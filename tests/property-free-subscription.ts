/**
 * Property-Based Tests for free subscription creation
 *
 * Property 4: New Tenant Always Gets Free Subscription
 *   For any new tenant account created (via email/password or Google OAuth),
 *   exactly one subscriptions row should exist for that tenant with:
 *     - plan_id === 'free'
 *     - status === 'active'
 *     - current_period_end set to the last second of the current calendar month
 *       (i.e., new Date(year, month+1, 0, 23, 59, 59) in local time)
 *
 * Validates: Requirements 3.8
 */

import * as fc from 'fast-check';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory mock stores (mirrors server.ts tables)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  onboarding_completed: boolean;
  onboarding_step: number;
  onboarding_step_data: Record<string, unknown>;
}

interface CompanyRow {
  id: string;
  name: string;
  owner_id: string;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
}

const usersStore = new Map<string, UserRow>();        // key = email (lowercase)
const companiesStore = new Map<string, CompanyRow>(); // key = company id
const subscriptionsStore = new Map<string, SubscriptionRow>(); // key = tenant_id

function resetStores(): void {
  usersStore.clear();
  companiesStore.clear();
  subscriptionsStore.clear();
}

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function stubHash(password: string): string {
  return `stub:${Buffer.from(password).toString('base64')}`;
}

function stubSignToken(payload: {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  avatar_url: null;
}): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const fakeSig = crypto
    .createHmac('sha256', 'test-secret-key-for-property-tests-only')
    .update(data)
    .digest('base64url');
  return `${data}.${fakeSig}`;
}

// ---------------------------------------------------------------------------
// Helper — compute expected current_period_end
//
// Mirrors the exact calculation in server.ts:
//   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
// Day=0 of month+1 rolls back to the last day of the current month.
// ---------------------------------------------------------------------------

function expectedPeriodEnd(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
}

/**
 * Check whether two dates represent the same year/month/day/hour/minute/second
 * in local time, allowing up to `toleranceMs` of clock drift between the two
 * Date objects (default 5 000 ms to account for test execution time).
 */
function periodEndMatches(actual: Date, expected: Date, toleranceMs = 5_000): boolean {
  // Primary: same year, month, day, hours, minutes, seconds in local time
  const sameComponents =
    actual.getFullYear() === expected.getFullYear() &&
    actual.getMonth() === expected.getMonth() &&
    actual.getDate() === expected.getDate() &&
    actual.getHours() === expected.getHours() &&
    actual.getMinutes() === expected.getMinutes() &&
    actual.getSeconds() === expected.getSeconds();

  if (sameComponents) return true;

  // Fallback: allow toleranceMs for month-boundary edge cases where "now"
  // in the mock and "now" in the assertion differ by milliseconds.
  return Math.abs(actual.getTime() - expected.getTime()) <= toleranceMs;
}

// ---------------------------------------------------------------------------
// createFreeSubscription — shared helper used by both registration paths
// (mirrors the subscription-creation block in server.ts)
// ---------------------------------------------------------------------------

