# Contraprova do diagnóstico Wascer (11/100) — loja BFF Fitness Atacado

**Data:** 08/09/2026 · **Loja:** https://www.bfffitnessatacado.com.br/
**Origem:** e-mail de `no-reply@wascer.com`, assunto "Diagnóstico do seu site: 11/100"
**Página de decisão:** https://claude.ai/code/artifact/9275d47d-18f4-46ce-92c3-37dbbe92caa1

Verificação feita de forma independente (HTML da home, DNS do domínio, CrUX/PageSpeed
Insights), sem depender do relatório do fornecedor.

## Resposta curta

Os fatos técnicos **procedem**. A nota **11/100 é peça de venda**: os 5 "problemas"
são exatamente os 5 módulos que a Wascer vende, todos marcados "A evoluir". A única
seção medida por régua pública (Core Web Vitals) dá 3 de 4 "Bom" e não conta pontos.
A nota não mede a saúde do site — mede o quanto falta de Wascer no site.

**A medição rodada em 08/09 partiu a conta ao meio:** a perda de *coleta* é de 2,6%
(desprezível — derruba os itens 1 e 4), mas o Safari é 66,4% das sessões (contra a
minoria que eu havia suposto — o que **fortalece** os itens 2, 3 e 5). Ver seção
"Medição".

## Medição (10/ago – 08/set 2026)

| Fonte | Valor |
|---|---|
| Compras registradas no GA4 | 1.112 |
| Pedidos reais no período | 1.142 |
| **Captura** | **97,4% — lacuna de coleta de 2,6% (30 pedidos/mês)** |
| Receita GA4 | R$ 745.293 (vs. R$ 737.186 bruto — GA4 marca *a mais*, base diferente) |

Quebra por navegador (40 dias, 270.392 sessões):

| Navegador | Sessões | Share | Compras | Conversão |
|---|---|---|---|---|
| Safari | 179.555 | 66,4% | 547 | 0,305% |
| Chrome | 46.048 | 17,0% | 666 | 1,446% |
| Android Webview | 37.845 | 14,0% | 208 | 0,550% |
| Safari (in-app) | 3.207 | 1,2% | 2 | 0,062% |
| Outros | 3.737 | 1,4% | 36 | 0,963% |

**Leitura.** São dois problemas distintos e o teste só matou um:

- **Coleta — resolvido.** O GA4 conta a venda em 97,4% dos casos. Driblar bloqueador
  (itens 1 e 4) compra 2,6%. Não pague por isso.
- **Atribuição — em aberto e grande.** Contar a venda ≠ saber de qual anúncio veio.
  Isso depende do cookie sobreviver (`_fbp`, `_fbc`, `_gcl_aw`) e é o que o ITP corta
  em 7 dias — em 66% do tráfego. O relatório está bom; o sinal que volta pro Meta e
  Google otimizarem é que está degradado.

O Safari traz 66% das sessões e 37% das compras, convertendo 4,7× pior que o Chrome.
Boa parte é comportamento real (in-app do Instagram tem menos intenção; o equivalente
Android converte a 0,550%), mas o Safari converte 1,8× pior que esse equivalente —
sobra compatível com perda de atribuição por ITP.

**Anomalia a investigar:** 01 e 02/ago registraram 2.753 e 1.384 sessões contra ~6.500
nos dias vizinhos (queda de até 75% num fim de semana que não se repete). Cara de
interrupção de coleta. Checar histórico de versões do GTM nessa data.

## Ambiente confirmado

| Item | Valor |
|---|---|
| Plataforma | Tray Commerce (`tcdn.com.br`), CDN Azion (`azioncdn.net`) |
| Container GTM | `GTM-K5WRJX42` (de `googletagmanager.com`) |
| GA4 | `G-D3HMX0K61L` |
| Meta / TikTok | não estão no HTML — injetados pelo GTM |
| Scripts externos | só `www.googletagmanager.com` (fora imagens da Tray) |
| `Set-Cookie` de tracking | nenhum — todos os cookies são de JavaScript |
| Subdomínio de tracking | não existe (testados: dados, analytics, track, tracking, sgtm, gtm, metrics, st) |
| CMP / Consent Mode | **nenhum** |

