import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";

// Envio de fotos e vídeos do publicador direto do navegador para o armazenamento (Vercel Blob).
// O navegador pede um token aqui (só administrador logado); depois sobe o arquivo sem passar pelo servidor,
// por isso aguenta vídeo grande. A confirmação final que a Vercel manda não tem sessão: ela é validada
// pela assinatura dentro do próprio handleUpload (por isso esta rota fica em /api/webhooks/).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;

  if (body.type === "blob.generate-client-token") {
    const session = await auth();
    if (session?.user?.role !== "admin") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  try {
    const resposta = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"],
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        /* nada a fazer: o endereço público já volta para o navegador */
      },
    });
    return NextResponse.json(resposta);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
