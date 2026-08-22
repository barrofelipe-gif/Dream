---
name: bff-blog-manutencao
description: Mapa técnico e regras de manutenção do Blog BFF Fitness Atacado (blog.bfffitnessatacado.com.br) — arquitetura das páginas (home dinâmica, /blog/, CSS global), regras que evitam quebrar o site (JavaScript à prova de WordPress, bloco wp:html, fix do mobile), tamanhos de imagem, vitrine de produtos e fluxo de validação visual mobile/desktop. Use SEMPRE que a tarefa envolver editar, ajustar, revisar ou diagnosticar o BLOG da BFF - layout, mobile, home, vitrine, página /blog/, CSS do tema, velocidade/performance do blog, capas ou imagens das páginas. Ativa com pedidos como "ajusta a home do blog", "o blog está quebrado no celular", "troca as fotos da vitrine", "revisa o layout do blog", "o artigo novo não apareceu", "velocidade do blog". NÃO usar para criar/escrever artigos (isso é bff-criacao-artigo-blog) nem para o site da loja (bfffitnessatacado.com.br, que é Tray).
---

# Manutenção do Blog BFF Fitness

Blog em WordPress (tema **Twenty Twenty-Five**, block theme) em `blog.bfffitnessatacado.com.br`.
Acesso de edição via ferramentas MCP **AI_Engine** (`wp_get_post`, `wp_update_post`, `wp_alter_post`,
`wp_get_option`, `wp_update_option`, `wp_upload_media`). Hospedagem HostGator (compartilhada).

## Mapa das páginas (IDs no WordPress)

| ID | O que é | Observações |
|---|---|---|
| **809** | Home do blog (front page, `show_on_front=page`) | HTML puro dentro de bloco `wp:html`. Herói e seção "Artigos recentes" são **dinâmicos** (JS + REST API) |
| **56** | Página `/blog/` "Todos os artigos" | HTML puro em `wp:html`. Grade de todos os posts via REST API + busca. `page_for_posts=0` (proposital — NÃO religar) |
| **254** | CSS global do tema (post type `custom_css`, título `twentytwentyfive`) | Contém o fix do mobile e os ocultamentos do chrome do tema. Editar SEMPRE com `wp_alter_post` (anexar/substituir trechos), nunca reescrever inteiro |

Artigos individuais carregam seu próprio HTML/CSS inline (modelo da skill `bff-criacao-artigo-blog`).

## Regras que evitam quebrar o site (aprendidas na prática)

1. **JavaScript inline não pode conter o caractere `<` solto.** O filtro de texto do WordPress
   interpreta `a<0` ou `/</g` como abertura de tag e corrompe o script (`&&` vira `&#038;&#038;`).
   Escreva JS com `document.createElement` (nunca `innerHTML` com tags em string) e inverta
   comparações (`0 > x` em vez de `x < 0`). Valide com `node --check` antes de publicar.
2. **Todo conteúdo de página vai dentro de `<!-- wp:html --> … <!-- /wp:html -->`.** Sem isso o
   `wpautop` injeta `<p>` e `<br>` entre elementos e quebra grades de cards.
3. **Não remover do CSS global (254):** `.entry-content.alignfull{max-width:none !important}` —
   é o fix que impede os artigos de serem cortados ~30px na lateral no celular. A causa raiz é uma
   regra legada `.single-post .entry-content{max-width:100%}` mais acima no mesmo arquivo que
   conflita com as margens negativas de `alignfull` do WordPress.
4. **Home e /blog/ se atualizam sozinhas.** Nunca adicionar artigos manualmente nelas — o JS busca
   os posts em `/wp-json/wp/v2/posts?_embed=wp:featuredmedia,wp:term`. Artigo novo só precisa de
   **imagem destacada + categoria** para aparecer em tudo (herói, cards, /blog/).
5. **Edições cirúrgicas com `wp_alter_post`** (busca literal ou regex) em vez de reenviar o
   conteúdo inteiro — menos risco de corromper as páginas grandes.
6. **Depois de qualquer edição, sincronizar o GitHub**: repo `barrofelipe-gif/Dream`, branch
   `claude/blog-mobile-responsiveness-kojn8u`, pasta `blog/` (fontes das páginas 809, 56 e do CSS
   anexado ao 254, mais README). Aplicar a mesma mudança no arquivo e commitar.

