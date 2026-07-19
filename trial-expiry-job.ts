import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';
import { sendPlanEmail } from './email-service.js';

// ============================================================
// Trial Expiry Job
// Background jobs that run on a schedule (every hour) to handle:
//   1. checkTrialExpirations   — downgrade expired trialing tenants to free
//   2. applyScheduledDowngrades — apply pending plan_id changes at period end
//   3. checkPastDueDowngrades  — downgrade past_due tenants after 7 days
//   4. sendDowngradeWarnings   — warn tenants 3 days before a scheduled downgrade
//
// The `now` parameter is injectable for deterministic testing without
// mocking system clocks. Defaults to () => new Date() when not provided.
//
// Requirements: 4.3, 7.3, 7.4, 7.6, 10.6
// ============================================================

// --- InsForge client (service-role key bypasses RLS) ---

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

// --- Row shapes ---

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  scheduled_plan_id: string | null;
  updated_at: string | null;
}

// ============================================================
// Helper — write a subscription_events audit entry
// ============================================================

async function writeJobAuditEntry(
  subscriptionId: string,
  eventType: string,
  oldPlanId: string,
  newPlanId: string,
  triggeredBy: string,
): Promise<void> {
  const { error } = await insforge.database
    .from('subscription_events')
    .insert([
      {
        subscription_id: subscriptionId,
        event_type: eventType,
        old_plan_id: oldPlanId,
        new_plan_id: newPlanId,
        triggered_by: triggeredBy,
        metadata: {},
      },
    ]);

  if (error) {
    console.error('trial-expiry-job: failed to write audit entry', {
      subscriptionId,
      eventType,
      error: (error as any).message ?? String(error),
    });
  }
}

// ============================================================
// 1. checkTrialExpirations
//    Query subscriptions WHERE status='trialing' AND trial_ends_at <= now()
//    For each expired trial:
//      a. Write audit entry (trial_expiry, triggered_by='trial_expiry')
//      b. UPDATE plan_id='free', status='active'
//      c. Send 'trial_expiry' email (fire-and-forget)
//
// Requirements: 4.3
// ============================================================

