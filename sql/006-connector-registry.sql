-- =========================================================================
-- MIGRACIÓN: Tabla de Registro de Conectores (Tenant Data Connectors)
-- =========================================================================

-- 1. Tabla del registro de conectores
CREATE TABLE connector_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    proxy_url TEXT NOT NULL CHECK (char_length(proxy_url) <= 2048),
    connector_token_encrypted TEXT NOT NULL,
    connector_token_iv TEXT NOT NULL,
    connector_token_tag TEXT NOT NULL,
    business_type TEXT NOT NULL DEFAULT 'general'
        CHECK (business_type IN ('ecommerce', 'appointments', 'restaurant', 'services', 'general')),
    display_name TEXT NOT NULL CHECK (char_length(display_name) <= 128),
    enabled BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'error')),
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_error_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Solo un conector activo por tenant
CREATE UNIQUE INDEX idx_connector_registry_tenant_active
    ON connector_registry(tenant_id) WHERE enabled = true;

-- 3. Índice estándar por tenant_id
CREATE INDEX idx_connector_registry_tenant ON connector_registry(tenant_id);

-- 4. RLS y política de aislamiento por tenant
ALTER TABLE connector_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY connector_tenant_isolation ON connector_registry
    FOR ALL USING (tenant_id = get_current_tenant_id());
