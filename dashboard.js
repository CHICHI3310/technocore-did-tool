"use strict";

const $ = (id) => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value ?? "-"; };
const date = (value) => value ? new Date(value).toLocaleString() : "-";

function statusClass(value) {
  return String(value || "unknown").toLowerCase();
}

function renderStatus(data) {
  const status = data.agent?.status || "UNKNOWN";
  const statusNode = $("agentStatus");
  statusNode.textContent = status;
  statusNode.className = `status ${statusClass(status)}`;
  text("did", data.identity?.did);
  text("profile", data.identity?.profile);
  text("mailboxStatus", data.identity?.mailbox);
  text("version", data.technocore?.version);
  text("lastCheck", date(data.observer?.lastCheckAt));
  text("lastSuccess", date(data.observer?.lastSuccessAt));
  text("lastError", data.observer?.lastError || "None");
  text("newMessages", data.mailbox?.newMessages ?? 0);
  text("newEvents", data.events?.newRoomEvents ?? 0);
  text("gaps", data.events?.cursorGaps ?? 0);
  const provenance = data.provenance || {};
  text("provenance", `${provenance.verified || 0} verified / ${provenance.failed || 0} failed`);

  $("rooms").replaceChildren(...(data.rooms || []).map((room) => {
    const node = document.createElement("article");
    node.className = `room ${statusClass(room.status)}`;
    node.innerHTML = `<strong></strong><span class="tag"></span><small>last seq: </small><small>gap: </small><small>retention: </small>`;
    node.querySelector("strong").textContent = room.name;
    node.querySelector(".tag").textContent = room.status;
    node.querySelectorAll("small")[0].append(document.createTextNode(String(room.lastSeq ?? "-")));
    node.querySelectorAll("small")[1].append(document.createTextNode(room.cursorGap ? "YES" : "NO"));
    node.querySelectorAll("small")[2].append(document.createTextNode(String(room.retention || "UNKNOWN").toUpperCase()));
    return node;
  }));

  const retention = data.retention || { rooms: {} };
  $("retention").replaceChildren(
    retentionItem("Profile", retention.profile),
    retentionItem("Mailbox", retention.mailbox),
    retentionItem("Rooms", `${retention.rooms.active || 0} active / ${retention.rooms.expired || 0} expired / ${retention.rooms.unknown || 0} unknown`),
  );
  const warnings = $("warnings");
  warnings.replaceChildren(...((data.warnings || []).length ? data.warnings : ["None"]).map((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    item.className = warning === "None" ? "muted" : "red";
    return item;
  }));
  renderKeeper(data.keeper);
}

function renderKeeper(keeper) {
  const data = keeper || { status: "IDLE", resources: {} };
  text("keeperStatus", data.status || "IDLE");
  const resources = data.resources || {};
  $("keeperResources").replaceChildren(...["profile", "contribution"].map((resourceId) => {
    const resource = resources[resourceId] || {};
    const node = document.createElement("article");
    node.className = "keeper-resource";
    node.innerHTML = `<h3></h3><dl><dt>Resource</dt><dd class="resource-path"></dd><dt>Retention</dt><dd class="retention-value"></dd><dt>Last verified maintenance</dt><dd class="verified-at"></dd><dt>Local maintenance target</dt><dd class="local-target"></dd><dt>Current value match</dt><dd class="value-match"></dd></dl><div class="keeper-actions"><button type="button" class="check-maintenance">Check maintenance</button><button type="button" class="confirm-maintenance" disabled>Confirm maintenance</button></div><p class="keeper-message muted"></p>`;
    node.querySelector("h3").textContent = resourceId === "profile" ? "Profile" : "Contribution";
    node.querySelector(".resource-path").textContent = `${resource.namespace || "-"}/${resource.key || "-"}`;
    node.querySelector(".retention-value").textContent = String(resource.retentionStatus || "UNKNOWN").toUpperCase();
    node.querySelector(".verified-at").textContent = resource.lastVerifiedMaintenanceAt ? `${date(resource.lastVerifiedMaintenanceAt)} (local Keeper time)` : "UNKNOWN";
    node.querySelector(".local-target").textContent = resource.localMaintenanceTarget || resourceId;
    node.querySelector(".value-match").textContent = resource.currentValueMatch || "UNKNOWN";
    node.querySelector(".check-maintenance").addEventListener("click", () => checkKeeper(node, resourceId));
    node.querySelector(".confirm-maintenance").addEventListener("click", () => confirmKeeper(node));
    return node;
  }));
}

