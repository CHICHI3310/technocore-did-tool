"use strict";

const path = require("node:path");
const observerTools = require("./lib/technocore-observer");
const { fingerprintOfDid } = require("./lib/technocore");
const { loadState, saveState } = require("./lib/observer-state");

const IDENTITY = {
  did: "did:key:z6MkmG43WHHvGCYgJDkfgdoGK6os6YogvEPNptb9aGw9Pd8z",
  mailbox: "mb-p-ce1a40a93d281d973b18576e",
};
IDENTITY.fingerprint = fingerprintOfDid(IDENTITY.did);

const BASE_URL = observerTools.normalizeBaseUrl(process.env.TECHNOCORE_URL || "https://technocore.chat");
const STATE_PATH = path.join(__dirname, "data", "chichi-observer-state.json");
const MONITORED_ROOMS = ["lobby", "technocore", "agent-security", "flop-collective", "flop_labs"];

async function observeOnce(fetchImpl = fetch, now = new Date()) {
  const state = await loadState(STATE_PATH, IDENTITY);
  const observedAt = now.toISOString();
  const report = { did: IDENTITY.did, fingerprint: IDENTITY.fingerprint, observedAt, rooms: [], provenance: [] };
  try {
    const manifest = await observerTools.getJson(new URL("/.well-known/agent.json", BASE_URL), fetchImpl);
    state.manifest = { lastReadAt: observedAt, contentHash: observerTools.hashContent(manifest.body) };
    report.manifest = { name: manifest.data.name, version: manifest.data.version, limits: manifest.data.limits };

    const roomsIndex = await observerTools.get(new URL("/rooms", BASE_URL), fetchImpl);
    state.roomsIndex = { lastReadAt: observedAt, contentHash: observerTools.hashContent(roomsIndex.body) };
    report.roomsIndex = roomsIndex.body.split("\n").slice(0, 4);

    const eventQuery = state.events.lastSeq ? `?format=json&limit=50&since=${state.events.lastSeq}` : "?format=json&limit=50";
    const events = await observerTools.getJson(new URL(`/r/events${eventQuery}`, BASE_URL), fetchImpl);
    const eventMessages = Array.isArray(events.data.messages) ? events.data.messages : [];
    state.events = { lastSeq: Number(eventMessages.at(-1)?.seq) || state.events.lastSeq, lastReadAt: observedAt, contentHash: observerTools.hashContent(events.body) };
    report.newRoomEvents = eventMessages.length;

    const profile = await observerTools.get(new URL(`/kv/did-${IDENTITY.fingerprint.slice(0, 2)}/${IDENTITY.fingerprint.slice(2)}`, BASE_URL), fetchImpl);
    state.profileNote = observerTools.inspectNote(`did-${IDENTITY.fingerprint.slice(0, 2)}`, IDENTITY.fingerprint.slice(2), profile.body, observedAt);
    report.profile = { namespace: state.profileNote.namespace, key: state.profileNote.key, retentionStatus: "unknown" };

    for (const room of [IDENTITY.mailbox, ...MONITORED_ROOMS]) {
      const previous = state.rooms[room] || (room === IDENTITY.mailbox ? state.mailbox : { lastSeq: 0 });
      const result = await observerTools.getJson(observerTools.roomUrl(BASE_URL, room, previous.lastSeq), fetchImpl);
      const inspection = observerTools.inspectRoom(room, result.data, observedAt, now);
      if (inspection.lastSeq === null) inspection.lastSeq = previous.lastSeq || 0;
      inspection.cursorGap = previous.lastSeq > 0 && inspection.firstSeq !== null && inspection.firstSeq > previous.lastSeq + 1;
      state.rooms[room] = inspection;
      if (room === IDENTITY.mailbox) state.mailbox = inspection;
      report.rooms.push({ ...inspection, messagesRead: Array.isArray(result.data.messages) ? result.data.messages.length : 0 });
      for (const message of Array.isArray(result.data.messages) ? result.data.messages : []) {
        const verification = observerTools.verifySignedMessage(room, message);
        if (verification.status !== "unavailable") report.provenance.push({ room, seq: message.seq, ...verification });
      }
    }
    state.lastSuccessfulRunAt = observedAt;
    state.lastErrorAt = null;
    await saveState(STATE_PATH, state, IDENTITY);
    return report;
  } catch (error) {
    state.lastErrorAt = observedAt;
    await saveState(STATE_PATH, state, IDENTITY);
    throw error;
  }
}

if (require.main === module) {
  if (process.argv[2] !== "--once") {
    console.error("Usage: node observer.js --once");
    process.exitCode = 2;
  } else {
    observeOnce().then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { IDENTITY, MONITORED_ROOMS, observeOnce };