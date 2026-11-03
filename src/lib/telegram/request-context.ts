import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { TelegramError } from "./domain";

type AccountContext = { accounts?: { activeId: string; generation: number } };
const requestContext = new AsyncLocalStorage<{ expected: string }>();

export function accountContext(data: AccountContext): string {
  return `${data.accounts?.activeId || "primary"}:${data.accounts?.generation || 0}`;
}

export function withRequestContext<T>(expected: string | null, work: () => T): T {
  if (!expected || expected.length > 160)
    throw new TelegramError("account_changed", "Atualize o painel para confirmar a conta Telegram selecionada.", 0, 409);
  return requestContext.run({ expected }, work);
}

// Called under the workspace row lock, before an action or Telegram lease.
export function assertRequestContext(data: AccountContext) {
  const context = requestContext.getStore();
  if (context && context.expected !== accountContext(data))
    throw new TelegramError("account_changed", "A conta selecionada mudou em outra janela. Atualize o painel e confira a conta antes de continuar.", 0, 409);
}

// Only a successfully committed change may advance its own request's context.
export function advanceRequestContext(data: AccountContext) {
  const context = requestContext.getStore();
  if (context) context.expected = accountContext(data);
}
