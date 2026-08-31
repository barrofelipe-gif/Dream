# Análise: automação da geração de boleto (Asaas) junto com a notificação de chargeback

**Contexto:** hoje, quando você gera uma notificação extrajudicial de chargeback (skill
`bff-chargeback`), o passo do boleto **não é automático**. O script
`assets/gerar_prompt_cobranca.js` da skill só monta um **texto de instrução** ("Criar cobrança
no Asaas com os dados abaixo...") em `/mnt/user-data/outputs/Cobranca_<PEDIDO>.txt`, e alguém
precisa entrar no Asaas manualmente e criar a cobrança à mão. É esse passo manual que você quer
eliminar: gerar a notificação e o boleto real (com link) no mesmo fluxo, para poder mandar tudo
junto e rápido.

**Status:** validado em produção em 25/08/2026 pelo caminho pela extensão do Claude no
Chrome (seção 4-B), com uma cobrança real de configuração (`TESTE-CONFIG-001`) e confirmado:
valor, vencimento, descrição e cliente corretos, boleto + Pix disponíveis juntos, juros/multa
zerados, status "Aguardando Pagamento". O prompt validado está salvo em
`assets/prompt_extensao_chrome_asaas.md` dentro da skill `bff-chargeback`.

**Atualização de 31/08/2026:** o caminho por API (`gerar_boleto_asaas.js`, seção 4-A) também
está validado em produção agora — criou uma cobrança real (`pay_sln3r3ayllzg16gc`, pedido
`TESTE-API-001`, R$ 1.000,00) reaproveitando o cliente existente por CPF. Também foi
implementada a **Opção A** descrita na seção 3: a skill `bff-chargeback` foi atualizada (fora
deste repositório — ela é gerenciada pelo usuário no claude.ai) para, ao rodar
`assets/gerar_notificacao.js`, já chamar `gerar_boleto_asaas.js` automaticamente com os dados
do caso e o total extrajudicial, sem precisar do passo manual de `gerar_prompt_cobranca.js`.
Duas coisas ficaram de fora do escopo deste repositório porque dependem de configuração da
conta/ambiente do usuário, não de código:
- **Node não lê `HTTPS_PROXY`/`HTTP_PROXY` sozinho.** Em ambientes de rede restrita (como
  sessões Claude Code na nuvem), o `fetch` nativo do Node ignora essas variáveis — diferente de
  `curl`. O script agora se re-executa com a flag `--use-env-proxy` quando detecta um proxy
  configurado, então isso já é automático a partir desta versão.
- **A `ASAAS_API_KEY` não é persistida entre sessões** a menos que seja salva como variável de
  ambiente do ambiente de nuvem usado (Claude Code on the web → seletor de ambiente → ⚙️ →
  Network access / Variáveis de ambiente). É uma decisão do usuário, pois esse campo fica em
  texto plano, visível a qualquer pessoa que use o mesmo ambiente.

Este documento cobre (1) como a API do Asaas funciona para emitir boleto, (2) como configurar o
acesso com segurança, (3) a arquitetura recomendada para automatizar isso e (4) um script pronto
(`scripts/asaas/gerar_boleto_asaas.js`) que substitui o passo manual por uma chamada real à API.

---

## 1. Como a API do Asaas funciona (boleto)

### Autenticação
- A chave de API vai no **header `access_token`** em toda requisição (Asaas **não** usa
  `Authorization: Bearer`).
- Existem **ambientes separados com chaves separadas**:
  - Sandbox (testes, dinheiro fictício): `https://api-sandbox.asaas.com/v3`
  - Produção (dinheiro real): `https://api.asaas.com/v3`
- A chave é gerada em **Asaas → menu do usuário → Integrações → API → "Gerar nova API Key"**,
  dentro da conta correta (CNPJ 38.261.132/0001-40 da BFF), no ambiente correto. Uma chave de
  sandbox não funciona em produção e vice-versa.

### Fluxo de criação de cobrança
1. **Localizar ou criar o cliente** no Asaas:
   - `GET /v3/customers?cpfCnpj=<CPF>` para ver se o cliente já existe (evita duplicar cliente a
     cada notificação).
   - Se não existir: `POST /v3/customers` com `{ name, cpfCnpj, email, mobilePhone }`.
2. **Criar a cobrança**: `POST /v3/payments` com, no mínimo:
   ```json
   {
     "customer": "<id do cliente no Asaas>",
     "billingType": "BOLETO",
     "value": 0,
     "dueDate": "AAAA-MM-DD",
     "description": "Quitação extrajudicial referente ao pedido <PEDIDO> (BFF Fitness Atacado)",
     "externalReference": "<PEDIDO>",
     "discount": { "value": 0 },
     "interest": { "value": 0 },
     "fine": { "value": 0 }
   }
   ```
   - `externalReference` = número do pedido: é o que garante **idempotência** (dá para checar
     antes se já existe cobrança para aquele pedido e não duplicar).
   - Juros/multa do boleto ficam **zerados** porque, no seu caso, os encargos (multa 20%, juros
     de mora, IGP-M, taxa Vindi, antecipação, retenção) já estão embutidos no `value`, calculados
     pelo `gerar_notificacao.js` — não pode cobrar duas vezes.
   - `billingType` pode ser `BOLETO` (só boleto) ou `UNDEFINED` (Asaas gera boleto **e** Pix
     copia-e-cola no mesmo link, deixando o cliente escolher) — dado que o texto atual já promete
     "boleto com PIX copia e cola", o certo é `UNDEFINED`.
3. **Resposta da API** já traz o que você precisa mandar pro cliente:
   - `id` — id da cobrança no Asaas
   - `invoiceUrl` — link da fatura (onde o cliente vê boleto + Pix)
   - `bankSlipUrl` — link direto do PDF do boleto
   - `status` — `PENDING` logo após a criação
   - Para pegar a linha digitável separadamente: `GET /v3/payments/{id}/identificationField`
   - Para pegar o QR code Pix separadamente: `GET /v3/payments/{id}/pixQrCode`

### Webhooks (saber quando o cliente pagou)
- Configurado em **Integrações → Webhooks** (ou via `POST /v3/webhooks`), apontando para uma URL
  sua que aceite `POST`.
- A cada evento, o Asaas envia um JSON `{ event, payment: {...} }`. Eventos relevantes:
  - `PAYMENT_CREATED` — boleto criado
  - `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED` — cliente pagou
  - `PAYMENT_OVERDUE` — venceu sem pagamento
- Sua URL precisa responder **HTTP 200 rápido**, senão o Asaas enfileira/reenvia.
- **Importante:** isso exige um endpoint público hospedado em algum lugar (não existe hoje). Não
  é bloqueante para a v1 da automação (ver seção 3, Opção A) — só passa a fazer sentido se você
  quiser saber automaticamente "esse cliente já pagou o boleto extrajudicial" sem checar o painel
  do Asaas manualmente.

---

## 2. Configuração segura da chave de API

Regras práticas para essa chave:

1. **Nunca commitar a `ASAAS_API_KEY` em nenhum repositório** (nem neste `Dream`, nem em nenhum
   outro) — é uma credencial financeira: com ela dá pra emitir cobrança em nome da BFF.
2. Guardar como **variável de ambiente** no lugar onde o script roda:
   - Se rodar dentro de uma sessão Claude Code (como hoje), definir `ASAAS_API_KEY` e
     `ASAAS_ENV=sandbox|production` no ambiente da sessão/projeto, não em texto solto.
   - Se rodar num serviço à parte (Opção B), usar o cofre de secrets da hospedagem escolhida.
3. **Testar sempre em sandbox primeiro** (`ASAAS_ENV=sandbox`) até confirmar que boleto sai
   certo, com o valor certo e o `externalReference` certo — só depois trocar a chave e a env var
   para produção.
4. Gerar uma chave **só de cobrança** se o Asaas permitir escopo restrito na conta (evita expor
   permissões de saque/transferência numa chave usada por automação).

---

## 3. Arquitetura recomendada

### Opção A — automação dentro do fluxo atual (recomendada para começar)
Continua tudo dentro da mesma sessão que já gera a notificação (skill `bff-chargeback`), só troca
o passo manual por uma chamada real de API:

1. `gerar_notificacao.js` gera o `.docx` (como hoje) e imprime o `TOTAL_EXTRAJUDICIAL`.
2. **Novo passo 5.5**: rodar `scripts/asaas/gerar_boleto_asaas.js` (entregue abaixo) com os
   mesmos dados do cliente + o total extrajudicial + o vencimento (mesma data da notificação, 5
   dias corridos). O script cria (ou reaproveita) o cliente no Asaas e cria a cobrança de verdade,
   devolvendo o link do boleto/Pix.
3. `gerar_mensagem_whatsapp.js` deixa de usar um placeholder de boleto e passa a receber o
   `invoiceUrl`/`bankSlipUrl` reais, retornados pelo passo 2, direto na mensagem final.
4. Resultado: você confirma os dados uma vez (como já faz hoje) e, na mesma leva, saem `.docx` +
   `.pdf` + boleto real + mensagem de WhatsApp com o link certo — sem abrir o painel do Asaas.

**Esforço:** baixo (é o script anexo). **Risco:** baixo, porque continua com humano confirmando
os dados antes de gerar (mesma trava que já existe hoje para não inventar dado).

### Opção B — gatilho automático a partir do próprio chargeback (evolução futura)
Isso é o que o pedido "já gerar quando eu gerar as notificações" pode crescer para depois: um
serviço que escuta o evento de chargeback direto na Vindi/Yapay (se elas expuserem webhook de
chargeback) e dispara sozinho: extrai dados → classifica o tipo de caso → gera notificação →
gera boleto Asaas → manda WhatsApp. Isso precisa de:
- Hospedagem de um serviço com endpoint público (webhook receiver).
- Fila/retry e idempotência mais robustos que um script solto.
- Ainda depender de revisão humana em algum ponto, porque a extração de dados das imagens do
  painel BFF e da Vindi/Yapay e a classificação do `TIPO_CASO` (7 tipos, cada um com argumento
  jurídico diferente) **não é um dado estruturado que vem em webhook** — é interpretação que hoje
  é feita por você + IA. Automatizar isso 100% sem revisão é arriscado juridicamente (a skill já
  tem regra explícita de "pergunte antes de gerar, não invente" e teto de 80% pra sinalizar antes
  de enviar).

**Recomendação:** não vale começar por aqui. É bem mais infraestrutura para o mesmo ganho
imediato que a Opção A já entrega, e o gargalo real hoje é o passo manual do boleto, não o
disparo do processo.

---

## 4-A. Entregável: script de emissão real de boleto (via API)

Arquivo: [`scripts/asaas/gerar_boleto_asaas.js`](../scripts/asaas/gerar_boleto_asaas.js)

Uso:
```bash
export ASAAS_API_KEY="sua_chave_aqui"
export ASAAS_ENV="sandbox"   # troque para "production" só depois de validar

node scripts/asaas/gerar_boleto_asaas.js \
  --pedido 99999 \
  --nome "NOME COMPLETO DA CLIENTE" \
  --cpf "000.000.000-00" \
  --email "email@cliente.com" \
  --telefone "27900000000" \
  --valor 1234.56 \
  --vencimento 2026-08-28
```

O script:
- Busca o cliente no Asaas pelo CPF; se não existir, cria.
- Cria a cobrança com `billingType: UNDEFINED` (boleto + Pix), `externalReference` = pedido,
  juros/multa/desconto zerados.
- Antes de criar, verifica se já existe uma cobrança `PENDING` com aquele `externalReference` e
  reaproveita em vez de duplicar (evita gerar dois boletos pro mesmo pedido se o script rodar
  duas vezes).
- Imprime e salva em `/mnt/user-data/outputs/Cobranca_<PEDIDO>.json` o `invoiceUrl`,
  `bankSlipUrl` e `id` — prontos para entrar na mensagem de WhatsApp e no e-mail.

Já foi copiado para dentro da skill de verdade: `assets/gerar_boleto_asaas.js` dentro da skill
`bff-chargeback` (fora deste repositório, junto dos outros scripts da skill). Falta apenas
configurar `ASAAS_API_KEY`/`ASAAS_ENV` no ambiente para esse caminho poder ser usado — enquanto
isso não acontece, o `SKILL.md` cai automaticamente no caminho 4-B abaixo.

---

## 4-B. Alternativa validada: prompt para a extensão do Claude no Chrome

Não depende de `ASAAS_API_KEY`. Em vez de chamar a API, dá o mesmo roteiro passo a passo pra um
agente de navegador (a extensão do Claude no Chrome) preencher a tela do Asaas exatamente como um
humano faria — busca/cria o cliente, cria a cobrança com boleto + Pix, zera juros/multa, para
para confirmação antes de salvar, e devolve o link da fatura + a mensagem de WhatsApp pronta.

Arquivo com o prompt completo (com os placeholders `{PEDIDO}`, `{NOME_COMPLETO}`, `{CPF}`,
`{EMAIL}`, `{TELEFONE}`, `{VALOR}`, `{VENCIMENTO}`, `{PRIMEIRO_NOME}`, `{FATO}`):
`assets/prompt_extensao_chrome_asaas.md` dentro da skill `bff-chargeback`.

**Validado em produção em 25/08/2026** com uma cobrança real de teste
(`TESTE-CONFIG-001`, cliente Felipe Barros, R$ 1.000,00, vencimento 30/10/2026): valor,
vencimento, descrição e cliente saíram corretos; boleto e Pix disponíveis no mesmo link;
juros/multa em branco (zerados); status "Aguardando Pagamento" — igual ao que o script por
API teria produzido, só que sem precisar de chave de API.

---

## 5. Próximos passos práticos

1. ~~Confirmar que a conta Asaas da BFF já existe~~ — confirmado: cobrança criada com sucesso
   em produção em 25/08/2026 (ver 4-B).
2. ~~Validar que o fluxo de criação de cobrança sai redondo~~ — validado via extensão do
   Chrome (4-B). O caminho por API (4-A) ainda não foi testado de fato (falta a chave).
3. Se quiser o caminho mais rápido/automatizável (sem depender do Chrome aberto): gerar a API
   Key da BFF (sandbox primeiro, depois produção), guardar como variável de ambiente (nunca em
   arquivo versionado) e testar `gerar_boleto_asaas.js` (4-A) num pedido de teste.
4. Cancelar ou deixar vencer a cobrança de teste `TESTE-CONFIG-001` no painel do Asaas quando
   não precisar mais dela — ela ficará "Aguardando Pagamento" indefinidamente até isso.
5. (Opcional, fase 2) Configurar webhook do Asaas para saber automaticamente quando cada boleto
   extrajudicial foi pago.
