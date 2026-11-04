import { ORBITA_NATIVE_VERSION } from "@/lib/orbita-hosting";

export default function InstagramOrbita() {
  return (
    <section
      className="min-w-0 space-y-5 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-emerald-50 p-6 sm:p-8"
      aria-labelledby="orbita-growth-title"
    >
      <p className="text-xs font-bold uppercase tracking-widest text-violet-700">
        Crescimento · Órbita · Teste inicial
      </p>
      <h2
        id="orbita-growth-title"
        className="text-2xl font-semibold tracking-tight text-slate-900"
      >
        Seu próximo ciclo de crescimento começa aqui.
      </h2>
      <p className="max-w-2xl text-sm leading-7 text-slate-600">
        Abra o dashboard para acompanhar engajamento, organizar públicos e
        transformar seus resultados em planos de melhoria. BFF e Moranga têm
        espaços separados por @.
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href="/api/growth/orbita/painel"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-600"
        >
          Abrir painel da Órbita →
        </a>
        <a
          href={`/api/growth/orbita/orbita-${ORBITA_NATIVE_VERSION}.zip`}
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-violet-200 bg-white px-5 py-3 text-sm font-semibold text-violet-800 hover:bg-violet-50"
        >
          Baixar extensão {ORBITA_NATIVE_VERSION}
        </a>
      </div>
      <p className="max-w-2xl text-xs leading-6 text-slate-600">
        O painel abre aqui no app, com seu login. Use o modo manual para
        analisar relatórios; coleta e execução dependem da extensão instalada
        neste navegador. Os dados ficam locais e não são sincronizados entre
        computadores. Cadastrar um @ cria o espaço da conta; a sessão do
        Instagram é confirmada separadamente. No painel, “Instalação e conexão”
        fica disponível mesmo no modo manual, e “Voltar ao Growth” traz você de
        volta aqui.
      </p>
    </section>
  );
}
