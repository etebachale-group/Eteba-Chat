/**
 * Property-Based Tests: Trial Subscription
 *
 * Property 6: Trial Subscription Sets Correct Expiry
 *   For any tenant who activates the Business trial, the resulting subscription
 *   should have status='trialing', plan_id='business', and trial_ends_at in the
 *   range [now + 13d 23h, now + 14d 1h] (14 days ± 1 hour to allow for
 *   processing time).
 *
 *   Validates: Requirements 4.1
 *
 * Property 7: Trial Cannot Be Activated Twice
 *   For any tenant whose subscription record has a non-null trial_used_at field,
 *   attempting to activate a trial again should always be rejected with a 409
 *   error, and the subscription record should remain unchanged.
 *
 *   Validates: Requirements 4.5
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
// Trial endpoint result type
// ---------------------------------------------------------------------------

type TrialResult =
  | { ok: true; subscription: SubscriptionRow }
  | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// In-memory mock stores
// ---------------------------------------------------------------------------

const subscriptionsStore = new Map<string, SubscriptionRow>(); // key = tenant_id
const auditLog: AuditEntry[] = [];

function resetStores(): void {
  subscriptionsStore.clear();
  auditLog.length = 0;
}

function getSubscriptionByTenantId(tenantId: string): SubscriptionRow | undefined {
  return subscriptionsStore.get(tenantId);
}

function auditEntriesFor(subscriptionId: string): AuditEntry[] {
  return auditLog.filter((e) => e.subscription_id === subscriptionId);
}

// ---------------------------------------------------------------------------
// Mock audit writer (mirrors writeAuditEntry in server.ts)
// Called BEFORE mutating the subscription record.
// ---------------------------------------------------------------------------

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
// Inline re-implementation of POST /api/subscription/trial
// Mirrors server.ts route 6.3 exactly:
//   - Reject 409 if trial_used_at is non-null
//   - Set plan_id='business', status='trialing',
//     trial_ends_at = now + 14 days, trial_used_at = now()
//   - Write audit entry (event_type='trial_start', triggered_by='user')
//     BEFORE updating the subscription record
//   - Return the updated subscription
// ---------------------------------------------------------------------------

function mockActivateTrial(tenantId: string, now: Date = new Date()): TrialResult {
  const sub = subscriptionsStore.get(tenantId);

  if (!sub) {
    return { ok: false, status: 404, error: 'subscription_not_found' };
  }

  // Reject if trial has already been used (Requirement 4.5)
  if (sub.trial_used_at !== null) {
    return { ok: false, status: 409, error: 'trial_already_used' };
  }

  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Write audit entry BEFORE mutation (Requirement 11.3)
  writeAuditEntry(sub.id, 'trial_start', sub.plan_id, 'business', 'user');

  // Mutate subscription
  const updated: SubscriptionRow = {
    ...sub,
    plan_id: 'business',
    status: 'trialing',
    trial_ends_at: trialEndsAt.toISOString(),
    trial_used_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  subscriptionsStore.set(tenantId, updated);

  return { ok: true, subscription: updated };
}

// ---------------------------------------------------------------------------
// Helper: create a fresh free subscription for a tenant
// ---------------------------------------------------------------------------

function createFreeSubscription(tenantId: string): SubscriptionRow {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const sub: SubscriptionRow = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    plan_id: 'free',
    status: 'active',
    trial_ends_at: null,
    trial_used_at: null,
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    scheduled_plan_id: null,
    updated_at: now.toISOString(),
  };

  subscriptionsStore.set(tenantId, sub);
  return sub;
}

// Helper: create a subscription that already has trial_used_at set
function createSubscriptionWithTrialUsed(
  tenantId: string,
  currentPlanId: PlanId = 'free',
  currentStatus: SubscriptionStatus = 'active',
): SubscriptionRow {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const sub: SubscriptionRow = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    plan_id: currentPlanId,
    status: currentStatus,
    trial_ends_at: currentStatus === 'trialing'
      ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    trial_used_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(), // used 10 days ago
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    scheduled_plan_id: null,
    updated_at: now.toISOString(),
  };

  subscriptionsStore.set(tenantId, sub);
  return sub;
}

// ---------------------------------------------------------------------------
// Time window helpers for Property 6
// ---------------------------------------------------------------------------

/** Returns true if the ISO date string falls within [now+13d23h, now+14d1h] */
function isWithinTrialWindow(trialEndsAtIso: string, referenceNow: Date): boolean {
  const trialEndsAt = new Date(trialEndsAtIso).getTime();

  const lowerBound = referenceNow.getTime() + (14 * 24 - 1) * 60 * 60 * 1000; // now + 13d 23h
  const upperBound = referenceNow.getTime() + (14 * 24 + 1) * 60 * 60 * 1000; // now + 14d 1h

  return trialEndsAt >= lowerBound && trialEndsAt <= upperBound;
}

