/**
 * Property-Based Tests: Subscription Mutations
 *
 * Property 17: Upgrade Preserves Plan Monotonicity
 *   For any valid (from, to) upgrade pair where to ranks higher; after calling
 *   upgrade assert plan_id=newPlanId, status='active',
 *   current_period_end ∈ [now+29d23h, now+30d1h]
 *
 *   Validates: Requirements 7.2
 *
 * Property 18: Downgrade Is Always Scheduled, Never Immediate
 *   For any valid downgrade request with current_period_end in the future;
 *   immediately after assert plan_id unchanged and scheduled_plan_id = requestedPlanId
 *
 *   Validates: Requirements 7.3, 7.4
 */

import * as fc from 'fast-check';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanId = 'free' | 'starter' | 'business' | 'enterprise';
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled';

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: PlanId;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  trial_used_at: string | null;
  current_period_start: string;
  current_period_end: string;
  scheduled_plan_id: PlanId | null;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  subscription_id: string;
  event_type: string;
  old_plan_id: PlanId;
  new_plan_id: PlanId;
  triggered_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Plan rank — defines valid upgrade / downgrade directions
// ---------------------------------------------------------------------------

const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  starter: 1,
  business: 2,
  enterprise: 3,
};

/** Returns true when fromPlan < toPlan in the tier hierarchy */
function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}

/** Returns true when toPlan < fromPlan in the tier hierarchy */
function isDowngrade(from: PlanId, to: PlanId): boolean {
  return PLAN_RANK[to] < PLAN_RANK[from];
}

// ---------------------------------------------------------------------------
// In-memory mock store
// ---------------------------------------------------------------------------

const subscriptionsStore = new Map<string, SubscriptionRow>();
const auditLog: AuditEntry[] = [];

function resetStores(): void {
  subscriptionsStore.clear();
  auditLog.length = 0;
}

