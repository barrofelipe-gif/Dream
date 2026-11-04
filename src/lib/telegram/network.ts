import { TelegramError } from "./domain";

export function telegramNetworkStatus(env: NodeJS.ProcessEnv = process.env) {
  const deployed = env.NODE_ENV === "production" || !!env.VERCEL || ["production", "preview"].includes(env.VERCEL_ENV || "");
  const region = env.VERCEL_REGION || (deployed ? "unknown" : "local");
  const paused = env.TELEGRAM_NETWORK_PAUSED === "1";
  const regionAllowed = !deployed || region === "gru1";
  const notice = paused
    ? "Operações Telegram pausadas após o relato de suspensão. Contas e histórico preservados."
    : !regionAllowed
      ? "A execução do Telegram precisa ocorrer em São Paulo, Brasil. Operação interrompida."
      : "";
  return { enabled: !paused && regionAllowed, paused, region, required_region: "gru1", notice };
}

export function assertTelegramNetwork() {
  const status = telegramNetworkStatus();
  if (!status.enabled)
    throw new TelegramError(status.paused ? "operations_paused" : "region_required", status.notice, 0, 503);
}
