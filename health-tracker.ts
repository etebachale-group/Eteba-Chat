// ============================================================
// Health Tracker Module
// Tracks consecutive proxy failures per tenant and triggers
// status updates via an injectable callback (avoids circular
// dependency with connector-registry).
// ============================================================

/**
 * Callback invoked when a tenant's connector status must be persisted.
 *
 * @param tenantId  - The tenant whose connector changed status.
 * @param status    - New status: 'active' or 'error'.
 * @param error     - Last error message (only present when status is 'error').
 */
export type StatusChangeCallback = (
  tenantId: string,
  status: 'active' | 'error',
  error?: string
) => Promise<void>;

export class HealthTracker {
  private failureCounts: Map<string, number> = new Map();
  private readonly THRESHOLD = 3;

  // Injectable callback — wired up from server.ts or connector-registry.ts
  // to avoid circular imports.
  private onStatusChange: StatusChangeCallback | null = null;

  /**
   * Register the callback that persists status changes to the database.
   * Call this once during application startup.
   */
  setStatusChangeCallback(callback: StatusChangeCallback): void {
    this.onStatusChange = callback;
  }

  /**
   * Record a successful proxy response for a tenant.
   * Resets the in-memory consecutive failure count to 0.
   * Does NOT write to the database — status stays wherever it was.
   */
  recordSuccess(tenantId: string): void {
    this.failureCounts.set(tenantId, 0);
  }

  /**
   * Record a failed proxy call for a tenant.
   * Increments the consecutive failure count. When the count reaches
   * the threshold (3), the registered `onStatusChange` callback is
   * invoked to mark the connector as "error" in the database.
   *
   * Requirements: 10.1, 10.2
   */
  async recordFailure(tenantId: string, error: string): Promise<void> {
    const current = this.failureCounts.get(tenantId) ?? 0;
    const next = current + 1;
    this.failureCounts.set(tenantId, next);

    if (next >= this.THRESHOLD && this.onStatusChange) {
      await this.onStatusChange(tenantId, 'error', error);
    }
  }

  /**
   * Reset a tenant's health status back to "active".
   * Clears the in-memory failure count and calls the registered
   * callback to persist status='active' with failure_count=0 in DB.
   *
   * Called after a successful manual "Test Connection".
   * Requirements: 10.3
   */
  async resetStatus(tenantId: string): Promise<void> {
    this.failureCounts.set(tenantId, 0);

    if (this.onStatusChange) {
      await this.onStatusChange(tenantId, 'active');
    }
  }

  /**
   * Returns the current computed status based on the in-memory
   * failure count. Does not hit the database.
   *
   * @returns 'error' if consecutive failures >= threshold, else 'active'.
   */
  getStatus(tenantId: string): 'active' | 'error' {
    const count = this.failureCounts.get(tenantId) ?? 0;
    return count >= this.THRESHOLD ? 'error' : 'active';
  }

  /**
   * Returns the raw consecutive failure count for a tenant (useful for tests).
   */
  getFailureCount(tenantId: string): number {
    return this.failureCounts.get(tenantId) ?? 0;
  }
}

// Singleton — imported by router.ts and wired up in server.ts
export const healthTracker = new HealthTracker();
