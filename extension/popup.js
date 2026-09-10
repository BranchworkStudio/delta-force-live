import { CONFIG } from "./config.js";

const $ = id => document.getElementById(id);
$("site").href = CONFIG.SITE_URL;
const GREEN = "#1de08c", RED = "#e0463f", AMBER = "#e6b34a";

function ago(ms) {
  if (!ms) return "–";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + " s";
  if (s < 3600) return Math.round(s / 60) + " min";
  if (s < 86400) return (s / 3600).toFixed(1) + " h";
  return (s / 86400).toFixed(1) + " d";
}

async function render() {
  const { state = {}, settings = {} } = await chrome.storage.local.get(["state", "settings"]);
  $("squad").value = settings.squadCode || "";
  $("nick").textContent = state.nickname || (settings.openid ? settings.openid.slice(0, 8) + "…" : "Not connected");
  const [color, text] = state.tokenOk === false ? [RED, "HQ session expired — log in"] : state.tokenOk ? [GREEN, "HQ session OK"] : [AMBER, "Session unknown"];
  $("st").style.color = color; $("ava").style.borderColor = color; $("session").textContent = text;
  $("lastPoll").textContent = ago(state.lastPoll);
  $("newest").textContent = state.newest ? ago(state.newest.match_time * 1000) : "–";
  $("pushed").textContent = state.pushed ?? 0;
  const err = state.lastError && !/squad code/i.test(state.lastError) ? state.lastError : state.lastError;
  $("err").hidden = !err; $("err").textContent = err || "";
  const pending = state.detailsPending || 0;
  $("note").textContent = pending > 0
    ? `Login stays in this browser. Only finished match rows leave it. Importing history: ${pending} match details left.`
    : "Login stays in this browser. Only finished match rows leave it.";
}

$("save").onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get(["settings"]);
  const squadCode = $("squad").value.trim();
  const changed = squadCode !== settings.squadCode;
  await chrome.storage.local.set({ settings: { ...settings, squadCode, ingestKey: changed ? "" : settings.ingestKey } });
  $("save").textContent = "Polling…"; $("save").disabled = true;
  await chrome.runtime.sendMessage({ type: "poll-now" });
  $("save").textContent = "Save & poll"; $("save").disabled = false;
  render();
};

render();
setInterval(render, 5000);
