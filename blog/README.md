# Blog BFF Fitness — correção mobile e home dinâmica (21/08/2026)

Fontes das alterações aplicadas no WordPress de `blog.bfffitnessatacado.com.br`.
O blog roda no tema **Twenty Twenty-Five**; as páginas principais são HTML puro
dentro de blocos `wp:html`.

## O que estava quebrado

1. **Artigos cortados na lateral no celular (e desktop).** Uma regra antiga no
   Additional CSS (`.single-post .entry-content{max-width:100%}`) prendia a
   largura do `entry-content` enquanto o WordPress aplicava as margens negativas
   de `alignfull` — o conteúdo inteiro deslocava ~30px para fora da tela.
2. **Home estática.** A home (página 809) tinha herói e cards de destaque
   escritos à mão no HTML — artigo novo publicado nunca aparecia.
3. **/blog/ inutilizável.** A página de posts do tema despejava os artigos
   **inteiros** empilhados (tabelas estourando a largura da tela) em vez de uma
   lista de cards.
4. Linha órfã "Escrito por  em" no topo dos artigos (grupo de meta do tema com
   autor/data ocultados individualmente).

## O que foi feito

| Arquivo | Destino no WordPress | Descrição |
|---|---|---|
| `custom-css-adicoes-post-254.css` | Post `custom_css` #254 (Additional CSS do tema) — blocos **anexados** ao final | Fix do corte lateral, remoção da linha órfã, chrome da página /blog/ |
| `home-blog-2026-page-809.html` | Página **809** (home do blog) | Herói agora carrega o **artigo mais recente** e a seção "Artigos recentes" lista os 8 seguintes via REST API (`/wp-json/wp/v2/posts`), com fallback estático. Ajustes mobile: fontes mínimas 11px, botões full-width ≤480px, remoção do botão flutuante que cobria CTAs |
| `todos-os-artigos-page-56.html` | Página **56** (`/blog/`) | Nova página "Todos os artigos": grade de cards com capa/categoria/data de **todos** os posts via REST API + busca instantânea. A opção `page_for_posts` foi zerada para a página renderizar o próprio conteúdo |

### Detalhes técnicos importantes

- Todo o conteúdo vai dentro de `<!-- wp:html --> … <!-- /wp:html -->` para o
  WordPress **não** aplicar `wpautop` (que injetava `<p>`/`<br>` entre os cards).
- O JavaScript inline **não pode conter o caractere `<`** (comparações `a<0`,
  regex `/</g` etc.): o filtro de texto do WordPress interpreta como tag e
  corrompe o script (`&&` vira `&#038;&#038;`). Por isso os scripts usam
  `createElement` em vez de template strings com HTML e comparações invertidas
  (`0 > x`).
- Artigos novos criados pela esteira editorial não precisam de nada especial:
  o fix de CSS é global e a home/arquivo se atualizam sozinhos pela REST API.
  Basta o post ter **imagem destacada** e **categoria**.

## Tamanhos de capa / imagem (para produzir as artes)

Uma única capa por artigo resolve tudo (herói, cards, /blog/, compartilhamento):

| Local | Tamanho ideal (px) | Proporção | Observação |
|---|---|---|---|
| **Capa do artigo (imagem destacada)** | **1600×1000** | 16:10 | Usada no herói da home, cards "Artigos recentes", página /blog/ e artigos relacionados. Assunto centralizado (as bordas podem ser cortadas pelo `object-fit:cover`) |
| Herói da home (desktop) | corte ~1240×960 da capa | ~4:3 | Coluna esquerda do card do herói; mobile corta para 780×520 |
| Cards "Artigos recentes" (desktop) | corte 800×500 | 16:10 | Card 275×170 renderizado em 2x |
| Cards /blog/ | corte 800×500 | 16:10 | `aspect-ratio:16/10` |
| Compartilhamento social (og:image) | 1200×630 | 1.91:1 | Se quiser arte própria para WhatsApp/Facebook, senão o Rank Math usa a capa |
| Imagens fixas da home (`bff-home-2026-01…11`) | herói 1240×960 · destaque 800×500 · radar 1260×740 · produtos 600×720 · autoridade 1120×720 | — | Só se quiser trocar as artes fixas da home |

Formato: JPG ou WebP, até ~300 KB (o plugin de otimização converte para WebP/AVIF).
