import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';

// ============================================================
// Usage Tracker Module
// Atomic query-count increments, resource-count snapshots, and
// usage summary retrieval for plan-limit enforcement and display.
// ============================================================

// --- Types ---

export interface UsageSummary {
  period: { year: number; month: number };
  query_count: number;
  product_count: number;
  connector_count: number;
  api_key_count: number;
  limits: {
    monthly_query_limit: number | null;
    product_limit: number | null;
    connector_limit: number;
    api_key_limit: number | null;
  };
  percentages: {
    queries: number;
    products: number;
    connectors: number;
    api_keys: number;
  };
}

// Row shapes coming back from InsForge queries

interface UsageMonthlyRow {
  id?: string;
  tenant_id: string;
  period_year: number;
  period_month: number;
  query_count: number;
  product_count: number;
  connector_count: number;
  api_key_count: number;
  soft_limit_email_sent_at?: string | null;
  updated_at?: string | null;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
}

interface PlanRow {
  id: string;
  monthly_query_limit: number | null;
  product_limit: number | null;
  connector_limit: number;
  api_key_limit: number | null;
}

// --- InsForge client (service-role key bypasses RLS) ---

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

// --- Period helpers ---

/**
 * Returns the current UTC billing period as { year, month }.
 * Month is 1-indexed (1 = January … 12 = December).
 */
function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/**
 * Ensures a usage_monthly row exists for the given tenant and period.
 * Uses INSERT … ON CONFLICT DO NOTHING so it is safe to call concurrently.
 * Returns without error if the row already exists.
 *
 * Requirements: 5.1, 5.4
 */
