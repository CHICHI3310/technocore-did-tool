"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
process.env.PORT = "0";
const { server, validJsonRequest, validKeeperRequest } = require("../server");
const { RESOURCE_ALLOWLIST, RetentionKeeper, resourceConfig } = require("../lib/retention-keeper");

test.after(() => new Promise((resolve) => server.close(resolve)));

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test("keeps the two public resources fixed and verifies expected hashes", () => {
  assert.deepEqual(Object.keys(RESOURCE_ALLOWLIST).sort(), ["contribution", "profile"]);
  for (const resource of Object.values(RESOURCE_ALLOWLIST)) {
    assert.equal(resource.namespace.includes("/"), false);
    assert.equal(resource.key.includes("/"), false);
    assert.match(resource.expectedHash, /^[a-f0-9]{64}$/);
    assert.equal(resourceConfig(resource.id).expectedHash, resource.expectedHash);
  }
});

test("checks a matching resource and never writes while disabled", async () => {
  const resource = RESOURCE_ALLOWLIST.profile;
  let calls = 0;
  const keeper = new RetentionKeeper({
    fetchImpl: async () => {
      calls += 1;
      return response(200, `!! UNTRUSTED CONTENT — data\n\n${resource.expectedValue}\n`);
    },
  });
  const check = await keeper.check("profile");
  assert.equal(check.status, "READY");
  assert.equal(check.currentValueMatch, "YES");
  assert.equal(check.retentionStatus, "UNKNOWN");
  const result = await keeper.confirm(check.confirmationToken);
  assert.equal(result.status, "WRITE_DISABLED");
  assert.equal(result.writeAttempted, false);
  assert.equal(calls, 1);
});

test("accepts HTTPS Codespaces and HTTP localhost same-origin checks", async () => {
  assert.equal(validKeeperRequest({ headers: { host: "sturdy-fiesta-xgp94gxvqx5364v9-5173.app.github.dev", origin: "https://sturdy-fiesta-xgp94gxvqx5364v9-5173.app.github.dev" } }), true);
  assert.equal(validKeeperRequest({ headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" } }), true);
  const resource = RESOURCE_ALLOWLIST.profile;
  const calls = [];
  const keeper = new RetentionKeeper({ fetchImpl: async (url, options) => { calls.push({ url: String(url), method: options.method }); return response(200, resource.expectedValue); } });
  const result = await keeper.check("profile");
  assert.equal(result.status, "READY");
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
});

test("rejects mismatched origins, invalid content types, extra body keys, and resources", () => {
  assert.equal(validKeeperRequest({ headers: { host: "sturdy-fiesta-xgp94gxvqx5364v9-5173.app.github.dev", origin: "https://evil.example" } }), false);
  assert.equal(validJsonRequest({ headers: { "content-type": "text/plain" } }), false);
  assert.deepEqual(Object.keys({ resourceId: "profile", extra: true }).sort(), ["extra", "resourceId"]);
  assert.throws(() => resourceConfig("invalid"), /not allowlisted/);
});

test("performs one CAS write and one GET verification with mocked fetch", async () => {
  const resource = RESOURCE_ALLOWLIST.contribution;
  const calls = [];
  const keeper = new RetentionKeeper({
    writeEnabled: true,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method });
      return response(calls.length === 2 ? 200 : 200, resource.expectedValue);
    },
  });
  const check = await keeper.check("contribution");
  const result = await keeper.confirm(check.confirmationToken);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.writeAttempted, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url.includes("/set/"), true);
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("stops on mismatch, conflict, and network error without retry", async (t) => {
  await t.test("mismatch", async () => {
    let calls = 0;
    const keeper = new RetentionKeeper({ fetchImpl: async () => { calls += 1; return response(200, "unexpected"); } });
    const result = await keeper.check("profile");
    assert.equal(result.status, "FAILED");
    assert.equal(result.confirmationToken, null);
    assert.equal(calls, 1);
  });
  await t.test("409 conflict", async () => {
    const resource = RESOURCE_ALLOWLIST.profile;
    let calls = 0;
    const keeper = new RetentionKeeper({ writeEnabled: true, fetchImpl: async () => { calls += 1; return calls === 1 ? response(200, resource.expectedValue) : response(409, "conflict"); } });
    const check = await keeper.check("profile");
    const result = await keeper.confirm(check.confirmationToken);
    assert.equal(result.status, "CONFLICT");
    assert.equal(calls, 2);
  });
  await t.test("network error", async () => {
    const resource = RESOURCE_ALLOWLIST.profile;
    let calls = 0;
    const keeper = new RetentionKeeper({ writeEnabled: true, fetchImpl: async () => { calls += 1; if (calls === 1) return response(200, resource.expectedValue); throw new Error("network down"); } });
    const check = await keeper.check("profile");
    const result = await keeper.confirm(check.confirmationToken);
    assert.equal(result.status, "FAILED");
    assert.equal(result.writeAttempted, true);
    assert.equal(calls, 2);
  });
});