import { CONFIG } from "./config.js";

const $ = id => document.getElementById(id);
$("site").href = CONFIG.SITE_URL;

function ago(ms) {
  if (!ms) return "–";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return (s / 3600).toFixed(1) + " h ago";
  return (s / 86400).toFixed(1) + " d ago";
}

async function render() {
  const { state = {}, settings = {} } = await chrome.storage.local.get(["state", "settings"]);
  $("squad").value = settings.squadCode || "";
  $("nick").textContent = state.nickname || (settings.openid ? settings.openid.slice(0, 8) + "…" : "–");
  $("session").textContent = state.tokenOk === null ? "unknown" : state.tokenOk ? "OK" : "logged out";
  $("lastPoll").textContent = ago(state.lastPoll);
  $("newest").textContent = state.newest ? ago(state.newest.match_time * 1000) : "–";
  $("pushed").textContent = state.pushed ?? 0;
  $("pending").textContent = state.detailsPending ?? "–";
  const dot = $("dot");
  dot.className = "dot " + (state.tokenOk === false || (state.lastError && !/squad code/i.test(state.lastError)) ? "bad" : state.tokenOk ? "ok" : "warn");
  $("err").hidden = !state.lastError;
  $("err").textContent = state.lastError || "";
}

$("save").onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get(["settings"]);
  const squadCode = $("squad").value.trim();
  const changed = squadCode !== settings.squadCode;
  await chrome.storage.local.set({ settings: { ...settings, squadCode, ingestKey: changed ? "" : settings.ingestKey } });
  $("save").textContent = "Polling…";
  await chrome.runtime.sendMessage({ type: "poll-now" });
  $("save").textContent = "Save & poll now";
  render();
};

render();
setInterval(render, 5000);
