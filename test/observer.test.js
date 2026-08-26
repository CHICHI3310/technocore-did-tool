"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createInitialState, loadState, saveState } = require("../lib/observer-state");
const { inspectNote, inspectRoom, retentionFromLastWrite, verifySignedMessage } = require("../lib/technocore-observer");
const { IDENTITY } = require("../observer");

test("keeps the existing DID and mailbox in initial state", () => {
  const state = createInitialState(IDENTITY);
  assert.equal(state.did, IDENTITY.did);
  assert.equal(state.mailbox.room, IDENTITY.mailbox);
  assert.equal(state.profileNote.retentionStatus, "unknown");
});

test("never estimates note retention from read time", () => {
  const note = inspectNote("did-52", "ad66441569e0fa", "public profile", "2026-08-26T00:00:00.000Z");
  assert.equal(note.retentionStatus, "unknown");
  assert.equal(note.lastReadAt, "2026-08-26T00:00:00.000Z");
});

test("calculates room retention only from an official message timestamp", () => {
  const now = new Date("2026-08-26T00:00:00.000Z");
  const room = inspectRoom("lobby", { first_seq: 10, messages: [{ seq: 10, ts: "2026-08-25T00:00:00.000Z", text: "data" }] }, now.toISOString());
  assert.equal(room.retentionStatus, "active");
  assert.equal(room.retentionSecondsRemaining, 518400);
  assert.equal(inspectRoom("empty", { messages: [] }, now.toISOString()).retentionStatus, "unknown");
  assert.equal(retentionFromLastWrite("not-a-date").retentionStatus, "unknown");
});

test("does not verify a signature that the public response did not retain", () => {
  assert.equal(verifySignedMessage("lobby", { from: IDENTITY.did, nonce: "1", text: "data" }).status, "unavailable");
});

test("saves only matching identity state atomically", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chichi-observer-"));
  const filePath = path.join(directory, "state.json");
  const state = createInitialState(IDENTITY);
  await saveState(filePath, state, IDENTITY);
  const loaded = await loadState(filePath, IDENTITY);
  assert.equal(loaded.did, IDENTITY.did);
  await assert.rejects(loadState(filePath, { ...IDENTITY, did: "did:key:wrong" }), /does not match/);
});