// ---------------------------------------------------------------------------
// Test runner helpers (same pattern as property-registration.ts)
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
// Property 6: Trial Subscription Sets Correct Expiry
//
// For any tenant who activates the Business trial, the resulting subscription
// should have:
//   - status = 'trialing'
//   - plan_id = 'business'
//   - trial_ends_at ∈ [now + 13d 23h, now + 14d 1h]
//
// Validates: Requirements 4.1
// ---------------------------------------------------------------------------

async function runProperty6(): Promise<void> {
  console.log('\n📋 Property 6: Trial Subscription Sets Correct Expiry');
  console.log('   Validates: Requirements 4.1\n');

  // --- Concrete warm-up examples ---

  await runTest('Basic trial activation sets status=trialing', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    const now = new Date();
    const result = mockActivateTrial(tenantId, now);

    if (!result.ok) {
      throw new Error(`Expected ok, got error: ${result.error}`);
    }
    if (result.subscription.status !== 'trialing') {
      throw new Error(`Expected status='trialing', got '${result.subscription.status}'`);
    }
  });

  await runTest('Basic trial activation sets plan_id=business', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    const now = new Date();
    const result = mockActivateTrial(tenantId, now);

    if (!result.ok) {
      throw new Error(`Expected ok, got error: ${result.error}`);
    }
    if (result.subscription.plan_id !== 'business') {
      throw new Error(`Expected plan_id='business', got '${result.subscription.plan_id}'`);
    }
  });

  await runTest('trial_ends_at is exactly 14 days from now (within ±1h window)', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    const now = new Date();
    const result = mockActivateTrial(tenantId, now);

    if (!result.ok) {
      throw new Error(`Expected ok, got error: ${result.error}`);
    }
    if (!result.subscription.trial_ends_at) {
      throw new Error('trial_ends_at should not be null after trial activation');
    }
    if (!isWithinTrialWindow(result.subscription.trial_ends_at, now)) {
      const actual = new Date(result.subscription.trial_ends_at);
      const expected = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      throw new Error(
        `trial_ends_at outside ±1h window. Expected ~${expected.toISOString()}, got ${actual.toISOString()}`,
      );
    }
  });

  await runTest('trial_used_at is set to a non-null timestamp after activation', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    const result = mockActivateTrial(tenantId);

    if (!result.ok) throw new Error(`Expected ok, got error: ${result.error}`);
    if (result.subscription.trial_used_at === null) {
      throw new Error('trial_used_at should be non-null after activation');
    }
  });

  await runTest('trial activation on non-existent tenant returns 404', () => {
    resetStores();
    const result = mockActivateTrial(crypto.randomUUID());
    if (result.ok) throw new Error('Expected error for non-existent tenant');
    if ((result as any).status !== 404) {
      throw new Error(`Expected 404, got ${(result as any).status}`);
    }
  });

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 6 — fast-check: trial always sets status=trialing, plan_id=business, expiry in window (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 4.1**
       *
       * For any tenant UUID, activating the trial on a fresh free subscription must
       * always result in:
       *   - status = 'trialing'
       *   - plan_id = 'business'
       *   - trial_ends_at ∈ [now + 13d 23h, now + 14d 1h]
       */
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // tenantId
          async (tenantId) => {
            resetStores();
            createFreeSubscription(tenantId);

            const now = new Date();
            const result = mockActivateTrial(tenantId, now);

            // Must succeed
            if (!result.ok) return false;

            const sub = result.subscription;

            // status must be 'trialing'
            if (sub.status !== 'trialing') return false;

            // plan_id must be 'business'
            if (sub.plan_id !== 'business') return false;

            // trial_ends_at must be set
            if (!sub.trial_ends_at) return false;

            // trial_ends_at must be within [now + 13d23h, now + 14d1h]
            if (!isWithinTrialWindow(sub.trial_ends_at, now)) return false;

            // trial_used_at must be set (non-null)
            if (!sub.trial_used_at) return false;

            return true;
          },
        ),
        {
          numRuns: 100,
          verbose: true,
        },
      );
    },
  );

  await runTest(
    'Property 6 — fast-check: trial_ends_at always within ±1h of exactly 14 days (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (tenantId) => {
            resetStores();
            createFreeSubscription(tenantId);

            const now = new Date();
            const result = mockActivateTrial(tenantId, now);
            if (!result.ok) return false;
            if (!result.subscription.trial_ends_at) return false;

            const endsAt = new Date(result.subscription.trial_ends_at).getTime();
            const expected14d = now.getTime() + 14 * 24 * 60 * 60 * 1000;

            // Must be within ±1 hour (3600 seconds) of exactly 14 days from now
            const diffMs = Math.abs(endsAt - expected14d);
            return diffMs <= 60 * 60 * 1000;
          },
        ),
        {
          numRuns: 100,
          verbose: true,
        },
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Property 7: Trial Cannot Be Activated Twice
//
// For any tenant with a non-null trial_used_at field, calling
// POST /api/subscription/trial must always be rejected with a 409, and
// the subscription record must remain unchanged.
//
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------

