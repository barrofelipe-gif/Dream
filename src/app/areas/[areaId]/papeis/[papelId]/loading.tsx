/** Aparece na hora em que um papel é clicado no mapa, enquanto a página carrega (antes a tela ficava parada e parecia que o clique não funcionou). */
export default function CarregandoPapel() {
  return (
    <div className="max-w-2xl space-y-4 pb-10" aria-busy="true">
      <div className="h-4 w-32 animate-pulse rounded bg-[#eef0f4]" />
      <div className="rounded-2xl border border-[#e3e5ea] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 animate-pulse rounded-xl bg-[#eef0f4]" />
          <div className="space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-[#eef0f4]" />
            <div className="h-3 w-24 animate-pulse rounded bg-[#eef0f4]" />
          </div>
        </div>
        <p className="mt-4 text-sm text-[#8a8f9c]">Abrindo…</p>
      </div>
    </div>
  );
}
