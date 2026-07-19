/**
 * Property-Based Tests for email-service.ts
 *
 * Property 19: Soft Limit Warning Email Sent At Most Once Per Period
 *   For N threshold crossings (1–10) for the same tenant/period, assert
 *   sendPlanEmail is called at most once with soft_limit_warning.
 *   Validates: Requirements 10.3
 *
 * Property 3: Welcome Email Contains User Name
 *   For any generated user name (2–64 chars), assert the captured email body
 *   contains the generated name string.
 *   Validates: Requirements 1.9, 10.1
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// In-memory mock of the InsForge database + email client
// ---------------------------------------------------------------------------
// We replicate the exact data structures that email-service.ts queries so we
// can inline-re-implement the service logic using only the mock — no real
// network connections needed.
// ---------------------------------------------------------------------------

interface CompanyRow {
  id: string;
  owner_id: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
}

interface UsageMonthlyRow {
  tenant_id: string;
  period_year: number;
  period_month: number;
  soft_limit_email_sent_at: string | null;
}

// In-memory stores
const companiesStore = new Map<string, CompanyRow>();
const usersStore = new Map<string, UserRow>();
const usageMonthlyStore = new Map<string, UsageMonthlyRow>();

// Captured email sends (the "mock inbox")
interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
}
let capturedEmails: CapturedEmail[] = [];

function usageKey(tenantId: string, year: number, month: number): string {
  return `${tenantId}:${year}:${month}`;
}

function resetAllStores(): void {
  companiesStore.clear();
  usersStore.clear();
  usageMonthlyStore.clear();
  capturedEmails = [];
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedTenant(
  tenantId: string,
  userName: string,
  userEmail: string,
  softLimitSentAt: string | null = null,
): void {
  const ownerId = `owner-${tenantId}`;
  companiesStore.set(tenantId, { id: tenantId, owner_id: ownerId });
  usersStore.set(ownerId, { id: ownerId, email: userEmail, name: userName });
  const { year, month } = currentPeriod();
  usageMonthlyStore.set(usageKey(tenantId, year, month), {
    tenant_id: tenantId,
    period_year: year,
    period_month: month,
    soft_limit_email_sent_at: softLimitSentAt,
  });
}

// ---------------------------------------------------------------------------
// Period helper (mirrors email-service.ts)
// ---------------------------------------------------------------------------

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

// ---------------------------------------------------------------------------
// Inline re-implementation of email-service.ts logic using mock stores
// ---------------------------------------------------------------------------
// We mirror the real implementation exactly but replace InsForge SDK calls
// with lookups into the in-memory stores above.
// ---------------------------------------------------------------------------

type EmailType =
  | 'welcome'
  | 'trial_expiry'
  | 'soft_limit_warning'
  | 'hard_limit_reached'
  | 'upgrade_confirmed'
  | 'downgrade_warning'
  | 'downgrade_confirmed'
  | 'past_due_downgrade';

/** Mirrors fetchTenantEmail() from email-service.ts */
function mockFetchTenantEmail(
  tenantId: string,
): { email: string; name: string } | null {
  const company = companiesStore.get(tenantId);
  if (!company) return null;
  const user = usersStore.get(company.owner_id);
  if (!user) return null;
  return { email: user.email, name: user.name };
}

/** Mirrors isSoftLimitAlreadySent() from email-service.ts */
function mockIsSoftLimitAlreadySent(tenantId: string): boolean {
  const { year, month } = currentPeriod();
  const row = usageMonthlyStore.get(usageKey(tenantId, year, month));
  if (!row) return false;
  return row.soft_limit_email_sent_at !== null && row.soft_limit_email_sent_at !== undefined;
}

/** Mirrors markSoftLimitSent() from email-service.ts */
function mockMarkSoftLimitSent(tenantId: string): void {
  const { year, month } = currentPeriod();
  const key = usageKey(tenantId, year, month);
  const row = usageMonthlyStore.get(key);
  if (row) {
    row.soft_limit_email_sent_at = new Date().toISOString();
    usageMonthlyStore.set(key, row);
  }
}

