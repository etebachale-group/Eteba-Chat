-- =========================================================================
-- MIGRACIÓN: Tablas para Webhook Integrations (Webhook Integrations)
-- =========================================================================

-- 1. Tabla de Endpoints de Webhooks
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL,
    signing_secret TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    consecutive_failures INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT url_length CHECK (char_length(url) <= 2048),
    CONSTRAINT url_https CHECK (url LIKE 'https://%'),
    CONSTRAINT unique_url_per_tenant UNIQUE (tenant_id, url)
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON webhook_endpoints(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints(is_active) WHERE is_active = true;

-- Habilitar RLS para webhook_endpoints
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para webhook_endpoints
CREATE POLICY tenant_all_webhook_endpoints ON webhook_endpoints
    FOR ALL
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());


-- 2. Tabla de Logs de Envío de Webhooks
CREATE TABLE IF NOT EXISTS delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL, -- 'delivered', 'failed', 'permanently_failed'
    status_code INTEGER,
    response_body TEXT,
    attempt_number INTEGER DEFAULT 1 NOT NULL,
    parent_delivery_id UUID REFERENCES delivery_logs(id) ON DELETE CASCADE,
    is_test BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_tenant ON delivery_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_endpoint_created ON delivery_logs(endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_parent ON delivery_logs(parent_delivery_id) WHERE parent_delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_logs_created_at ON delivery_logs(created_at);

-- Habilitar RLS para delivery_logs
ALTER TABLE delivery_logs ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para delivery_logs (Solo lectura para el tenant)
CREATE POLICY tenant_select_delivery_logs ON delivery_logs
    FOR SELECT
    USING (tenant_id = auth.uid());
