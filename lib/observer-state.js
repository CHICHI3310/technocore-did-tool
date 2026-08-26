"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function createInitialState(identity) {
  return {
    schemaVersion: 1,
    did: identity.did,
    fingerprint: identity.fingerprint,
    profileNote: {
      namespace: `did-${identity.fingerprint.slice(0, 2)}`,
      key: identity.fingerprint.slice(2),
      lastReadAt: null,
      contentHash: null,
      retentionStatus: "unknown",
    },
    mailbox: {
      room: identity.mailbox,
      lastSeq: 0,
      lastReadAt: null,
      contentHash: null,
      retentionStatus: "unknown",
      newMessages: 0,
    },
    mailboxMessages: [],
    rooms: {},
    events: {
      lastSeq: 0,
      lastReadAt: null,
      contentHash: null,
      newMessages: 0,
    },
    provenance: { verified: 0, failed: 0, unavailable: 0 },
    manifest: {
      lastReadAt: null,
      contentHash: null,
      version: null,
    },
    roomsIndex: {
      lastReadAt: null,
      contentHash: null,
    },
    lastSuccessfulRunAt: null,
    lastErrorAt: null,
    lastError: null,
    failedEndpoints: [],
  };
}

function validateState(state, identity) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Observer state must be a JSON object.");
  }
  if (state.schemaVersion !== 1 || state.did !== identity.did || state.fingerprint !== identity.fingerprint) {
    throw new Error("Observer state identity or schema does not match the configured identity.");
  }
  if (state.mailbox?.room !== identity.mailbox) {
    throw new Error("Observer state mailbox does not match the configured mailbox.");
  }
  if (!Array.isArray(state.mailboxMessages)) state.mailboxMessages = [];
  if (!Array.isArray(state.failedEndpoints)) state.failedEndpoints = [];
  if (!("lastError" in state)) state.lastError = null;
  for (const message of state.mailboxMessages) {
    if (message && typeof message === "object" && "text" in message) {
      throw new Error("Observer state must not persist mailbox message text.");
    }
  }
  return state;
}

async function loadState(filePath, identity) {
  try {
    const state = JSON.parse(await fs.readFile(filePath, "utf8"));
    return validateState(state, identity);
  } catch (error) {
    if (error.code === "ENOENT") return createInitialState(identity);
    if (error instanceof SyntaxError) throw new Error("Observer state is not valid JSON.");
    throw error;
  }
}

async function saveState(filePath, state, identity) {
  validateState(state, identity);
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

module.exports = { createInitialState, loadState, saveState, validateState };