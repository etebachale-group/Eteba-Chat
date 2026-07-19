-- 012-webhook-perf-tuning.sql
-- Optimización de rendimiento RLS e índices en webhooks recomendados por Advisor

-- 1. Crear índice para parent_delivery_id en delivery_logs (Issue 1)
CREATE INDEX IF NOT EXISTS idx_delivery_logs_parent_delivery_id ON delivery_logs(parent_delivery_id);

-- 2. Optimizar política de delivery_logs envolviendo auth.uid() en subconsulta (Issue 2)
DROP POLICY IF EXISTS tenant_select_delivery_logs ON delivery_logs;
CREATE POLICY tenant_select_delivery_logs ON delivery_logs
    FOR SELECT
    USING (tenant_id = (SELECT auth.uid()));

-- 3. Optimizar política de webhook_endpoints envolviendo auth.uid() en subconsulta (Issue 3)
DROP POLICY IF EXISTS tenant_all_webhook_endpoints ON webhook_endpoints;
CREATE POLICY tenant_all_webhook_endpoints ON webhook_endpoints
    FOR ALL
    USING (tenant_id = (SELECT auth.uid()))
    WITH CHECK (tenant_id = (SELECT auth.uid()));
