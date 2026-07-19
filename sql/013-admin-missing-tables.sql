-- 013-admin-missing-tables.sql
-- Migrations needed for admin dashboard + remaining pending migrations

-- ── 009 remainder: apply_bulk_upsert function ─────────────────────────────────
CREATE OR REPLACE FUNCTION apply_bulk_upsert(
    p_tenant_id UUID,
    p_to_insert JSONB,
    p_to_update JSONB
) RETURNS VOID AS $$
DECLARE
    item JSONB;
BEGIN
    IF jsonb_array_length(p_to_insert) > 0 THEN
        INSERT INTO products (tenant_id, name, description, price, stock, image_url, created_at, updated_at)
        SELECT 
            p_tenant_id,
            (val->>'name'),
            (val->>'description'),
            (val->>'price')::NUMERIC,
            (val->>'stock')::INTEGER,
            (val->>'image_url'),
            now(),
            now()
        FROM jsonb_array_elements(p_to_insert) AS val;
    END IF;

    IF jsonb_array_length(p_to_update) > 0 THEN
        FOR item IN SELECT * FROM jsonb_array_elements(p_to_update) LOOP
            UPDATE products
            SET 
                name = (item->>'name'),
                description = (item->>'description'),
                price = (item->>'price')::NUMERIC,
                stock = (item->>'stock')::INTEGER,
                image_url = (item->>'image_url'),
                updated_at = now()
            WHERE id = (item->>'id')::UUID AND tenant_id = p_tenant_id;
        END LOOP;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ── 011: Security & performance tuning ────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users 
    FOR SELECT USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users 
    FOR UPDATE USING (id = (SELECT auth.uid())) 
    WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_insert_own ON public.users;
CREATE POLICY users_insert_own ON public.users 
    FOR INSERT WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS companies_public_read ON public.companies;
CREATE POLICY companies_public_read ON public.companies 
    FOR SELECT USING (id IS NOT NULL);

DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products 
    FOR SELECT USING (tenant_id IS NOT NULL);

DROP POLICY IF EXISTS pedidos_insert_public ON public.pedidos_chat;
CREATE POLICY pedidos_insert_public ON public.pedidos_chat 
    FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_users_linked_tenant_id ON users(linked_tenant_id);

-- ── 012: Webhook performance tuning ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_delivery_logs_parent_delivery_id ON delivery_logs(parent_delivery_id);

DROP POLICY IF EXISTS tenant_select_delivery_logs ON delivery_logs;
CREATE POLICY tenant_select_delivery_logs ON delivery_logs
    FOR SELECT
    USING (tenant_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tenant_all_webhook_endpoints ON webhook_endpoints;
CREATE POLICY tenant_all_webhook_endpoints ON webhook_endpoints
    FOR ALL
    USING (tenant_id = (SELECT auth.uid()))
    WITH CHECK (tenant_id = (SELECT auth.uid()));

-- ── Admin: missing indexes for RLS ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON public.companies(user_id);

-- ── 008: Onboarding columns for users ─────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS onboarding_step_data JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_onboarding ON users(onboarding_completed)
    WHERE onboarding_completed = false;

-- ── Subscriptions: ensure existing companies get a default 'free' subscription ─
INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
SELECT 
    c.id,
    'free',
    'active',
    now(),
    now() + INTERVAL '1 year'
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.tenant_id = c.id
);