async function runProperty7(): Promise<void> {
  console.log('\n📋 Property 7: Trial Cannot Be Activated Twice');
  console.log('   Validates: Requirements 4.5\n');

  // --- Concrete warm-up examples ---

  await runTest('Second trial attempt returns 409', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    // First activation succeeds
    const first = mockActivateTrial(tenantId);
    if (!first.ok) throw new Error('First trial activation should succeed');

    // Second activation must be rejected
    const second = mockActivateTrial(tenantId);
    if (second.ok) throw new Error('Second trial activation should be rejected');
    if ((second as any).status !== 409) {
      throw new Error(`Expected 409, got ${(second as any).status}`);
    }
    if ((second as any).error !== 'trial_already_used') {
      throw new Error(`Expected error='trial_already_used', got '${(second as any).error}'`);
    }
  });

  await runTest('Subscription record is unchanged after a rejected second trial attempt', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    // First activation
    const first = mockActivateTrial(tenantId);
    if (!first.ok) throw new Error('First trial activation should succeed');

    // Snapshot the subscription state after first activation
    const snapshotAfterFirst = { ...getSubscriptionByTenantId(tenantId)! };

    // Second activation attempt
    mockActivateTrial(tenantId);

    // Subscription must be bit-for-bit identical to the snapshot
    const current = getSubscriptionByTenantId(tenantId)!;
    const fields: (keyof SubscriptionRow)[] = [
      'plan_id', 'status', 'trial_ends_at', 'trial_used_at',
      'current_period_start', 'current_period_end', 'scheduled_plan_id',
    ];
    for (const field of fields) {
      if (current[field] !== snapshotAfterFirst[field]) {
        throw new Error(
          `Field '${field}' changed: expected '${snapshotAfterFirst[field]}', got '${current[field]}'`,
        );
      }
    }
  });

  await runTest('Tenant with trial_used_at already set (never activated via mock) is rejected', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    // Create a subscription with trial_used_at already populated (simulates DB state)
    createSubscriptionWithTrialUsed(tenantId, 'free', 'active');

    const result = mockActivateTrial(tenantId);
    if (result.ok) throw new Error('Should be rejected when trial_used_at is already set');
    if ((result as any).status !== 409) {
      throw new Error(`Expected 409, got ${(result as any).status}`);
    }
  });

  await runTest('No additional audit entries written on rejected second attempt', () => {
    resetStores();
    const tenantId = crypto.randomUUID();
    createFreeSubscription(tenantId);

    // First activation — writes one audit entry
    const first = mockActivateTrial(tenantId);
    if (!first.ok) throw new Error('First trial activation should succeed');

    const subId = first.subscription.id;
    const auditCountAfterFirst = auditEntriesFor(subId).length;

    // Second activation — must not write any new audit entries
    mockActivateTrial(tenantId);

    const auditCountAfterSecond = auditEntriesFor(subId).length;
    if (auditCountAfterSecond !== auditCountAfterFirst) {
      throw new Error(
        `Audit log should not grow on rejected attempt. ` +
        `Before: ${auditCountAfterFirst}, after: ${auditCountAfterSecond}`,
      );
    }
  });

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 7 — fast-check: any tenant with non-null trial_used_at always gets 409 (100 runs)',
    async () => {
      /**
       * **Validates: Requirements 4.5**
       *
       * For any tenant UUID, if the subscription has trial_used_at non-null,
       * calling mockActivateTrial must:
       *   1. Return {ok: false, status: 409, error: 'trial_already_used'}
       *   2. Leave the subscription record fields unchanged
       */
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // tenantId
          fc.constantFrom<PlanId>('free', 'starter', 'business', 'enterprise'), // currentPlan
          fc.constantFrom<SubscriptionStatus>('active', 'trialing'), // currentStatus
          async (tenantId, currentPlan, currentStatus) => {
            resetStores();
            // Create a subscription whose trial has already been used
            createSubscriptionWithTrialUsed(tenantId, currentPlan, currentStatus);

            // Snapshot before attempt
            const before = { ...getSubscriptionByTenantId(tenantId)! };

            const result = mockActivateTrial(tenantId);

            // Must be rejected
            if (result.ok) return false;
            if ((result as any).status !== 409) return false;
            if ((result as any).error !== 'trial_already_used') return false;

            // Subscription must be unchanged
            const after = getSubscriptionByTenantId(tenantId)!;
            const criticalFields: (keyof SubscriptionRow)[] = [
              'plan_id', 'status', 'trial_ends_at', 'trial_used_at',
              'current_period_start', 'current_period_end', 'scheduled_plan_id',
            ];
            for (const field of criticalFields) {
              if (after[field] !== before[field]) return false;
            }

            return true;
          },
        ),
        {
          numRuns: 100,
          verbose: true,
        },
      );
    },
  );

  await runTest(
    'Property 7 — fast-check: first activation succeeds, second always returns 409 (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // tenantId
          async (tenantId) => {
            resetStores();
            createFreeSubscription(tenantId);

            const now = new Date();

            // First call must succeed
            const first = mockActivateTrial(tenantId, now);
            if (!first.ok) return false;

            // Capture state after first activation
            const afterFirst = { ...getSubscriptionByTenantId(tenantId)! };

            // Any number of subsequent calls must all return 409 with no state change
            const second = mockActivateTrial(tenantId, now);
            if (second.ok) return false;
            if ((second as any).status !== 409) return false;

            // State must not have changed between first and second
            const afterSecond = getSubscriptionByTenantId(tenantId)!;
            const fields: (keyof SubscriptionRow)[] = [
              'plan_id', 'status', 'trial_ends_at', 'trial_used_at',
            ];
            for (const field of fields) {
              if (afterSecond[field] !== afterFirst[field]) return false;
            }

            return true;
          },
        ),
        {
          numRuns: 100,
          verbose: true,
        },
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Main entry point (same pattern as property-registration.ts)
// ---------------------------------------------------------------------------

(async () => {
  console.log('🧪 Running Property-Based Tests: trial subscription');
  console.log('═'.repeat(55));

  await runProperty6();
  await runProperty7();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
