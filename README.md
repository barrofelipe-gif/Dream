# Dream

Conectores MCP para acompanhamento processual (CNJ/PJe), configurados em
[`.mcp.json`](./.mcp.json):

| Servidor | O que é | Credencial |
|---|---|---|
| `datajud` | API pública do DataJud (CNJ) — processo por número, busca por classe/tribunal/assunto, movimentações | Nenhuma |
| `djen` | Diário de Justiça Eletrônico Nacional (comunicações, prazos) + descoberta de processos por parte | Nenhuma |
| `pje-tjes` | PJe do TJES — consulta de processos com seu certificado digital | Seu certificado A1 (`.pfx`) ou A3 |

`datajud` e `djen` são serviços hospedados de terceiros (`api.mcp.ai`), sem
cadastro — a única aprovação necessária é a do próprio Claude Code na
primeira vez que a sessão for usar cada um.

`pje-tjes` é vendorizado em [`integrations/pje-tjes-mcp`](./integrations/pje-tjes-mcp)
com uma correção de segurança em relação ao projeto de origem — leia o
README dessa pasta antes de configurar seu certificado, especialmente a
seção "Onde rodar isto".

Não existe um "MCP Ana" instalável fora do TJMA — é uma ferramenta interna
do Laboratório de Inovação de lá. `pje-tjes` é o equivalente prático para o
TJES.
