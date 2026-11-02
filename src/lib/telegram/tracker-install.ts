import "server-only";

export const TRACKER_SOURCE =
  "https://app.bfffitnessatacado.com.br/api/telegram-growth/tracker.js";
export const STOREFRONT_URL = "https://www.bfffitnessatacado.com.br/";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const JAVASCRIPT_TYPES = new Set([
  "", "module", "text/javascript", "application/javascript",
  "text/ecmascript", "application/ecmascript",
]);

function attributes(text: string) {
  const result = new Map<string, string>();
  const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of text.matchAll(attribute)) {
    const key = match[1].toLowerCase();
    // HTML retains the first occurrence of a duplicated attribute.
    if (!result.has(key)) result.set(key, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

/** Recognizes an executable external tag, excluding comments and inert content. */
export function hasTrackerScript(html: string): boolean {
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-zA-Z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*?)>/g;
  let templateDepth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    if (!match[1]) continue;
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (name === "template") {
      templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1));
      continue;
    }
    if (closing) continue;
    if (name === "plaintext") return false;
    if (["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"].includes(name)) {
      const end = new RegExp(`</${name}\\s*[^>]*>`, "gi");
      end.lastIndex = tags.lastIndex;
      const endMatch = end.exec(html);
      if (!endMatch) return false;
      if (name === "script" && templateDepth === 0) {
        const attrs = attributes(match[2]);
        const type = (attrs.get("type") ?? "").trim().toLowerCase().split(";")[0];
        if (attrs.get("src") === TRACKER_SOURCE && JAVASCRIPT_TYPES.has(type) && !attrs.has("nomodule")) {
          return true;
        }
      }
      // Skip raw text so a quoted tag in JavaScript is never treated as HTML.
      tags.lastIndex = end.lastIndex;
    }
  }
  return false;
}

type VerificationReason =
  | "present" | "missing" | "unreachable" | "non_html" | "too_large";
export type StorefrontTrackerVerification = {
  installed: boolean;
  reachable: boolean;
  checkedAt: string;
  storefrontUrl: string;
  source: string;
  reason: VerificationReason;
};

/** Checks only the public, fixed BFF storefront; never forwards authentication. */
export async function verifyStorefrontTracker(): Promise<StorefrontTrackerVerification> {
  const result: StorefrontTrackerVerification = {
    installed: false,
    reachable: false,
    checkedAt: new Date().toISOString(),
    storefrontUrl: STOREFRONT_URL,
    source: TRACKER_SOURCE,
    reason: "unreachable",
  };
  try {
    const url = new URL(STOREFRONT_URL);
    // Tray may serve old HTML at the root immediately after a settings change.
    url.searchParams.set("bff_tracker_check", String(Math.floor(Date.now() / 60000)));
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "text/html", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return result;
    }
    result.reachable = true;
    if (!/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      return { ...result, reason: "non_html" };
    }
    if (Number(response.headers.get("content-length")) > MAX_HTML_BYTES) {
      await response.body?.cancel();
      return { ...result, reason: "too_large" };
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_HTML_BYTES) {
            await reader.cancel();
            return { ...result, reason: "too_large" };
          }
          html += decoder.decode(value, { stream: true });
        }
        html += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    const installed = hasTrackerScript(html);
    return { ...result, installed, reason: installed ? "present" : "missing" };
  } catch {
    return { ...result, reachable: false, reason: "unreachable" };
  }
}
