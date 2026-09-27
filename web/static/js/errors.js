/* Shared browser error handling: reports uncaught errors to the server log (/api/client-log, rate-limited)
   and exposes getJSON(), a fetch wrapper that throws a readable Error on non-2xx responses. */
(() => {
  const page = location.pathname.replace(/^\//, "") || "home";
  let sent = 0;
  function report(message, source = "", stack = "") {
    if (sent >= 8) return;                       // never spam the server from one page
    sent += 1;
    try {
      const body = JSON.stringify({ message: String(message).slice(0, 300), source: String(source).slice(0, 120), stack: String(stack || "").slice(0, 500), page });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/client-log", new Blob([body], { type: "application/json" }));
      else fetch("/api/client-log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch (_) { /* reporting must never throw */ }
  }
  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) return;   // failed asset loads: ignore
    report(e.message, `${e.filename || ""}:${e.lineno || ""}`, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason || {};
    if (r.name === "AbortError" || r.handled) return;
    report(r.message || String(r), "unhandledrejection", r.stack);
  });

  async function getJSON(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
    } catch (_) {
      throw new Error("Can't reach the café server — check your connection.");
    }
    let data = null;
    try { data = res.status === 204 ? null : await res.json(); } catch (_) { /* non-JSON body */ }
    if (!res.ok) {
      const err = new Error((data && data.detail) || `Request failed (${res.status})`);
      err.status = res.status; err.code = data && data.code; err.requestId = data && data.request_id;
      if (res.status >= 500) report(`${url} -> ${res.status} ${err.message}`, "api", `request_id=${err.requestId || "?"}`);
      throw err;
    }
    return data;
  }
  window.CafeErrors = { report, getJSON };
})();
