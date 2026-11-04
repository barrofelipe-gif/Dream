import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { build } from "esbuild";
import {
  ORBITA_ASSETS,
  ORBITA_CSP,
  ORBITA_NATIVE_VERSION,
  ORBITA_VERSION,
} from "../src/lib/orbita-hosting";

test("rota de hospedagem exige administrador, isola identidade e serve somente arquivos permitidos", async (t) => {
  type Fixture = {
    session: { user: { id?: string; role?: string; email?: string } } | null;
    reads: string[];
    unavailable: boolean;
  };
  const key = Symbol.for("orbita-hosting-route-audit");
  const holder = globalThis as unknown as Record<symbol, Fixture>;
  const state: Fixture = { session: null, reads: [], unavailable: false };
  holder[key] = state;
  const bundled = await build({
    entryPoints: ["src/app/api/growth/orbita/[...path]/route.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    plugins: [{
      name: "isolated-hosting-auth-and-files",
      setup(builder) {
        builder.onResolve({ filter: /^@\/auth$/ }, () => ({ path: "auth", namespace: "fixture" }));
        builder.onResolve({ filter: /^node:fs\/promises$/ }, () => ({ path: "files", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: modulePath }) => ({
          loader: "js",
          contents: modulePath === "auth"
            ? 'export async function auth(){return globalThis[Symbol.for("orbita-hosting-route-audit")].session;}'
            : 'export async function readFile(file){const s=globalThis[Symbol.for("orbita-hosting-route-audit")];s.reads.push(file);if(s.unavailable)throw Error("FIXTURE_PRIVATE_PATH_AND_SECRET");return new Uint8Array([0,13,42,255]);}',
        }));
      },
    }],
  });
  const route = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const get = (parts: string[]) => route.GET(
    new Request(`https://app.example/api/growth/orbita/${parts.join("/")}`),
    { params: Promise.resolve({ path: parts }) },
  ) as Promise<Response>;
  const assertPrivate = (response: Response) => {
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  };
  try {
    await t.test("sem sessão ou sem id retorna 401 antes de acessar qualquer arquivo", async () => {
      for (const session of [null, { user: { role: "admin" } }]) {
        state.session = session;
        const response = await get([`orbita-${ORBITA_NATIVE_VERSION}.zip`]);
        assert.equal(response.status, 401);
        assertPrivate(response);
      }
      assert.deepEqual(state.reads, []);
    });
    await t.test("usuário autenticado sem papel admin não recebe painel, sessão ou download", async () => {
      state.session = { user: { id: "fixture-member", role: "member" } };
      for (const name of ["painel", "session", `orbita-${ORBITA_NATIVE_VERSION}.zip`]) {
        const response = await get([name]);
        assert.equal(response.status, 403);
        assertPrivate(response);
      }
      assert.deepEqual(state.reads, []);
    });
    await t.test("a identidade da sessão varia por usuário e não expõe os campos da conta", async () => {
      const scopes: string[] = [];
      for (const id of ["fixture-admin-a", "fixture-admin-b"]) {
        state.session = { user: { id, role: "admin", email: "private-fixture@example.test" } };
        const response = await get(["session"]);
        assert.equal(response.status, 200);
        assertPrivate(response);
        const result = await response.json();
        const scope = createHash("sha256").update(id).digest("hex").slice(0, 32);
        assert.deepEqual(result, { ready: true, version: ORBITA_VERSION, userScope: scope });
        scopes.push(result.userScope);
        const panel = await get(["painel"]);
        assert.equal(panel.headers.get("content-security-policy"), ORBITA_CSP);
        assert.equal(panel.headers.get("x-frame-options"), "SAMEORIGIN");
        assert.match(panel.headers.get("content-type")!, /^text\/html/);
        assertPrivate(panel);
        const html = await panel.text();
        assert.ok(html.includes(`name="orbita-user" content="${scope}"`));
        assert.equal(html.includes(id), false);
        assert.equal(html.includes("private-fixture@example.test"), false);
      }
      assert.notEqual(scopes[0], scopes[1]);
      assert.deepEqual(state.reads, []);
    });
    await t.test("rotas desconhecidas, nomes herdados e travessia de diretório nunca chegam ao disco", async () => {
      for (const parts of [
        ["../package.json"], ["..", ".env"], ["hosted.js.map"],
        ["toString"], ["constructor"], ["__proto__"],
        ["%2e%2e%2f.env"], ["background.js"], ["painel", "extra"],
      ]) {
        const response = await get(parts);
        assert.equal(response.status, 404);
        assertPrivate(response);
      }
      assert.deepEqual(state.reads, []);
    });
    await t.test("arquivos permitidos mantêm MIME, bytes e nome de download dentro da pasta empacotada", async () => {
      for (const [name, asset] of Object.entries(ORBITA_ASSETS)) {
        const response = await get([name]);
        assert.equal(response.status, 200);
        assertPrivate(response);
        assert.equal(response.headers.get("content-type"), asset.type);
        assert.equal(response.headers.get("content-disposition"), asset.download ? `attachment; filename="${asset.download}"` : null);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 13, 42, 255]));
        assert.equal(state.reads.at(-1), path.join(process.cwd(), "integrations/orbita/assets", asset.file));
      }
    });
    await t.test("arquivo indisponível retorna 503 privado sem expor erro interno", async () => {
      state.unavailable = true;
      const response = await get(["hosted.js"]);
      assert.equal(response.status, 503);
      assertPrivate(response);
      const body = await response.text();
      assert.equal(body.includes("FIXTURE_PRIVATE_PATH_AND_SECRET"), false);
      assert.equal(body.includes(process.cwd()), false);
      assert.match(body, /indisponível/);
    });
  } finally {
    delete holder[key];
  }
});
