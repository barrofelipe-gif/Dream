-- A tabela é criada pelo Prisma. Nenhum dado Telegram é gravado até o app
-- verificar estas proteções no primeiro acesso. Não concede acesso Data API.
BEGIN;
ALTER TABLE public."TelegramWorkspace" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."TelegramWorkspace" FROM anon, authenticated;
COMMIT;