## As 5 alegações

| # | Alegação | Veredito |
|---|---|---|
| 1 | `gtm.js` bloqueável por adblock | Procede — ponto único de falha confirmado (Meta e TikTok dependem do GTM). **Medido: custa 2,6% (30 pedidos/mês).** Tráfego vem de in-app browser, sem adblock. Solução deles = driblar bloqueador. Não compensa. |
| 2 | Safari/ITP corta cookies em 7 dias | **Procede, e é dos mais fortes.** Nenhum `Set-Cookie` no servidor. Tabela enganosa (apresenta o teto do ITP como duração: `_ga` é de 2 anos, `_fbp` de 90 dias). **Correção da leitura inicial:** supus que o Android dominaria e pegaria a minoria — medi e é o contrário, Safari = 66,4% das sessões. |
| 3 | Falta subdomínio first-party próprio | Procede — o mais correto tecnicamente, e o peso subiu com Safari em 66,4%. Ressalva: em loja Tray atrás de CDN, um CNAME pra infra deles cai justamente na defesa de CNAME cloaking do Safari que eles citam. |
| 4 | `/g/collect` sem ofuscação | Procede, mas **descartado pela medição** — divide os mesmos 2,6% do item 1, com a maior exposição do pacote. |
| 5 | Falta server-side (sGTM) | **Procede — o único que vale comprar.** Ganho real vem de Meta CAPI + Enhanced Conversions com deduplicação. Mas é commodity: sGTM gerenciado entrega o mesmo pacote. |

## Core Web Vitals (CrUX, mobile) — conferem com o relatório deles

| Métrica | Valor | Status |
|---|---|---|
| LCP | 1,9 s | Bom |
| INP | 160 ms | Bom |
| FCP | 1,7 s | Bom |
| CLS | 0,21 | A melhorar (52,4% bom / 46,4% médio / 1,2% ruim) |
| TTFB | 1,18 s | A melhorar — **omitido pelo relatório** |

## O que a Wascer omitiu

1. **Nenhum banner de consentimento nem Consent Mode.** O e-mail se anuncia como
   auditoria "de tagging e privacidade" e não cita isso. É a maior exposição real
   hoje (LGPD/ANPD). Implementar os itens 1 e 4 sem consentimento **aumenta** o risco.
2. **Causa do CLS identificada e gratuita:** 57 de 65 imagens da home sem
   `width`/`height`; só 2 com `loading`. Ajuste no tema da Tray, custo zero.
3. **TTFB 1,18 s fora do bom** — a única métrica ruim de velocidade ficou de fora
   da lista deles.

## Plano de correção (reordenado após a medição)

**Fase 0 — esta semana, sem fornecedor.** Banner de consentimento + Consent Mode v2;
`width`/`height` nas imagens do tema (57 de 65); investigar a queda de 1–2/ago no GTM.

**Fase 1 — justificada pela medição (Safari = 66,4%).** Meta CAPI + Enhanced
Conversions com deduplicação (maior ganho por real gasto); sGTM em subdomínio próprio
— cotar pelo menos 3 fornecedores, a Wascer entre eles.

**Fase 2 — descartada.** Loader anti-adblock e ofuscação de endpoint (itens 1 e 4):
~30 pedidos/mês em jogo, contra a maior exposição do pacote. Não pagar.

## Perguntas para o comercial

1. Como entregam o first-party numa loja Tray atrás da CDN Azion — CNAME ou registro A?
   Se CNAME, como fica a defesa do Safari que vocês mesmos citam no item 3?
2. Qual a régua dos 11/100? Um site sem nenhum produto de vocês tira quanto no melhor caso?
3. Entregam consentimento / Consent Mode v2? Por que a ausência total de CMP não
   apareceu numa auditoria "de privacidade"?
4. Preço mensal cheio, setup e fidelidade — comparado a sGTM gerenciado.
5. Eu pedi esse diagnóstico? O rodapé afirma que sim.

---
*Estimativas de impacto de adblock e de participação do Safari são leituras de
mercado, não medições desta loja — por isso a Fase 0 inclui medir a lacuna real.*