function writeAuditEntry(
  subscriptionId: string,
  eventType: string,
  oldPlanId: PlanId,
  newPlanId: PlanId,
  triggeredBy: string,
): void {
  auditLog.push({
    id: crypto.randomUUID(),
    subscription_id: subscriptionId,
    event_type: eventType,
    old_plan_id: oldPlanId,
    new_plan_id: newPlanId,
    triggered_by: triggeredBy,
    created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Helper: create a subscription row in the store
// ---------------------------------------------------------------------------

function createSubscription(
  tenantId: string,
  planId: PlanId,
  status: SubscriptionStatus = 'active',
  currentPeriodEnd?: Date,
  scheduledPlanId: PlanId | null = null,
): SubscriptionRow {
  const now = new Date();
  const periodEnd = currentPeriodEnd ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const sub: SubscriptionRow = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    plan_id: planId,
    status,
    trial_ends_at: null,
    trial_used_at: null,
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    scheduled_plan_id: scheduledPlanId,
    updated_at: now.toISOString(),
  };

  subscriptionsStore.set(tenantId, sub);
  return sub;
}

// ---------------------------------------------------------------------------
// Upgrade result type
// ---------------------------------------------------------------------------

type UpgradeResult =
  | { ok: true; subscription: SubscriptionRow }
  | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Mock upgrade — mirrors POST /api/subscription/upgrade in server.ts
//
// Logic (Req 7.2):
//   - Reject 400 if newPlanId doesn't rank higher than current plan_id
//   - Write audit entry BEFORE updating subscription
//   - Set plan_id=newPlanId, status='active',
//     current_period_start=now, current_period_end=now+30d
// ---------------------------------------------------------------------------

function mockUpgrade(tenantId: string, newPlanId: PlanId, now: Date = new Date()): UpgradeResult {
  const sub = subscriptionsStore.get(tenantId);
  if (!sub) {
    return { ok: false, status: 404, error: 'subscription_not_found' };
  }

  if (!isUpgrade(sub.plan_id, newPlanId)) {
    return { ok: false, status: 400, error: 'invalid_upgrade' };
  }

  const newPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Write audit entry first (Req 11.3)
  writeAuditEntry(sub.id, 'upgrade', sub.plan_id, newPlanId, 'user');

  const updated: SubscriptionRow = {
    ...sub,
    plan_id: newPlanId,
    status: 'active',
    current_period_start: now.toISOString(),
    current_period_end: newPeriodEnd.toISOString(),
    updated_at: now.toISOString(),
  };

  subscriptionsStore.set(tenantId, updated);
  return { ok: true, subscription: updated };
}

// ---------------------------------------------------------------------------
// Downgrade result type
// ---------------------------------------------------------------------------

type DowngradeResult =
  | { ok: true; subscription: SubscriptionRow }
  | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Mock downgrade — mirrors POST /api/subscription/downgrade in server.ts
//
// Logic (Req 7.3, 7.4):
//   - Reject 400 if newPlanId doesn't rank lower than current plan_id
//   - Set scheduled_plan_id=newPlanId; do NOT change plan_id immediately
//   - Write audit entry (event_type='downgrade', triggered_by='user')
// ---------------------------------------------------------------------------

function mockDowngrade(
  tenantId: string,
  newPlanId: PlanId,
  now: Date = new Date(),
): DowngradeResult {
  const sub = subscriptionsStore.get(tenantId);
  if (!sub) {
    return { ok: false, status: 404, error: 'subscription_not_found' };
  }

  if (!isDowngrade(sub.plan_id, newPlanId)) {
    return { ok: false, status: 400, error: 'invalid_downgrade' };
  }

  // Write audit entry first (Req 11.3)
  writeAuditEntry(sub.id, 'downgrade', sub.plan_id, newPlanId, 'user');

  // Schedule downgrade — plan_id is unchanged immediately (Req 7.3)
  const updated: SubscriptionRow = {
    ...sub,
    scheduled_plan_id: newPlanId,
    updated_at: now.toISOString(),
  };

  subscriptionsStore.set(tenantId, updated);
  return { ok: true, subscription: updated };
}

// ---------------------------------------------------------------------------
// Time window helpers
// ---------------------------------------------------------------------------

/** Returns true if isoDate is within [now+29d23h, now+30d1h] */
function isWithin30DayWindow(isoDate: string, referenceNow: Date): boolean {
  const t = new Date(isoDate).getTime();
  const lower = referenceNow.getTime() + (30 * 24 - 1) * 60 * 60 * 1000; // now + 29d23h
  const upper = referenceNow.getTime() + (30 * 24 + 1) * 60 * 60 * 1000; // now + 30d1h
  return t >= lower && t <= upper;
}

// ---------------------------------------------------------------------------
// Test runner helpers
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
// Property 17: Upgrade Preserves Plan Monotonicity
//
// Validates: Requirements 7.2
// ---------------------------------------------------------------------------

async function runProperty17(): Promise<void> {
  console.log('\n📋 Property 17: Upgrade Preserves Plan Monotonicity');
  console.log('   Validates: Requirements 7.2\n');

  // --- Deterministic warm-up examples ---

  await runTest('free → starter upgrade: plan_id=starter, status=active', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createSubscription(tenantId, 'free');
    const now = new Date();
    const result = mockUpgrade(tenantId, 'starter', now);
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (result.subscription.plan_id !== 'starter') {
      throw new Error(`Expected plan_id='starter', got '${result.subscription.plan_id}'`);
    }
    if (result.subscription.status !== 'active') {
      throw new Error(`Expected status='active', got '${result.subscription.status}'`);
    }
  });

  await runTest('starter → business upgrade: current_period_end ≈ now+30d', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createSubscription(tenantId, 'starter');
    const now = new Date();
    const result = mockUpgrade(tenantId, 'business', now);
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (!isWithin30DayWindow(result.subscription.current_period_end, now)) {
      throw new Error(
        `current_period_end outside [now+29d23h, now+30d1h]: ${result.subscription.current_period_end}`,
      );
    }
  });

  await runTest('free → enterprise upgrade succeeds', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createSubscription(tenantId, 'free');
    const result = mockUpgrade(tenantId, 'enterprise');
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (result.subscription.plan_id !== 'enterprise') {
      throw new Error(`Expected plan_id='enterprise', got '${result.subscription.plan_id}'`);
    }
  });

  await runTest('downgrade attempt via upgrade endpoint returns 400', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createSubscription(tenantId, 'business');
    const result = mockUpgrade(tenantId, 'free');
    if (result.ok) throw new Error('Expected error for attempted downgrade via upgrade');
    if ((result as any).status !== 400) {
      throw new Error(`Expected 400, got ${(result as any).status}`);
    }
  });

  await runTest('same-plan upgrade attempt returns 400', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createSubscription(tenantId, 'starter');
    const result = mockUpgrade(tenantId, 'starter');
    if (result.ok) throw new Error('Expected error for same-plan upgrade');
  });

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 17 — fast-check: upgrade sets plan_id, status=active, period_end≈now+30d (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 7.2**
       *
       * For any valid (from, to) upgrade pair where to ranks higher:
       *   - plan_id = newPlanId
       *   - status = 'active'
       *   - current_period_end ∈ [now+29d23h, now+30d1h]
       */
      const UPGRADEABLE_PAIRS: [PlanId, PlanId][] = [
        ['free', 'starter'],
        ['free', 'business'],
        ['free', 'enterprise'],
        ['starter', 'business'],
        ['starter', 'enterprise'],
        ['business', 'enterprise'],
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...UPGRADEABLE_PAIRS),
          async ([fromPlan, toPlan]) => {
            resetStores();
            const tenantId = crypto.randomUUID();
            createSubscription(tenantId, fromPlan);

            const now = new Date();
            const result = mockUpgrade(tenantId, toPlan, now);

            // Must succeed
            if (!result.ok) return false;

            const sub = result.subscription;

            // plan_id must equal the new plan
            if (sub.plan_id !== toPlan) return false;

            // status must be 'active'
            if (sub.status !== 'active') return false;

            // current_period_end must be within [now+29d23h, now+30d1h]
            if (!isWithin30DayWindow(sub.current_period_end, now)) return false;

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 17 — fast-check: invalid upgrade (same/lower plan) always returns 400 (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 7.2** (negative case — monotonicity enforced)
       */
      const NON_UPGRADE_PAIRS: [PlanId, PlanId][] = [
        ['starter', 'free'],
        ['business', 'starter'],
        ['business', 'free'],
        ['enterprise', 'business'],
        ['enterprise', 'starter'],
        ['enterprise', 'free'],
        ['free', 'free'],
        ['starter', 'starter'],
        ['business', 'business'],
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...NON_UPGRADE_PAIRS),
          async ([fromPlan, toPlan]) => {
            resetStores();
            const tenantId = crypto.randomUUID();
            createSubscription(tenantId, fromPlan);

            const result = mockUpgrade(tenantId, toPlan);

            // Must be rejected
            if (result.ok) return false;
            if ((result as any).status !== 400) return false;

            // Subscription must be unchanged
            const sub = subscriptionsStore.get(tenantId)!;
            if (sub.plan_id !== fromPlan) return false;

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Property 18: Downgrade Is Always Scheduled, Never Immediate
//
// Validates: Requirements 7.3, 7.4
// ---------------------------------------------------------------------------

async function runProperty18(): Promise<void> {
  console.log('\n📋 Property 18: Downgrade Is Always Scheduled, Never Immediate');
  console.log('   Validates: Requirements 7.3, 7.4\n');

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // --- Deterministic warm-up examples ---

  await runTest('business → starter downgrade: plan_id unchanged immediately', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    const futureEnd = new Date(Date.now() + 15 * ONE_DAY_MS);
    createSubscription(tenantId, 'business', 'active', futureEnd);
    const result = mockDowngrade(tenantId, 'starter');
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (result.subscription.plan_id !== 'business') {
      throw new Error(
        `plan_id must remain 'business' immediately after downgrade request, got '${result.subscription.plan_id}'`,
      );
    }
  });

  await runTest('business → starter downgrade: scheduled_plan_id = starter', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    const futureEnd = new Date(Date.now() + 15 * ONE_DAY_MS);
    createSubscription(tenantId, 'business', 'active', futureEnd);
    const result = mockDowngrade(tenantId, 'starter');
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (result.subscription.scheduled_plan_id !== 'starter') {
      throw new Error(
        `scheduled_plan_id must be 'starter', got '${result.subscription.scheduled_plan_id}'`,
      );
    }
  });

  await runTest('starter → free downgrade: plan_id unchanged, scheduled_plan_id=free', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    const futureEnd = new Date(Date.now() + 10 * ONE_DAY_MS);
    createSubscription(tenantId, 'starter', 'active', futureEnd);
    const result = mockDowngrade(tenantId, 'free');
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (result.subscription.plan_id !== 'starter') {
      throw new Error(`plan_id must remain 'starter' immediately, got '${result.subscription.plan_id}'`);
    }
    if (result.subscription.scheduled_plan_id !== 'free') {
      throw new Error(`scheduled_plan_id must be 'free', got '${result.subscription.scheduled_plan_id}'`);
    }
  });

  await runTest('upgrade attempt via downgrade endpoint returns 400', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createSubscription(tenantId, 'free');
    const result = mockDowngrade(tenantId, 'business');
    if (result.ok) throw new Error('Expected error for upgrade attempt via downgrade');
    if ((result as any).status !== 400) {
      throw new Error(`Expected 400, got ${(result as any).status}`);
    }
  });

  await runTest('downgrade does not change current_period_end', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    const futureEnd = new Date(Date.now() + 20 * ONE_DAY_MS);
    createSubscription(tenantId, 'enterprise', 'active', futureEnd);
    const before = { ...subscriptionsStore.get(tenantId)! };
    const result = mockDowngrade(tenantId, 'business');
    if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
    if (result.subscription.current_period_end !== before.current_period_end) {
      throw new Error(
        `current_period_end must not change on downgrade request. ` +
        `Before: ${before.current_period_end}, after: ${result.subscription.current_period_end}`,
      );
    }
  });

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 18 — fast-check: downgrade always schedules, never changes plan_id immediately (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 7.3, 7.4**
       *
       * For any valid downgrade pair (from > to in rank) with current_period_end in the future:
       *   - plan_id must remain the original plan immediately after the call
       *   - scheduled_plan_id must equal the requested lower plan
       */
      const DOWNGRADEABLE_PAIRS: [PlanId, PlanId][] = [
        ['starter', 'free'],
        ['business', 'starter'],
        ['business', 'free'],
        ['enterprise', 'business'],
        ['enterprise', 'starter'],
        ['enterprise', 'free'],
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...DOWNGRADEABLE_PAIRS),
          // future period_end offset: 1 hour to 60 days
          fc.integer({ min: 60 * 60 * 1000, max: 60 * 24 * 60 * 60 * 1000 }),
          async ([fromPlan, toPlan], offsetMs) => {
            resetStores();
            const tenantId = crypto.randomUUID();
            const futureEnd = new Date(Date.now() + offsetMs);
            createSubscription(tenantId, fromPlan, 'active', futureEnd);

            const result = mockDowngrade(tenantId, toPlan);

            // Must succeed
            if (!result.ok) return false;

            const sub = result.subscription;

            // plan_id must be UNCHANGED immediately
            if (sub.plan_id !== fromPlan) return false;

            // scheduled_plan_id must equal the requested lower plan
            if (sub.scheduled_plan_id !== toPlan) return false;

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 18 — fast-check: downgrade does not alter billing period (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 7.3, 7.4**
       *
       * current_period_end must be unchanged immediately after a downgrade request —
       * the tenant retains their current plan until billing period end.
       */
      const DOWNGRADEABLE_PAIRS: [PlanId, PlanId][] = [
        ['starter', 'free'],
        ['business', 'starter'],
        ['enterprise', 'business'],
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...DOWNGRADEABLE_PAIRS),
          fc.integer({ min: 60 * 60 * 1000, max: 60 * 24 * 60 * 60 * 1000 }),
          async ([fromPlan, toPlan], offsetMs) => {
            resetStores();
            const tenantId = crypto.randomUUID();
            const futureEnd = new Date(Date.now() + offsetMs);
            createSubscription(tenantId, fromPlan, 'active', futureEnd);

            const beforeEnd = subscriptionsStore.get(tenantId)!.current_period_end;
            const result = mockDowngrade(tenantId, toPlan);

            if (!result.ok) return false;

            // current_period_end must be identical
            return result.subscription.current_period_end === beforeEnd;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 18 — fast-check: invalid downgrade (same/higher plan) always returns 400 (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 7.3** (negative — monotonicity enforced)
       */
      const NON_DOWNGRADE_PAIRS: [PlanId, PlanId][] = [
        ['free', 'starter'],
        ['free', 'business'],
        ['starter', 'business'],
        ['starter', 'enterprise'],
        ['free', 'free'],
        ['starter', 'starter'],
        ['business', 'business'],
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...NON_DOWNGRADE_PAIRS),
          async ([fromPlan, toPlan]) => {
            resetStores();
            const tenantId = crypto.randomUUID();
            createSubscription(tenantId, fromPlan);

            const result = mockDowngrade(tenantId, toPlan);

            // Must be rejected
            if (result.ok) return false;
            if ((result as any).status !== 400) return false;

            // Subscription must be unchanged
            const sub = subscriptionsStore.get(tenantId)!;
            if (sub.plan_id !== fromPlan) return false;
            if (sub.scheduled_plan_id !== null) return false;

            return true;
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
  console.log('🧪 Running Property-Based Tests: subscription mutations');
  console.log('═'.repeat(55));

  await runProperty17();
  await runProperty18();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
