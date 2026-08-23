# Análise: automação da geração de boleto (Asaas) junto com a notificação de chargeback

**Contexto:** hoje, quando você gera uma notificação extrajudicial de chargeback (skill
`bff-chargeback`), o passo do boleto **não é automático**. O script
`assets/gerar_prompt_cobranca.js` da skill só monta um **texto de instrução** ("Criar cobrança
no Asaas com os dados abaixo...") em `/mnt/user-data/outputs/Cobranca_<PEDIDO>.txt`, e alguém
precisa entrar no Asaas manualmente e criar a cobrança à mão. É esse passo manual que você quer
eliminar: gerar a notificação e o boleto real (com link) no mesmo fluxo, para poder mandar tudo
junto e rápido.

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

## 4. Entregável: script de emissão real de boleto

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

Para plugar na skill de verdade, o passo seguinte é: copiar este script para
`assets/gerar_boleto_asaas.js` dentro da skill `bff-chargeback` (fora deste repositório, junto
dos outros scripts da skill) e ajustar o passo 5 do `SKILL.md` para chamá-lo em vez de gerar só o
`.txt` de instrução manual.

---

## 5. Próximos passos práticos

1. Confirmar que a conta Asaas da BFF (CNPJ 38.261.132/0001-40) já existe e tem sandbox
   disponível; se não tiver, criar conta e habilitar sandbox.
2. Gerar a API Key de sandbox e rodar o script acima num pedido de teste até o boleto sair
   redondo (valor, vencimento, descrição, PIX habilitado).
3. Gerar a API Key de produção, guardar como variável de ambiente (nunca em arquivo versionado)
   e trocar `ASAAS_ENV=production`.
4. Copiar o script para dentro da skill `bff-chargeback` e atualizar o `SKILL.md` (passo 5) para
   chamá-lo automaticamente, substituindo `gerar_prompt_cobranca.js`.
5. (Opcional, fase 2) Configurar webhook do Asaas para saber automaticamente quando cada boleto
   extrajudicial foi pago.
