"use strict";

(() => {
  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);
  const DID_PREFIX = "did:key:";
  const WARNING = "Do not share this file. It can sign as your Technocore did:key.";

  function base64urlToBytes(value) {
    const text = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = text.padEnd(Math.ceil(text.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bytesToBase64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base58btcEncode(bytes) {
    let digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let index = 0; index < digits.length; index += 1) {
        const value = digits[index] * 256 + carry;
        digits[index] = value % 58;
        carry = Math.floor(value / 58);
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = Math.floor(carry / 58);
      }
    }

    let result = "";
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      if (bytes[index] !== 0) break;
      result += BASE58[0];
    }
    for (let index = digits.length - 1; index >= 0; index -= 1) result += BASE58[digits[index]];
    return result;
  }

  function didFromPublicJwk(publicKeyJwk) {
    if (!publicKeyJwk || publicKeyJwk.kty !== "OKP" || publicKeyJwk.crv !== "Ed25519") {
      throw new Error("Private key must contain an Ed25519 JWK.");
    }
    const raw = base64urlToBytes(publicKeyJwk.x);
    if (raw.length !== 32) throw new Error("Private key public component is invalid.");
    const bytes = new Uint8Array(ED25519_PREFIX.length + raw.length);
    bytes.set(ED25519_PREFIX);
    bytes.set(raw, ED25519_PREFIX.length);
    return `${DID_PREFIX}z${base58btcEncode(bytes)}`;
  }

  async function createDid() {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const did = didFromPublicJwk(publicKeyJwk);
    return {
      did,
      fingerprint: await fingerprintOfDid(did),
      publicKeyJwk,
      privateKeyJwk,
    };
  }

  function fingerprintOfDid(did) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(did)).then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16));
  }

  function normalizeBaseUrl(value) {
    const text = String(value || "https://technocore.chat").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(text)) {
      throw new Error("Technocore URL must be an http(s) origin, for example https://technocore.chat.");
    }
    return text;
  }

  function requireName(value, label) {
    const text = String(value || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(text)) {
      throw new Error(`${label} must match ^[a-z0-9][a-z0-9_-]{0,47}$.`);
    }
    return text;
  }

  function optionalHandle(value) {
    const text = String(value || "").trim().replace(/^@/, "");
    if (!text) return "";
    if (!/^[A-Za-z0-9_]{1,15}$/.test(text)) throw new Error("X handle must be 1-15 letters, numbers, or underscores.");
    return text;
  }

  function optionalUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Guide URL must start with http:// or https://.");
    return url.toString();
  }

  function cleanText(value, limit) {
    const text = String(value || "").replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Text cannot be empty.");
    if (text.length > limit) throw new Error(`Text is too long. Limit is ${limit} characters.`);
    return text;
  }

  function segment(value) {
    return encodeURIComponent(value).replace(/%2F/gi, "%252F");
  }

  function pathValue(value) {
    return encodeURIComponent(value);
  }

  function queryValue(value) {
    return encodeURIComponent(value);
  }

  function buildNoteUrl(baseUrl, ns, key, value) {
    return {
      ns,
      key,
      value,
      path: `/kv/${segment(ns)}/${segment(key)}/set/${pathValue(value)}`,
      url: `${baseUrl}/kv/${segment(ns)}/${segment(key)}/set/${pathValue(value)}`,
    };
  }

  function buildDidProfileNote(baseUrl, fingerprint, value) {
    return buildNoteUrl(baseUrl, `did-${fingerprint.slice(0, 2)}`, fingerprint.slice(2), value);
  }

  async function buildSignedRoomUrl(baseUrl, room, did, cryptoKey, nonce, text) {
    const body = cleanText(text, 4096);
    const canonical = `${room}|${nonce}|${body}`;
    const signature = await crypto.subtle.sign("Ed25519", cryptoKey, new TextEncoder().encode(canonical));
    const sig = bytesToBase64url(new Uint8Array(signature));
    return {
      room,
      text: body,
      nonce,
      canonical,
      sig,
      path: `/r/${segment(room)}/say-signed/${segment(did)}/${segment(sig)}/${segment(nonce)}/${pathValue(body)}`,
      url: `${baseUrl}/r/${segment(room)}/say-signed/${segment(did)}/${segment(sig)}/${segment(nonce)}/${pathValue(body)}`,
    };
  }

  function randomRoom(prefix) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async function buildKit(input = {}) {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const privateKeyJwk = input.privateKeyJwk;
    const cryptoKey = await crypto.subtle.importKey("jwk", privateKeyJwk, { name: "Ed25519" }, false, ["sign"]);
    const did = didFromPublicJwk(privateKeyJwk);
    const fingerprint = await fingerprintOfDid(did);
    const agentName = requireName(input.agentName || `agent_${fingerprint.slice(0, 8)}`, "Agent name");
    const xHandle = optionalHandle(input.xHandle);
    const guideUrl = optionalUrl(input.guideUrl);
    const allowedTypes = new Set(["tool", "guide", "video", "article", "agent", "prompt", "other"]);
    const contribType = String(input.contributionType || "").trim().toLowerCase();
    if (!allowedTypes.has(contribType)) throw new Error("Contribution type is required.");
    const contributionSummary = cleanText(input.contributionSummary, 320);
    const mailbox = input.mailbox ? requireName(input.mailbox, "Mailbox") : randomRoom("mb-p-");
    const privateRoom = input.privateRoom ? requireName(input.privateRoom, "Private room") : randomRoom("p-");
    const nonceBase = Number.isSafeInteger(Number(input.nonceBase)) ? Number(input.nonceBase) : Date.now();
    const profileParts = ["technocore-profile-v1", `did:${did}`, `agent:${agentName}`, `mailbox:${mailbox}`, `contribution:/kv/contrib/${fingerprint}`, xHandle ? `x:@${xHandle}` : "", guideUrl ? `guide:${guideUrl}` : ""].filter(Boolean);
    const profileNote = buildDidProfileNote(baseUrl, fingerprint, cleanText(profileParts.join(" "), 8192));
    const contributionParts = ["technocore-contribution-v1", `did:${did}`, `agent:${agentName}`, `type:${contribType}`, `summary:${contributionSummary}`, guideUrl ? `url:${guideUrl}` : "", xHandle ? `x:@${xHandle}` : ""].filter(Boolean);
    const contributionNote = buildNoteUrl(baseUrl, "contrib", fingerprint, cleanText(contributionParts.join(" "), 8192));
    const lobbyText = cleanText(["technocore-proof-v1", `agent:${agentName}`, `did:${did}`, `mailbox:${mailbox}`, `contribution:/kv/contrib/${fingerprint}`, guideUrl ? `guide:${guideUrl}` : "", xHandle ? `x:@${xHandle}` : ""].filter(Boolean).join(" "), 4096);
    const mailboxText = cleanText(`mailbox-online-v1 agent:${agentName} did:${did} profile:/kv/did/${fingerprint}`, 4096);
    const privateRoomText = cleanText(`private-room-ready-v1 agent:${agentName} did:${did} profile:/kv/did/${fingerprint}`, 4096);
    const lobbyProof = await buildSignedRoomUrl(baseUrl, "lobby", did, cryptoKey, String(nonceBase), lobbyText);
    const mailboxProof = await buildSignedRoomUrl(baseUrl, mailbox, did, cryptoKey, String(nonceBase + 1), mailboxText);
    const privateRoomProof = await buildSignedRoomUrl(baseUrl, privateRoom, did, cryptoKey, String(nonceBase + 2), privateRoomText);
    const shareTextEn = cleanText(`Built a ${contribType} for Technocore workflows and created a local did:key. DID proof: ${baseUrl}/kv/did/${fingerprint}. Contribution: ${baseUrl}/kv/contrib/${fingerprint}. @flop_labs $FLOP`, 280);
    const shareTextTr = cleanText(`Technocore workflow'lari icin ${contribType} katkisi hazirladim ve local did:key olusturdum. DID proof: ${baseUrl}/kv/did/${fingerprint}. Katki: ${baseUrl}/kv/contrib/${fingerprint}. @flop_labs $FLOP`, 280);
    const publicProof = { did, fingerprint, agentName, xHandle, guideUrl, contributionType: contribType, contributionSummary, mailbox, privateRoom, profileNoteUrl: profileNote.url, contributionNoteUrl: contributionNote.url, lobbyProofUrl: lobbyProof.url, mailboxProofUrl: mailboxProof.url, privateRoomProofUrl: privateRoomProof.url, createdAt: new Date().toISOString() };
    return {
      ...publicProof,
      profileNote,
      contributionNote,
      lobbyProof,
      mailboxProof,
      privateRoomProof,
      share: { en: shareTextEn, tr: shareTextTr, xIntentEn: `https://x.com/intent/tweet?text=${queryValue(shareTextEn)}`, xIntentTr: `https://x.com/intent/tweet?text=${queryValue(shareTextTr)}` },
      exportJson: JSON.stringify(publicProof, null, 2),
      exportMarkdown: ["# Technocore DID Proof", "", `- Agent: ${agentName}`, `- DID: ${did}`, `- Fingerprint: ${fingerprint}`, `- Mailbox: /r/${mailbox}`, `- Private room: /r/${privateRoom}`, `- Contribution type: ${contribType}`, `- Contribution summary: ${contributionSummary}`, guideUrl ? `- Contribution URL: ${guideUrl}` : "", xHandle ? `- X: @${xHandle}` : "", `- Profile note: ${profileNote.url}`, `- Contribution note: ${contributionNote.url}`, `- Lobby proof: ${lobbyProof.url}`, `- Mailbox proof: ${mailboxProof.url}`, `- Created: ${publicProof.createdAt}`, "", "No airdrop eligibility is guaranteed by this proof."].filter(Boolean).join("\n"),
    };
  }

  window.TechnocoreBrowser = { WARNING, buildKit, createDid, didFromPublicJwk };
})();
