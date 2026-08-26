"use strict";

const crypto = require("node:crypto");

const RETENTION_SECONDS = 604800;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

function normalizeBaseUrl(value = "https://technocore.chat") {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Observer base URL must be an HTTP(S) origin.");
  }
  return url.origin;
}

function hashContent(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function roomUrl(baseUrl, room, since) {
  if (!NAME_RE.test(room)) throw new Error("Invalid monitored room name.");
  const url = new URL(`/r/${room}`, baseUrl);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "200");
  if (Number.isSafeInteger(since) && since > 0) url.searchParams.set("since", String(since));
  return url;
}

async function get(url, fetchImpl = fetch) {
  const response = await fetchImpl(String(url), { method: "GET", cache: "no-store" });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Technocore GET failed with ${response.status}.`);
    error.status = response.status;
    error.body = body.slice(0, 500);
    throw error;
  }
  return { body, status: response.status };
}

async function getJson(url, fetchImpl = fetch) {
  const result = await get(url, fetchImpl);
  try {
    return { ...result, data: JSON.parse(result.body) };
  } catch {
    throw new Error("Technocore GET did not return valid JSON.");
  }
}

function retentionFromLastWrite(lastWriteAt, now = new Date()) {
  const writeTime = Date.parse(lastWriteAt);
  if (!Number.isFinite(writeTime)) return { retentionStatus: "unknown" };
  const remaining = Math.min(RETENTION_SECONDS, Math.max(0, RETENTION_SECONDS - (now.getTime() - writeTime) / 1000));
  return {
    retentionStatus: remaining > 0 ? "active" : "expired",
    lastWriteAt: new Date(writeTime).toISOString(),
    retentionSecondsRemaining: Math.floor(remaining),
  };
}

function inspectRoom(room, data, observedAt, now = new Date(observedAt)) {
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const latest = messages.at(-1);
  const lastSeq = Number.isSafeInteger(Number(latest?.seq)) ? Number(latest.seq) : null;
  const firstSeq = Number.isSafeInteger(Number(data.first_seq)) ? Number(data.first_seq) : null;
  const result = {
    room,
    lastSeq,
    firstSeq,
    messageCount: messages.length,
    lastReadAt: observedAt,
    contentHash: hashContent(JSON.stringify(data)),
    ...retentionFromLastWrite(latest?.ts, now),
  };
  return result;
}

function inspectNote(namespace, key, body, observedAt) {
  return {
    namespace,
    key,
    lastReadAt: observedAt,
    contentHash: hashContent(body),
    retentionStatus: "unknown",
  };
}

function didFromDidKey(did) {
  if (typeof did !== "string" || !did.startsWith("did:key:z")) throw new Error("Unsupported DID.");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const character of did.slice(9)) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid did:key base58 value.");
    value = value * 58n + BigInt(digit);
  }
  let hex = value.toString(16).padStart(2, "0");
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error("Unsupported did:key codec.");
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: bytes.subarray(2).toString("base64url") }, format: "jwk" });
}

function verifySignedMessage(room, message) {
  if (!message?.from?.startsWith("did:key:") || typeof message.sig !== "string") {
    return { status: "unavailable", reason: "The public response has no retained signature envelope." };
  }
  if (!/^\d{1,19}$/.test(String(message.nonce)) || !/^[A-Za-z0-9_-]{86}$/.test(message.sig)) {
    return { status: "invalid", reason: "Invalid nonce or signature encoding." };
  }
  try {
    const valid = crypto.verify(null, Buffer.from(`${room}|${message.nonce}|${message.text}`, "utf8"), didFromDidKey(message.from), Buffer.from(message.sig, "base64url"));
    return valid ? { status: "verified" } : { status: "invalid", reason: "Signature verification failed." };
  } catch (error) {
    return { status: "invalid", reason: error.message };
  }
}

module.exports = {
  RETENTION_SECONDS,
  get,
  getJson,
  hashContent,
  inspectNote,
  inspectRoom,
  normalizeBaseUrl,
  retentionFromLastWrite,
  roomUrl,
  verifySignedMessage,
};