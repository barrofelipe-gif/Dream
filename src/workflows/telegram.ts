import { sleep } from "workflow";
import { qrStep, queueStep } from "@/lib/telegram/steps";

export async function connectTelegramQR(userId: string, attempt: string) {
  "use workflow";
  await qrStep(userId, attempt);
}
export async function runTelegramQueue(userId: string, jobId: string) {
  "use workflow";
  while (await queueStep(userId, jobId)) await sleep("2s");
}
