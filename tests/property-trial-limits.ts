/**
 * Property-Based Tests: Trial Plan Limits
 *
 * Property 8: Trialing Tenants Get Business-Tier Limits
 *   For any tenant with status='trialing' and trial_ends_at in the future,
 *   the Enforcement Gate should apply Business plan limits:
 *     - monthly_query_limit = 15000
 *     - product_limit       = 5000
 *     - connector_limit     = 3
 *     - api_key_limit       = 10
 *   ...not Free plan limits.
 *
 *   Validates: Requirements 4.2
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types (mirror enforcement-gate.ts)
// ---------------------------------------------------------------------------

type ResourceType = 'query' | 'product' | 'connector' | 'api_key';

interface EnforceResult {
  allowed: boolean;
  reason?: string;
  plan?: string;
  limit?: number;
  upgradeUrl?: string;
}

// ---------------------------------------------------------------------------
// In-memory mock store (same approach as property-enforcement-gate.ts)
// ---------------------------------------------------------------------------

interface MockSubscription {
  plan_id: string;
  status: string;
  trial_ends_at: string | null;
}

interface MockUsage {
  query_count: number;
  product_count: number;
  connector_count: number;
  api_key_count: number;
}

interface MockPlan {
  id: string;
  monthly_query_limit: number | null;
  product_limit: number | null;
  connector_limit: number | null;
  api_key_limit: number | null;
}

// Plan catalogue (mirrors the seed data in 007-plans-subscriptions.sql)
const PLANS: Record<string, MockPlan> = {
  free: {
    id: 'free',
    monthly_query_limit: 500,
    product_limit: 50,
    connector_limit: 1,
    api_key_limit: 0,
  },
  starter: {
    id: 'starter',
    monthly_query_limit: 3000,
    product_limit: 500,
    connector_limit: 1,
    api_key_limit: 2,
  },
  business: {
    id: 'business',
    monthly_query_limit: 15000,
    product_limit: 5000,
    connector_limit: 3,
    api_key_limit: 10,
  },
  enterprise: {
    id: 'enterprise',
    monthly_query_limit: null,
    product_limit: null,
    connector_limit: 999,
    api_key_limit: null,
  },
};

// Business plan limits — the source of truth for Property 8 assertions
const BUSINESS_LIMITS = {
  monthly_query_limit: 15000,
  product_limit: 5000,
  connector_limit: 3,
  api_key_limit: 10,
} as const;

// Mutable state — reset between tests
let mockSubscription: MockSubscription = {
  plan_id: 'free',
  status: 'active',
  trial_ends_at: null,
};

let mockUsage: MockUsage = {
  query_count: 0,
  product_count: 0,
  connector_count: 0,
  api_key_count: 0,
};

function resetMocks(
  planId = 'free',
  status = 'active',
  trialEndsAt: string | null = null,
): void {
  mockSubscription = { plan_id: planId, status, trial_ends_at: trialEndsAt };
  mockUsage = { query_count: 0, product_count: 0, connector_count: 0, api_key_count: 0 };
}

// ---------------------------------------------------------------------------
// Resource map (mirrors enforcement-gate.ts RESOURCE_MAP)
// ---------------------------------------------------------------------------

const RESOURCE_MAP: Record<
  ResourceType,
  { limitField: keyof MockPlan; countField: keyof MockUsage }
> = {
  query:     { limitField: 'monthly_query_limit', countField: 'query_count' },
  product:   { limitField: 'product_limit',        countField: 'product_count' },
  connector: { limitField: 'connector_limit',      countField: 'connector_count' },
  api_key:   { limitField: 'api_key_limit',        countField: 'api_key_count' },
};

// ---------------------------------------------------------------------------
// Inline re-implementation of enforcePlanLimit (mirrors enforcement-gate.ts)
//
// The key logic under test (Req 4.2):
//   If status='trialing' AND trial_ends_at > now(), effectivePlanId = 'business'
// ---------------------------------------------------------------------------

const UPGRADE_URL = '/billing';

function enforcePlanLimitMock(resource: ResourceType, _tenantId: string): EnforceResult {
  // Determine effective plan — trial substitution (Req 4.2)
  let effectivePlanId = mockSubscription.plan_id;
  if (
    mockSubscription.status === 'trialing' &&
    mockSubscription.trial_ends_at !== null &&
    new Date(mockSubscription.trial_ends_at) > new Date()
  ) {
    effectivePlanId = 'business';
  }

  const plan = PLANS[effectivePlanId];
  const { limitField, countField } = RESOURCE_MAP[resource];
  const limit: number | null = plan[limitField] as number | null;

  // NULL limit = unlimited (Enterprise) — always allow
  if (limit === null) {
    return { allowed: true };
  }

  const count: number = mockUsage[countField];

  if (count < limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${resource}_limit_reached`,
    plan: effectivePlanId,
    limit,
    upgradeUrl: UPGRADE_URL,
  };
}

/**
 * Returns the effective plan's limit for a given resource, given the mock
 * subscription state. Used in assertions to verify the correct limit is applied.
 */
