import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@insforge/sdk';
import { getPlanLimits } from './plans-cache.js';
import { verifyToken } from './auth-token.js';

// ============================================================
// Enforcement Gate
// Checks tenant plan limits before allowing resource creation
// or query execution. Reads subscription + usage from InsForge
// and compares against cached plan limits.
// ============================================================

// --- Types ---

export type ResourceType = 'query' | 'product' | 'connector' | 'api_key';

export interface EnforceResult {
  allowed: boolean;
  reason?: string;
  plan?: string;
  limit?: number;
  upgradeUrl?: string;
}

// --- InsForge client (service-role key bypasses RLS) ---

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

// --- DB row types ---

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  trial_ends_at: string | null;
}

interface UsageRow {
  query_count: number;
  product_count: number;
  connector_count: number;
  api_key_count: number;
}

// --- Helpers ---

/**
 * Returns the current UTC billing period as { year, month }.
 * Month is 1-indexed (1 = January … 12 = December).
 */
function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/** The upgrade URL to include in blocked responses. */
const UPGRADE_URL = '/billing';

/**
 * Map from resource type to the plan field that holds its limit
 * and the usage_monthly field that holds its count.
 */
const RESOURCE_MAP: Record<
  ResourceType,
  { limitField: 'monthly_query_limit' | 'product_limit' | 'connector_limit' | 'api_key_limit'; countField: keyof UsageRow }
> = {
  query:     { limitField: 'monthly_query_limit', countField: 'query_count' },
  product:   { limitField: 'product_limit',        countField: 'product_count' },
  connector: { limitField: 'connector_limit',      countField: 'connector_count' },
  api_key:   { limitField: 'api_key_limit',        countField: 'api_key_count' },
};

// ============================================================
// Core enforcement function
// ============================================================

/**
 * Checks whether a tenant is allowed to perform an action on the given
 * resource type based on their current plan and period usage.
 *
 * Logic:
 *  1. Fetch subscription (plan_id, status, trial_ends_at).
 *  2. If status='trialing' and trial_ends_at > now(), use 'business' limits (Req 4.2).
 *  3. Fetch plan limits from cache (plans-cache.ts).
 *  4. Fetch current period usage from usage_monthly (all counts default 0 if no row).
 *  5. If the relevant limit is null (Enterprise unlimited), allow unconditionally (Req 6.10).
 *  6. Compare count vs limit: count < limit → allowed; count >= limit → blocked.
 *
 * Requirements: 6.1–6.10
 */
export async function enforcePlanLimit(
  resource: ResourceType,
  tenantId: string,
): Promise<EnforceResult> {
  // --- 1. Fetch subscription ---
  const { data: subData, error: subError } = await insforge.database
    .from('subscriptions')
    .select('id, tenant_id, plan_id, status, trial_ends_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (subError) {
    throw new Error(
      `enforcement-gate: failed to fetch subscription for tenant ${tenantId}: ${
        (subError as any).message ?? String(subError)
      }`,
    );
  }

  // Default to 'free' if no subscription exists (shouldn't happen in normal flow)
  const sub = (subData as SubscriptionRow | null) ?? {
    id: '',
    tenant_id: tenantId,
    plan_id: 'free',
    status: 'active',
    trial_ends_at: null,
  };

  // --- 2. Determine effective plan ID ---
  // During an active trial, enforce Business-tier limits (Req 4.2)
  let effectivePlanId = sub.plan_id;
  if (
    sub.status === 'trialing' &&
    sub.trial_ends_at !== null &&
    new Date(sub.trial_ends_at) > new Date()
  ) {
    effectivePlanId = 'business';
  }

  // --- 3. Fetch plan limits from cache ---
  const planRecord = await getPlanLimits(effectivePlanId);

  // --- 4. Fetch current period usage ---
  const { year, month } = currentPeriod();

  const { data: usageData, error: usageError } = await insforge.database
    .from('usage_monthly')
    .select('query_count, product_count, connector_count, api_key_count')
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', month)
    .maybeSingle();

  if (usageError) {
    throw new Error(
      `enforcement-gate: failed to fetch usage for tenant ${tenantId}: ${
        (usageError as any).message ?? String(usageError)
      }`,
    );
  }

  // Default all counts to 0 if no row exists yet for this period
  const usage: UsageRow = (usageData as UsageRow | null) ?? {
    query_count: 0,
    product_count: 0,
    connector_count: 0,
    api_key_count: 0,
  };

  // --- 5. Check the relevant limit ---
  const { limitField, countField } = RESOURCE_MAP[resource];
  const limit: number | null = planRecord[limitField] as number | null;

  // NULL limit = Enterprise unlimited plan — always allow (Req 6.10)
  if (limit === null) {
    return { allowed: true };
  }

  // --- 6. Compare count vs limit ---
  const count = usage[countField] as number;

  if (count < limit) {
    return { allowed: true };
  }

  // Blocked — build a descriptive response
  const reason = `${resource}_limit_reached`;
  return {
    allowed: false,
    reason,
    plan: planRecord.id,
    limit,
    upgradeUrl: UPGRADE_URL,
  };
}

// ============================================================
// Express middleware factory
// ============================================================

/**
 * Returns Express middleware that enforces the plan limit for the given
 * resource type.
 *
 * - Extracts the JWT from the `Authorization: Bearer <token>` header.
 * - Verifies the token using `verifyToken` from `auth-token.ts`.
 * - Calls `enforcePlanLimit(resource, tenantId)`.
 * - If blocked: `query` → 429; all others → 403.
 * - If allowed: calls `next()`.
 *
 * Requirements: 6.1–6.10
 */
export function requirePlanLimit(resource: ResourceType) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // --- Extract tenantId ---
    // Priority 1: verified JWT (dashboard, API clients)
    // Priority 2: tenantId from request body (public widget — no auth required)
    let tenantId: string | null = null;

    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (token) {
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
        return;
      }
      tenantId = payload.tenantId ?? null;
    }

    // Fall back to tenantId in the request body (public widget calls)
    if (!tenantId) {
      tenantId = (req.body?.tenantId as string | undefined) ?? null;
    }

    if (!tenantId) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing tenantId' });
      return;
    }

    // --- Enforce plan limit ---
    let result: EnforceResult;
    try {
      result = await enforcePlanLimit(resource, tenantId);
    } catch (err) {
      // Fail-open: if enforcement check errors, log and allow (avoids blocking paying customers)
      console.error(
        `[enforcement-gate] Error checking limit for tenant ${tenantId} resource ${resource}:`,
        err,
      );
      next();
      return;
    }

    if (result.allowed) {
      next();
      return;
    }

    // --- Blocked ---
    const errorCode = `${resource}_limit_reached`;
    const httpStatus = resource === 'query' ? 429 : 403;

    res.status(httpStatus).json({
      error: errorCode,
      plan: result.plan,
      limit: result.limit,
      upgradeUrl: result.upgradeUrl,
    });
  };
}
