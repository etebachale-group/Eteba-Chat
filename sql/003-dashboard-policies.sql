-- =========================================================================
-- MIGRACIÓN: Políticas RLS para el Dashboard + tabla pedidos_chat
-- =========================================================================

ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Lectura pública de empresas (para Explorar)
CREATE POLICY IF NOT EXISTS companies_public_read ON companies FOR SELECT USING (true);

-- Lectura pública de productos (para el widget)
CREATE POLICY IF NOT EXISTS products_public_read ON products FOR SELECT USING (true);

-- Tabla pedidos_chat en Postgres (para tenants sin proxy PHP)
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
ALTER TABLE pedidos_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY pedidos_insert_public ON pedidos_chat FOR INSERT WITH CHECK (true);
