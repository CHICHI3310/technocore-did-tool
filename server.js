"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const {
  createDid,
  buildKit,
  publicProofFromPrivateKey,
} = require("./lib/technocore");

const host = process.env.HOST || (process.env.CODESPACES === "true" ? "0.0.0.0" : "127.0.0.1");
let port = Number.parseInt(process.env.PORT || process.argv[2] || "5173", 10);
const root = __dirname;
const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
const SIGNED_LOBBY_DID = "did:key:z6MkmG43WHHvGCYgJDkfgdoGK6os6YogvEPNptb9aGw9Pd8z";
const SIGNED_LOBBY_TEXT = "chichi1031moon checking in. DID identity active. $FLOP";
let lobbyForwarded = false;

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
  const safePathname = pathname === "/" ? "/index.html" : pathname;
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