async function checkKeeper(node, resourceId) {
  const check = node.querySelector(".check-maintenance");
  const confirm = node.querySelector(".confirm-maintenance");
  const message = node.querySelector(".keeper-message");
  check.disabled = true;
  confirm.disabled = true;
  message.textContent = "Checking...";
  try {
    const response = await fetch("/api/keeper/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId }), cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok || result.status !== "READY") throw new Error(result.error || "Maintenance check failed.");
    confirm.dataset.token = result.confirmationToken || "";
    confirm.disabled = !confirm.dataset.token;
    message.textContent = `Current value: ${result.currentValueMatch}. Confirm maintenance to continue.`;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    check.disabled = false;
  }
}

async function confirmKeeper(node) {
  const check = node.querySelector(".check-maintenance");
  const confirm = node.querySelector(".confirm-maintenance");
  const message = node.querySelector(".keeper-message");
  const confirmationToken = confirm.dataset.token;
  if (!confirmationToken) return;
  check.disabled = true;
  confirm.disabled = true;
  message.textContent = "Confirming... LIVE WRITE: DISABLED";
  try {
    const response = await fetch("/api/keeper/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationToken }), cache: "no-store" });
    const result = await response.json();
    message.textContent = result.status === "WRITE_DISABLED" ? "LIVE WRITE: DISABLED. No Technocore write was attempted." : (result.error || result.status);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    delete confirm.dataset.token;
    await loadDashboard();
  }
}

function retentionItem(label, value) {
  const node = document.createElement("div");
  node.innerHTML = "<span></span><b></b>";
  node.querySelector("span").textContent = label;
  node.querySelector("b").textContent = String(value || "UNKNOWN").toUpperCase();
  node.querySelector("b").className = statusClass(value);
  return node;
}

function renderMessages(messages) {
  $("mailboxCount").textContent = `${messages.length} new`;
  const container = $("messages");
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No new messages in this observation.";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...messages.map((message) => {
    const node = document.createElement("article");
    node.className = `message ${String(message.risk || "unknown").toLowerCase()}`;
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = `seq ${message.seq ?? "-"} | ${date(message.timestamp)} | from ${message.from || "unknown"} | ${message.signed ? "SIGNED" : "UNSIGNED"}`;
    const summary = document.createElement("p");
    summary.className = "message-summary";
    summary.textContent = message.summary || "(empty message)";
    const tags = document.createElement("div");
    tags.textContent = `${message.category || "unknown"} / ${message.risk || "UNKNOWN"}${message.instructionDetected ? " / Potential instruction detected" : ""}`;
    tags.className = "tag";
    node.append(meta, summary, tags);
    if (typeof message.content === "string") {
      const details = document.createElement("details");
      const label = document.createElement("summary");
      label.textContent = "Show untrusted text";
      const pre = document.createElement("pre");
      pre.textContent = message.content;
      details.append(label, pre);
      node.append(details);
    }
    return node;
  }));
}

async function loadDashboard() {
  $("refresh").disabled = true;
  $("error").hidden = true;
  try {
    const statusResponse = await fetch("/api/observer/status", { cache: "no-store" });
    const status = await statusResponse.json();
    if (!statusResponse.ok || !status.ok) throw new Error("Observer status is unavailable.");
    renderStatus(status);
    const mailboxResponse = await fetch("/api/observer/mailbox", { cache: "no-store" });
    const mailbox = await mailboxResponse.json();
    if (!mailboxResponse.ok || !mailbox.ok) throw new Error("Mailbox is unavailable.");
    renderMessages(Array.isArray(mailbox.newMessages) ? mailbox.newMessages : []);
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    $("refresh").disabled = false;
  }
}

$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try {
    const response = await fetch("/api/observer/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
    if (!response.ok) throw new Error("Observation refresh failed.");
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    await loadDashboard();
  }
});

loadDashboard();
