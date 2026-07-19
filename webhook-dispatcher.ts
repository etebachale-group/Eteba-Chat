import { createClient } from '@insforge/sdk';
import { WebhookEndpoint, DeliveryLog, WebhookPayload, DeliveryResult, EventType, RETRY_DELAYS } from './webhook-types.js';
import { signPayload } from './webhook-signing.js';
import { truncateBody } from './webhook-validation.js';
import crypto from 'crypto';

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: (process.env.INSFORGE_SERVICE_KEY ?? process.env.INSFORGE_API_KEY)!,
});

// Map to keep track of active retry timeouts per endpoint
const activeTimeouts = new Map<string, Set<NodeJS.Timeout>>();

function registerTimeout(endpointId: string, timeout: NodeJS.Timeout) {
  if (!activeTimeouts.has(endpointId)) {
    activeTimeouts.set(endpointId, new Set());
  }
  activeTimeouts.get(endpointId)!.add(timeout);
}

function clearRegisteredTimeout(endpointId: string, timeout: NodeJS.Timeout) {
  const timeouts = activeTimeouts.get(endpointId);
  if (timeouts) {
    timeouts.delete(timeout);
    if (timeouts.size === 0) {
      activeTimeouts.delete(endpointId);
    }
  }
}

/**
 * Cancels all pending retry timeouts for a specific endpoint.
 */
export function cancelPendingRetries(endpointId: string) {
  const timeouts = activeTimeouts.get(endpointId);
  if (timeouts) {
    for (const t of timeouts) {
      clearTimeout(t);
    }
    activeTimeouts.delete(endpointId);
  }
}

/**
 * Emits a webhook event to all subscribed and active endpoints for a tenant.
 * Fire-and-forget: returns immediately and handles delivery in background.
 */
export async function emitEvent(tenantId: string, eventType: EventType, data: any): Promise<void> {
  try {
    // 1. Fetch active endpoints for the tenant
    const { data: endpoints, error } = await insforge.database
      .from('webhook_endpoints')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (error || !endpoints) {
      console.error('[Webhook Dispatcher] Error fetching endpoints:', error);
      return;
    }

    // 2. Filter endpoints subscribed to this event type
    const subscribedEndpoints = endpoints.filter((ep: WebhookEndpoint) => 
      ep.events && Array.isArray(ep.events) && ep.events.includes(eventType)
    );

    if (subscribedEndpoints.length === 0) return;

    // 3. Dispatch to all matching endpoints in parallel (fire-and-forget)
    subscribedEndpoints.forEach((ep: WebhookEndpoint) => {
      const payload: WebhookPayload = {
        id: crypto.randomUUID(),
        event: eventType,
        timestamp: new Date().toISOString(),
        tenant_id: tenantId,
        data,
      };
      deliverToEndpoint(ep, payload, 1, null, false).catch((err) => {
        console.error(`[Webhook Dispatcher] Background delivery error for endpoint ${ep.id}:`, err);
      });
    });
  } catch (err) {
    console.error('[Webhook Dispatcher] emitEvent top-level error:', err);
  }
}

/**
 * Performs actual HTTP request delivery, logs the attempt, and handles retry/consecutive failure updates.
 */
export async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  payload: WebhookPayload,
  attemptNumber: number,
  parentDeliveryId: string | null = null,
  isTest: boolean = false
): Promise<DeliveryResult> {
  const timestamp = Math.round(Date.now() / 1000);
  const payloadJson = JSON.stringify(payload);
  const endpointId = endpoint.id;
  const tenantId = endpoint.tenant_id;
  const eventType = payload.event;

  // Insert base log row (returns the ID we need to link retries)
  const logId = crypto.randomUUID();

  // If secret is missing, fail immediately
  if (!endpoint.signing_secret) {
    const errorMsg = 'Missing signing secret';
    await recordDeliveryLog({
      id: logId,
      endpoint_id: endpointId,
      tenant_id: tenantId,
      event_type: eventType,
      payload,
      status: 'failed',
      status_code: null,
      response_body: errorMsg,
      attempt_number: attemptNumber,
      parent_delivery_id: parentDeliveryId,
      is_test: isTest
    });
    return { success: false, error: errorMsg };
  }

  const signature = signPayload(payloadJson, endpoint.signing_secret, timestamp);

  let result: DeliveryResult;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Eteba-Signature': signature,
        'X-Eteba-Timestamp': String(timestamp),
      },
      body: payloadJson,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const status = response.status;
    const bodyText = await response.text();
    const truncatedBody = truncateBody(bodyText, 1024);

    if (response.ok) {
      result = { success: true, statusCode: status, responseBody: truncatedBody };
    } else {
      result = { success: false, statusCode: status, responseBody: truncatedBody, error: `HTTP ${status}` };
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    let errMsg = err.message || 'Fetch error';
    if (err.name === 'AbortError') {
      errMsg = 'Request timeout (10s exceeded)';
    }
    result = { success: false, statusCode: null, responseBody: null, error: errMsg };
  }

  // Determine delivery status
  const statusOutcome = result.success ? 'delivered' : 'failed';
  const finalStatus = (statusOutcome === 'failed' && attemptNumber >= 4) ? 'permanently_failed' : statusOutcome;

  // Save delivery log to database
  await recordDeliveryLog({
    id: logId,
    endpoint_id: endpointId,
    tenant_id: tenantId,
    event_type: eventType,
    payload,
    status: finalStatus as any,
    status_code: result.statusCode,
    response_body: result.responseBody || result.error || null,
    attempt_number: attemptNumber,
    parent_delivery_id: parentDeliveryId,
    is_test: isTest
  });

  // Update endpoint status and failures (not for test pings)
  if (!isTest) {
    if (result.success) {
      await resetConsecutiveFailures(endpointId);
    } else {
      await incrementConsecutiveFailures(endpointId, result.error || 'Failed attempt');
    }
  }

  // Handle retry scheduling if failed and not test and attempts remaining
  if (!result.success && !isTest && attemptNumber < 4) {
    scheduleRetry(logId, endpoint, payload, attemptNumber);
  }

  return result;
}

