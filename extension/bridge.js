/* Content script: lets the live site act as the extension's control panel.
   The page can ask for status, trigger a poll and set the squad code. It never
   sees the HQ session, the token or the ingest key. Only the origins listed in
   the manifest get this script. */
const NS = "df-live";

function announce(version) {
  document.documentElement.setAttribute("data-df-live", version);
  window.dispatchEvent(new CustomEvent("df-live-ready", { detail: { version } }));
}

const ALLOWED = new Set(["status", "poll-now", "set-code"]);

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.ns !== NS || !e.data.id) return;
  const { id, type, payload } = e.data;
  if (!ALLOWED.has(type)) return;
  chrome.runtime.sendMessage({ type, payload }, (res) => {
    const err = chrome.runtime.lastError;
    window.postMessage({ ns: NS + "-reply", id, ok: !err && !!res && res.ok !== false, data: res, error: err ? err.message : (res && res.error) || null }, window.location.origin);
  });
});

announce(chrome.runtime.getManifest().version);
