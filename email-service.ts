import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';

// ============================================================
// Email Service Module
// Sends plan-related email notifications to tenants with:
//   - Soft-limit warning deduplication (once per billing period)
//   - Retry logic: up to 3 attempts, exponential backoff (1s, 2s)
//   - Never throws to caller; logs all failures
//
// Requirements: 1.9, 10.1–10.7
// ============================================================

// --- Types ---

export type EmailType =
  | 'welcome'
  | 'trial_expiry'
  | 'soft_limit_warning'
  | 'hard_limit_reached'
  | 'upgrade_confirmed'
  | 'downgrade_warning'
  | 'downgrade_confirmed'
  | 'past_due_downgrade';

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
  soft_limit_email_sent_at: string | null;
}

// --- InsForge client (service-role key bypasses RLS) ---

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

// --- Period helpers ---

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

// --- Sleep helper for exponential backoff ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Looks up the tenant's email address.
 *
 * Flow:
 *   1. Fetch `companies` row where `id = tenantId` to get `owner_id`
 *   2. Fetch `users` row where `id = owner_id` to get the email
 *
 * Returns null if any row is missing (tenant/user not found).
 */
async function fetchTenantEmail(
  tenantId: string,
): Promise<{ email: string; name: string } | null> {
  // Step 1 — get the company to find the owner
  const { data: company, error: companyError } = await insforge.database
    .from('companies')
    .select('id, owner_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (companyError) {
    throw new Error(
      `email-service: failed to fetch company for tenant ${tenantId}: ${
        (companyError as any).message ?? String(companyError)
      }`,
    );
  }

  if (!company) {
    return null;
  }

  const { owner_id } = company as CompanyRow;

  // Step 2 — get the owner's email from users
  const { data: user, error: userError } = await insforge.database
    .from('users')
    .select('id, email, name')
    .eq('id', owner_id)
    .maybeSingle();

  if (userError) {
    throw new Error(
      `email-service: failed to fetch user ${owner_id} for tenant ${tenantId}: ${
        (userError as any).message ?? String(userError)
      }`,
    );
  }

  if (!user) {
    return null;
  }

  const u = user as UserRow;
  return { email: u.email, name: u.name };
}

/**
 * Checks whether a soft_limit_warning email has already been sent this
 * billing period for the given tenant. Returns true if we should skip.
 *
 * Requirements: 10.3, Property 19
 */
async function isSoftLimitAlreadySent(tenantId: string): Promise<boolean> {
  const { year, month } = currentPeriod();

  const { data: row, error } = await insforge.database
    .from('usage_monthly')
    .select('soft_limit_email_sent_at')
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', month)
    .maybeSingle();

  if (error) {
    // If we cannot determine, err on the side of not sending to avoid duplicates
    console.error(
      `email-service: failed to check soft_limit_email_sent_at for tenant ${tenantId}:`,
      (error as any).message ?? String(error),
    );
    return true;
  }

  if (!row) {
    // No usage row means no email sent yet
    return false;
  }

  const r = row as UsageMonthlyRow;
  return r.soft_limit_email_sent_at !== null && r.soft_limit_email_sent_at !== undefined;
}

/**
 * Marks the soft_limit_warning as sent for the current billing period by
 * setting `soft_limit_email_sent_at = now()` on the usage_monthly row.
 *
 * Requirements: 10.3, Property 19
 */
