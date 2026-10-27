import { NextRequest, NextResponse, after } from "next/server";
import { assinaturaValida } from "@/lib/instagram";
import { tentarGatilhoPorComentario } from "@/lib/igFluxos";
import { processarComentario } from "@/lib/igAutomacoes";
import { tratarEvento, type Payload } from "@/lib/igWebhook";

// O robô responde em segundo plano (after) e pode chamar a IA: o plano da Vercel aceita até 60 s.
export const maxDuration = 60;

// Handshake de verificação da Meta ao cadastrar o webhook no app.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verificação recusada" }, { status: 403 });
}

// Eventos de DM. A Meta exige 200 rápido: valida a assinatura, responde e
// processa depois (after). Sem assinatura válida, nada é processado.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!assinaturaValida(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }
  let payload: Payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (payload.object !== "instagram") return NextResponse.json({ ok: true });

  after(async () => {
    for (const entry of payload.entry ?? []) {
      // Comentários nas publicações: automação "comentário -> resposta pública + DM".
      for (const c of entry.changes ?? []) {
        if (c.field !== "comments" || !c.value?.id || !c.value.from?.id) continue;
        try {
          const evento = {
            contaId: entry.id,
            commentId: c.value.id,
            texto: c.value.text ?? "",
            userId: c.value.from.id,
            username: c.value.from.username,
            midiaId: c.value.media?.id ?? "",
            parentId: c.value.parent_id,
          };
          // Um fluxo visual com gatilho de comentário tem prioridade; senão vale a automação de comentário.
          // Falha no fluxo não pode impedir a automação de comentário de sempre.
          const fluxoAssumiu = await tentarGatilhoPorComentario(evento).catch((err) => {
            console.error("[ig-webhook] falha no fluxo de comentário", err);
            return false;
          });
          if (!fluxoAssumiu) await processarComentario(evento);
        } catch (err) {
          console.error("[ig-webhook] falha na automação de comentário", err);
        }
      }
      for (const ev of entry.messaging ?? []) {
        try {
          await tratarEvento(ev);
        } catch (err) {
          console.error("[ig-webhook] falha ao tratar evento", err);
        }
      }
    }
  });
  return NextResponse.json({ ok: true });
}

