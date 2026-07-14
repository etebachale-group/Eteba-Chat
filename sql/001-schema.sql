-- =========================================================================
-- ESQUEMA DE BASE DE DATOS UNIFICADO Y OPTIMIZADO - ANTIGRAVITY RAG ENGINE
-- =========================================================================

-- 1. Habilitar la extensión vectorial para almacenamiento de embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Crear tabla de inquilinos (Companies)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    operational_manual TEXT, -- Manual operativo y personalidad del asistente
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Crear tabla de miembros (Mapeo de usuarios con sus Tenants)
CREATE TABLE company_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_id, user_id)
);

CREATE INDEX idx_company_members_user ON company_members(user_id);
CREATE INDEX idx_company_members_company ON company_members(company_id);

-- 4. Función para obtener Tenant ID actual
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
DECLARE
    tenant_id_var TEXT;
BEGIN
    tenant_id_var := current_setting('app.current_tenant_id', true);
    IF tenant_id_var IS NOT NULL AND tenant_id_var <> '' THEN
        RETURN tenant_id_var::UUID;
    END IF;
    IF (SELECT auth.uid()) IS NOT NULL THEN
        RETURN (
            SELECT company_id FROM public.company_members 
            WHERE user_id = (SELECT auth.uid()) LIMIT 1
        );
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 5. Tabla de productos
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_products_tenant ON products(tenant_id);

-- 6. Tabla de conocimiento (RAG)
CREATE TABLE knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kb_tenant ON knowledge_base(tenant_id);

-- 7. Función de búsqueda semántica
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
RETURNS TABLE (id UUID, content TEXT, similarity float) AS $$
BEGIN
  RETURN QUERY
  SELECT kb.id, kb.content, 1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_base kb
  WHERE 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- 8. RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_tenant_isolation ON companies FOR ALL USING (
    id IN (SELECT company_id FROM public.company_members WHERE user_id = (SELECT auth.uid()))
);
CREATE POLICY products_tenant_isolation ON products FOR ALL USING (
    tenant_id = get_current_tenant_id()
);
CREATE POLICY kb_tenant_isolation ON knowledge_base FOR ALL USING (
    tenant_id = get_current_tenant_id()
);
