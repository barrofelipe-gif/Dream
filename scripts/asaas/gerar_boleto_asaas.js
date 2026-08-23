#!/usr/bin/env node
/**
 * gerar_boleto_asaas.js
 *
 * Cria (ou reaproveita) uma cobrança real no Asaas para o total extrajudicial de um pedido,
 * em substituição ao passo manual de "criar cobrança no Asaas com os dados abaixo" usado hoje
 * pela skill bff-chargeback (gerar_prompt_cobranca.js).
 *
 * Uso:
 *   export ASAAS_API_KEY="sua_chave"
 *   export ASAAS_ENV="sandbox"      # ou "production"
 *
 *   node gerar_boleto_asaas.js \
 *     --pedido 99999 \
 *     --nome "NOME COMPLETO DA CLIENTE" \
 *     --cpf "000.000.000-00" \
 *     --email "email@cliente.com" \
 *     --telefone "27900000000" \
 *     --valor 1234.56 \
 *     --vencimento 2026-08-28
 *
 * Saída: imprime no console e grava em
 *   /mnt/user-data/outputs/Cobranca_<PEDIDO>.json
 * com { id, invoiceUrl, bankSlipUrl, status }.
 *
 * Regras de negócio embutidas (não mexer sem revalidar com o fluxo jurídico da skill):
 *   - value = SEMPRE o total extrajudicial já calculado (nunca o valor principal do pedido).
 *   - juros/multa/desconto do boleto ficam zerados: os encargos já estão dentro do value.
 *   - billingType = UNDEFINED, para o boleto sair com opção de Pix copia-e-cola também.
 *   - externalReference = número do pedido, usado para não duplicar cobrança em reexecuções.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

function baseUrl(env) {
  if (env === 'production') return 'https://api.asaas.com/v3';
  if (env === 'sandbox') return 'https://api-sandbox.asaas.com/v3';
  throw new Error(`ASAAS_ENV inválido: "${env}" (use "sandbox" ou "production")`);
}

async function asaasFetch(env, apiKey, pathname, options = {}) {
  const url = `${baseUrl(env)}${pathname}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
      'User-Agent': 'bff-chargeback-automation',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.errors ? JSON.stringify(body.errors) : JSON.stringify(body);
    throw new Error(`Asaas API ${res.status} em ${pathname}: ${detail}`);
  }
  return body;
}

async function findOrCreateCustomer(env, apiKey, { nome, cpf, email, telefone }) {
  const cpfDigits = onlyDigits(cpf);
  const search = await asaasFetch(
    env,
    apiKey,
    `/customers?cpfCnpj=${encodeURIComponent(cpfDigits)}`,
  );
  if (search?.data?.length) {
    return search.data[0];
  }
  return asaasFetch(env, apiKey, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: nome,
      cpfCnpj: cpfDigits,
      email,
      mobilePhone: onlyDigits(telefone),
    }),
  });
}

async function findExistingPendingPayment(env, apiKey, pedido) {
  const res = await asaasFetch(
    env,
    apiKey,
    `/payments?externalReference=${encodeURIComponent(pedido)}&status=PENDING`,
  );
  return res?.data?.[0] || null;
}

async function createPayment(env, apiKey, { customerId, valor, vencimento, pedido }) {
  return asaasFetch(env, apiKey, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'UNDEFINED', // boleto + Pix copia-e-cola no mesmo link
      value: Number(valor),
      dueDate: vencimento, // AAAA-MM-DD
      description: `Quitação extrajudicial referente ao pedido ${pedido} (BFF Fitness Atacado), conforme notificação extrajudicial enviada.`,
      externalReference: String(pedido),
      discount: { value: 0 },
      interest: { value: 0 },
      fine: { value: 0 },
    }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['pedido', 'nome', 'cpf', 'email', 'telefone', 'valor', 'vencimento'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Faltam argumentos: ${missing.map((k) => `--${k}`).join(', ')}`);
    process.exit(1);
  }

  const apiKey = process.env.ASAAS_API_KEY;
  const env = process.env.ASAAS_ENV;
  if (!apiKey) {
    console.error('Defina ASAAS_API_KEY no ambiente antes de rodar este script.');
    process.exit(1);
  }
  if (!env) {
    console.error('Defina ASAAS_ENV=sandbox (ou production) no ambiente antes de rodar este script.');
    process.exit(1);
  }

  const { pedido, nome, cpf, email, telefone, valor, vencimento } = args;

  console.log(`[asaas:${env}] Buscando/criando cliente para CPF ${cpf}...`);
  const customer = await findOrCreateCustomer(env, apiKey, { nome, cpf, email, telefone });

  console.log(`[asaas:${env}] Cliente: ${customer.id} (${customer.name})`);

  console.log(`[asaas:${env}] Verificando se já existe cobrança pendente para o pedido ${pedido}...`);
  let payment = await findExistingPendingPayment(env, apiKey, pedido);

  if (payment) {
    console.log(`[asaas:${env}] Cobrança já existia (${payment.id}), reaproveitando em vez de duplicar.`);
  } else {
    console.log(`[asaas:${env}] Criando cobrança de R$ ${valor} com vencimento em ${vencimento}...`);
    payment = await createPayment(env, apiKey, {
      customerId: customer.id,
      valor,
      vencimento,
      pedido,
    });
  }

  const resultado = {
    pedido: String(pedido),
    id: payment.id,
    status: payment.status,
    invoiceUrl: payment.invoiceUrl,
    bankSlipUrl: payment.bankSlipUrl,
    valor: payment.value,
    vencimento: payment.dueDate,
  };

  const outDir = '/mnt/user-data/outputs';
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `Cobranca_${pedido}.json`);
    fs.writeFileSync(outPath, JSON.stringify(resultado, null, 2));
    console.log(`OK: ${outPath}`);
  } catch (err) {
    console.warn(`Aviso: não consegui gravar em ${outDir} (${err.message}). Resultado só no console.`);
  }

  console.log('\n--- Resultado ---');
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
});
