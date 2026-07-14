-- =========================================================================
-- MIGRACIÓN: Campos adicionales para el Dashboard de Eteba Chat
-- Ejecutar en InsForge SQL Editor
-- =========================================================================

-- 1. Agregar columnas faltantes a companies
ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Permitir que usuarios autenticados lean empresas públicas (para Explorar)
CREATE POLICY companies_public_read ON companies
  FOR SELECT USING (true);

-- 3. Permitir inserción directa para el registro de nuevos usuarios
-- (el usuario autenticado puede crear su propia empresa)
CREATE POLICY companies_insert_own ON companies
  FOR INSERT WITH CHECK (
    id = (SELECT auth.uid())
  );

-- 4. Permitir actualización de la propia empresa
CREATE POLICY companies_update_own ON companies
  FOR UPDATE USING (
    id = (SELECT auth.uid())
  ) WITH CHECK (
    id = (SELECT auth.uid())
  );

-- 5. Permitir lectura pública de productos (para la búsqueda desde el widget)
CREATE POLICY products_public_read ON products
  FOR SELECT USING (true);

-- 6. Crear tabla pedidos_chat en Postgres (para tenants que no usan proxy PHP)
CREATE TABLE IF NOT EXISTS pedidos_chat (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES companies(id),
  producto_nombre TEXT NOT NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_telefono TEXT NOT NULL,
  ciudad_entrega TEXT NOT NULL,
  precio_producto NUMERIC(10,2) DEFAULT 0,
  tienda_id INT,
  producto_id UUID,
  notas TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_tenant ON pedidos_chat(tenant_id);

-- 7. RLS para pedidos
ALTER TABLE pedidos_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY pedidos_read_own ON pedidos_chat
  FOR SELECT USING (
    tenant_id = (SELECT auth.uid())
  );

CREATE POLICY pedidos_insert_public ON pedidos_chat
  FOR INSERT WITH CHECK (true);
