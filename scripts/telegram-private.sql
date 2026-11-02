-- A tabela é criada pelo Prisma. Nenhum dado Telegram é gravado até o app
-- verificar estas proteções no primeiro acesso. Não concede acesso Data API.
-- Executado em transação e no schema do DATABASE_URL pelo script de build.
ALTER TABLE "TelegramWorkspace" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TelegramWorkspace" FROM anon, authenticated;