## Vitrine de produtos da home ("Compre o que você acabou de entender")

- 6 cards `<a class="product-card">`, cada um linkando uma categoria real da loja com
  `?utm_source=blog&utm_medium=home&utm_campaign=vitrine`:
  `conjunto-de-legging`, `conjunto-de-short`, `caneladodecompressao`, `macacao-e-macaquinho`,
  `blusas`, `novidades-moda-fitness-atacado`.
- Fotos: **fotos reais de produto** vindas do CDN da Tray (`images.tcdn.com.br/img/img_prod/1270558/…`),
  enviadas para a mídia do blog via `wp_upload_media(url=…)` (o CDN da Tray é bloqueado pela proxy da
  sessão, mas o WordPress baixa server-side sem problema). Originais 900×1350; no HTML usar a variante
  **`-768x1152.jpg`** com `width`/`height` declarados e `loading="lazy"`.
- Layout: grade 3 colunas no desktop, 2 no mobile, imagens `aspect-ratio:3/4` — a peça deve
  preencher o quadro (foto de produto vertical, nunca foto de cena aberta em baixa resolução).
- Para trocar uma foto: achar a URL no HTML da categoria da loja (padrão `data-src` em
  `images.tcdn.com.br`), subir com `wp_upload_media`, trocar o `src` com `wp_alter_post`.

## Tamanhos de imagem (resumo)

- **Capa de artigo (imagem destacada): 1600×1000 (16:10)**, assunto nos 75% centrais, JPG/WebP ≤300KB.
- Vitrine: fotos de produto retrato, servidas em 768×1152.
- Herói da home (fallback estático): 1240×960 · og:image: 1200×630.
- Guia completo: doc "GUIA DE CAPAS E IMAGENS DO BLOG" na pasta CLAUDE do Drive
  (junto da FILA EDITORIAL) e `blog/README.md` no repo.

## Validação visual (obrigatória antes de dar por pronto)

O Chromium da sessão **não acessa a internet** (proxy reseta CONNECT do browser), mas o `curl` acessa.
Fluxo que funciona:
1. Baixar as páginas com `curl --cacert /root/.ccr/ca-bundle.crt` e espelhar localmente
   (reescrever URLs do host para caminhos locais; baixar as imagens de `/wp-content/`).
2. Servir com um servidor Node/Python local e abrir com **playwright-core**
   (`executablePath:'/opt/pw-browsers/chromium'`), interceptando `page.route` para servir
   `/wp-json/` de um JSON salvo (com header `access-control-allow-origin:*`) e os assets do espelho.
3. Testar em **390×844 (iOS) e 360×800 (Android)**, deviceScaleFactor 2, e desktop 1366×900.
4. Checar: overflow horizontal (`scrollWidth > clientWidth`), elementos cortados na lateral
   (rect.left < 0), fontes < 12px, e **tirar screenshots e OLHAR** — medir não substitui ver.
5. Mostrar screenshots ao usuário via arquivo (antes/depois quando fizer sentido).

## Performance (estado em 08/2026)

- Home ~533KB total, HTML 52KB gzipado, imagens lazy, herói com `fetchpriority="high"`.
- Gargalo: TTFB 0,8–1,4s (HostGator compartilhada). Melhoria pendente sugerida: ativar page cache
  do plugin da HostGator ou Cloudflare grátis. PageSpeed API não roda da sessão (429 sem chave) —
  medir com curl (`time_starttransfer`) e somar bytes dos recursos.

## Diagnóstico rápido de problemas conhecidos

- **"Artigo novo não aparece na home"** → conferir se o post tem imagem destacada e categoria e se
  está `publish`; depois conferir se o `<script>` da home está íntegro (buscar `&#038;` dentro do
  script servido = corrompido; ver regra 1).
- **"Conteúdo cortado na lateral no celular"** → a regra do item 3 foi removida do CSS 254; reanexar.
- **"Linha 'Escrito por em' no topo do artigo"** → regra `.single .wp-block-group:has(> .wp-block-post-author-name){display:none}` sumiu do CSS 254.
- **"/blog/ mostrando artigos inteiros empilhados"** → `page_for_posts` deixou de ser 0; zerar de novo
  com `wp_update_option`.
