-- Inicialização do banco de dados SaaS Legal
-- Este arquivo é executado automaticamente quando o container PostgreSQL é criado

-- Criar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Configurações de timezone
SET timezone = 'America/Sao_Paulo';

-- Configurações de encoding
SET client_encoding = 'UTF8';

-- Log de inicialização
DO $$
BEGIN
    RAISE NOTICE 'Banco de dados SaaS Legal inicializado com sucesso!';
    RAISE NOTICE 'Timezone: %', current_setting('timezone');
    RAISE NOTICE 'Encoding: %', current_setting('client_encoding');
END $$;