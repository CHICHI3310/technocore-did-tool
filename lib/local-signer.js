"use strict";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4319;

function createLocalSignerState({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  return {
    mode: "stub",
    host,
    port,
    ready: true,
    keyConfigured: false,
    liveWrite: "DISABLED",
    exposesPrivateKey: false,
    supports: ["health", "sign-request-validation"],
    allowedAlgorithms: ["Ed25519"],
  };
}

function safeHealthResponse(overrides = {}) {
  return {
    ok: true,
    mode: "stub",
    ready: true,
    keyConfigured: false,
    liveWrite: "DISABLED",
    exposesPrivateKey: false,
    supports: ["health", "sign-request-validation"],
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    ...overrides,
  };
}

function validateSignerRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Signer request must be a JSON object.");
  }

  if (typeof body.canonical !== "string" || body.canonical.length === 0) {
    throw new Error("Canonical payload is required.");
  }

  const algorithm = String(body.algorithm || "Ed25519").trim();
  if (!/^(Ed25519|ed25519)$/.test(algorithm)) {
    throw new Error("Only Ed25519 signing is allowed.");
  }

  if (Object.prototype.hasOwnProperty.call(body, "privateKeyJwk") ||
      Object.prototype.hasOwnProperty.call(body, "seed") ||
      Object.prototype.hasOwnProperty.call(body, "privateKey") ||
      Object.prototype.hasOwnProperty.call(body, "d")) {
    throw new Error("Private key material is not accepted by the local signer API.");
  }

  return {
    did: typeof body.did === "string" && body.did.length > 0 ? body.did : null,
    algorithm: "Ed25519",
    canonical: body.canonical,
    nonce: typeof body.nonce === "string" && body.nonce.length > 0 ? body.nonce : null,
    purpose: typeof body.purpose === "string" && body.purpose.length > 0 ? body.purpose : "local-sign",
  };
}

function safeSignResponse(body = {}) {
  const request = validateSignerRequest(body);
  return {
    ok: false,
    status: "STUB_NO_KEY",
    mode: "stub",
    ready: true,
    keyConfigured: false,
    liveWrite: "DISABLED",
    did: request.did,
    signature: null,
    publicKeyJwk: null,
    publicMetadata: {
      did: request.did,
      algorithm: request.algorithm,
      mode: "stub",
    },
    purpose: request.purpose,
    note: "Local signer is running in stub mode and has no secret key configured.",
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createLocalSignerState,
  safeHealthResponse,
  safeSignResponse,
  validateSignerRequest,
};
