"use strict";

const crypto = require("node:crypto");
const { normalizeBaseUrl } = require("./technocore-observer");

const DEFAULT_BASE_URL = "https://technocore.chat";
const DEFAULT_WRITE_ENABLED = false;
const TOKEN_TTL_MS = 5 * 60 * 1000;

const RESOURCE_ALLOWLIST = Object.freeze({
  profile: Object.freeze({
    id: "profile",
    namespace: "did-52",
    key: "ad66441569e0fa",
    expectedValue: "technocore-profile-v1 did:did:key:z6MkmG43WHHvGCYgJDkfgdoGK6os6YogvEPNptb9aGw9Pd8z agent:chichi1031moon mailbox:mb-p-ce1a40a93d281d973b18576e contribution:/kv/contrib/52ad66441569e0fa x:@chichi1031moon",
    expectedHash: "76de01cc75e91326b176f91f4e9ee036473ee1bb516ae09f1c76321b1057c00e",
  }),
  contribution: Object.freeze({
    id: "contribution",
    namespace: "contrib",
    key: "52ad66441569e0fa",
    expectedValue: "technocore-contribution-v1 did:did:key:z6MkmG43WHHvGCYgJDkfgdoGK6os6YogvEPNptb9aGw9Pd8z agent:chichi1031moon type:guide summary:Testing the Technocore onboarding process as a Japanese user and sharing a beginner-friendly Japanese guide based on my experience. x:@chichi1031moon",
    expectedHash: "8bd09ebb7665507ec859cd0fb5dfcbc9ef0c3655a665f4d00cf4c391bdd79008",
  }),
});

function createKeeperState() {
  return {
    mode: "MANUAL",
    liveWrite: "DISABLED",
    status: "IDLE",
    resources: Object.fromEntries(Object.entries(RESOURCE_ALLOWLIST).map(([id, resource]) => [id, {
      resourceId: id,
      namespace: resource.namespace,
      key: resource.key,
      expectedHash: resource.expectedHash,
      observedHash: null,
      currentValueMatch: "UNKNOWN",
      retentionStatus: "UNKNOWN",
      estimatedExpiry: "UNKNOWN",
      nextMaintenance: "UNKNOWN",
      lastCheckedAt: null,
      lastVerifiedMaintenanceAt: null,
      lastResult: null,
      httpStatus: null,
      conflict: false,
      localMaintenanceTarget: id,
    }])),
  };
}

function hashContent(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function noteValue(body) {
  const text = String(body);
  if (!text.startsWith("!! UNTRUSTED CONTENT")) return text;
  const separator = text.indexOf("\n\n");
  return separator === -1 ? text : text.slice(separator + 2).trimEnd();
}

function resourceConfig(resourceId) {
  const resource = RESOURCE_ALLOWLIST[resourceId];
  if (!resource) throw new Error("Keeper resource is not allowlisted.");
  if (hashContent(resource.expectedValue) !== resource.expectedHash) {
    throw new Error("Keeper expected value configuration is invalid.");
  }
  return resource;
}

function readUrl(baseUrl, resource) {
  return `${baseUrl}/kv/${encodeURIComponent(resource.namespace)}/${encodeURIComponent(resource.key)}`;
}

function writeUrl(baseUrl, resource, currentValue) {
  return `${baseUrl}/kv/${encodeURIComponent(resource.namespace)}/${encodeURIComponent(resource.key)}/set/${encodeURIComponent(resource.expectedValue)}?if=${encodeURIComponent(currentValue)}`;
}

async function readResource(baseUrl, resource, fetchImpl) {
  const response = await fetchImpl(readUrl(baseUrl, resource), { method: "GET", cache: "no-store" });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Keeper GET failed with ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const value = noteValue(body);
  return { body: value, hash: hashContent(value), status: response.status };
}

class RetentionKeeper {
  constructor({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, writeEnabled = DEFAULT_WRITE_ENABLED, now = () => new Date() } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.writeEnabled = writeEnabled === true;
    this.now = now;
    this.tokens = new Map();
    this.locks = new Set();
  }

  async check(resourceId) {
    const resource = resourceConfig(resourceId);
    if (this.locks.has(resource.id)) throw new Error("Keeper resource is busy.");
    for (const [token, plan] of this.tokens) {
      if (plan.resource.id === resource.id) this.tokens.delete(token);
    }
    this.locks.add(resource.id);
    try {
      const observed = await readResource(this.baseUrl, resource, this.fetchImpl);
      const match = observed.body === resource.expectedValue;
      const token = match ? crypto.randomBytes(32).toString("hex") : null;
      if (token) this.tokens.set(token, { resource, observed, expiresAt: this.now().getTime() + TOKEN_TTL_MS });
      return {
        resourceId: resource.id,
        namespace: resource.namespace,
        key: resource.key,
        currentValueMatch: match ? "YES" : "NO",
        observedHash: observed.hash,
        expectedHash: resource.expectedHash,
        retentionStatus: "UNKNOWN",
        estimatedExpiry: "UNKNOWN",
        nextMaintenance: "UNKNOWN",
        confirmationToken: token,
        status: match ? "READY" : "FAILED",
      };
    } catch (error) {
      return { resourceId: resource.id, status: "FAILED", currentValueMatch: "UNKNOWN", error: error.message };
    } finally {
      this.locks.delete(resource.id);
    }
  }

  async confirm(token) {
    const plan = this.tokens.get(token);
    this.tokens.delete(token);
    if (!plan || plan.expiresAt <= this.now().getTime()) return { status: "FAILED", error: "Confirmation expired or invalid." };
    const { resource, observed } = plan;
    if (this.locks.has(resource.id)) return { resourceId: resource.id, status: "FAILED", error: "Keeper resource is busy." };
    if (!this.writeEnabled) return { resourceId: resource.id, status: "WRITE_DISABLED", writeAttempted: false };
    this.locks.add(resource.id);
    try {
      const response = await this.fetchImpl(writeUrl(this.baseUrl, resource, observed.body), { method: "GET", cache: "no-store" });
      const body = await response.text();
      if (response.status === 409) return { resourceId: resource.id, status: "CONFLICT", writeAttempted: true, httpStatus: 409 };
      if (!response.ok) return { resourceId: resource.id, status: "FAILED", writeAttempted: true, httpStatus: response.status };
      const verified = await readResource(this.baseUrl, resource, this.fetchImpl);
      const verifiedAt = this.now().toISOString();
      if (verified.body !== resource.expectedValue) return { resourceId: resource.id, status: "FAILED", writeAttempted: true, httpStatus: response.status, observedHash: verified.hash };
      return { resourceId: resource.id, status: "VERIFIED", writeAttempted: true, httpStatus: response.status, observedHash: verified.hash, lastVerifiedMaintenanceAt: verifiedAt };
    } catch (error) {
      return { resourceId: resource.id, status: "FAILED", writeAttempted: true, error: error.message };
    } finally {
      this.locks.delete(resource.id);
    }
  }
}

module.exports = { RESOURCE_ALLOWLIST, RetentionKeeper, createKeeperState, hashContent, noteValue, resourceConfig, writeUrl };