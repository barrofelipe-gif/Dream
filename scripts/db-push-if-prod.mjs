// Temporário: aplica o schema no deploy de PRODUÇÃO (a DATABASE_URL é sensível na
// Vercel e não dá para usar localmente). Sem --accept-data-loss: se o push exigir
// apagar algo, falha e o deploy para. Remover do "build" depois de aplicado.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (process.env.VERCEL_ENV !== "production") {
  console.log("[db-push] fora de produção, pulando");
  process.exit(0);
}
// O pooler do Supabase na porta 6543 (modo transação) trava o schema engine do
// Prisma; a mesma URL na 5432 (modo sessão) aceita DDL.
const url = new URL(process.env.DATABASE_URL);
if (url.port === "6543") url.port = "5432";
url.searchParams.delete("pgbouncer");
url.searchParams.set("connect_timeout", "20");
const r = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  shell: true,
  timeout: 180_000,
  env: { ...process.env, DATABASE_URL: url.toString() },
});
if (r.status !== 0) process.exit(r.status ?? 1);
const schema = url.searchParams.get("schema") || "public";
const identifier = '"' + schema.replaceAll('"', '""') + '"';
const sqlFile = join(tmpdir(), `bff-telegram-rls-${randomUUID()}.sql`);
writeFileSync(
  sqlFile,
  `BEGIN;\nSET LOCAL search_path TO ${identifier};\n${readFileSync("scripts/telegram-private.sql", "utf8")}\nCOMMIT;\n`,
);
let status = 1;
try {
  const privacy = spawnSync(
    "npx",
    [
      "prisma",
      "db",
      "execute",
      "--schema",
      "prisma/schema.prisma",
      "--file",
      sqlFile,
    ],
    {
      stdio: "inherit",
      shell: true,
      timeout: 60_000,
      env: { ...process.env, DATABASE_URL: url.toString() },
    },
  );
  status = privacy.status ?? 1;
} finally {
  unlinkSync(sqlFile);
}
process.exit(status);
