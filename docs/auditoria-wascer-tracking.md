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
| 1 | `gtm.js` bloqueável por adblock | Procede — ponto único de falha confirmado (Meta e TikTok dependem do GTM). Tamanho inflado: tráfego vem de in-app browser do Meta, sem adblock. Solução deles = driblar bloqueador. |
| 2 | Safari/ITP corta cookies em 7 dias | Procede (nenhum `Set-Cookie` no servidor). Tabela enganosa: apresenta o teto do ITP como duração do cookie (`_ga` é de 2 anos, `_fbp` de 90 dias). No Brasil, Android domina — atinge minoria. |
| 3 | Falta subdomínio first-party próprio | Procede — o mais correto tecnicamente. Ressalva: em loja Tray atrás de CDN, um CNAME pra infra deles cai justamente na defesa de CNAME cloaking do Safari que eles citam. |
| 4 | `/g/collect` sem ofuscação | Procede, mas é o de menor retorno e maior exposição. Quase redundante com o item 1. Deixar por último. |
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

## Antes de contratar: medir a lacuna

```
lacuna = 1 − (compras registradas no GA4 ÷ pedidos reais aprovados)
         mesmo período fechado, 30 dias · fontes: GA4 e Tray/Bling
```

- **até 10%** — perda normal de mercado; fazer só consentimento + CLS.
- **10–25%** — vale server-side; cotar Wascer contra sGTM gerenciado.
- **acima de 25%** — alegação comprovada com número próprio; discutir preço, não mérito.

## Plano de correção

**Fase 0 (esta semana, sem fornecedor):** banner de consentimento + Consent Mode v2;
`width`/`height` nas imagens do tema; medir a lacuna GA4 × pedidos reais.

**Fase 1 (só se a lacuna > 10%):** Meta CAPI + Enhanced Conversions com deduplicação;
sGTM em subdomínio próprio — cotar pelo menos 3 fornecedores.

**Fase 2 (provavelmente não):** ofuscação de endpoint (item 4).

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
