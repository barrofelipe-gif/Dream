import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";

// Exercise the real event handlers and rendered controls with isolated React hooks.
// This is component coverage, not a browser or a live Telegram test.
const group = (id = -100123, kind = "group") => ({
  id, kind, name: `Fitness ${id}`, username: `fitness_${Math.abs(id)}`,
  members: 100, history: [], query: "fitness atacado",
  discoveredAt: "2026-11-03T12:00:00Z", savedAt: "2026-11-03T12:00:00Z",
});
function harness({ connected = true, prospects = [group()], post } = {}) {
  const values = [], effects = [], calls = [], opened = [], notices = [];
  let index = 0, changed = 0;
  const hook = (initial) => {
    const at = index++;
    if (!(at in values)) values[at] = typeof initial === "function" ? initial() : initial;
    return [values[at], (value) => { values[at] = typeof value === "function" ? value(values[at]) : value; }];
  };
  const react = {
    useState: hook,
    useRef: (current) => hook({ current })[0],
    useEffect: (effect) => {
      const at = index++;
      if (!(at in values)) { values[at] = true; effects.push(effect()); }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const code = transformSync(readFileSync("src/components/hub/growth/TelegramDiscovery.tsx", "utf8"), {
    loader: "tsx", format: "cjs", jsx: "automatic", target: "node20",
  }).code;
  const compiled = { exports: {} };
  const require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name.endsWith(".module.css")) return { default: {} };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("require", "module", "exports", code)(require, compiled, compiled.exports);
  const Component = compiled.exports.default;
  const render = () => {
    index = 0;
    return Component({
      data: { prospects, connection: connected ? "connected" : "disconnected", updatedAt: "2026-11-03T12:00:00Z" },
      post: async (path, input) => { calls.push({ path, input }); return post ? post(path, input) : { source: { id: input.id, name: "Fitness" }, accountId: 1 }; },
      notify: (text) => notices.push(text), onChanged: () => changed++,
      connect() {}, openCommunity: (id, accountId) => opened.push({ id, accountId }),
    });
  };
  return { render, calls, opened, notices, changed: () => changed, unmount: () => effects.forEach((cleanup) => cleanup?.()) };
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text(node.props?.children) : String(node ?? "");
}
const prepareButtons = (tree) => nodes(tree).filter((node) => node.type === "button" && /Entrar e preparar coleta|Entrando e verificando/.test(text(node)));

test("prepare origin opens community only after the exact source is confirmed, without collecting or inviting", async () => {
  let resolve;
  const h = harness({ prospects: [group(), group(-100456)], post: () => new Promise((done) => { resolve = done; }) });
  const buttons = prepareButtons(h.render());
  const pending = buttons[0].props.onClick();
  await buttons[1].props.onClick();
  assert.deepEqual(h.calls, [{ path: "connection/prepare-origin", input: { id: -100123 } }]);
  assert.deepEqual(h.opened, []);
  assert.ok(prepareButtons(h.render()).every((button) => button.props.disabled));
  resolve({ source: { id: -100123, name: "Confirmed fitness" }, accountId: 1 });
  await pending;
  assert.deepEqual(h.opened, [{ id: -100123, accountId: 1 }]);
  assert.equal(h.changed(), 1);
  assert.match(h.notices[0], /Escolha o destino/);
  assert.equal(h.calls.length, 1);
});

test("a rejected or mismatched preparation keeps the user on discovery and allows a retry", async () => {
  for (const response of [() => { throw new Error("Aguardando aprovação no Telegram"); }, () => ({ source: { id: -999, name: "Wrong identity" }, accountId: 1 }), () => ({ source: { id: -100123, name: "Missing account identity" } })]) {
    const h = harness({ post: response });
    await prepareButtons(h.render())[0].props.onClick();
    const tree = h.render();
    assert.deepEqual(h.opened, []);
    assert.equal(h.changed(), 0);
    assert.equal(prepareButtons(tree)[0].props.disabled, false);
    assert.equal(nodes(tree).filter((node) => node.props?.role === "alert").length, 1);
  }
});

test("broadcast channels have no preparation action, and disconnected accounts cannot prepare", async () => {
  assert.equal(prepareButtons(harness({ prospects: [group(-100123, "channel")] }).render()).length, 0);
  const h = harness({ connected: false });
  const button = prepareButtons(h.render())[0];
  assert.equal(button.props.disabled, true);
  await button.props.onClick();
  assert.deepEqual(h.calls, []);
});

test("a late preparation cannot navigate after the discovery screen is unmounted", async () => {
  let resolve;
  const h = harness({ post: () => new Promise((done) => { resolve = done; }) });
  const pending = prepareButtons(h.render())[0].props.onClick();
  h.unmount();
  resolve({ source: { id: -100123, name: "Confirmed fitness" }, accountId: 1 });
  await pending;
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.notices, []);
  assert.equal(h.changed(), 0);
});

