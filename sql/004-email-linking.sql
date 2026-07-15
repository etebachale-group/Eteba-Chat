-- =========================================================================
-- MIGRACIÓN: Vinculación por email + índice de búsqueda
-- =========================================================================

-- Asegurar que google_id puede ser NULL (para usuarios creados desde otros sistemas)
ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;

-- Índice único por email (el email es el identificador universal)
-- Si ya existe, esto no hará nada
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

-- Agregar campo role a users si no existe
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';

-- Agregar campo linked_tenant_id para admins de negocios
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_tenant_id UUID REFERENCES companies(id);

-- Vincular el email de Rotteri admin con su tenant
UPDATE users SET role = 'admin', linked_tenant_id = 'e22e9ee0-d29a-4172-88de-fb9ad14c9c1b'
WHERE email = 'rotterinzakus@gmail.com';
