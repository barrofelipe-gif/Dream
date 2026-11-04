"use strict";
let discoveryBusy = false,
  discoveryScope = null,
  discoveryGeneration = 0;
// Called by app.js; the panel uses classic scripts with a shared scope.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function renderDiscovery(active, limited) {
  const connection = state?.connection;
  const connected = connection?.state === "connected" && connection.enabled !== false;
  const scope = connected ? connection.context_id || String(connection.account?.id ?? "connected") : "";
  if (scope !== discoveryScope) {
    discoveryScope = scope;
    discoveryGeneration++;
    $("discovery-results").innerHTML = "";
    $("discovery-status").textContent = "";
  }
  const blocked = !connected || busy || active || limited || discoveryBusy;
  $("discovery-submit").disabled = blocked;
  $("discovery-query").disabled = discoveryBusy;
  for (const button of document.querySelectorAll("[data-discovery-term]"))
    button.disabled = discoveryBusy;
  $("discovery-hint").textContent = connection?.operation_notice || (!connected
    ? "Conecte sua conta acima para pesquisar no Telegram."
    : active
      ? "Encerre a operação em andamento antes de pesquisar."
      : limited
        ? "Aguarde a liberação da sua conta pelo Telegram antes de pesquisar."
        : "Pesquise quando quiser. A pesquisa não entra em grupos nem altera sua comunidade.");
}
function discoveryCards(groups) {
  return groups
    .flatMap((group) => {
      if (
        typeof group.username !== "string" ||
        !/^[A-Za-z0-9_]{3,32}$/.test(group.username)
      )
        return [];
      const members =
        Number.isSafeInteger(group.members) && group.members >= 0
          ? `${group.members.toLocaleString("pt-BR")} participantes`
          : "Quantidade de participantes não informada";
      return [
        `<article class="discovery-card"><div><h3>${escapeHTML(group.name)}</h3><p>@${escapeHTML(group.username)}</p><p class="hint">${members}</p>${group.sponsored ? '<span class="pill">Patrocinado</span>' : ""}</div><a class="button secondary" href="https://t.me/${encodeURIComponent(group.username)}" target="_blank" rel="noopener noreferrer">Abrir no Telegram</a></article>`,
      ];
    })
    .join("");
}
for (const button of document.querySelectorAll("[data-discovery-term]"))
  button.addEventListener("click", () => {
    $("discovery-query").value = button.dataset.discoveryTerm;
    $("discovery-query").focus();
  });
$("discovery-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("discovery-submit").disabled || !$("discovery-query").reportValidity())
    return;
  const query = $("discovery-query").value.trim(),
    generation = ++discoveryGeneration;
  discoveryBusy = true;
  busy = true;
  render();
  $("discovery-results").innerHTML = "";
  $("discovery-results").setAttribute("aria-busy", "true");
  $("discovery-status").textContent = "Buscando grupos públicos no Telegram…";
  try {
    const result = await request("/api/discover", { query });
    if (generation !== discoveryGeneration) return;
    $("discovery-results").innerHTML = discoveryCards(result.groups);
    $("discovery-status").textContent = result.groups.length
      ? `${result.groups.length} grupo(s) para “${result.query}”. Confira os resultados no Telegram.`
      : `Nenhum grupo público encontrado para “${result.query}”. Tente menos palavras ou um @usuário exato.`;
  } catch (error) {
    if (generation === discoveryGeneration)
      $("discovery-status").textContent = error.message;
  } finally {
    discoveryBusy = false;
    busy = false;
    $("discovery-results").setAttribute("aria-busy", "false");
    render();
  }
});
