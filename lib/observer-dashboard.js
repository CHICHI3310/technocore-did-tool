"use strict";

const { loadState } = require("./observer-state");
const { IDENTITY, MONITORED_ROOMS } = require("../observer");

const FRESH_SECONDS = 15 * 60;
const OFFLINE_SECONDS = 60 * 60;
const SECRET_KEYS = /privateKeyJwk|privateKey|secret|seed|token|credential|password|wallet/i;

function ageSeconds(value, now = new Date()) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 1000) : null;
}

function retentionSummary(state) {
  const values = [state.mailbox, ...MONITORED_ROOMS.map((room) => state.rooms[room])];
  return values.reduce((summary, room) => {
    const key = room?.retentionStatus || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, { active: 0, expired: 0, unknown: 0 });
}

function determineAgentStatus(state, now = new Date()) {
  if (!state.lastSuccessfulRunAt && !state.lastErrorAt) return { status: "UNKNOWN", statusReason: "No observation has run." };
  const age = ageSeconds(state.lastSuccessfulRunAt, now);
  if (age === null || age > OFFLINE_SECONDS) return { status: "OFFLINE", statusReason: "Observer has not succeeded recently." };
  const rooms = MONITORED_ROOMS.map((room) => state.rooms[room]);
  const failed = state.failedEndpoints?.length > 0;
  const degraded = failed || rooms.some((room) => !room || room.cursorGap || room.retentionStatus === "expired") || state.mailbox.retentionStatus === "expired";
  if (degraded || age > FRESH_SECONDS) return { status: "DEGRADED", statusReason: degraded ? "Observer warnings require attention." : "Last success is older than 15 minutes." };
  return { status: "ONLINE", statusReason: "Recent observation succeeded and monitored endpoints are healthy." };
}

function publicStatus(state, now = new Date()) {
  const agent = determineAgentStatus(state, now);
  const rooms = MONITORED_ROOMS.map((name) => {
    const room = state.rooms[name];
    return {
      name,
      status: room ? (room.cursorGap || room.retentionStatus === "expired" ? "WARNING" : "ACTIVE") : "UNKNOWN",
      lastSeq: room?.lastSeq ?? null,
      lastReadAt: room?.lastReadAt ?? null,
      cursorGap: room?.cursorGap === true,
      retention: room?.retentionStatus || "unknown",
    };
  });
  const cursorGaps = rooms.filter((room) => room.cursorGap).length;
  const provenance = state.provenance || { verified: 0, failed: 0, unavailable: 0 };
  return {
    ok: true,
    agent,
    identity: {
      did: IDENTITY.did,
      profile: state.profileNote?.lastReadAt ? "FOUND" : "UNKNOWN",
      mailbox: state.mailbox?.lastReadAt ? "ONLINE" : "UNKNOWN",
      mailboxId: IDENTITY.mailbox,
    },
    technocore: { version: state.manifest?.version || "UNKNOWN" },
    observer: {
      lastCheckAt: [state.lastSuccessfulRunAt, state.lastErrorAt].filter(Boolean).sort().at(-1) || null,
      lastSuccessAt: state.lastSuccessfulRunAt,
      lastError: state.lastError || null,
      failedEndpoints: Array.isArray(state.failedEndpoints) ? state.failedEndpoints : [],
    },
    rooms,
    retention: { profile: state.profileNote?.retentionStatus || "unknown", mailbox: state.mailbox?.retentionStatus || "unknown", rooms: retentionSummary(state) },
    mailbox: { newMessages: state.mailbox?.newMessages || 0, lastSeq: state.mailbox?.lastSeq || 0 },
    events: { newRoomEvents: state.events?.newMessages || 0, cursorGaps },
    provenance,
    warnings: [
      ...(cursorGaps ? ["Cursor gap detected"] : []),
      ...(state.profileNote?.retentionStatus === "unknown" ? ["Profile retention is unknown"] : []),
      ...(state.mailboxMessages || []).some((message) => message.instructionDetected) ? ["Potential instruction detected"] : [],
    ],
  };
}

function assertPublicPayload(payload) {
  const serialized = JSON.stringify(payload);
  if (SECRET_KEYS.test(serialized)) throw new Error("Dashboard payload contains a forbidden secret field.");
  return payload;
}

async function loadPublicStatus(statePath) {
  const state = await loadState(statePath, IDENTITY);
  return assertPublicPayload(publicStatus(state));
}

module.exports = { assertPublicPayload, determineAgentStatus, loadPublicStatus, publicStatus };
