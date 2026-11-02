/* Telegram BFF: acompanha apenas chegadas por um link assinado deste app. */
(function () {
  "use strict";
  if (window.__bffTelegramGrowth) return;
  window.__bffTelegramGrowth = true;
  var script = document.currentScript;
  if (!script || !script.src || !/^(www\.)?bfffitnessatacado\.com\.br$/.test(location.hostname)) return;
  var endpoint = new URL("visit", script.src).href;
  var storageKey = "bff_telegram_attribution_v1", record, sent = "", running = false;
  try {
    var incoming = new URL(location.href).searchParams.get("bff_tg");
    if (incoming && /^[0-9a-f-]{36}\.[0-9a-f]{32}$/.test(incoming)) {
      record = { token: incoming, expires: Date.now() + 30 * 86400000 };
      try { localStorage.setItem(storageKey, JSON.stringify(record)); } catch (_) { /* no storage still confirms this landing */ }
    } else {
      try { record = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) { /* no attribution */ }
    }
    if (!record || record.expires < Date.now()) return;
  } catch (_) { return; }
  async function confirm() {
    if (running || document.visibilityState === "hidden") return;
    running = true;
    try {
      var session = document.documentElement.getAttribute("data-session") || "";
      var sessionDigest = "";
      if (session && window.crypto && window.crypto.subtle) {
        var bytes = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(session));
        sessionDigest = Array.from(new Uint8Array(bytes)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      }
      if (sent === record.token + ":" + sessionDigest) return;
      var response = await fetch(endpoint, { method: "POST", credentials: "omit", mode: "cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ token: record.token, session: sessionDigest }) });
      if (response.ok) sent = record.token + ":" + sessionDigest;
    } catch (_) { /* Tracking failure never interrupts the store. */ }
    finally { running = false; }
  }
  document.documentElement.addEventListener("tray-session-loaded", confirm);
  document.addEventListener("visibilitychange", confirm);
  confirm();
  [1000, 3000, 8000, 15000].forEach(function (delay) { setTimeout(confirm, delay); });
})();
