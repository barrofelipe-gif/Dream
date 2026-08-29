# PJe (TJES) — servidor MCP

Servidor MCP (stdio) para consultar o PJe do TJES a partir do seu certificado
digital A1 (arquivo `.pfx`) ou A3 (token/smartcard, **só em Windows**).

## Origem e o que foi mudado

Não existe uma versão pública/genérica do "MCP Ana" — ele é uma ferramenta
interna do Laboratório de Inovação do TJMA, não distribuída para outros
tribunais. Este servidor é vendorizado a partir de
[chapirousIA/pje-mcp-server](https://github.com/chapirousIA/pje-mcp-server)
(MIT), que afirma funcionar com qualquer tribunal PJe, mas só foi testado
publicamente contra TJCE, TRF5, TJMG, TJSP e TJRJ — **não o TJES**. Trate a
primeira consulta como um teste, não como certeza.

Duas mudanças em relação ao upstream:

1. **Removida a desativação da verificação de certificado TLS**
   (`rejectUnauthorized: false` em `src/certificate-manager.ts`). O código
   original aceitava qualquer certificado do servidor ao autenticar — ou
   seja, abria brecha de man-in-the-middle exatamente na conexão que carrega
   o seu certificado digital. Isso foi removido; a verificação padrão do
   Node volta a valer.
2. **Removido tudo que não é o servidor MCP em si** (`web-server.ts`,
   upload de PDF, e principalmente `src/pje-client.ts`, que era um stub
   morto com dados falsos fixos — `buscarProcesso` sempre devolvia um
   processo fictício de "João da Silva vs. Empresa XYZ Ltda", e
   `peticionar` "protocolava" uma petição fake sem nunca chamar o PJe de
   verdade). Só ficou o caminho real, que faz chamadas HTTP de fato: o
   `PJEClient` definido dentro de `src/index.ts`.

## Configuração

```bash
cp .env.example .env
# edite o .env com o caminho do seu certificado — NUNCA faça commit dele
```

- `PJE_BASE_URL` já vem pré-preenchido com `https://pje.tjes.jus.br`.
- Use **A1** (`PJE_CERTIFICATE_PFX_PATH` + `PJE_CERTIFICATE_PFX_PASSWORD`)
  se você não estiver no Windows — o caminho A3 depende do utilitário
  `certutil` do Windows para ler o repositório de certificados do sistema.
- O `.pfx`/`.p12` real e o `.env` real nunca devem ir para o git — o
  `.gitignore` deste diretório já bloqueia isso.

## Onde rodar isto

Este container remoto é efêmero: cada sessão nova começa do zero. Guardar um
certificado digital de advogado (que assina peças e autentica sua
identidade) num container efêmero, mesmo que temporariamente, é um
compromisso de segurança que só você deve decidir assumir. Prefira rodar
esta peça específica com o Claude Code local (CLI ou Desktop) na sua própria
máquina, apontando `PJE_CERTIFICATE_PFX_PATH` para o certificado que já está
aí — assim o arquivo nunca precisa ser enviado a lugar nenhum.

## Ferramentas expostas

`pje_configurar`, `pje_configurar_certificado`, `pje_listar_certificados`,
`pje_status`, `pje_listar_processos`, `pje_buscar_processo`,
`pje_listar_orgaos_julgadores`, `pje_listar_classes`, `pje_listar_assuntos`.

Não há ferramenta de peticionamento — de propósito: o upstream original
tinha um `peticionar()` que nunca funcionou de verdade (era o stub removido
acima), e protocolar uma petição automaticamente por IA é um risco que este
projeto não assume.

## Build

```bash
npm install
npm run build
```

Em sessões na web, isso roda sozinho via `.claude/hooks/session-start.sh`.
