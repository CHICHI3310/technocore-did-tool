"use strict";

const crypto = require("node:crypto");
const observerTools = require("./technocore-observer");

const SAFE_TEXT_LIMIT = 2000;

function sanitizeUntrustedText(value) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, SAFE_TEXT_LIMIT);
}

function classifyConversationRisk(text) {
  const clean = sanitizeUntrustedText(text);
  const normalized = clean.toLowerCase();

  const blockedPatterns = [
    /secret key|private key|private jwk|seed|wallet seed|passphrase|ssh key|api key/i,
    /reveal.*(key|seed|jwk)|show.*(key|seed|jwk)|give.*(key|seed|jwk)/i,
    /shell|bash -c|powershell|cmd\.exe|rm -rf|chmod|sudo/i,
    /run .*command|execute .*command|execute .*script|run .*script/i,
    /read .*file|open .*file|write .*file|edit .*config|modify .*config|update .*settings/i,
  ];
  if (blockedPatterns.some((pattern) => pattern.test(clean))) {
    return {
      risk: "BLOCKED",
      classification: "BLOCKED",
      reason: "Blocked because the request attempts to obtain secrets, execute commands, or modify system settings.",
    };
  }

  const autoSafePatterns = [
    /^(hello|hi|hey|greetings|good morning|good evening|thanks|thank you|こんにちは|よろしく|おはよう|こんばんは|元気|ping)$/i,
    /\b(hello|hi|hey|greetings|thanks|thank you|こんにちは|よろしく|おはよう|こんばんは|ping)\b/i,
    /\b(check[- ]?in|checking in|daily check|status update)\b/i,
  ];
  if (autoSafePatterns.some((pattern) => pattern.test(clean)) && clean.length <= 220) {
    return {
      risk: "AUTO_SAFE_CANDIDATE",
      classification: "AUTO_SAFE_CANDIDATE",
      reason: "Short greeting or routine check-in is a candidate for a safe draft.",
    };
  }

  const userApprovalPatterns = [
    /contribution|profile|bio|about me|summary|guide|article|video/i,
    /https?:\/\//i,
    /\b(post|share|publish|announce|update)\b/i,
    /\b(wallet|token|authentication|auth|login|verify|identity)\b/i,
    /\b(please|can you|could you|would you)\b/i,
  ];
  if (clean.length > 600 || userApprovalPatterns.some((pattern) => pattern.test(clean))) {
    return {
      risk: "USER_APPROVAL_REQUIRED",
      classification: "USER_APPROVAL_REQUIRED",
      reason: "This message requires human review because it is long, action-oriented, or related to profile/contribution changes.",
    };
  }

  return {
    risk: "AUTO_SAFE_CANDIDATE",
    classification: "AUTO_SAFE_CANDIDATE",
    reason: "Short harmless conversation is a candidate for a draft, but not for automatic send.",
  };
}

function createConversationState(room, lastSeq = 0) {
  return {
    room,
    lastSeq: Number.isSafeInteger(lastSeq) ? lastSeq : 0,
    lastCheckedAt: null,
    lastMessageSeq: null,
  };
}

async function getNewPublicRoomMessages(baseUrl, room, roomState, fetchImpl = fetch) {
  const safeRoom = typeof room === "string" && room.trim() ? room.trim() : "lobby";
  const lastSeq = Number.isSafeInteger(Number(roomState?.lastSeq)) ? Number(roomState.lastSeq) : 0;
  const result = await observerTools.getJson(observerTools.roomUrl(baseUrl, safeRoom, lastSeq), fetchImpl);
  const payload = result?.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data : result;
  const messages = Array.isArray(payload?.messages) ? payload.messages : (Array.isArray(payload?.data?.messages) ? payload.data.messages : []);
  const newMessages = messages.filter((message) => {
    const seq = Number(message?.seq);
    return Number.isSafeInteger(seq) && seq > lastSeq;
  });

  const maxSeq = messages.reduce((highest, message) => {
    const seq = Number(message?.seq);
    return Number.isSafeInteger(seq) && seq > highest ? seq : highest;
  }, lastSeq);

  return {
    room: safeRoom,
    since: lastSeq,
    lastSeq: maxSeq,
    messages: newMessages.map((message) => ({
      seq: Number(message?.seq),
      from: typeof message?.from === "string" ? message.from : null,
      ts: typeof message?.ts === "string" ? message.ts : null,
      text: sanitizeUntrustedText(message?.text),
      risk: classifyConversationRisk(message?.text),
    })),
  };
}

function buildReplyDraft({ room, message, publicAgent = {} }) {
  const safeRoom = typeof room === "string" && room.trim() ? room.trim() : "lobby";
  const source = message && typeof message === "object" ? message : {};
  const sourceText = sanitizeUntrustedText(source.text);
  const risk = classifyConversationRisk(sourceText);
  const publicDid = typeof publicAgent.did === "string" && publicAgent.did.length > 0 ? publicAgent.did : null;
  const publicFingerprint = typeof publicAgent.fingerprint === "string" && publicAgent.fingerprint.length > 0 ? publicAgent.fingerprint : null;
  const seq = Number.isSafeInteger(Number(source.seq)) ? Number(source.seq) : null;

  const draftId = crypto.createHash("sha256").update(`${safeRoom}|${String(seq ?? "unknown")}|${sourceText}|${risk.risk}`, "utf8").digest("hex").slice(0, 16);

  return {
    draftId,
    draftStatus: "READY_FOR_USER_APPROVAL",
    room: safeRoom,
    replyTo: {
      seq,
      from: typeof source.from === "string" ? source.from : null,
      ts: typeof source.ts === "string" ? source.ts : null,
    },
    publicContext: {
      did: publicDid,
      fingerprint: publicFingerprint,
      notes: "Draft only; no automatic send or signing.",
    },
    body: sourceText,
    risk: risk.risk,
    classification: risk.classification,
    reason: risk.reason,
    requiresApproval: true,
    signerMode: "STUB_LOCAL_SIGNER_DISABLED",
    writeMode: "LIVE_WRITE_DISABLED",
    policy: "READ_ONLY_DRAFT_ONLY",
  };
}

module.exports = {
  SAFE_TEXT_LIMIT,
  buildReplyDraft,
  classifyConversationRisk,
  createConversationState,
  getNewPublicRoomMessages,
  sanitizeUntrustedText,
};