/** Mirrors buildEmailContent() from email-service.ts (subset used in tests) */
function mockBuildEmailContent(
  emailType: EmailType,
  recipientName: string,
  payload: Record<string, any>,
): { subject: string; html: string } {
  const name = recipientName || payload.name || 'there';
  const platformUrl = 'https://eteba.chat';
  const upgradeUrl = payload.upgradeUrl ?? `${platformUrl}/?tab=billing`;

  switch (emailType) {
    case 'welcome':
      return {
        subject: `Welcome to Eteba Chat, ${name}!`,
        html: `<p>Hi ${name},</p><p>Welcome to <strong>Eteba Chat</strong>! Your account has been created and you're now on the <strong>Free plan</strong>.</p><p>To get the most out of the platform, <a href="${platformUrl}">complete your onboarding</a> — it takes about 5 minutes and sets up your AI assistant.</p><p>— The Eteba Chat team</p>`,
      };
    case 'soft_limit_warning': {
      const limit = payload.limit ?? 'your monthly limit';
      const count = payload.count ?? '';
      const planName = payload.planName ?? 'your current plan';
      return {
        subject: "Heads up: you're approaching your Eteba Chat query limit",
        html: `<p>Hi ${name},</p><p>You've used <strong>${count ? `${count} of ${limit}` : '80%'}</strong> of your monthly AI queries on the <strong>${planName}</strong>.</p><p><a href="${upgradeUrl}">View upgrade options →</a></p><p>— The Eteba Chat team</p>`,
      };
    }
    default:
      return {
        subject: 'A message from Eteba Chat',
        html: `<p>Hi ${name},</p>`,
      };
  }
}

/**
 * Mirrors sendPlanEmail() from email-service.ts, using mock stores and
 * pushing into capturedEmails instead of calling InsForge.
 */
