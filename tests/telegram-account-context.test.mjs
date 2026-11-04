import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const native = createRequire(import.meta.url);
const compiled = (file, deps = {}) => {
  const module = { exports: {} };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs", target: "node20" }).code;
  new Function("require", "module", "exports", code)((name) => {
    if (name === "server-only") return {};
    return name in deps ? deps[name] : native(name);
  }, module, module.exports);
  return module.exports;
};
const domain = compiled("src/lib/telegram/domain.ts");
const scope = compiled("src/lib/telegram/request-context.ts", { "./domain": domain });
const account = (id, generation) => ({ accounts: { activeId: id, generation } });

test("an old account context cannot act after A → B → A", () => {
  scope.withRequestContext("primary:0", () => {
    scope.assertRequestContext({});
    assert.throws(() => scope.assertRequestContext(account("yara", 1)), { code: "account_changed" });
    assert.throws(() => scope.assertRequestContext(account("primary", 2)), { code: "account_changed" });
  });
});

test("independent requests keep their own expected account across async boundaries", async () => {
  await Promise.all(["felipe", "yara"].map((id) => scope.withRequestContext(`${id}:3`, async () => {
    await new Promise((resolve) => setImmediate(resolve));
    scope.assertRequestContext(account(id, 3));
    assert.throws(() => scope.assertRequestContext(account(id === "felipe" ? "yara" : "felipe", 3)), { code: "account_changed" });
  })));
});

test("the successful account switch may advance only its own request", async () => {
  await scope.withRequestContext("primary:0", async () => {
    scope.advanceRequestContext(account("felipe", 1));
    await Promise.resolve();
    scope.assertRequestContext(account("felipe", 1));
  });
  scope.withRequestContext("primary:0", () => assert.throws(() => scope.assertRequestContext(account("felipe", 1)), { code: "account_changed" }));
  assert.throws(() => scope.withRequestContext(null, () => {}), { code: "account_changed" });
});

test("the HTTP boundary rejects missing and stale account headers before any Telegram operation", async () => {
  for (const [header, status] of [[null, 409], ["primary:0", 409], ["yara:2", 200]]) {
    let calls = 0;
    const route = compiled("src/app/api/telegram/[...path]/route.ts", {
      "@/lib/telegram/access": { operator: async () => "operator", checkPost() {}, body: (request) => request.json() },
      "@/lib/telegram/request-context": scope,
      "@/lib/telegram/domain": domain,
      "@/lib/telegram/driver": { mapError: (error) => error },
      "@/lib/telegram/network": { telegramNetworkStatus: () => ({ enabled: true, region: "gru1" }) },
      "@/lib/telegram/service": { groups: async () => { scope.assertRequestContext(account("yara", 2)); calls++; return { groups: [] }; } },
      "@/lib/telegram/growth": {}, "@/lib/telegram/analytics": {},
    });
    const request = new Request("https://app.example/api/telegram/connection/groups", {
      method: "POST", headers: { "Content-Type": "application/json", ...(header ? { "X-Telegram-Context": header } : {}) }, body: "{}",
    });
    const response = await route.POST(request, { params: Promise.resolve({ path: ["connection", "groups"] }) });
    assert.equal(response.status, status);
    assert.equal(calls, status === 200 ? 1 : 0);
  }
});

test("an old download link cannot export the participant list of another selected account", async () => {
  let exports = 0;
  const route = compiled("src/app/api/telegram/[...path]/route.ts", {
    "@/lib/telegram/access": { operator: async () => "operator" },
    "@/lib/telegram/request-context": scope, "@/lib/telegram/domain": domain,
    "@/lib/telegram/driver": { mapError: (error) => error },
    "@/lib/telegram/network": { telegramNetworkStatus: () => ({ enabled: true, region: "gru1" }) },
    "@/lib/telegram/service": { csv: async () => { scope.assertRequestContext(account("yara", 2)); exports++; return "test-only-csv"; } },
    "@/lib/telegram/growth": {}, "@/lib/telegram/analytics": {},
  });
  for (const [context, status] of [["primary:0", 409], ["yara:2", 200]]) {
    const response = await route.GET(new Request(`https://app.example/api/telegram/export/contacts.csv?account_context=${encodeURIComponent(context)}`), { params: Promise.resolve({ path: ["export", "contacts.csv"] }) });
    assert.equal(response.status, status);
  }
  assert.equal(exports, 1);
});