test("origin preparation and channel HTTP endpoints require operator and CSRF before invoking Telegram", async () => {
  class SafeError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
  }
  const native = createRequire(import.meta.url);
  for (const [action, payload, method] of [
    ["prepare-origin", { id: -100123 }, "prepareOrigin"],
    ["channel/create", { title: "Private fitness", requestId: "test-request" }, "createChannel"],
    ["channel/test", { target_id: -100123, username: "own_test", requestId: "test-request" }, "testChannel"],
  ]) for (const failureAt of ["operator", "csrf", null]) {
    const calls = [];
    const request = new Request(`https://app.example/api/telegram/connection/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const dependencies = {
      "@/lib/telegram/access": {
        operator: async () => { calls.push("operator"); if (failureAt === "operator") throw new SafeError("permission", 403); return "test-operator"; },
        checkPost: (received, userId) => { calls.push("csrf"); assert.equal(received, request); assert.equal(userId, "test-operator"); if (failureAt === "csrf") throw new SafeError("csrf", 403); },
        body: async (received) => { calls.push("body"); return received.json(); },
      },
      "@/lib/telegram/service": { [method]: async (userId, input) => { calls.push("operation"); assert.equal(userId, "test-operator"); assert.deepEqual(input, payload); return { ok: true }; } },
      "@/lib/telegram/domain": { TelegramError: SafeError },
      "@/lib/telegram/driver": { mapError: (error) => error },
      "@/lib/telegram/growth": {}, "@/lib/telegram/analytics": {},
    };
    const compiled = { exports: {} };
    const code = transformSync(readFileSync("src/app/api/telegram/[...path]/route.ts", "utf8"), { loader: "ts", format: "cjs", target: "node20" }).code;
    new Function("require", "module", "exports", code)((name) => name in dependencies ? dependencies[name] : native(name), compiled, compiled.exports);
    const response = await compiled.exports.POST(request, { params: Promise.resolve({ path: ["connection", ...action.split("/")] }) });
    assert.equal(response.status, failureAt ? 403 : 200);
    assert.deepEqual(calls, failureAt === "operator" ? ["operator"] : failureAt === "csrf" ? ["operator", "csrf"] : ["operator", "csrf", "body", "operation"]);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("community delivers account-bound source selection on load and on repeated preparation without reloading its iframe", () => {
  const effects = [], sent = [], frame = { current: null };
  const react = {
    useCallback: (callback) => callback, useRef: () => frame,
    useState: () => [1500, () => {}], useEffect: (effect) => effects.push(effect),
  };
  const jsx = (type, props) => ({ type, props });
  const compiled = { exports: {} };
  const code = transformSync(readFileSync("src/components/hub/growth/TelegramCommunity.tsx", "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic", target: "node20" }).code;
  const window = { location: { origin: "https://app.example" }, addEventListener() {}, removeEventListener() {} };
  new Function("require", "module", "exports", "window", code)((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    throw new Error(`Unexpected dependency: ${name}`);
  }, compiled, compiled.exports, window);
  frame.current = { contentWindow: { postMessage: (payload, origin) => sent.push({ payload, origin }) } };
  let src;
  for (const request of [1, 2]) {
    const selection = { id: -100123, accountId: 1, request };
    const tree = compiled.exports.default({ selection });
    const iframe = nodes(tree).find((node) => node.type === "iframe");
    src ??= iframe.props.src;
    assert.equal(iframe.props.src, src);
    assert.equal(src, "/api/telegram/painel");
    while (effects.length) effects.shift()();
    iframe.props.onLoad();
    assert.deepEqual(sent.at(-1), { payload: { type: "bff-telegram-source", ...selection }, origin: "https://app.example" });
  }
  assert.equal(sent.length, 4);
});
