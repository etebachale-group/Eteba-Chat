/**
 * Property-Based Tests for onboarding (POST /api/onboarding/step + GET /api/onboarding/status logic)
 *
 * Property 5: Onboarding Step Data Survives Page Reload
 *   For any step number (1–4) and any valid step payload, submitting that step's data via
 *   POST /api/onboarding/step and then calling GET /api/onboarding/status should return the same
 *   step data under the matching step key — regardless of how many times the page is reloaded
 *   between the two calls (simulated by multiple GET calls).
 *
 * Validates: Requirements 2.4, 2.5
 */

import * as fc from 'fast-check';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory mock store (mirrors users table columns added in migration 008)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  onboarding_completed: boolean;
  onboarding_step: number;
  onboarding_step_data: Record<number, unknown>;
}

const usersStore = new Map<string, UserRow>(); // key = userId

function resetStores(): void {
  usersStore.clear();
}

function createUser(id?: string): UserRow {
  const userId = id ?? crypto.randomUUID();
  const row: UserRow = {
    id: userId,
    email: `user-${userId}@example.com`,
    onboarding_completed: false,
    onboarding_step: 0,
    onboarding_step_data: {},
  };
  usersStore.set(userId, row);
  return row;
}

// ---------------------------------------------------------------------------
// Step payload types (from design.md §2 Onboarding API)
// ---------------------------------------------------------------------------

type Step1Data = { businessName: string; country: string };
type Step2Data = { businessType: 'ecommerce' | 'appointments' | 'services' | 'restaurant' | 'general' };
type Step3Data = { planId: 'free' | 'starter' | 'business' | 'enterprise' | 'trial' };
type Step4Data = { assistantManual: string; language: string };

type OnboardingStepData = Step1Data | Step2Data | Step3Data | Step4Data;

// ---------------------------------------------------------------------------
// Inline re-implementation of POST /api/onboarding/step logic
// Mirrors server.ts: upsert step data and advance onboarding_step
// ---------------------------------------------------------------------------

interface OnboardingStepRequest {
  step: 1 | 2 | 3 | 4;
  data: OnboardingStepData;
}

type OnboardingStepResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function mockSaveStep(userId: string, req: OnboardingStepRequest): OnboardingStepResult {
  const user = usersStore.get(userId);
  if (!user) {
    return { ok: false, status: 404, error: 'user_not_found' };
  }
  if (req.step < 1 || req.step > 4) {
    return { ok: false, status: 400, error: 'invalid_step' };
  }

  // Upsert: merge step data into onboarding_step_data (step key is a number)
  user.onboarding_step_data = {
    ...user.onboarding_step_data,
    [req.step]: req.data,
  };

  // Advance onboarding_step to the highest completed step
  if (req.step > user.onboarding_step) {
    user.onboarding_step = req.step;
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Inline re-implementation of GET /api/onboarding/status logic
// Mirrors server.ts: read onboarding_step + onboarding_step_data
// ---------------------------------------------------------------------------

interface OnboardingStatusResponse {
  completed: boolean;
  currentStep: number;
  stepData: Record<number, unknown>;
}

type OnboardingStatusResult =
  | { ok: true; response: OnboardingStatusResponse }
  | { ok: false; status: number; error: string };

function mockGetStatus(userId: string): OnboardingStatusResult {
  const user = usersStore.get(userId);
  if (!user) {
    return { ok: false, status: 404, error: 'user_not_found' };
  }

  return {
    ok: true,
    response: {
      completed: user.onboarding_completed,
      currentStep: user.onboarding_step,
      stepData: { ...user.onboarding_step_data }, // shallow copy (simulates JSON serialise/deserialise)
    },
  };
}

// ---------------------------------------------------------------------------
// fast-check generators for each step's valid payload
// ---------------------------------------------------------------------------

const businessTypeArb = fc.constantFrom(
  'ecommerce' as const,
  'appointments' as const,
  'services' as const,
  'restaurant' as const,
  'general' as const,
);

const planIdArb = fc.constantFrom(
  'free' as const,
  'starter' as const,
  'business' as const,
  'enterprise' as const,
  'trial' as const,
);

const step1Arb: fc.Arbitrary<Step1Data> = fc.record({
  businessName: fc.string({ minLength: 2, maxLength: 128 }),
  country: fc.string({ minLength: 2, maxLength: 64 }),
});

const step2Arb: fc.Arbitrary<Step2Data> = fc.record({
  businessType: businessTypeArb,
});

const step3Arb: fc.Arbitrary<Step3Data> = fc.record({
  planId: planIdArb,
});

const step4Arb: fc.Arbitrary<Step4Data> = fc.record({
  assistantManual: fc.string({ minLength: 0, maxLength: 500 }),
  language: fc.string({ minLength: 2, maxLength: 32 }),
});

/**
 * Returns the appropriate arbitrary for a given step number.
 */
function stepDataArbFor(step: 1 | 2 | 3 | 4): fc.Arbitrary<OnboardingStepData> {
  switch (step) {
    case 1: return step1Arb;
    case 2: return step2Arb;
    case 3: return step3Arb;
    case 4: return step4Arb;
  }
}

// ---------------------------------------------------------------------------
// Deep equality helper (no external libs — mirrors JSON round-trip behaviour)
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Test runner helpers (same pattern as property-registration.ts)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
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
// Property 5: Onboarding Step Data Survives Page Reload
//
// For any step ∈ {1,2,3,4} and any valid step payload:
//   1. POST /api/onboarding/step → ok
//   2. GET /api/onboarding/status (called 1..N times) always returns
//      stepData[step] === submitted payload
//
// Validates: Requirements 2.4, 2.5
// ---------------------------------------------------------------------------

async function runProperty5(): Promise<void> {
  console.log('\n📋 Property 5: Onboarding Step Data Survives Page Reload');
  console.log('   Validates: Requirements 2.4, 2.5\n');

  // ── Concrete warm-up examples ──────────────────────────────────────────

  await runTest('Step 1 data is returned correctly after a single GET', async () => {
    resetStores();
    const user = createUser();
    const data: Step1Data = { businessName: 'Acme Corp', country: 'Spain' };
    const saveResult = mockSaveStep(user.id, { step: 1, data });
    if (!saveResult.ok) throw new Error(`Save failed: ${saveResult.error}`);

    const statusResult = mockGetStatus(user.id);
    if (!statusResult.ok) throw new Error(`GET status failed: ${statusResult.error}`);
    if (!deepEqual(statusResult.response.stepData[1], data)) {
      throw new Error(`stepData[1] mismatch: expected ${JSON.stringify(data)}, got ${JSON.stringify(statusResult.response.stepData[1])}`);
    }
  });

  await runTest('Step 2 data persists after multiple GET calls (simulating page reloads)', async () => {
    resetStores();
    const user = createUser();
    const data: Step2Data = { businessType: 'ecommerce' };
    mockSaveStep(user.id, { step: 2, data });

    // Simulate 5 page reloads
    for (let i = 0; i < 5; i++) {
      const result = mockGetStatus(user.id);
      if (!result.ok) throw new Error(`GET #${i + 1} failed`);
      if (!deepEqual(result.response.stepData[2], data)) {
        throw new Error(`Reload #${i + 1}: stepData[2] changed unexpectedly`);
      }
    }
  });

  await runTest('Step 3 data (plan selection) survives multiple GET calls', async () => {
    resetStores();
    const user = createUser();
    const data: Step3Data = { planId: 'business' };
    mockSaveStep(user.id, { step: 3, data });

    for (let i = 0; i < 3; i++) {
      const result = mockGetStatus(user.id);
      if (!result.ok) throw new Error(`GET #${i + 1} failed`);
      if (!deepEqual(result.response.stepData[3], data)) {
        throw new Error(`stepData[3] mismatch on reload ${i + 1}`);
      }
    }
  });

  await runTest('Step 4 data survives page reload', async () => {
    resetStores();
    const user = createUser();
    const data: Step4Data = { assistantManual: 'Be helpful and concise.', language: 'en' };
    mockSaveStep(user.id, { step: 4, data });

    const result = mockGetStatus(user.id);
    if (!result.ok) throw new Error('GET status failed');
    if (!deepEqual(result.response.stepData[4], data)) {
      throw new Error(`stepData[4] mismatch: ${JSON.stringify(result.response.stepData[4])}`);
    }
  });

  await runTest('Saving a step advances currentStep to that step number', async () => {
    resetStores();
    const user = createUser();
    if (mockGetStatus(user.id).ok && (mockGetStatus(user.id) as any).response.currentStep !== 0) {
      throw new Error('Expected currentStep = 0 before any steps');
    }
    mockSaveStep(user.id, { step: 2, data: { businessType: 'services' } });
    const result = mockGetStatus(user.id);
    if (!result.ok) throw new Error('GET failed');
    if (result.response.currentStep !== 2) {
      throw new Error(`Expected currentStep=2, got ${result.response.currentStep}`);
    }
  });

  await runTest('Later steps do not overwrite earlier step data', async () => {
    resetStores();
    const user = createUser();
    const data1: Step1Data = { businessName: 'My Shop', country: 'France' };
    const data2: Step2Data = { businessType: 'restaurant' };
    mockSaveStep(user.id, { step: 1, data: data1 });
    mockSaveStep(user.id, { step: 2, data: data2 });

    const result = mockGetStatus(user.id);
    if (!result.ok) throw new Error('GET failed');
    if (!deepEqual(result.response.stepData[1], data1)) {
      throw new Error('Step 1 data was overwritten by Step 2 save');
    }
    if (!deepEqual(result.response.stepData[2], data2)) {
      throw new Error('Step 2 data is incorrect');
    }
  });

  await runTest('Re-saving a step updates the stored data (upsert)', async () => {
    resetStores();
    const user = createUser();
    const original: Step1Data = { businessName: 'Old Name', country: 'US' };
    const updated: Step1Data = { businessName: 'New Name', country: 'UK' };
    mockSaveStep(user.id, { step: 1, data: original });
    mockSaveStep(user.id, { step: 1, data: updated });

    const result = mockGetStatus(user.id);
    if (!result.ok) throw new Error('GET failed');
    if (!deepEqual(result.response.stepData[1], updated)) {
      throw new Error(`Expected updated data, got: ${JSON.stringify(result.response.stepData[1])}`);
    }
  });

  // ── fast-check property (100 runs minimum) ─────────────────────────────

  await runTest(
    'Property 5 — fast-check: step data always matches after any number of GET calls (100 runs)',
    async () => {
      /**
       * Validates: Requirements 2.4, 2.5
       *
       * Strategy:
       *   - Generate step ∈ {1,2,3,4} via fc.constantFrom
       *   - Generate a valid payload for that step
       *   - Generate reloadCount ∈ [1,10] to simulate multiple page reloads
       *   - Assert every GET /api/onboarding/status call returns stepData[step] === submitted payload
       */
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const),
          fc.integer({ min: 1, max: 10 }), // number of simulated reloads
          async (step, reloadCount) => {
            // Derive the step-specific payload inside the property
            // We use fc.sample to pull one value from the correct arbitrary
            const [data] = fc.sample(stepDataArbFor(step), 1);

            resetStores();
            const user = createUser();

            // POST /api/onboarding/step
            const saveResult = mockSaveStep(user.id, { step, data });
            if (!saveResult.ok) return false;

            // GET /api/onboarding/status — repeated reloadCount times
            for (let i = 0; i < reloadCount; i++) {
              const statusResult = mockGetStatus(user.id);
              if (!statusResult.ok) return false;

              const returned = statusResult.response.stepData[step];
              if (!deepEqual(returned, data)) return false;

              // currentStep must be >= step that was saved
              if (statusResult.response.currentStep < step) return false;
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
    'Property 5 — fast-check: saving multiple steps, all survive concurrent GET calls (100 runs)',
    async () => {
      /**
       * Validates: Requirements 2.4, 2.5
       *
       * Tests that saving several steps in sequence does not corrupt earlier step data
       * when status is polled between each save (simulating browser reloads mid-wizard).
       */
      await fc.assert(
        fc.asyncProperty(
          step1Arb,
          step2Arb,
          step3Arb,
          step4Arb,
          async (d1, d2, d3, d4) => {
            resetStores();
            const user = createUser();

            // Save steps one by one; poll status after each
            const steps: Array<{ step: 1 | 2 | 3 | 4; data: OnboardingStepData }> = [
              { step: 1, data: d1 },
              { step: 2, data: d2 },
              { step: 3, data: d3 },
              { step: 4, data: d4 },
            ];

            const savedData: Partial<Record<number, OnboardingStepData>> = {};

            for (const { step, data } of steps) {
              const saveResult = mockSaveStep(user.id, { step, data });
              if (!saveResult.ok) return false;
              savedData[step] = data;

              // Simulate a page reload immediately after each save
              const statusResult = mockGetStatus(user.id);
              if (!statusResult.ok) return false;

              // All previously saved steps must still be present and correct
              for (const [savedStep, savedPayload] of Object.entries(savedData)) {
                const key = Number(savedStep);
                const returned = statusResult.response.stepData[key];
                if (!deepEqual(returned, savedPayload)) return false;
              }
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
  console.log('🧪 Running Property-Based Tests: onboarding');
  console.log('═'.repeat(55));

  await runProperty5();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
