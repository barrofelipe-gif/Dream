import { NextRequest, NextResponse, after } from "next/server";
import { assinaturaFacebookValida, tratarEventoMessenger, type PayloadPagina } from "@/lib/messenger";

// O robô do Messenger pode chamar a IA em segundo plano (after): até 60 s no plano da Vercel.
export const maxDuration = 60;

// Handshake ao cadastrar o webhook "Page" no app da Meta (mesmo token de verificação do Instagram).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verificação recusada" }, { status: 403 });
}

// Mensagens da Página do Facebook (Messenger). Responde 200 rápido e processa depois; sem assinatura válida, nada entra.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!assinaturaFacebookValida(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }
  let payload: PayloadPagina;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (payload.object !== "page") return NextResponse.json({ ok: true });

  after(async () => {
    for (const entry of payload.entry ?? []) {
      for (const ev of entry.messaging ?? []) {
        try {
          await tratarEventoMessenger(entry.id, ev);
        } catch (err) {
          console.error("[fb-webhook] falha ao tratar evento", err);
        }
      }
    }
  });
  return NextResponse.json({ ok: true });
}
