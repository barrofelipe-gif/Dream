// Temporário: aplica o schema no deploy de PRODUÇÃO (a DATABASE_URL é sensível na
// Vercel e não dá para usar localmente). Sem --accept-data-loss: se o push exigir
// apagar algo, falha e o deploy para. Remover do "build" depois de aplicado.
import { spawnSync } from "node:child_process";
if (process.env.VERCEL_ENV !== "production") {
  console.log("[db-push] fora de produção, pulando");
  process.exit(0);
}
const r = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
