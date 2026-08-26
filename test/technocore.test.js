"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const {
  buildKit,
  cleanText,
  createDid,
  fingerprintOfDid,
  publicProofFromPrivateKey,
  requireName,
  sign,
} = require("../lib/technocore");

test("creates an Ed25519 did:key with a Technocore-compatible shape", () => {
  const identity = createDid();
  assert.match(identity.did, /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/);
  assert.equal(identity.fingerprint, fingerprintOfDid(identity.did));
  assert.equal(identity.publicKeyJwk.crv, "Ed25519");
  assert.equal(identity.privateKeyJwk.crv, "Ed25519");
});

test("signs canonical Technocore room messages", () => {
  const identity = createDid();
  const canonical = `lobby|123|hello technocore`;
  const sig = sign(identity.privateKeyJwk, canonical);
  const privateKey = crypto.createPrivateKey({ key: identity.privateKeyJwk, format: "jwk" });
  const publicKey = crypto.createPublicKey(privateKey);
  assert.equal(sig.length, 86);
  assert.equal(
    crypto.verify(null, Buffer.from(canonical, "utf8"), publicKey, Buffer.from(sig, "base64url")),
    true,
  );
});

test("builds one profile note and signed proof URLs", () => {
  const identity = createDid();
  const kit = buildKit({
    privateKeyJwk: identity.privateKeyJwk,
    agentName: "ufuk_agent",
    xHandle: "UfukNode",
    contributionType: "tool",
    contributionSummary: "Simple Technocore DID starter for agents.",
    guideUrl: "https://example.com/guide",
    baseUrl: "https://technocore.chat",
    nonceBase: 1000,
  });

  assert.equal(kit.did, identity.did);
  assert.equal(kit.agentName, "ufuk_agent");
  assert.match(kit.mailbox, /^mb-p-[a-f0-9]{24}$/);
  assert.match(kit.privateRoom, /^p-[a-f0-9]{24}$/);
  assert.equal(kit.profileNote.ns, `did-${kit.fingerprint.slice(0, 2)}`);
  assert.equal(kit.profileNote.key, kit.fingerprint.slice(2));
  assert.equal(
    kit.profileNote.url,
    `https://technocore.chat/kv/did-${kit.fingerprint.slice(0, 2)}/${kit.fingerprint.slice(2)}/set/${encodeURIComponent(kit.profileNote.value)}`,
  );
  assert.ok(kit.profileNote.url.includes("https%3A%2F%2Fexample.com%2Fguide"));
  assert.ok(!kit.profileNote.url.includes("https%3A%252F%252Fexample.com"));
  assert.match(kit.contributionNote.url, /^https:\/\/technocore\.chat\/kv\/contrib\//);
  assert.ok(kit.contributionNote.value.includes("type:tool"));
  assert.ok(kit.lobbyProof.text.includes(`/kv/contrib/${kit.fingerprint}`));
  assert.match(kit.lobbyProof.url, /\/r\/lobby\/say-signed\//);
  assert.match(kit.mailboxProof.url, /\/r\/mb-p-/);
  assert.ok(kit.exportMarkdown.includes("No airdrop eligibility is guaranteed"));
  assert.ok(kit.exportMarkdown.includes("Contribution note:"));
});

test("rejects invalid names and cleans invisible text", () => {
  assert.throws(() => requireName("../bad", "Agent name"), /must match/);
  assert.equal(cleanText("hello\u200b\nworld", 100), "hello world");
});

test("requires an explicit contribution type and summary", () => {
  const identity = createDid();
  assert.throws(
    () => buildKit({ privateKeyJwk: identity.privateKeyJwk, contributionSummary: "Useful guide." }),
    /Contribution type is required/,
  );
  assert.throws(
    () => buildKit({ privateKeyJwk: identity.privateKeyJwk, contributionType: "guide" }),
    /Text cannot be empty/,
  );
});

test("derives the public proof from a private JWK", () => {
  const identity = createDid();
  const proof = publicProofFromPrivateKey(identity.privateKeyJwk);
  assert.equal(proof.did, identity.did);
  assert.equal(proof.fingerprint, identity.fingerprint);
});

test("rebuilds a kit in the browser without creating a new DID", async () => {
  const context = { window: {}, crypto: crypto.webcrypto, atob, btoa, TextEncoder, URL };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("lib/technocore-browser.js", "utf8"), context);
  const identity = createDid();
  const kit = await context.window.TechnocoreBrowser.buildKit({
    privateKeyJwk: identity.privateKeyJwk,
    agentName: "restore_test",
    contributionType: "tool",
    contributionSummary: "Browser-only restore test.",
    baseUrl: "https://technocore.chat",
    nonceBase: 1000,
  });

  assert.equal(kit.did, identity.did);
  assert.equal(kit.fingerprint, identity.fingerprint);
  assert.equal(kit.profileNote.ns, `did-${identity.fingerprint.slice(0, 2)}`);
  assert.equal(kit.profileNote.key, identity.fingerprint.slice(2));
  assert.match(kit.lobbyProof.url, /\/r\/lobby\/say-signed\//);
});

  test("creates a browser DID and uses the sharded profile namespace", async () => {
    const context = { window: {}, crypto: crypto.webcrypto, atob, btoa, TextEncoder, URL };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync("lib/technocore-browser.js", "utf8"), context);
    const identity = await context.window.TechnocoreBrowser.createDid();
    const kit = await context.window.TechnocoreBrowser.buildKit({
      privateKeyJwk: identity.privateKeyJwk,
      agentName: "create_test",
      contributionType: "tool",
      contributionSummary: "Browser-only create test.",
      baseUrl: "https://technocore.chat",
      nonceBase: 1000,
    });

    assert.equal(kit.did, identity.did);
    assert.equal(kit.fingerprint, identity.fingerprint);
    assert.equal(kit.profileNote.ns, `did-${identity.fingerprint.slice(0, 2)}`);
    assert.equal(kit.profileNote.key, identity.fingerprint.slice(2));
    assert.match(kit.contributionNote.url, /\/kv\/contrib\/[a-f0-9]{16}\/set\//);
  });

test("posts only the public signed lobby envelope", async () => {
  const context = { window: {}, crypto: crypto.webcrypto, atob, btoa, TextEncoder, URL };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("lib/technocore-browser.js", "utf8"), context);
  let request;
  const response = await context.window.TechnocoreBrowser.postSignedLobbyMessage({
    did: context.window.TechnocoreBrowser.SIGNED_LOBBY_DID,
    sig: "a".repeat(86),
    nonce: "1787699669000",
    text: context.window.TechnocoreBrowser.SIGNED_LOBBY_TEXT,
  }, async (url, options) => {
    request = { url, options };
    return { ok: true };
  });

  assert.equal(response.ok, true);
  assert.equal(request.url, "https://technocore.chat/r/lobby");
  assert.deepEqual(JSON.parse(request.options.body), {
    did: context.window.TechnocoreBrowser.SIGNED_LOBBY_DID,
    sig: "a".repeat(86),
    nonce: "1787699669000",
    text: context.window.TechnocoreBrowser.SIGNED_LOBBY_TEXT,
  });
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.includes("privateKeyJwk"), false);
});

test("rejects a non-required DID for the fixed lobby message", async () => {
  const context = { window: {}, crypto: crypto.webcrypto, atob, btoa, TextEncoder, URL };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("lib/technocore-browser.js", "utf8"), context);
  await assert.rejects(
    context.window.TechnocoreBrowser.buildSignedLobbyMessage({
      kty: "OKP",
      crv: "Ed25519",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      d: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }, "1787699669000"),
    /required lobby DID/,
  );
});
