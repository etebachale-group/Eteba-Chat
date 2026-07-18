-- =========================================================================
-- MIGRACIÓN: Tablas para API Keys y Query Counts (Dashboard Completion)
-- =========================================================================

-- 1. Tabla de API Keys por tenant
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key_value TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- 2. Tabla de conteo de consultas (Query Tracker)
CREATE TABLE query_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_query_counts_tenant ON query_counts(tenant_id);
CREATE INDEX idx_query_counts_created ON query_counts(created_at DESC);