async function markSoftLimitSent(tenantId: string): Promise<void> {
  const { year, month } = currentPeriod();

  const { error } = await insforge.database
    .from('usage_monthly')
    .update({ soft_limit_email_sent_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', month);

  if (error) {
    console.error(
      `email-service: failed to mark soft_limit_email_sent_at for tenant ${tenantId}:`,
      (error as any).message ?? String(error),
    );
  }
}

// ============================================================
// Email content builder
// ============================================================

interface EmailContent {
  subject: string;
  html: string;
}

/**
 * Builds the subject line and HTML body for each email type.
 * The `payload` carries runtime context (name, plan names, limits, dates, etc.)
 * supplied by the caller.
 */
function buildEmailContent(
  emailType: EmailType,
  recipientName: string,
  payload: Record<string, any>,
): EmailContent {
  const name = recipientName || payload.name || 'there';
  const platformUrl = process.env.PLATFORM_URL ?? 'https://eteba.chat';
  const upgradeUrl = payload.upgradeUrl ?? `${platformUrl}/?tab=billing`;

  switch (emailType) {
    // --- Welcome (Requirement 10.1, 1.9) ---
    case 'welcome':
      return {
        subject: `Welcome to Eteba Chat, ${name}!`,
        html: `
<p>Hi ${name},</p>
<p>Welcome to <strong>Eteba Chat</strong>! Your account has been created and you're now on the <strong>Free plan</strong>.</p>
<p>To get the most out of the platform, <a href="${platformUrl}">complete your onboarding</a> — it takes about 5 minutes and sets up your AI assistant.</p>
<p>Your initial plan:<br>
  • 500 AI queries / month<br>
  • 50 products in catalog<br>
  • 1 data connector
</p>
<p><a href="${platformUrl}">Start your setup →</a></p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };

    // --- Trial expiry (Requirement 10.2) ---
    case 'trial_expiry':
      return {
        subject: 'Your Eteba Chat trial has ended — you\'ve been moved to Free',
        html: `
<p>Hi ${name},</p>
<p>Your 14-day Business trial has ended. Your account has been moved back to the <strong>Free plan</strong>.</p>
<p>Features you no longer have access to:<br>
  • 15,000 queries/month (now 500)<br>
  • 5,000 products (now 50)<br>
  • 3 connectors (now 1)<br>
  • 10 API keys (now 0)<br>
  • Priority support &amp; analytics dashboard
</p>
<p>Ready to keep the full experience? <a href="${upgradeUrl}">Upgrade your plan →</a></p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };

    // --- Soft limit warning 80% (Requirement 10.3) ---
    case 'soft_limit_warning': {
      const limit = payload.limit ?? 'your monthly limit';
      const count = payload.count ?? '';
      const planName = payload.planName ?? 'your current plan';
      return {
        subject: 'Heads up: you\'re approaching your Eteba Chat query limit',
        html: `
<p>Hi ${name},</p>
<p>You've used <strong>${count ? `${count} of ${limit}` : '80%'}</strong> of your monthly AI queries on the <strong>${planName}</strong>.</p>
<p>When you reach 100% your queries will be paused until the next billing period — or you can upgrade now to avoid any interruption.</p>
<p><a href="${upgradeUrl}">View upgrade options →</a></p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };
    }

    // --- Hard limit reached 100% (Requirement 10.4) ---
    case 'hard_limit_reached': {
      const limit = payload.limit ?? 'your monthly limit';
      const planName = payload.planName ?? 'your current plan';
      return {
        subject: 'Your Eteba Chat queries are paused — monthly limit reached',
        html: `
<p>Hi ${name},</p>
<p>You've reached your limit of <strong>${limit} queries/month</strong> on the <strong>${planName}</strong>. New AI queries are currently paused.</p>
<p>Your limit resets at the start of next month. To resume immediately, upgrade your plan.</p>
<p><a href="${upgradeUrl}">Upgrade now →</a></p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };
    }

    // --- Upgrade confirmed (Requirement 10.5) ---
    case 'upgrade_confirmed': {
      const newPlan = payload.newPlanName ?? payload.newPlanId ?? 'your new plan';
      const effectiveDate = payload.effectiveDate
        ? new Date(payload.effectiveDate).toLocaleDateString('en-US', { dateStyle: 'long' })
        : 'today';
      const periodEnd = payload.periodEnd
        ? new Date(payload.periodEnd).toLocaleDateString('en-US', { dateStyle: 'long' })
        : '';
      return {
        subject: `Your Eteba Chat plan has been upgraded to ${newPlan}`,
        html: `
<p>Hi ${name},</p>
<p>Your plan has been upgraded to <strong>${newPlan}</strong>, effective <strong>${effectiveDate}</strong>.</p>
${payload.limits ? `<p>Your new limits:<br>${payload.limits}</p>` : ''}
${periodEnd ? `<p>Your next billing period ends on <strong>${periodEnd}</strong>.</p>` : ''}
<p><a href="${platformUrl}">Go to your dashboard →</a></p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };
    }

    // --- Downgrade warning 3 days before (Requirement 10.6) ---
    case 'downgrade_warning': {
      const oldPlan = payload.oldPlanName ?? payload.oldPlanId ?? 'your current plan';
      const newPlan = payload.newPlanName ?? payload.newPlanId ?? 'a lower plan';
      const effectiveDate = payload.effectiveDate
        ? new Date(payload.effectiveDate).toLocaleDateString('en-US', { dateStyle: 'long' })
        : 'in 3 days';
      return {
        subject: `Your Eteba Chat plan will change to ${newPlan} on ${effectiveDate}`,
        html: `
<p>Hi ${name},</p>
<p>This is a reminder that your plan is scheduled to change from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong> on <strong>${effectiveDate}</strong>.</p>
<p>If you'd like to stay on your current plan, you can cancel the scheduled change in your <a href="${upgradeUrl}">billing settings</a>.</p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };
    }

    // --- Downgrade confirmed (Requirement 10.6) ---
    case 'downgrade_confirmed': {
      const newPlan = payload.newPlanName ?? payload.newPlanId ?? 'Free';
      const effectiveDate = payload.effectiveDate
        ? new Date(payload.effectiveDate).toLocaleDateString('en-US', { dateStyle: 'long' })
        : 'today';
      return {
        subject: `Your Eteba Chat plan has been changed to ${newPlan}`,
        html: `
<p>Hi ${name},</p>
<p>Your plan has been changed to <strong>${newPlan}</strong> effective <strong>${effectiveDate}</strong>.</p>
<p>You can upgrade again at any time from your <a href="${upgradeUrl}">billing settings</a>.</p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };
    }

    // --- Past-due downgrade (Requirement 7.6) ---
    case 'past_due_downgrade':
      return {
        subject: 'Your Eteba Chat account has been moved to Free (past due)',
        html: `
<p>Hi ${name},</p>
<p>Because your account has been past due for more than 7 days, your subscription has been moved to the <strong>Free plan</strong>.</p>
<p>To restore your previous plan, please update your payment method and re-upgrade from your <a href="${upgradeUrl}">billing settings</a>.</p>
<p>— The Eteba Chat team</p>
        `.trim(),
      };

    default: {
      // Exhaustiveness guard — TypeScript narrows to never here
      const _exhaustive: never = emailType;
      return {
        subject: 'A message from Eteba Chat',
        html: `<p>Hi ${name},</p><p>Please visit your <a href="${platformUrl}">dashboard</a> for updates.</p>`,
      };
    }
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Sends a plan-related email notification to the tenant owner.
 *
 * Behaviour:
 *   1. Fetches the tenant's email from `users` (via `companies.owner_id`).
 *   2. For `soft_limit_warning`: checks `usage_monthly.soft_limit_email_sent_at` for the
 *      current period — skips if already sent (deduplication per Requirement 10.3).
 *   3. Builds subject + HTML body from `emailType` and `payload`.
 *   4. Attempts `insforge.email.send(...)` up to 3 times (attempts 1, 2, 3) with
 *      exponential backoff: 1 s after attempt 1, 2 s after attempt 2.
 *   5. On success for `soft_limit_warning`: marks `soft_limit_email_sent_at = now()`.
 *   6. On all-attempts failure: logs `{tenantId, emailType, error, attempt}` — never throws.
 *
 * Requirements: 1.9, 10.1–10.7
 */
export async function sendPlanEmail(
  tenantId: string,
  emailType: EmailType,
  payload: Record<string, any>,
): Promise<void> {
  // --- Step 1: resolve tenant email ---
  let recipient: { email: string; name: string } | null = null;
  try {
    recipient = await fetchTenantEmail(tenantId);
  } catch (lookupError) {
    console.error('email-service: failed to resolve tenant email', {
      tenantId,
      emailType,
      error: (lookupError as any).message ?? String(lookupError),
    });
    return; // cannot send without an address — do not throw
  }

  if (!recipient) {
    console.error('email-service: tenant or owner user not found', { tenantId, emailType });
    return;
  }

  // --- Step 2: soft_limit_warning deduplication ---
  if (emailType === 'soft_limit_warning') {
    let alreadySent = false;
    try {
      alreadySent = await isSoftLimitAlreadySent(tenantId);
    } catch (dedupError) {
      // Err on the side of not sending rather than double-sending
      console.error('email-service: dedup check failed — skipping send to be safe', {
        tenantId,
        emailType,
        error: (dedupError as any).message ?? String(dedupError),
      });
      return;
    }

    if (alreadySent) {
      // Already sent for this period — skip silently per Requirement 10.3
      return;
    }
  }

  // --- Step 3: build email content ---
  const { subject, html } = buildEmailContent(emailType, recipient.name, payload);

  // --- Step 4: attempt send with retry (up to 3 attempts, backoff 1s / 2s) ---
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1000, 2000]; // delay after attempt 1, attempt 2

  let lastError: unknown = null;
  let sent = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await (insforge as any).email.send({
        to: recipient.email,
        subject,
        html,
      });
      sent = true;
      break; // success — exit retry loop
    } catch (sendError) {
      lastError = sendError;
      console.error('email-service: send attempt failed', {
        tenantId,
        emailType,
        error: (sendError as any).message ?? String(sendError),
        attempt,
      });

      if (attempt < MAX_ATTEMPTS) {
        const delayMs = BACKOFF_MS[attempt - 1] ?? 2000;
        await sleep(delayMs);
      }
    }
  }

  if (!sent) {
    // All 3 attempts exhausted — log final failure, do NOT throw
    console.error('email-service: all attempts exhausted, giving up', {
      tenantId,
      emailType,
      error: (lastError as any)?.message ?? String(lastError),
      attempt: MAX_ATTEMPTS,
    });
    return;
  }

  // --- Step 5: mark soft_limit_warning as sent for deduplication ---
  if (emailType === 'soft_limit_warning') {
    await markSoftLimitSent(tenantId);
  }
}
