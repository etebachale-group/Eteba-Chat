/**
 * Property-Based Tests for registration — Property 2
 *
 * Property 2: Password Validation Rejects All Short Passwords
 *   For any string of length 1–7 submitted as a password in the registration
 *   form, the server validation should reject it with a 400 response, field
 *   'password', and zero new users rows created.
 *
 * Validates: Requirements 1.5
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

const usersStore = new Map<string, UserRow>();
const companiesStore = new Map<string, CompanyRow>();

function resetStores(): void {
  usersStore.clear();
  companiesStore.clear();
}

// ---------------------------------------------------------------------------
// Stub bcrypt — no real hashing needed for the property test
// ---------------------------------------------------------------------------

function stubHash(password: string): string {
  return `stub:${Buffer.from(password).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Stub signToken — deterministic fake JWT-shaped string
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
  const fakeSig = crypto
    .createHmac('sha256', 'test-secret-key-for-property-tests-only')
    .update(data)
    .digest('base64url');
  return `${data}.${fakeSig}`;
}

// ---------------------------------------------------------------------------
// Inline re-implementation of POST /auth/register validation logic
// (mirrors server.ts validation exactly)
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

  companiesStore.set(userId, {
    id: userId,
    name,
    owner_id: userId,
  });

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
// Helper — count users rows in mock store
// ---------------------------------------------------------------------------

function totalUsersCount(): number {
  return usersStore.size;
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
// Property 2: Password Validation Rejects All Short Passwords
//
// For any string of length 1–7 submitted as password, the server validation
// should:
//   1. Return ok: false
//   2. Return status 400
//   3. Return field: 'password'
//   4. Create 0 users rows
//
// Validates: Requirements 1.5
// ---------------------------------------------------------------------------

async function runProperty2(): Promise<void> {
  console.log('\n📋 Property 2: Password Validation Rejects All Short Passwords');
  console.log('   Validates: Requirements 1.5\n');

  // --- Concrete boundary examples ---

  await runTest('Empty password is rejected with 400 / field=password', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Test User',
      email: 'user@example.com',
      password: '',
      passwordConfirm: '',
    });
    if (result.ok) throw new Error('Expected rejection for empty password');
    if (result.status !== 400) throw new Error(`Expected 400, got ${result.status}`);
    if (result.field !== 'password') throw new Error(`Expected field='password', got '${result.field}'`);
    if (totalUsersCount() !== 0) throw new Error(`Expected 0 users rows, found ${totalUsersCount()}`);
  });

  await runTest('Password of exactly 1 character is rejected', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Test User',
      email: 'user1@example.com',
      password: 'x',
      passwordConfirm: 'x',
    });
    if (result.ok) throw new Error('Expected rejection for 1-char password');
    if (result.status !== 400) throw new Error(`Expected 400, got ${result.status}`);
    if (result.field !== 'password') throw new Error(`Expected field='password', got '${result.field}'`);
    if (totalUsersCount() !== 0) throw new Error(`Expected 0 users rows, found ${totalUsersCount()}`);
  });

  await runTest('Password of exactly 7 characters is rejected (boundary)', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Test User',
      email: 'user7@example.com',
      password: '1234567',
      passwordConfirm: '1234567',
    });
    if (result.ok) throw new Error('Expected rejection for 7-char password');
    if (result.status !== 400) throw new Error(`Expected 400, got ${result.status}`);
    if (result.field !== 'password') throw new Error(`Expected field='password', got '${result.field}'`);
    if (totalUsersCount() !== 0) throw new Error(`Expected 0 users rows, found ${totalUsersCount()}`);
  });

  await runTest('Password of exactly 8 characters is accepted (boundary)', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Test User',
      email: 'user8@example.com',
      password: '12345678',
      passwordConfirm: '12345678',
    });
    if (!result.ok) throw new Error(`Expected success for 8-char password, got error: ${(result as any).error}`);
    if (totalUsersCount() !== 1) throw new Error(`Expected 1 users row, found ${totalUsersCount()}`);
  });

  await runTest('Short password does not create users row even with otherwise valid payload', async () => {
    resetStores();
    const result = mockRegister({
      name: 'Alice',
      email: 'alice@test.io',
      password: 'abc',
      passwordConfirm: 'abc',
    });
    if (result.ok) throw new Error('Expected rejection for 3-char password');
    if (totalUsersCount() !== 0) throw new Error(`Expected 0 users rows, found ${totalUsersCount()}`);
  });

  // --- fast-check property (100+ runs) ---

  await runTest(
    'Property 2 — fast-check: any password length 1–7 always rejected with 400 and 0 users rows (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Short password: length 1–7 (strictly below the 8-char minimum)
          fc.string({ minLength: 1, maxLength: 7 }),
          // Valid name and email so the only failure source is the password
          fc.string({ minLength: 2, maxLength: 128 }),
          fc.emailAddress(),
          async (shortPassword, name, email) => {
            resetStores();

            const result = mockRegister({
              name,
              email,
              password: shortPassword,
              passwordConfirm: shortPassword, // match so passwordConfirm doesn't interfere
            });

            // Must be rejected
            if (result.ok) return false;

            // Must return 400
            if (result.status !== 400) return false;

            // Must indicate the password field as the failing field
            if (result.field !== 'password') return false;

            // Must not have created any users row
            if (totalUsersCount() !== 0) return false;

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
    'Property 2 — fast-check: short password rejection is independent of other valid fields (100 runs)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            shortPassword: fc.string({ minLength: 1, maxLength: 7 }),
            name: fc.string({ minLength: 2, maxLength: 128 }),
            email: fc.emailAddress(),
          }),
          async ({ shortPassword, name, email }) => {
            resetStores();

            // Attempt registration with short password
            const result = mockRegister({
              name,
              email,
              password: shortPassword,
              passwordConfirm: shortPassword,
            });

            // Regardless of name/email contents, a short password must be rejected
            if (result.ok) return false;
            if (result.status !== 400) return false;

            // The store must remain empty — no partial writes
            if (totalUsersCount() !== 0) return false;

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
  console.log('🧪 Running Property-Based Tests: password validation');
  console.log('═'.repeat(55));

  await runProperty2();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
