import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';

// ============================================================
// Plans Cache Module
// In-memory cache with 5-minute TTL for plan limit records.
// Avoids a DB lookup on every enforced request while keeping
// plan configuration changes responsive (max 5-min lag).
// Cache can be invalidated explicitly for testing.
// ============================================================

// --- Types ---

export interface PlanRecord {
  id: 'free' | 'starter' | 'business' | 'enterprise';
  name: string;
  monthly_query_limit: number | null;
  product_limit: number | null;
  connector_limit: number;
  api_key_limit: number | null;
  price_monthly_usd: number;
  price_yearly_usd: number;
  features: string[];
}

interface CacheEntry {
  limits: PlanRecord;
  fetchedAt: number; // Unix timestamp in ms (Date.now())
}

// --- InsForge client (service role key bypasses RLS) ---

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  // Prefer service-role key for server-side reads; fall back to API key
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

// --- Cache state ---

const TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const cache = new Map<string, CacheEntry>();

// --- DB row type (as stored in InsForge `plans` table) ---

interface PlanRow {
  id: string;
  name: string;
  monthly_query_limit: number | null;
  product_limit: number | null;
  connector_limit: number;
  api_key_limit: number | null;
  price_monthly_usd: number | string; // NUMERIC may arrive as string
  price_yearly_usd: number | string;
  features: string[] | string; // JSONB may arrive as raw JSON string
}

/**
 * Normalises a raw DB row into a typed PlanRecord.
 * Handles NUMERIC-as-string and JSONB-as-string variations that some
 * Postgres drivers return.
 */
function rowToPlanRecord(row: PlanRow): PlanRecord {
  let features: string[];
  if (typeof row.features === 'string') {
    try {
      features = JSON.parse(row.features) as string[];
    } catch {
      features = [];
    }
  } else {
    features = row.features ?? [];
  }

  return {
    id: row.id as PlanRecord['id'],
    name: row.name,
    monthly_query_limit: row.monthly_query_limit,
    product_limit: row.product_limit,
    connector_limit: Number(row.connector_limit),
    api_key_limit: row.api_key_limit,
    price_monthly_usd: Number(row.price_monthly_usd),
    price_yearly_usd: Number(row.price_yearly_usd),
    features,
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Returns the plan limits for the given planId.
 *
 * - On a cache hit that is within the 5-minute TTL, returns the cached record
 *   immediately without hitting the database.
 * - On a cache miss (or expired entry), fetches the row from the InsForge
 *   `plans` table, caches it, and returns the typed PlanRecord.
 *
 * Throws if the planId is not found in the database or a DB error occurs.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.10
 */
export async function getPlanLimits(planId: string): Promise<PlanRecord> {
  // Check cache first
  const entry = cache.get(planId);
  if (entry !== undefined && Date.now() - entry.fetchedAt <= TTL) {
    return entry.limits;
  }

  // Cache miss or expired — fetch from DB
  const { data, error } = await insforge.database
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (error) {
    throw new Error(`plans-cache: failed to fetch plan "${planId}": ${error.message ?? String(error)}`);
  }

  if (!data) {
    throw new Error(`plans-cache: plan "${planId}" not found`);
  }

  const record = rowToPlanRecord(data as PlanRow);

  // Store in cache
  cache.set(planId, { limits: record, fetchedAt: Date.now() });

  return record;
}

/**
 * Clears all cached plan entries.
 *
 * Intended for use in tests and wherever an immediate cache refresh is
 * needed (e.g. after a plan seed migration).
 */
export function invalidatePlanCache(): void {
  cache.clear();
}