/**
 * Inserts a log into the delivery_logs table.
 */
async function recordDeliveryLog(log: DeliveryLog): Promise<void> {
  try {
    const { error } = await insforge.database
      .from('delivery_logs')
      .insert([log]);
    if (error) {
      console.error('[Webhook Dispatcher] Error writing delivery log:', error);
    }
  } catch (err) {
    console.error('[Webhook Dispatcher] recordDeliveryLog error:', err);
  }
}

/**
 * Resets consecutive failures to 0.
 */
async function resetConsecutiveFailures(endpointId: string): Promise<void> {
  try {
    await insforge.database
      .from('webhook_endpoints')
      .update({ consecutive_failures: 0, updated_at: new Date().toISOString() })
      .eq('id', endpointId);
  } catch (err) {
    console.error('[Webhook Dispatcher] Error resetting failures:', err);
  }
}

/**
 * Increments consecutive failures. If they reach 50, deactivates the endpoint.
 */
async function incrementConsecutiveFailures(endpointId: string, lastError: string): Promise<void> {
  try {
    // Read current count
    const { data: endpoint } = await insforge.database
      .from('webhook_endpoints')
      .select('consecutive_failures, is_active')
      .eq('id', endpointId)
      .maybeSingle();

    if (!endpoint) return;

    const newFailures = endpoint.consecutive_failures + 1;
    const updates: any = {
      consecutive_failures: newFailures,
      updated_at: new Date().toISOString(),
    };

    if (newFailures >= 50 && endpoint.is_active) {
      updates.is_active = false;
      cancelPendingRetries(endpointId);
      console.warn(`[Webhook Dispatcher] Endpoint ${endpointId} deactivated automatically due to 50 consecutive failures.`);
    }

    await insforge.database
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', endpointId);
  } catch (err) {
    console.error('[Webhook Dispatcher] Error incrementing failures:', err);
  }
}

/**
 * Schedules a retry delivery with exponential backoff.
 */
function scheduleRetry(
  originalLogId: string,
  endpoint: WebhookEndpoint,
  payload: WebhookPayload,
  currentAttempt: number
) {
  const retryIdx = currentAttempt - 1; // 1st retry (attempt 2) -> index 0 (30s)
  const delaySec = RETRY_DELAYS[retryIdx] || 1800;
  const endpointId = endpoint.id;

  const t = setTimeout(async () => {
    clearRegisteredTimeout(endpointId, t);
    
    // Check if endpoint is still active before running the retry
    try {
      const { data: ep } = await insforge.database
        .from('webhook_endpoints')
        .select('is_active')
        .eq('id', endpointId)
        .maybeSingle();

      if (ep && ep.is_active) {
        // Run retry delivery
        await deliverToEndpoint(endpoint, payload, currentAttempt + 1, originalLogId, false);
      }
    } catch (err) {
      console.error('[Webhook Dispatcher] Retry check failed:', err);
    }
  }, delaySec * 1000);

  registerTimeout(endpointId, t);
}

/**
 * Daily cleanup job to delete delivery logs older than 30 days.
 */
export async function runDeliveryLogsCleanup(): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const { error } = await insforge.database
      .from('delivery_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      console.error('[Webhook Dispatcher] Logs cleanup error:', error);
    } else {
      console.log(`[Webhook Dispatcher] Daily cleanup completed. Deleted logs older than ${cutoffDate.toISOString()}`);
    }
  } catch (err) {
    console.error('[Webhook Dispatcher] Logs cleanup exception:', err);
  }
}
