/**
 * Property-Based Tests for registration (POST /auth/register logic)
 *
 * Property 1: Valid Registration Always Creates Tenant Records
 *   For any valid registration payload (name 2–128 chars, valid unique email,
 *   password ≥ 8 chars), calling the register logic should always result in
 *   exactly one users row, one companies row with owner_id === userId, and
 *   a valid JWT token returned.
 *
 * Validates: Requirements 1.3, 3.8
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

const usersStore = new Map<string, UserRow>();       // key = email (lowercase)
const companiesStore = new Map<string, CompanyRow>(); // key = company id
const subscriptionsStore = new Map<string, SubscriptionRow>(); // key = tenant_id

function resetStores(): void {
  usersStore.clear();
  companiesStore.clear();
  subscriptionsStore.clear();
}

// ---------------------------------------------------------------------------
// Stub bcrypt — no real hashing needed for the property test
// ---------------------------------------------------------------------------

function stubHash(password: string): string {
  return `stub:${Buffer.from(password).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Stub signToken — returns a deterministic fake JWT-shaped string
// The real signToken requires AUTH_SECRET in the environment; we bypass that
// here and just verify the token is a non-empty string with the correct
// base64url.payload.sig structure.
// ---------------------------------------------------------------------------

function stubSignToken(payload: {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  avatar_url: null;
}): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // Use a deterministic fake signature so the output is always a valid-looking token
  const fakeSig = crypto
    .createHmac('sha256', 'test-secret-key-for-property-tests-only')
    .update(data)
    .digest('base64url');
  return `${data}.${fakeSig}`;
}

// ---------------------------------------------------------------------------
// Inline re-implementation of POST /auth/register logic using mock stores
// (mirrors server.ts implementation without Express / InsForge / real bcrypt)
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

  // --- Validation (mirrors server.ts exactly) ---
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

  // --- Check email uniqueness ---
  if (usersStore.has(normalizedEmail)) {
    return { ok: false, status: 409, error: 'email_exists' };
  }

  // --- Create user row ---
  const userId = crypto.randomUUID();
  const passwordHash = stubHash(password);

  usersStore.set(normalizedEmail, {
    id: userId,
    email: normalizedEmail,
    name,
    password_hash: passwordHash,
    role: 'tenant',
    onboarding_completed: false,
    onboarding_step: 0,
    onboarding_step_data: {},
  });

  // --- Create company row (mirrors: insert companies with id=userId, owner_id=userId) ---
  companiesStore.set(userId, {
    id: userId,
    name,
    owner_id: userId,
  });

  // --- Create free subscription ---
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const subId = crypto.randomUUID();
  subscriptionsStore.set(userId, {
    id: subId,
    tenant_id: userId,
    plan_id: 'free',
    status: 'active',
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
  });

  // --- Return token ---
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
// Helper — count rows in mock stores
// ---------------------------------------------------------------------------

function countUsersForEmail(email: string): number {
  const normalized = email.toLowerCase().trim();
  return usersStore.has(normalized) ? 1 : 0;
}

function countCompaniesForOwner(ownerId: string): number {
  let count = 0;
  for (const row of companiesStore.values()) {
    if (row.owner_id === ownerId) count++;
  }
  return count;
}

function getCompanyForOwner(ownerId: string): CompanyRow | undefined {
  for (const row of companiesStore.values()) {
    if (row.owner_id === ownerId) return row;
  }
  return undefined;
}

function isValidToken(token: string): boolean {
  // Token must be two base64url segments separated by a single dot
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  // Each part must be non-empty base64url
  const base64urlRe = /^[A-Za-z0-9_\-]+$/;
  return parts.every((p) => p.length > 0 && base64urlRe.test(p));
}

// ---------------------------------------------------------------------------
// Test runner helpers (same pattern as property-usage-tracker.ts)
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
// Property 1: Valid Registration Always Creates Tenant Records
//
// For any valid registration payload the mock register function should:
//   1. Return ok: true
//   2. Create exactly 1 users row
//   3. Create exactly 1 companies row with owner_id === userId
//   4. Return a valid JWT-shaped token string
//   5. 0 duplicate users for the same email (idempotency of uniqueness check)
//
// Validates: Requirements 1.3, 3.8
// ---------------------------------------------------------------------------

async function runProperty1(): Promise<void> {
  console.log('\n📋 Property 1: Valid Registration Always Creates Tenant Records');
  console.log('   Validates: Requirements 1.3, 3.8\n');

  // --- Concrete warm-up examples ---

  await runTest('Minimal valid registration (name=2 chars, password=8 chars)', async () => {
    resetStores();
    const result = mockRegister({
      name: 'AB',
      email: 'ab@example.com',
      password: '12345678',
      passwordConfirm: '12345678',
    });
    if (!result.ok) throw new Error(`Expected ok, got error: ${result.error}`);
    const userId = result.response.user.id;
    if (countUsersForEmail('ab@example.com') !== 1) {
      throw new Error('Expected exactly 1 users row');
    }
    if (countCompaniesForOwner(userId) !== 1) {
      throw new Error('Expected exactly 1 companies row');
    }
    if (!isValidToken(result.response.token)) {
      throw new Error(`Invalid token shape: ${result.response.token}`);
    }
  });

  await runTest('Maximum name length (128 chars)', async () => {
    resetStores();
    const longName = 'A'.repeat(128);
    const result = mockRegister({
      name: longName,
      email: 'long@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
    });
    if (!result.ok) throw new Error(`Expected ok, got error: ${result.error}`);
    if (countUsersForEmail('long@example.com') !== 1) {
      throw new Error('Expected exactly 1 users row for max name');
    }
  });

  await runTest('Duplicate email is rejected and no extra users row is created', async () => {
    resetStores();
    const payload = {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'securepass',
      passwordConfirm: 'securepass',
    };
    const first = mockRegister(payload);
    if (!first.ok) throw new Error('First registration should succeed');
    const second = mockRegister(payload);
    if (second.ok) throw new Error('Duplicate email should be rejected');
    if ((second as any).status !== 409) throw new Error(`Expected 409, got ${(second as any).status}`);
    // Only 1 user row should exist
    if (countUsersForEmail('alice@example.com') !== 1) {
      throw new Error('Expected exactly 1 users row after duplicate attempt');
    }
  });

  await runTest('owner_id on companies row matches userId from users row', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Bob',
      email: 'bob@test.io',
      password: 'mypassword1',
      passwordConfirm: 'mypassword1',
    });
    if (!result.ok) throw new Error('Expected ok');
    const userId = result.response.user.id;
    const company = getCompanyForOwner(userId);
    if (!company) throw new Error('No company row found for userId');
    if (company.owner_id !== userId) {
      throw new Error(`owner_id mismatch: expected ${userId}, got ${company.owner_id}`);
    }
  });

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 1 — fast-check: valid payloads always produce 1 user + 1 company + valid token (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 2, maxLength: 128 }),
            email: fc.emailAddress(),
            password: fc.string({ minLength: 8, maxLength: 64 }),
          }),
          async ({ name, email, password }) => {
            // Each run uses a fresh store to avoid cross-run interference
            resetStores();

            const result = mockRegister({
              name,
              email,
              password,
              passwordConfirm: password, // always matches — valid payload
            });

            // Must succeed
            if (!result.ok) return false;

            const userId = result.response.user.id;

            // Exactly 1 users row for this email
            if (countUsersForEmail(email) !== 1) return false;

            // Exactly 1 companies row with correct owner_id
            const company = getCompanyForOwner(userId);
            if (!company) return false;
            if (company.owner_id !== userId) return false;

            // Valid JWT-shaped token returned
            if (!isValidToken(result.response.token)) return false;

            // Calling register again with the same email must return 409 (no extra rows)
            const dup = mockRegister({ name, email, password, passwordConfirm: password });
            if (dup.ok) return false; // duplicate should be rejected
            if ((dup as any).status !== 409) return false;
            if (countUsersForEmail(email) !== 1) return false; // still exactly 1

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
    'Property 1 — fast-check: token payload decodes to correct user data (100 runs)',
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

            const { token, user } = result.response;

            // Decode payload (first segment before the dot)
            const payloadB64 = token.split('.')[0];
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            } catch {
              return false;
            }

            // Payload must contain expected fields matching the user
            if (payload['id'] !== user.id) return false;
            if (payload['email'] !== user.email) return false;
            if (payload['tenantId'] !== user.id) return false;
            if (payload['role'] !== 'tenant') return false;

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
// Main entry point (same pattern as property-usage-tracker.ts)
// ---------------------------------------------------------------------------

(async () => {
  console.log('🧪 Running Property-Based Tests: registration');
  console.log('═'.repeat(55));

  await runProperty1();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