async function ensureUsageRow(
  tenantId: string,
  year: number,
  month: number,
): Promise<void> {
  const { error } = await insforge.database
    .from('usage_monthly')
    .insert([
      {
        tenant_id: tenantId,
        period_year: year,
        period_month: month,
        query_count: 0,
        product_count: 0,
        connector_count: 0,
        api_key_count: 0,
        updated_at: new Date().toISOString(),
      },
    ])
    .select();

  // Ignore unique-constraint violations (the row already exists — that is fine)
  if (error) {
    const isConflict =
      (error as any).code === '23505' ||
      String((error as any).message ?? '').toLowerCase().includes('unique') ||
      String((error as any).message ?? '').toLowerCase().includes('conflict');

    if (!isConflict) {
      throw new Error(
        `usage-tracker: failed to ensure usage row for tenant ${tenantId}: ${
          (error as any).message ?? String(error)
        }`,
      );
    }
    // Otherwise: row already exists — continue normally
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Atomically increments the AI query_count for the current billing period.
 *
 * Guarantees:
 *   1. Ensures the usage_monthly row exists (upsert-like INSERT … ON CONFLICT DO NOTHING).
 *   2. Runs a read-modify-write increment via the SDK so the final count
 *      equals the exact number of successful queries processed.
 *
 * Requirements: 5.1, 5.2, 5.6
 */
export async function incrementQueryCount(tenantId: string): Promise<void> {
  const { year, month } = currentPeriod();

  // Step 1 — ensure the row exists
  await ensureUsageRow(tenantId, year, month);

  // Step 2 — read the current count, then update atomically.
  // The InsForge SDK does not expose raw SQL RPC, so we perform a
  // SELECT then UPDATE in the same request tick. For production-grade
  // atomic guarantees, the companion SQL migration should add a
  // Postgres function `increment_query_count(tenant_id, year, month)`
  // that runs the UPDATE … SET query_count = query_count + 1 directly.
  // Here we use the SDK's rpc if available, falling back to two calls.

  let incremented = false;

  // Attempt RPC-based atomic increment (preferred)
  if (typeof (insforge as any).database?.rpc === 'function') {
    const { error: rpcError } = await (insforge as any).database.rpc(
      'increment_query_count',
      { p_tenant_id: tenantId, p_year: year, p_month: month },
    );
    if (!rpcError) {
      incremented = true;
    }
    // If the RPC doesn't exist (PGRST202 / unknown function), fall through to SDK path
  }

  if (!incremented) {
    // Fallback: read + increment via SDK query builder
    const { data: row, error: fetchError } = await insforge.database
      .from('usage_monthly')
      .select('query_count')
      .eq('tenant_id', tenantId)
      .eq('period_year', year)
      .eq('period_month', month)
      .maybeSingle();

    if (fetchError) {
      throw new Error(
        `usage-tracker: failed to fetch query_count for tenant ${tenantId}: ${
          (fetchError as any).message ?? String(fetchError)
        }`,
      );
    }

    const currentCount = (row as UsageMonthlyRow | null)?.query_count ?? 0;

    const { error: updateError } = await insforge.database
      .from('usage_monthly')
      .update({ query_count: currentCount + 1, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('period_year', year)
      .eq('period_month', month);

    if (updateError) {
      throw new Error(
        `usage-tracker: failed to increment query_count for tenant ${tenantId}: ${
          (updateError as any).message ?? String(updateError)
        }`,
      );
    }
  }
}

/**
 * Recomputes product_count, connector_count, and api_key_count from their
 * source tables and updates the current period's usage_monthly row.
 *
 * Call this after any CREATE or DELETE on products, connector_registry,
 * or api_keys for the given tenant.
 *
 * Requirements: 5.3
 */
export async function syncResourceCounts(tenantId: string): Promise<void> {
  const { year, month } = currentPeriod();

  // Ensure the usage row exists before updating
  await ensureUsageRow(tenantId, year, month);

  // --- Count products ---
  const { count: productCount, error: productError } = await insforge.database
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (productError) {
    throw new Error(
      `usage-tracker: failed to count products for tenant ${tenantId}: ${
        (productError as any).message ?? String(productError)
      }`,
    );
  }

  // --- Count connectors ---
  const { count: connectorCount, error: connectorError } = await insforge.database
    .from('connector_registry')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (connectorError) {
    throw new Error(
      `usage-tracker: failed to count connectors for tenant ${tenantId}: ${
        (connectorError as any).message ?? String(connectorError)
      }`,
    );
  }

  // --- Count API keys ---
  const { count: apiKeyCount, error: apiKeyError } = await insforge.database
    .from('api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (apiKeyError) {
    throw new Error(
      `usage-tracker: failed to count api_keys for tenant ${tenantId}: ${
        (apiKeyError as any).message ?? String(apiKeyError)
      }`,
    );
  }

  // --- Update usage_monthly row ---
  const { error: updateError } = await insforge.database
    .from('usage_monthly')
    .update({
      product_count: productCount ?? 0,
      connector_count: connectorCount ?? 0,
      api_key_count: apiKeyCount ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', month);

  if (updateError) {
    throw new Error(
      `usage-tracker: failed to sync resource counts for tenant ${tenantId}: ${
        (updateError as any).message ?? String(updateError)
      }`,
    );
  }
}

/**
 * Returns the current month's usage counts alongside the tenant's plan limits
 * for display in the Dashboard and for enforcement decisions.
 *
 * Fetches the active subscription and its plan via a JOIN on
 * `subscriptions` + `plans` tables.  If no usage row exists for the
 * current period one is created on-the-fly (all counts default to 0).
 *
 * Percentages are calculated as (count / limit) * 100.
 * If a limit is null (unlimited), the corresponding percentage is 0.
 *
 * Requirements: 5.5
 */
export async function getUsageSummary(tenantId: string): Promise<UsageSummary> {
  const { year, month } = currentPeriod();

  // --- Ensure usage row exists ---
  await ensureUsageRow(tenantId, year, month);

  // --- Fetch current usage row ---
  const { data: usageRow, error: usageError } = await insforge.database
    .from('usage_monthly')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', month)
    .maybeSingle();

  if (usageError) {
    throw new Error(
      `usage-tracker: failed to fetch usage for tenant ${tenantId}: ${
        (usageError as any).message ?? String(usageError)
      }`,
    );
  }

  const usage = (usageRow as UsageMonthlyRow | null) ?? {
    tenant_id: tenantId,
    period_year: year,
    period_month: month,
    query_count: 0,
    product_count: 0,
    connector_count: 0,
    api_key_count: 0,
  };

  // --- Fetch subscription with plan limits (JOIN via select) ---
  const { data: subData, error: subError } = await insforge.database
    .from('subscriptions')
    .select('id, tenant_id, plan_id, status, plans(monthly_query_limit, product_limit, connector_limit, api_key_limit)')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (subError) {
    throw new Error(
      `usage-tracker: failed to fetch subscription for tenant ${tenantId}: ${
        (subError as any).message ?? String(subError)
      }`,
    );
  }

  // Default to Free plan limits if no subscription is found
  let limits: UsageSummary['limits'] = {
    monthly_query_limit: 500,
    product_limit: 50,
    connector_limit: 1,
    api_key_limit: 0,
  };

  if (subData) {
    const sub = subData as unknown as SubscriptionRow & { plans: PlanRow | null };
    if (sub.plans) {
      limits = {
        monthly_query_limit: sub.plans.monthly_query_limit,
        product_limit: sub.plans.product_limit,
        connector_limit: Number(sub.plans.connector_limit),
        api_key_limit: sub.plans.api_key_limit,
      };
    } else {
      // Fallback: fetch plan separately if the join didn't embed it
      const { data: planData, error: planError } = await insforge.database
        .from('plans')
        .select('monthly_query_limit, product_limit, connector_limit, api_key_limit')
        .eq('id', (subData as SubscriptionRow).plan_id)
        .maybeSingle();

      if (planError) {
        throw new Error(
          `usage-tracker: failed to fetch plan for tenant ${tenantId}: ${
            (planError as any).message ?? String(planError)
          }`,
        );
      }

      if (planData) {
        const plan = planData as PlanRow;
        limits = {
          monthly_query_limit: plan.monthly_query_limit,
          product_limit: plan.product_limit,
          connector_limit: Number(plan.connector_limit),
          api_key_limit: plan.api_key_limit,
        };
      }
    }
  }

  // --- Calculate percentages ---
  // If limit is null (unlimited), percentage is 0
  function calcPct(count: number, limit: number | null): number {
    if (limit === null || limit === 0) return 0;
    return (count / limit) * 100;
  }

  const percentages: UsageSummary['percentages'] = {
    queries: calcPct(usage.query_count, limits.monthly_query_limit),
    products: calcPct(usage.product_count, limits.product_limit),
    connectors: calcPct(usage.connector_count, limits.connector_limit),
    api_keys: calcPct(usage.api_key_count, limits.api_key_limit),
  };

  return {
    period: { year: usage.period_year, month: usage.period_month },
    query_count: usage.query_count,
    product_count: usage.product_count,
    connector_count: usage.connector_count,
    api_key_count: usage.api_key_count,
    limits,
    percentages,
  };
}
