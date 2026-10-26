# Métricas das redes sociais

Módulo que coleta e analisa as métricas das contas conectadas no publicador. Hoje só o **Instagram** coleta; as outras redes estão registradas como "em breve".

## O que é coletado (Instagram)

Tudo via Instagram API com Instagram Login (`graph.instagram.com`), permissão `instagram_business_manage_insights` (já pedida na conexão em `/api/instagram/connect`).

| Tabela | Conteúdo |
| --- | --- |
| `SocialMetricaConta` | 1 linha por conta e dia: alcance, visualizações, visitas ao perfil, toques no link da bio (`profile_links_taps`), contas engajadas, interações, curtidas, comentários, compartilhamentos, salvamentos e total de seguidores (do dia da coleta). |
| `SocialMetricaPost` | 1 linha por mídia (foto, reel, carrossel, story): alcance, views, curtidas, comentários, compartilhamentos, salvamentos, interações, seguidores ganhos, visitas ao perfil, cliques no link da bio (`profile_activity` com `action_type`), tempo médio assistido (reels), hora e dia da semana no fuso de Brasília. |
| `SocialMetricaPublico` | 1 linha por conta e dia da coleta: idade, gênero, cidade e país de seguidores, de quem engaja e de quem é alcançado. |

Todas guardam o `bruto` (JSON completo devolvido pela API) para análises futuras. A coleta é idempotente (upsert).

Código: `src/lib/social/metricas/` (`instagram.ts` coleta, `analise.ts` análise pura, `types.ts` contrato, `index.ts` registro).
API: `GET /api/social/metricas?contaId=&dias=30`, `POST /api/social/metricas/coletar` ({contaId?, dias?}), `GET /api/cron/coletar-metricas`.
Tela: `src/components/hub/growth/SocialMetricas.tsx` (precisa ser plugada numa aba do hub por quem mexe no hub).

## Como a análise funciona

- **Melhor horário**: a Meta NÃO fornece mais o horário de pico dos seguidores. O painel calcula com o histórico real: média de alcance e de interações por postagem, por hora, dia da semana e dia x hora (feed e reels, últimos 90 dias; stories ficam fora). Só entram hora/dia com 3+ postagens; sempre mostra quantas postagens embasam; avisa se há menos de 20 postagens no total.
- **Formato**: alcance médio, taxa de engajamento (soma das interações ÷ soma do alcance), salvamentos, compartilhamentos e cliques na bio por postagem.
- **Cliques no link da bio**: a conta informa por DIA (não por hora). Por hora só existe via `profile_activity` de cada post (foto/carrossel/story), atribuído à hora da publicação.

## O que foi confirmado na documentação oficial (developers.facebook.com, consultada em 26/10/2026)

- Insights da conta (`/{ig-user-id}/insights`): `reach`, `views`, `accounts_engaged`, `total_interactions`, `likes`, `comments`, `shares`, `saves`, `replies`, `reposts`, `follows_and_unfollows`, `profile_links_taps` (breakdown `contact_button_type`), `follower_demographics`, `engaged_audience_demographics` (breakdown `age`, `gender`, `city`, `country`), `period=day`, `metric_type=total_value`, `since`/`until` em UNIX, dados com atraso de até 48h.
- `impressions` foi descontinuado (substituído por `views`). Em mídia: `impressions` não existe para mídia criada depois de 02/07/2024.
- Demografia de seguidores exige 100+ seguidores; engajados exige 100+ engajamentos no período; `timeframe` é obrigatório nas demográficas (não aceitam since/until).
- Métricas por mídia: FEED (comments, follows, likes, profile_activity, profile_visits, reach, saved, shares, total_interactions, views), REELS (comments, ig_reels_avg_watch_time, ig_reels_video_view_total_time, likes, reach, saved, shares, total_interactions, views), STORY (follows, navigation, profile_activity, profile_visits, reach, replies, shares, total_interactions, views). `profile_activity` aceita breakdown `action_type` (inclui `BIO_LINK_CLICKED`). `follows` e `profile_visits` não valem para reels.

## O que NÃO foi confirmado / limites

- `profile_views` (visitas ao perfil da conta) e `reached_audience_demographics` não apareceram na página de referência consultada; são pedidos assim mesmo e, se a API recusar, vira aviso na tela sem derrubar a coleta. A coleta de métricas da conta tenta o conjunto todo e, se recusar, tenta métrica por métrica.
- A página de insights de mídia diz que itens DENTRO de um álbum não têm insights; o álbum (carrossel) em si é pedido com as métricas de feed. Não consegui confirmar sem token se a API devolve todas elas para carrossel; se não, ficam zeradas e a mídia entra no aviso "sem insights".
- Nada foi testado contra a API real (sem token neste ambiente). A API de stories só devolve os das últimas 24h.
- `online_followers` (horário de pico) saiu da API em 24/09/2024; não existe.
- Plano gratuito da Vercel: cada rota roda no máximo 60 s. A coleta de 30 dias + ~90 dias de mídias usa chamadas em paralelo (4 por vez); se estourar, clique em Atualizar mais uma vez (dias já gravados são pulados, exceto os 3 mais recentes).

## Como adicionar uma rede nova

1. Crie `src/lib/social/metricas/<rede>.ts` exportando `coletar<Rede>(contaId, opcoes)` que devolve `ResultadoColeta` (use `abrirConta` para o token). Grave nas mesmas tabelas `SocialMetrica*`, com `tipo` normalizado (`foto|reel|carrossel|story`), hora e dia da semana no fuso de Brasília, e o `bruto` completo.
2. Em `src/lib/social/metricas/index.ts`, troque `coletorEmBreve(...)` da rede pelo coletor real com `disponivel: true`.
3. A análise e a tela já servem para qualquer rede.

## O que o Felipe precisa fazer

1. **Rodar a migração do banco**: foram adicionados 3 modelos (`SocialMetricaConta`, `SocialMetricaPost`, `SocialMetricaPublico`) e 3 relações em `SocialConta`. Rode `npx prisma db push` (ou a migração usada no projeto).
2. **Reconectar a conta do Instagram** (BFF e Moranga) se a coleta acusar falta de permissão de métricas.
3. **Agendador**: chamar `GET /api/cron/coletar-metricas` com `Authorization: Bearer <PUBLICAR_SECRET ou CRON_SECRET>` 1x por dia (de preferência de madrugada). Sem agendador, use o botão "Atualizar dados".
4. **Pedido para quem edita o hub** (fora da minha pasta): incluir uma aba que renderize `SocialMetricas` (exportação padrão) ao lado do publicador.