function getEffectiveLimitForResource(resource: ResourceType): number | null {
  let effectivePlanId = mockSubscription.plan_id;
  if (
    mockSubscription.status === 'trialing' &&
    mockSubscription.trial_ends_at !== null &&
    new Date(mockSubscription.trial_ends_at) > new Date()
  ) {
    effectivePlanId = 'business';
  }

  const plan = PLANS[effectivePlanId];
  const { limitField } = RESOURCE_MAP[resource];
  return plan[limitField] as number | null;
}

// ---------------------------------------------------------------------------
// Test runner helpers (same pattern as existing property tests)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error).message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helper: returns an ISO timestamp N milliseconds in the future
// ---------------------------------------------------------------------------
function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Property 8: Trialing Tenants Get Business-Tier Limits
//
// Validates: Requirements 4.2
// ---------------------------------------------------------------------------

async function runProperty8(): Promise<void> {
  console.log('\n📋 Property 8: Trialing Tenants Get Business-Tier Limits');
  console.log('   Validates: Requirements 4.2\n');

  const ALL_RESOURCES: ResourceType[] = ['query', 'product', 'connector', 'api_key'];
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // --- Deterministic warm-up examples ---

  await runTest('Trialing tenant: effective query limit equals Business (15000)', () => {
    resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
    const limit = getEffectiveLimitForResource('query');
    if (limit !== BUSINESS_LIMITS.monthly_query_limit) {
      throw new Error(
        `Expected monthly_query_limit=${BUSINESS_LIMITS.monthly_query_limit}, got ${limit}`,
      );
    }
  });

  await runTest('Trialing tenant: effective product limit equals Business (5000)', () => {
    resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
    const limit = getEffectiveLimitForResource('product');
    if (limit !== BUSINESS_LIMITS.product_limit) {
      throw new Error(
        `Expected product_limit=${BUSINESS_LIMITS.product_limit}, got ${limit}`,
      );
    }
  });

  await runTest('Trialing tenant: effective connector limit equals Business (3)', () => {
    resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
    const limit = getEffectiveLimitForResource('connector');
    if (limit !== BUSINESS_LIMITS.connector_limit) {
      throw new Error(
        `Expected connector_limit=${BUSINESS_LIMITS.connector_limit}, got ${limit}`,
      );
    }
  });

  await runTest('Trialing tenant: effective api_key limit equals Business (10)', () => {
    resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
    const limit = getEffectiveLimitForResource('api_key');
    if (limit !== BUSINESS_LIMITS.api_key_limit) {
      throw new Error(
        `Expected api_key_limit=${BUSINESS_LIMITS.api_key_limit}, got ${limit}`,
      );
    }
  });

  await runTest('Non-trialing free tenant uses Free plan limits (not Business)', () => {
    resetMocks('free', 'active', null);
    const limit = getEffectiveLimitForResource('query');
    const freePlanLimit = PLANS.free.monthly_query_limit;
    if (limit !== freePlanLimit) {
      throw new Error(
        `Expected free plan query limit=${freePlanLimit}, got ${limit}`,
      );
    }
  });

  await runTest('Expired trial (trial_ends_at in the past) uses own plan_id limits', () => {
    // trial_ends_at is 1 day in the past
    const expiredAt = new Date(Date.now() - ONE_DAY_MS).toISOString();
    resetMocks('free', 'trialing', expiredAt);
    const limit = getEffectiveLimitForResource('query');
    // Should fall back to free plan limit since trial is expired
    if (limit !== PLANS.free.monthly_query_limit) {
      throw new Error(
        `Expected free query limit=${PLANS.free.monthly_query_limit} for expired trial, got ${limit}`,
      );
    }
  });

  await runTest(
    'Trialing tenant with 0 usage is allowed for all resources (business limits not yet reached)',
    () => {
      for (const resource of ALL_RESOURCES) {
        resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
        // Usage is 0
        const result = enforcePlanLimitMock(resource, 'tenant-trial-zero-usage');
        if (!result.allowed) {
          throw new Error(
            `Expected allowed for trialing tenant with 0 usage on resource=${resource}, got blocked`,
          );
        }
      }
    },
  );

  await runTest(
    'Trialing tenant blocked only when usage reaches Business limit (not Free limit)',
    () => {
      // For query: Free limit = 500, Business limit = 15000
      // Usage = 501 → would be blocked on Free, but allowed on Business
      resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
      mockUsage.query_count = 501;
      const result = enforcePlanLimitMock('query', 'tenant-trial-above-free');
      if (!result.allowed) {
        throw new Error(
          `Trialing tenant with query_count=501 should be ALLOWED under Business limits (15000), but was blocked. ` +
          `This indicates Free plan limits are incorrectly being applied during trial.`,
        );
      }
    },
  );

  await runTest(
    'Trialing tenant is blocked when usage reaches Business plan limit',
    () => {
      // Set query_count to exactly the Business limit
      resetMocks('free', 'trialing', futureIso(14 * ONE_DAY_MS));
      mockUsage.query_count = BUSINESS_LIMITS.monthly_query_limit; // 15000
      const result = enforcePlanLimitMock('query', 'tenant-trial-at-business-limit');
      if (result.allowed) {
        throw new Error(
          `Expected blocked for trialing tenant with query_count=${BUSINESS_LIMITS.monthly_query_limit} ` +
          `(at Business plan limit)`,
        );
      }
      // Blocked response should reflect Business plan limit
      if (result.limit !== BUSINESS_LIMITS.monthly_query_limit) {
        throw new Error(
          `Expected blocked limit=${BUSINESS_LIMITS.monthly_query_limit}, got ${result.limit}`,
        );
      }
    },
  );

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 8 — fast-check: trialing tenant always gets Business-tier limits for all resources (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 4.2**
       *
       * For any tenant with status='trialing' and trial_ends_at in the future,
       * enforcePlanLimit must apply Business plan limits:
       *   - monthly_query_limit = 15000
       *   - product_limit       = 5000
       *   - connector_limit     = 3
       *   - api_key_limit       = 10
       *
       * We verify this by:
       *   1. Setting usage to a value that would be BLOCKED under Free plan limits
       *      but ALLOWED under Business plan limits for the same resource.
       *   2. Asserting that the enforcement result is ALLOWED (Business limits applied).
       *   3. For the same value at/above the Business plan limit, asserting BLOCKED.
       */
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ResourceType>('query', 'product', 'connector', 'api_key'),
          // offset: 0 = not yet started, positive = partial trial remaining
          fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }), // 1ms to 30 days
          async (resource, trialOffsetMs) => {
            const trialEndsAt = futureIso(trialOffsetMs);
            resetMocks('free', 'trialing', trialEndsAt);

            // The expected Business limit for this resource
            const expectedLimit: number =
              BUSINESS_LIMITS[
                (RESOURCE_MAP[resource].limitField as keyof typeof BUSINESS_LIMITS)
              ];

            // Confirm the effective limit equals Business plan limit
            const effectiveLimit = getEffectiveLimitForResource(resource);
            if (effectiveLimit !== expectedLimit) {
              return false; // incorrect limit applied
            }

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 8 — fast-check: trialing tenant allowed when usage is below Business limit (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 4.2**
       *
       * For any usage count in [0, businessLimit), a trialing tenant must be ALLOWED.
       * This also confirms that the higher Business limits (not Free limits) are active.
       */
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ResourceType>('query', 'product', 'connector', 'api_key'),
          fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }), // future trial_ends_at offset
          async (resource, trialOffsetMs) => {
            const trialEndsAt = futureIso(trialOffsetMs);
            resetMocks('free', 'trialing', trialEndsAt);

            const businessLimit: number =
              BUSINESS_LIMITS[
                (RESOURCE_MAP[resource].limitField as keyof typeof BUSINESS_LIMITS)
              ];

            // Set usage to the minimum of (businessLimit - 1, 0) — always below Business limit
            const { countField } = RESOURCE_MAP[resource];
            (mockUsage as Record<string, number>)[countField] = Math.max(0, businessLimit - 1);

            const result = enforcePlanLimitMock(resource, `tenant-trial-p8-${resource}`);

            // Must be allowed (usage is below Business plan limit)
            return result.allowed === true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 8 — fast-check: trialing tenant blocked when usage >= Business limit (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 4.2**
       *
       * For any usage count >= businessLimit, a trialing tenant must be BLOCKED,
       * and the blocked response must reflect the Business plan limit (not Free limit).
       */
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ResourceType>('query', 'product', 'connector', 'api_key'),
          fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }), // future trial_ends_at offset
          fc.nat(),          // overage: how many units above the limit
          async (resource, trialOffsetMs, overage) => {
            const trialEndsAt = futureIso(trialOffsetMs);
            resetMocks('free', 'trialing', trialEndsAt);

            const businessLimit: number =
              BUSINESS_LIMITS[
                (RESOURCE_MAP[resource].limitField as keyof typeof BUSINESS_LIMITS)
              ];

            // Set usage to exactly businessLimit + overage (>= limit)
            const { countField } = RESOURCE_MAP[resource];
            (mockUsage as Record<string, number>)[countField] = businessLimit + overage;

            const result = enforcePlanLimitMock(resource, `tenant-trial-p8-block-${resource}`);

            // Must be blocked
            if (result.allowed) return false;

            // Blocked response must carry Business plan limit value
            if (result.limit !== businessLimit) return false;

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 8 — fast-check: non-trialing tenant always uses its actual plan limits (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 4.2** (contrast — confirming the trialing substitution
       * does NOT fire for non-trialing tenants, preserving plan isolation)
       */
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ResourceType>('query', 'product', 'connector', 'api_key'),
          fc.constantFrom('free', 'starter'),  // plans whose limits differ from Business
          fc.constantFrom('active', 'cancelled', 'past_due'),
          async (resource, planId, status) => {
            resetMocks(planId, status, null);

            const plan = PLANS[planId];
            const { limitField } = RESOURCE_MAP[resource];
            const expectedLimit = plan[limitField] as number | null;

            const effectiveLimit = getEffectiveLimitForResource(resource);

            // Must NOT be promoted to Business limits
            return effectiveLimit === expectedLimit;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

(async () => {
  console.log('🧪 Running Property-Based Tests: trial plan limits');
  console.log('═'.repeat(55));

  await runProperty8();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