export async function checkTrialExpirations(now: () => Date = () => new Date()): Promise<void> {
  const nowIso = now().toISOString();

  const { data, error } = await insforge.database
    .from('subscriptions')
    .select('id, tenant_id, plan_id, status, trial_ends_at')
    .eq('status', 'trialing')
    .lte('trial_ends_at', nowIso);

  if (error) {
    console.error('trial-expiry-job: checkTrialExpirations — query failed', {
      error: (error as any).message ?? String(error),
    });
    return;
  }

  if (!data || (data as SubscriptionRow[]).length === 0) {
    return;
  }

  for (const row of data as SubscriptionRow[]) {
    // a. Write audit entry BEFORE mutating the subscription
    await writeJobAuditEntry(
      row.id,
      'trial_expiry',
      row.plan_id,
      'free',
      'trial_expiry',
    );

    // b. Downgrade subscription to free / active
    const { error: updateError } = await insforge.database
      .from('subscriptions')
      .update({
        plan_id: 'free',
        status: 'active',
        updated_at: now().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error('trial-expiry-job: checkTrialExpirations — update failed', {
        subscriptionId: row.id,
        tenantId: row.tenant_id,
        error: (updateError as any).message ?? String(updateError),
      });
      continue;
    }

    // c. Send trial_expiry email (fire-and-forget)
    sendPlanEmail(row.tenant_id, 'trial_expiry', {}).catch((err) => {
      console.error('trial-expiry-job: checkTrialExpirations — email failed', {
        tenantId: row.tenant_id,
        error: (err as any).message ?? String(err),
      });
    });
  }
}

// ============================================================
// 2. applyScheduledDowngrades
//    Query subscriptions WHERE scheduled_plan_id IS NOT NULL
//                          AND current_period_end <= now()
//    For each:
//      a. Write audit entry (downgrade, triggered_by='system')
//      b. Apply plan_id = scheduled_plan_id, clear scheduled_plan_id
//      c. Send 'downgrade_confirmed' email (fire-and-forget)
//
// Requirements: 7.3, 7.4, 10.6
// ============================================================

export async function applyScheduledDowngrades(now: () => Date = () => new Date()): Promise<void> {
  const nowIso = now().toISOString();

  const { data, error } = await insforge.database
    .from('subscriptions')
    .select('id, tenant_id, plan_id, scheduled_plan_id, current_period_end')
    .not('scheduled_plan_id', 'is', null)
    .lte('current_period_end', nowIso);

  if (error) {
    console.error('trial-expiry-job: applyScheduledDowngrades — query failed', {
      error: (error as any).message ?? String(error),
    });
    return;
  }

  if (!data || (data as SubscriptionRow[]).length === 0) {
    return;
  }

  for (const row of data as SubscriptionRow[]) {
    const newPlanId = row.scheduled_plan_id!;

    // a. Write audit entry BEFORE mutating the subscription
    await writeJobAuditEntry(
      row.id,
      'downgrade',
      row.plan_id,
      newPlanId,
      'system',
    );

    // b. Apply the scheduled downgrade and clear scheduled_plan_id
    const { error: updateError } = await insforge.database
      .from('subscriptions')
      .update({
        plan_id: newPlanId,
        scheduled_plan_id: null,
        status: 'active',
        updated_at: now().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error('trial-expiry-job: applyScheduledDowngrades — update failed', {
        subscriptionId: row.id,
        tenantId: row.tenant_id,
        error: (updateError as any).message ?? String(updateError),
      });
      continue;
    }

    // c. Send downgrade_confirmed email (fire-and-forget)
    sendPlanEmail(row.tenant_id, 'downgrade_confirmed', {
      newPlanId,
      effectiveDate: nowIso,
    }).catch((err) => {
      console.error('trial-expiry-job: applyScheduledDowngrades — email failed', {
        tenantId: row.tenant_id,
        error: (err as any).message ?? String(err),
      });
    });
  }
}

// ============================================================
// 3. checkPastDueDowngrades
//    Query subscriptions WHERE status='past_due'
//                          AND updated_at <= now() - 7 days
//    For each:
//      a. Write audit entry (past_due_downgrade, triggered_by='system')
//      b. UPDATE plan_id='free', status='active'
//      c. Send 'past_due_downgrade' email (fire-and-forget)
//
// Requirements: 7.6
// ============================================================

export async function checkPastDueDowngrades(now: () => Date = () => new Date()): Promise<void> {
  const sevenDaysAgo = new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await insforge.database
    .from('subscriptions')
    .select('id, tenant_id, plan_id, status, updated_at')
    .eq('status', 'past_due')
    .lte('updated_at', sevenDaysAgo);

  if (error) {
    console.error('trial-expiry-job: checkPastDueDowngrades — query failed', {
      error: (error as any).message ?? String(error),
    });
    return;
  }

  if (!data || (data as SubscriptionRow[]).length === 0) {
    return;
  }

  for (const row of data as SubscriptionRow[]) {
    // a. Write audit entry BEFORE mutating the subscription
    await writeJobAuditEntry(
      row.id,
      'past_due_downgrade',
      row.plan_id,
      'free',
      'system',
    );

    // b. Downgrade to free / active
    const { error: updateError } = await insforge.database
      .from('subscriptions')
      .update({
        plan_id: 'free',
        status: 'active',
        updated_at: now().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error('trial-expiry-job: checkPastDueDowngrades — update failed', {
        subscriptionId: row.id,
        tenantId: row.tenant_id,
        error: (updateError as any).message ?? String(updateError),
      });
      continue;
    }

    // c. Send past_due_downgrade email (fire-and-forget)
    sendPlanEmail(row.tenant_id, 'past_due_downgrade', {}).catch((err) => {
      console.error('trial-expiry-job: checkPastDueDowngrades — email failed', {
        tenantId: row.tenant_id,
        error: (err as any).message ?? String(err),
      });
    });
  }
}

// ============================================================
// 4. sendDowngradeWarnings
//    Query subscriptions WHERE scheduled_plan_id IS NOT NULL
//                          AND current_period_end <= now() + 3 days
//                          AND current_period_end >  now()
//    For each: send 'downgrade_warning' email (fire-and-forget)
//
// Requirements: 10.6
// ============================================================

export async function sendDowngradeWarnings(now: () => Date = () => new Date()): Promise<void> {
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const threeDaysFromNow = new Date(nowDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await insforge.database
    .from('subscriptions')
    .select('id, tenant_id, plan_id, scheduled_plan_id, current_period_end')
    .not('scheduled_plan_id', 'is', null)
    .lte('current_period_end', threeDaysFromNow)
    .gt('current_period_end', nowIso);

  if (error) {
    console.error('trial-expiry-job: sendDowngradeWarnings — query failed', {
      error: (error as any).message ?? String(error),
    });
    return;
  }

  if (!data || (data as SubscriptionRow[]).length === 0) {
    return;
  }

  for (const row of data as SubscriptionRow[]) {
    // Send downgrade_warning email (fire-and-forget)
    sendPlanEmail(row.tenant_id, 'downgrade_warning', {
      oldPlanId: row.plan_id,
      newPlanId: row.scheduled_plan_id,
      effectiveDate: row.current_period_end,
    }).catch((err) => {
      console.error('trial-expiry-job: sendDowngradeWarnings — email failed', {
        tenantId: row.tenant_id,
        error: (err as any).message ?? String(err),
      });
    });
  }
}
