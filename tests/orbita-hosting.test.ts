import test from "node:test";
import assert from "node:assert/strict";
import {
  ORBITA_ASSETS,
  ORBITA_CSP,
  orbitaPanel,
} from "../src/lib/orbita-hosting";

test("painel restringe incorporação ao app e não usa JavaScript inline", () => {
  const html = orbitaPanel("a".repeat(32));
  assert.match(ORBITA_CSP, /frame-ancestors 'self'/);
  assert.match(ORBITA_CSP, /script-src 'self';/);
  assert.match(html, /id="connect-extension"/);
  assert.match(html, /id="manual-mode"/);
  assert.match(html, /orbita-user.*a{32}/);
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.match(
    html,
    /<script type="module" src="\/api\/growth\/orbita\/hosted.js"><\/script>/,
  );
});
test("identidade não aceita HTML e nenhum arquivo arbitrário fica disponível", () => {
  assert.throws(() => orbitaPanel('"><script>alert(1)</script>'));
  assert.throws(() => orbitaPanel(""));
  for (const value of [
    "../package.json",
    "../../.env",
    "background.js",
    "index.html",
    "hosted.js.map",
    "toString",
  ])
    assert.equal(Object.hasOwn(ORBITA_ASSETS, value), false);
  assert.ok(ORBITA_ASSETS["orbita-0.16.0.zip"]);
});
