-- 007-plans-subscriptions.sql

-- 1. Plans table (static configuration; seeded once)
CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_query_limit INTEGER,
    product_limit INTEGER,
    connector_limit INTEGER NOT NULL DEFAULT 1,
    api_key_limit INTEGER,
    price_monthly_usd NUMERIC(8,2) NOT NULL DEFAULT 0,
    price_yearly_usd  NUMERIC(8,2) NOT NULL DEFAULT 0,
    features JSONB NOT NULL DEFAULT '[]'
);

INSERT INTO plans VALUES
  ('free',       'Free',       500,   50,    1, 0,     0.00,    0.00,
   '["Widget embedding","500 queries/month","50 products","1 connector"]'),
  ('starter',    'Starter',    3000,  500,   1, 2,     19.00,   190.00,
   '["Widget embedding","3,000 queries/month","500 products","1 connector","2 API keys","Custom personality","Email support"]'),
  ('business',   'Business',   15000, 5000,  3, 10,    49.00,   490.00,
   '["Widget embedding","15,000 queries/month","5,000 products","3 connectors","10 API keys","Custom personality","Priority support","Analytics dashboard"]'),
  ('enterprise', 'Enterprise', NULL,  NULL,  999, NULL, 0.00,   0.00,
   '["Unlimited queries","Unlimited products","Unlimited connectors","Unlimited API keys","Dedicated support","Custom integrations"]');

-- 2. Subscriptions table
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled')),
    trial_ends_at TIMESTAMPTZ,
    trial_used_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end   TIMESTAMPTZ NOT NULL,
    scheduled_plan_id TEXT REFERENCES plans(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_trial_ends ON subscriptions(trial_ends_at)
    WHERE status = 'trialing';

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subs_tenant_read ON subscriptions
    FOR SELECT USING (tenant_id = get_current_tenant_id());

-- 3. Usage monthly table
CREATE TABLE usage_monthly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period_year  INTEGER NOT NULL,
    period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    query_count     INTEGER NOT NULL DEFAULT 0,
    product_count   INTEGER NOT NULL DEFAULT 0,
    connector_count INTEGER NOT NULL DEFAULT 0,
    api_key_count   INTEGER NOT NULL DEFAULT 0,
    soft_limit_email_sent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, period_year, period_month)
);

CREATE INDEX idx_usage_monthly_tenant ON usage_monthly(tenant_id);
CREATE INDEX idx_usage_monthly_period ON usage_monthly(period_year, period_month);

ALTER TABLE usage_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_tenant_read ON usage_monthly
    FOR SELECT USING (tenant_id = get_current_tenant_id());

-- 4. Subscription events (audit log)
CREATE TABLE subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    old_plan_id TEXT,
    new_plan_id TEXT NOT NULL,
    triggered_by TEXT NOT NULL CHECK (triggered_by IN ('user', 'system', 'trial_expiry')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sub_events_sub ON subscription_events(subscription_id);
CREATE INDEX idx_sub_events_created ON subscription_events(created_at DESC);