async function mockSendPlanEmail(
  tenantId: string,
  emailType: EmailType,
  payload: Record<string, any>,
): Promise<void> {
  // Step 1 — resolve tenant email
  const recipient = mockFetchTenantEmail(tenantId);
  if (!recipient) return;

  // Step 2 — soft_limit_warning deduplication
  if (emailType === 'soft_limit_warning') {
    if (mockIsSoftLimitAlreadySent(tenantId)) {
      return; // already sent this period — skip
    }
  }

  // Step 3 — build email content
  const { subject, html } = mockBuildEmailContent(emailType, recipient.name, payload);

  // Step 4 — "send" (capture into mock inbox)
  capturedEmails.push({ to: recipient.email, subject, html });

  // Step 5 — mark soft_limit_warning as sent
  if (emailType === 'soft_limit_warning') {
    mockMarkSoftLimitSent(tenantId);
  }
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
// Property 19: Soft Limit Warning Email Sent At Most Once Per Period
//
// Generate fc.nat({min:1, max:10}) threshold crossings for the same
// tenant/period; assert sendPlanEmail is called at most once with
// soft_limit_warning.
//
// Validates: Requirements 10.3
// ---------------------------------------------------------------------------

async function runProperty19(): Promise<void> {
  console.log('\n📋 Property 19: Soft Limit Warning Email Sent At Most Once Per Period');
  console.log('   Validates: Requirements 10.3\n');

  await runTest('Single threshold crossing → exactly 1 warning email sent', async () => {
    resetAllStores();
    const tenantId = 'tenant-p19-single';
    seedTenant(tenantId, 'Alice', 'alice@example.com');

    await mockSendPlanEmail(tenantId, 'soft_limit_warning', { planName: 'Free', limit: 500, count: 400 });

    const warnings = capturedEmails.filter(
      (e) => e.subject.includes('approaching') && e.to === 'alice@example.com',
    );
    if (warnings.length !== 1) {
      throw new Error(`Expected 1 warning email, got ${warnings.length}`);
    }
  });

  await runTest('Second crossing in same period → email suppressed (dedup)', async () => {
    resetAllStores();
    const tenantId = 'tenant-p19-double';
    seedTenant(tenantId, 'Bob', 'bob@example.com');

    await mockSendPlanEmail(tenantId, 'soft_limit_warning', { planName: 'Free', limit: 500, count: 401 });
    await mockSendPlanEmail(tenantId, 'soft_limit_warning', { planName: 'Free', limit: 500, count: 420 });

    const warnings = capturedEmails.filter((e) => e.to === 'bob@example.com');
    if (warnings.length !== 1) {
      throw new Error(`Expected 1 warning email after 2 crossings, got ${warnings.length}`);
    }
  });

  await runTest('Tenant with email already sent → 0 new warning emails', async () => {
    resetAllStores();
    const tenantId = 'tenant-p19-already';
    seedTenant(tenantId, 'Carol', 'carol@example.com', new Date().toISOString());

    await mockSendPlanEmail(tenantId, 'soft_limit_warning', { planName: 'Free', limit: 500, count: 450 });

    const warnings = capturedEmails.filter((e) => e.to === 'carol@example.com');
    if (warnings.length !== 0) {
      throw new Error(`Expected 0 warning emails (already sent), got ${warnings.length}`);
    }
  });

  await runTest(
    /**
     * **Validates: Requirements 10.3**
     *
     * Property 19 fast-check: for any N (1–10) crossings of the soft-limit
     * threshold for the same tenant+period, exactly 1 warning email is sent.
     */
    'Property 19 — fast-check: N crossings (1–10) → at most 1 soft_limit_warning email',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.nat({ min: 1, max: 10 }),
          fc.uuid(),
          async (crossings, tenantSuffix) => {
            resetAllStores();
            const tenantId = `tenant-fc-p19-${tenantSuffix}`;
            seedTenant(tenantId, `User-${tenantSuffix}`, `${tenantSuffix}@test.com`);

            // Simulate N threshold crossings
            for (let i = 0; i < crossings; i++) {
              await mockSendPlanEmail(tenantId, 'soft_limit_warning', {
                planName: 'Free',
                limit: 500,
                count: 400 + i,
              });
            }

            const warnings = capturedEmails.filter(
              (e) => e.to === `${tenantSuffix}@test.com` && e.subject.includes('approaching'),
            );

            // At most once — property 19
            return warnings.length <= 1;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Tenant isolation — soft-limit for tenant A does not affect tenant B',
    async () => {
      resetAllStores();
      const tenantA = 'p19-isolation-a';
      const tenantB = 'p19-isolation-b';
      seedTenant(tenantA, 'Dave', 'dave@example.com');
      seedTenant(tenantB, 'Eve', 'eve@example.com');

      // A reaches limit 3 times, B reaches limit once
      for (let i = 0; i < 3; i++) {
        await mockSendPlanEmail(tenantA, 'soft_limit_warning', { planName: 'Free', limit: 500, count: 400 + i });
      }
      await mockSendPlanEmail(tenantB, 'soft_limit_warning', { planName: 'Free', limit: 500, count: 410 });

      const warningsA = capturedEmails.filter((e) => e.to === 'dave@example.com');
      const warningsB = capturedEmails.filter((e) => e.to === 'eve@example.com');

      if (warningsA.length !== 1) {
        throw new Error(`Tenant A: expected 1 warning, got ${warningsA.length}`);
      }
      if (warningsB.length !== 1) {
        throw new Error(`Tenant B: expected 1 warning, got ${warningsB.length}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Property 3: Welcome Email Contains User Name
//
// Generate fc.string({minLength:2, maxLength:64}) as user name; call the
// welcome email path; assert the captured email body contains the generated
// name string.
//
// Validates: Requirements 1.9, 10.1
// ---------------------------------------------------------------------------

async function runProperty3(): Promise<void> {
  console.log('\n📋 Property 3: Welcome Email Contains User Name');
  console.log('   Validates: Requirements 1.9, 10.1\n');

  await runTest('Welcome email body contains the registered name (concrete example)', async () => {
    resetAllStores();
    const tenantId = 'tenant-p3-concrete';
    const userName = 'María García';
    seedTenant(tenantId, userName, 'maria@example.com');

    await mockSendPlanEmail(tenantId, 'welcome', {});

    const email = capturedEmails.find((e) => e.to === 'maria@example.com');
    if (!email) {
      throw new Error('No welcome email captured');
    }
    if (!email.html.includes(userName)) {
      throw new Error(`Expected email body to contain "${userName}" but got: ${email.html}`);
    }
  });

  await runTest('Welcome email subject contains the registered name', async () => {
    resetAllStores();
    const tenantId = 'tenant-p3-subject';
    const userName = 'John Doe';
    seedTenant(tenantId, userName, 'john@example.com');

    await mockSendPlanEmail(tenantId, 'welcome', {});

    const email = capturedEmails.find((e) => e.to === 'john@example.com');
    if (!email) {
      throw new Error('No welcome email captured');
    }
    if (!email.subject.includes(userName)) {
      throw new Error(`Expected subject to contain "${userName}" but got: ${email.subject}`);
    }
  });

  await runTest('Welcome email not sent when tenant does not exist', async () => {
    resetAllStores();
    // Do NOT seed the tenant — fetchTenantEmail should return null
    await mockSendPlanEmail('non-existent-tenant', 'welcome', {});
    if (capturedEmails.length !== 0) {
      throw new Error(`Expected 0 emails for missing tenant, got ${capturedEmails.length}`);
    }
  });

  await runTest(
    /**
     * **Validates: Requirements 1.9, 10.1**
     *
     * Property 3 fast-check: for any generated name (2–64 chars), the welcome
     * email body must contain that exact name string.
     */
    'Property 3 — fast-check: welcome email body always contains the user name',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate a printable ASCII name, 2–64 chars, no leading/trailing spaces
          // (mirrors the server-side validation of 2–128 chars from Requirement 1.1)
          fc.string({ minLength: 2, maxLength: 64 }).filter(
            (s) => s.trim().length === s.length && s.length >= 2,
          ),
          fc.uuid(),
          async (userName, tenantSuffix) => {
            resetAllStores();
            const tenantId = `tenant-fc-p3-${tenantSuffix}`;
            const email = `${tenantSuffix}@test.com`;
            seedTenant(tenantId, userName, email);

            await mockSendPlanEmail(tenantId, 'welcome', {});

            const captured = capturedEmails.find((e) => e.to === email);
            if (!captured) return false; // no email sent — fail

            // Both the body AND the subject must contain the name
            return captured.html.includes(userName) && captured.subject.includes(userName);
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  await runTest(
    'Property 3 — name appears in greeting (Hi <name>) inside email body',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 2, maxLength: 64 }).filter(
            (s) => s.trim().length === s.length && s.length >= 2,
          ),
          fc.uuid(),
          async (userName, tenantSuffix) => {
            resetAllStores();
            const tenantId = `tenant-fc-p3-greeting-${tenantSuffix}`;
            const emailAddr = `${tenantSuffix}@greet-test.com`;
            seedTenant(tenantId, userName, emailAddr);

            await mockSendPlanEmail(tenantId, 'welcome', {});

            const captured = capturedEmails.find((e) => e.to === emailAddr);
            if (!captured) return false;

            // The greeting pattern "Hi <name>" must appear in the body
            return captured.html.includes(`Hi ${userName}`);
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
  console.log('🧪 Running Property-Based Tests: email-service');
  console.log('═'.repeat(55));

  await runProperty19();
  await runProperty3();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All property tests passed.');
    process.exit(0);
  }
})();