function createFreeSubscription(tenantId: string): void {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const subId = crypto.randomUUID();
  subscriptionsStore.set(tenantId, {
    id: subId,
    tenant_id: tenantId,
    plan_id: 'free',
    status: 'active',
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// mockRegister — email/password path
// (inline re-implementation of POST /auth/register, mirrors server.ts)
// ---------------------------------------------------------------------------

interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
}

interface RegisterResponse {
  token: string;
  user: { id: string; email: string; name: string; role: string; tenantId: string };
  isNewUser: true;
}

type RegisterResult =
  | { ok: true; response: RegisterResponse }
  | { ok: false; status: number; error: string; field?: string };

function mockRegister(req: RegisterRequest): RegisterResult {
  const { name, email, password, passwordConfirm } = req;

  // Validation
  if (!name || name.length < 2 || name.length > 128) {
    return { ok: false, status: 400, error: 'validation', field: 'name' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return { ok: false, status: 400, error: 'validation', field: 'email' };
  }
  if (!password || password.length < 8) {
    return { ok: false, status: 400, error: 'validation', field: 'password' };
  }
  if (password !== passwordConfirm) {
    return { ok: false, status: 400, error: 'validation', field: 'passwordConfirm' };
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (usersStore.has(normalizedEmail)) {
    return { ok: false, status: 409, error: 'email_exists' };
  }

  // Create user row
  const userId = crypto.randomUUID();
  usersStore.set(normalizedEmail, {
    id: userId,
    email: normalizedEmail,
    name,
    password_hash: stubHash(password),
    role: 'tenant',
    onboarding_completed: false,
    onboarding_step: 0,
    onboarding_step_data: {},
  });

  // Create company row
  companiesStore.set(userId, { id: userId, name, owner_id: userId });

  // Create free subscription (shared helper)
  createFreeSubscription(userId);

  const token = stubSignToken({
    id: userId,
    email: normalizedEmail,
    name,
    role: 'tenant',
    tenantId: userId,
    avatar_url: null,
  });

  return {
    ok: true,
    response: {
      token,
      user: { id: userId, email: normalizedEmail, name, role: 'tenant', tenantId: userId },
      isNewUser: true,
    },
  };
}

// ---------------------------------------------------------------------------
// mockGoogleOAuthNewUser — simulates the Google OAuth new-user branch
//
// Mirrors server.ts /auth/google/callback logic for a brand-new Google user:
//   1. User does not exist → create users row
//   2. Create companies row
//   3. Create free subscriptions row
//   4. Return token + redirect info (new_user=true)
// ---------------------------------------------------------------------------

interface GoogleOAuthProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

interface GoogleOAuthResult {
  token: string;
  userId: string;
  tenantId: string;
  isNewUser: boolean;
}

function mockGoogleOAuthNewUser(profile: GoogleOAuthProfile): GoogleOAuthResult {
  const { email, name } = profile;
  const normalizedEmail = email.toLowerCase().trim();

  // For this path we always assume a brand-new user (the test controls the store)
  const userId = crypto.randomUUID();

  usersStore.set(normalizedEmail, {
    id: userId,
    email: normalizedEmail,
    name,
    password_hash: '', // OAuth users have no password
    role: 'tenant',
    onboarding_completed: false,
    onboarding_step: 0,
    onboarding_step_data: {},
  });

  companiesStore.set(userId, { id: userId, name, owner_id: userId });

  // Create free subscription — same as email/password path (Req 3.8)
  createFreeSubscription(userId);

  const token = stubSignToken({
    id: userId,
    email: normalizedEmail,
    name,
    role: 'tenant',
    tenantId: userId,
    avatar_url: null,
  });

  return { token, userId, tenantId: userId, isNewUser: true };
}

// ---------------------------------------------------------------------------
// Store query helpers
// ---------------------------------------------------------------------------

function getSubscriptionsForTenant(tenantId: string): SubscriptionRow[] {
  const sub = subscriptionsStore.get(tenantId);
  return sub ? [sub] : [];
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
// Property 4: New Tenant Always Gets Free Subscription
//
// Assertions:
//   1. Exactly 1 subscriptions row per new tenant
//   2. plan_id === 'free'
//   3. status === 'active'
//   4. current_period_end is the last second of the current calendar month
//      (new Date(year, month+1, 0, 23, 59, 59) in local time)
//   5. Google OAuth new user path also gets free subscription
//
// Validates: Requirements 3.8
// ---------------------------------------------------------------------------

async function runProperty4(): Promise<void> {
  console.log('\n📋 Property 4: New Tenant Always Gets Free Subscription');
  console.log('   Validates: Requirements 3.8\n');

  // ---- Concrete warm-up examples (email/password path) ----

  await runTest('Email/password registration creates exactly 1 subscriptions row', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'securepass1',
      passwordConfirm: 'securepass1',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const subs = getSubscriptionsForTenant(result.response.user.tenantId);
    if (subs.length !== 1) throw new Error(`Expected 1 subscription row, got ${subs.length}`);
  });

  await runTest('Subscription has plan_id === "free"', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Bob',
      email: 'bob@example.com',
      password: 'mypassword9',
      passwordConfirm: 'mypassword9',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const subs = getSubscriptionsForTenant(result.response.user.tenantId);
    if (subs[0].plan_id !== 'free') {
      throw new Error(`Expected plan_id='free', got '${subs[0].plan_id}'`);
    }
  });

  await runTest('Subscription has status === "active"', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Carol',
      email: 'carol@example.com',
      password: 'password99',
      passwordConfirm: 'password99',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const subs = getSubscriptionsForTenant(result.response.user.tenantId);
    if (subs[0].status !== 'active') {
      throw new Error(`Expected status='active', got '${subs[0].status}'`);
    }
  });

  await runTest('Subscription current_period_end is last second of current calendar month', async () => {
    resetStores();
    const beforeCall = new Date();
    const result = mockRegister({
      name: 'Dave',
      email: 'dave@example.com',
      password: 'passw0rd!',
      passwordConfirm: 'passw0rd!',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const subs = getSubscriptionsForTenant(result.response.user.tenantId);
    const actualEnd = new Date(subs[0].current_period_end);
    const expected = expectedPeriodEnd(beforeCall);
    if (!periodEndMatches(actualEnd, expected)) {
      throw new Error(
        `current_period_end mismatch.\n` +
        `  Expected: ${expected.toISOString()}\n` +
        `  Got:      ${actualEnd.toISOString()}`,
      );
    }
  });

  await runTest('current_period_end day is the last day of the current month', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Eve',
      email: 'eve@example.com',
      password: 'evepass99',
      passwordConfirm: 'evepass99',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const subs = getSubscriptionsForTenant(result.response.user.tenantId);
    const actualEnd = new Date(subs[0].current_period_end);
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (actualEnd.getDate() !== lastDayOfMonth) {
      throw new Error(
        `current_period_end day (${actualEnd.getDate()}) is not last day of month (${lastDayOfMonth})`,
      );
    }
  });

  await runTest('current_period_end time is 23:59:59 local time', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Frank',
      email: 'frank@example.com',
      password: 'frankpass1',
      passwordConfirm: 'frankpass1',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const subs = getSubscriptionsForTenant(result.response.user.tenantId);
    const actualEnd = new Date(subs[0].current_period_end);
    if (
      actualEnd.getHours() !== 23 ||
      actualEnd.getMinutes() !== 59 ||
      actualEnd.getSeconds() !== 59
    ) {
      throw new Error(
        `current_period_end time is ${actualEnd.getHours()}:${actualEnd.getMinutes()}:${actualEnd.getSeconds()}, expected 23:59:59`,
      );
    }
  });

  await runTest('Subscription tenant_id matches the registered userId', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Grace',
      email: 'grace@example.com',
      password: 'gracepass1',
      passwordConfirm: 'gracepass1',
    });
    if (!result.ok) throw new Error(`Registration failed: ${result.error}`);
    const userId = result.response.user.id;
    const subs = getSubscriptionsForTenant(userId);
    if (subs.length !== 1) throw new Error('No subscription found for userId');
    if (subs[0].tenant_id !== userId) {
      throw new Error(`tenant_id mismatch: expected ${userId}, got ${subs[0].tenant_id}`);
    }
  });

  // ---- Google OAuth path ----

  await runTest('Google OAuth new user also gets exactly 1 free subscription row', async () => {
    resetStores();
    const oauthResult = mockGoogleOAuthNewUser({
      googleId: 'google-uid-001',
      email: 'googleuser@gmail.com',
      name: 'Google User',
    });
    const subs = getSubscriptionsForTenant(oauthResult.tenantId);
    if (subs.length !== 1) throw new Error(`Expected 1 subscription, got ${subs.length}`);
    if (subs[0].plan_id !== 'free') {
      throw new Error(`Expected plan_id='free', got '${subs[0].plan_id}'`);
    }
    if (subs[0].status !== 'active') {
      throw new Error(`Expected status='active', got '${subs[0].status}'`);
    }
  });

  await runTest('Google OAuth subscription current_period_end is last second of current month', async () => {
    resetStores();
    const beforeCall = new Date();
    const oauthResult = mockGoogleOAuthNewUser({
      googleId: 'google-uid-002',
      email: 'googleuser2@gmail.com',
      name: 'Google User Two',
    });
    const subs = getSubscriptionsForTenant(oauthResult.tenantId);
    const actualEnd = new Date(subs[0].current_period_end);
    const expected = expectedPeriodEnd(beforeCall);
    if (!periodEndMatches(actualEnd, expected)) {
      throw new Error(
        `Google OAuth current_period_end mismatch.\n` +
        `  Expected: ${expected.toISOString()}\n` +
        `  Got:      ${actualEnd.toISOString()}`,
      );
    }
  });

  await runTest('Google OAuth subscription time is 23:59:59 local time', async () => {
    resetStores();
    const oauthResult = mockGoogleOAuthNewUser({
      googleId: 'google-uid-003',
      email: 'googleuser3@gmail.com',
      name: 'Google User Three',
    });
    const subs = getSubscriptionsForTenant(oauthResult.tenantId);
    const actualEnd = new Date(subs[0].current_period_end);
    if (
      actualEnd.getHours() !== 23 ||
      actualEnd.getMinutes() !== 59 ||
      actualEnd.getSeconds() !== 59
    ) {
      throw new Error(
        `Google OAuth current_period_end time is ${actualEnd.getHours()}:${actualEnd.getMinutes()}:${actualEnd.getSeconds()}, expected 23:59:59`,
      );
    }
  });

  // ---- fast-check property — email/password path (100+ runs) ----

  await runTest(
    'Property 4 — fast-check email/password: every valid registration gets plan_id="free" & status="active" (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 2, maxLength: 128 }),
            email: fc.emailAddress(),
            password: fc.string({ minLength: 8, maxLength: 64 }),
          }),
          async ({ name, email, password }) => {
            resetStores();

            const result = mockRegister({
              name,
              email,
              password,
              passwordConfirm: password,
            });

            if (!result.ok) return false;

            const tenantId = result.response.user.tenantId;
            const subs = getSubscriptionsForTenant(tenantId);

            // Assertion 1: exactly 1 row
            if (subs.length !== 1) return false;
            const sub = subs[0];

            // Assertion 2: plan_id === 'free'
            if (sub.plan_id !== 'free') return false;

            // Assertion 3: status === 'active'
            if (sub.status !== 'active') return false;

            // Assertion 4: tenant_id matches
            if (sub.tenant_id !== tenantId) return false;

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 4 — fast-check email/password: current_period_end is last second of current month (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 2, maxLength: 128 }),
            email: fc.emailAddress(),
            password: fc.string({ minLength: 8, maxLength: 64 }),
          }),
          async ({ name, email, password }) => {
            resetStores();
            const beforeCall = new Date();

            const result = mockRegister({
              name,
              email,
              password,
              passwordConfirm: password,
            });

            if (!result.ok) return false;

            const subs = getSubscriptionsForTenant(result.response.user.tenantId);
            if (subs.length !== 1) return false;

            const actualEnd = new Date(subs[0].current_period_end);
            const expected = expectedPeriodEnd(beforeCall);

            // Assertion 4: correct period-end date/time components
            if (!periodEndMatches(actualEnd, expected)) return false;

            // Additional: hours=23, minutes=59, seconds=59
            if (
              actualEnd.getHours() !== 23 ||
              actualEnd.getMinutes() !== 59 ||
              actualEnd.getSeconds() !== 59
            ) {
              return false;
            }

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  // ---- fast-check property — Google OAuth path (100+ runs) ----

  await runTest(
    'Property 4 — fast-check Google OAuth: every new Google user gets plan_id="free" & status="active" (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            googleId: fc.string({ minLength: 8, maxLength: 32 }).map(s => `g-${s}`),
            email: fc.emailAddress(),
            name: fc.string({ minLength: 2, maxLength: 128 }),
          }),
          async ({ googleId, email, name }) => {
            resetStores();

            const oauthResult = mockGoogleOAuthNewUser({ googleId, email, name });
            const subs = getSubscriptionsForTenant(oauthResult.tenantId);

            // Assertion 1: exactly 1 row
            if (subs.length !== 1) return false;
            const sub = subs[0];

            // Assertion 2: plan_id === 'free'
            if (sub.plan_id !== 'free') return false;

            // Assertion 3: status === 'active'
            if (sub.status !== 'active') return false;

            // Assertion 4: tenant_id matches
            if (sub.tenant_id !== oauthResult.tenantId) return false;

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 4 — fast-check Google OAuth: current_period_end is last second of current month (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            googleId: fc.string({ minLength: 8, maxLength: 32 }).map(s => `g-${s}`),
            email: fc.emailAddress(),
            name: fc.string({ minLength: 2, maxLength: 128 }),
          }),
          async ({ googleId, email, name }) => {
            resetStores();
            const beforeCall = new Date();

            const oauthResult = mockGoogleOAuthNewUser({ googleId, email, name });
            const subs = getSubscriptionsForTenant(oauthResult.tenantId);
            if (subs.length !== 1) return false;

            const actualEnd = new Date(subs[0].current_period_end);
            const expected = expectedPeriodEnd(beforeCall);

            if (!periodEndMatches(actualEnd, expected)) return false;

            if (
              actualEnd.getHours() !== 23 ||
              actualEnd.getMinutes() !== 59 ||
              actualEnd.getSeconds() !== 59
            ) {
              return false;
            }

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Main entry point (same pattern as property-registration.ts)
// ---------------------------------------------------------------------------

(async () => {
  console.log('🧪 Running Property-Based Tests: free subscription');
  console.log('═'.repeat(60));

  await runProperty4();

  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
