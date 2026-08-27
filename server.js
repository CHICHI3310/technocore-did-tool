"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const {
  createDid,
  buildKit,
  publicProofFromPrivateKey,
} = require("./lib/technocore");
const observerTools = require("./lib/technocore-observer");
const { IDENTITY, observeOnce } = require("./observer");
const { loadPublicStatus } = require("./lib/observer-dashboard");
const { loadState, saveState } = require("./lib/observer-state");
const { RetentionKeeper, RESOURCE_ALLOWLIST } = require("./lib/retention-keeper");

const host = process.env.HOST || (process.env.CODESPACES === "true" ? "0.0.0.0" : "127.0.0.1");
let port = Number.parseInt(process.env.PORT || process.argv[2] || "5173", 10);
const root = __dirname;
const observerStatePath = path.join(root, "data", "chichi-observer-state.json");
const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
const SIGNED_LOBBY_DID = "did:key:z6MkmG43WHHvGCYgJDkfgdoGK6os6YogvEPNptb9aGw9Pd8z";
const SIGNED_LOBBY_TEXT = "chichi1031moon checking in. DID identity active. $FLOP";
let lobbyForwarded = false;
const retentionKeeper = new RetentionKeeper({ writeEnabled: false });

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  send(response, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function validKeeperRequest(request) {
  const host = String(request.headers.host || "");
  const origin = request.headers.origin;
  if (!host || host.includes("@") || host.includes("/")) return false;
  if (!origin) return ["localhost", "127.0.0.1", "[::1]"].includes(host.split(":")[0]);
  try {
    const originUrl = new URL(origin);
    return ["http:", "https:"].includes(originUrl.protocol) && originUrl.host === host;
  } catch {
    return false;
  }
}

function validJsonRequest(request) {
  return String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function saveKeeperResult(resourceId, result) {
  const state = await loadState(observerStatePath, IDENTITY);
  const resource = state.keeper.resources[resourceId];
  if (resource) {
    resource.lastResult = result.status;
    resource.httpStatus = result.httpStatus ?? null;
    resource.conflict = result.status === "CONFLICT";
    if (result.observedHash) resource.observedHash = result.observedHash;
    if (result.currentValueMatch) resource.currentValueMatch = result.currentValueMatch;
    if (result.status !== "WRITE_DISABLED") resource.lastCheckedAt = resource.lastCheckedAt || new Date().toISOString();
    if (result.lastVerifiedMaintenanceAt) resource.lastVerifiedMaintenanceAt = result.lastVerifiedMaintenanceAt;
  }
  state.keeper.status = result.status;
  await saveState(observerStatePath, state, IDENTITY);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString("utf8");
    if (body.length > 64 * 1024) {
      throw new Error("Request body is too large.");
    }
  }

  return body ? JSON.parse(body) : {};
}

async function readLobbyNonce() {
  const response = await fetch("https://technocore.chat/r/lobby?limit=200&format=json");
  if (!response.ok) throw new Error("Could not read the lobby history.");
  const data = await response.json();
  let lastNonce = 0n;
  for (const message of Array.isArray(data.messages) ? data.messages : []) {
    if (message.from !== SIGNED_LOBBY_DID || !/^\d{1,19}$/.test(String(message.nonce))) continue;
    const nonce = BigInt(String(message.nonce));
    if (nonce > lastNonce) lastNonce = nonce;
  }
  const candidate = lastNonce + 1n > BigInt(Date.now()) ? lastNonce + 1n : BigInt(Date.now());
  if (candidate.toString().length > 19) throw new Error("No valid lobby nonce is available.");
  return candidate.toString();
}

async function forwardLobbyMessage(message) {
  const response = await fetch("https://technocore.chat/r/lobby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = await response.text();
  return { ok: response.ok, source: "technocore", status: response.status, body, error: "" };
}

async function handleApi(request, response, pathname) {
  try {
    if (pathname === "/api/keeper/check" || pathname === "/api/keeper/confirm") {
      if (request.method !== "POST" || !validKeeperRequest(request) || !validJsonRequest(request)) {
        sendJson(response, 403, { ok: false, status: "FAILED", error: "Keeper request rejected." });
        return;
      }
      const body = await readJson(request);
      const expectedKeys = pathname.endsWith("/check") ? ["resourceId"] : ["confirmationToken"];
      if (Object.keys(body).sort().join(",") !== expectedKeys.join(",")) {
        sendJson(response, 400, { ok: false, status: "FAILED", error: "Invalid Keeper request." });
        return;
      }
      if (pathname.endsWith("/check")) {
        if (typeof body.resourceId !== "string" || !RESOURCE_ALLOWLIST[body.resourceId]) {
          sendJson(response, 400, { ok: false, status: "FAILED", error: "Keeper resource is not allowlisted." });
          return;
        }
        const result = await retentionKeeper.check(body.resourceId);
        await saveKeeperResult(body.resourceId, result);
        sendJson(response, result.status === "FAILED" ? 409 : 200, { ok: result.status !== "FAILED", liveWrite: "DISABLED", ...result });
        return;
      }
      if (typeof body.confirmationToken !== "string" || body.confirmationToken.length !== 64) {
        sendJson(response, 400, { ok: false, status: "FAILED", error: "Invalid confirmation token." });
        return;
      }
      const result = await retentionKeeper.confirm(body.confirmationToken);
      if (result.resourceId) await saveKeeperResult(result.resourceId, result);
      sendJson(response, result.status === "VERIFIED" || result.status === "WRITE_DISABLED" ? 200 : 409, { ok: result.status === "VERIFIED" || result.status === "WRITE_DISABLED", liveWrite: "DISABLED", ...result });
      return;
    }

    if (request.method === "GET" && pathname === "/api/observer/status") {
      sendJson(response, 200, await loadPublicStatus(observerStatePath));
      return;
    }

    if (request.method === "GET" && pathname === "/api/observer/mailbox") {
      const state = await loadState(observerStatePath, IDENTITY);
      const result = await observerTools.getJson(observerTools.roomUrl(process.env.TECHNOCORE_URL || "https://technocore.chat", IDENTITY.mailbox, state.mailbox.lastSeq), fetch);
      const messages = Array.isArray(result.data.messages) ? result.data.messages : [];
      const { mailboxMessageMetadata, classifyMailboxMessage } = observerTools;
      const publicMessages = messages.map((message) => ({
        seq: Number.isSafeInteger(Number(message?.seq)) ? Number(message.seq) : null,
        timestamp: typeof message?.ts === "string" ? message.ts : null,
        from: typeof message?.from === "string" ? message.from : null,
        signed: typeof message?.sig === "string" && message.sig.length > 0,
        ...classifyMailboxMessage(message),
        content: typeof message?.text === "string" ? message.text : "",
        metadata: mailboxMessageMetadata(IDENTITY.mailbox, message, new Date().toISOString()),
      }));
      sendJson(response, 200, { ok: true, newMessages: publicMessages });
      return;
    }

    if (request.method === "POST" && pathname === "/api/observer/refresh") {
      await observeOnce();
      const status = await loadPublicStatus(observerStatePath);
      sendJson(response, 200, status);
      return;
    }

    if (request.method === "GET" && pathname === "/api/lobby-nonce") {
      sendJson(response, 200, { ok: true, nonce: await readLobbyNonce() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/post-signed-lobby") {
      if (lobbyForwarded) {
        sendJson(response, 409, {
          ok: false,
          source: "local",
          status: 409,
          body: "",
          error: "The lobby message was already submitted.",
        });
        return;
      }
      const body = await readJson(request);
      const keys = Object.keys(body).sort();
      if (keys.join(",") !== "did,nonce,sig,text" ||
        body.did !== SIGNED_LOBBY_DID || body.text !== SIGNED_LOBBY_TEXT ||
        !/^\d{1,19}$/.test(String(body.nonce)) || !/^[A-Za-z0-9_-]{86}$/.test(String(body.sig))) {
        sendJson(response, 400, {
          ok: false,
          source: "local",
          status: 400,
          body: "",
          error: "Invalid signed lobby message.",
        });
        return;
      }
      let result;
      try {
        result = await forwardLobbyMessage(body);
      } catch (error) {
        result = { ok: false, source: "technocore", status: 502, body: "", error: "Technocore request failed." };
      }
      if (result.ok) lobbyForwarded = true;
      sendJson(response, result.status, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/create-did") {
      sendJson(response, 200, { ok: true, ...createDid() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/build-kit") {
      const body = await readJson(request);
      sendJson(response, 200, { ok: true, ...buildKit(body) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/public-proof") {
      const body = await readJson(request);
      sendJson(response, 200, { ok: true, ...publicProofFromPrivateKey(body.privateKeyJwk) });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found." });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      source: "local",
      status: 400,
      body: "",
      error: error.message,
    });
  }
}

async function handleStatic(response, pathname) {
  const safePathname = pathname === "/" ? "/index.html" : pathname === "/dashboard" ? "/dashboard.html" : pathname;
  const filePath = path.normalize(path.join(root, decodeURIComponent(safePathname)));

  if (filePath !== root && !filePath.startsWith(safeRoot)) {
    send(response, 403, "Forbidden");
    return;
  }

  const body = await fs.readFile(filePath);
  send(response, 200, body, contentTypes[path.extname(filePath)] || "application/octet-stream");
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl.pathname);
      return;
    }

    await handleStatic(response, requestUrl.pathname);
  } catch (error) {
    if (error.code === "ENOENT") {
      send(response, 404, "Not found");
      return;
    }

    send(response, 500, "Server error");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && port < 5190) {
    port += 1;
    console.warn(`Port ${port - 1} is already in use. Trying ${port}...`);
    server.listen(port, host);
    return;
  }

  console.error(error.message);
  process.exit(1);
});

server.listen(port, host, () => {
  const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`Technocore DID Tool running at http://${shownHost}:${port}`);
});

module.exports = { server, validJsonRequest, validKeeperRequest };
