-- 008-onboarding-users.sql

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS onboarding_step_data JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_onboarding ON users(onboarding_completed)
    WHERE onboarding_completed = false;
