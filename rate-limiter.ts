/**
 * RateLimiter — sliding window rate limiter per tenant.
 *
 * Allows at most 60 requests per 60-second window per tenant.
 * Implements Requirements 11.5 and 11.6.
 */
export class RateLimiter {
  private windows: Map<string, number[]>; // tenant -> request timestamps (ms)
  private readonly MAX_REQUESTS = 60;
  private readonly WINDOW_MS = 60 * 1000; // 1 minute

  constructor() {
    this.windows = new Map();
  }

  /**
   * Returns the current timestamp window for a tenant, creating it if needed.
   * Expired entries (older than WINDOW_MS) are pruned before returning.
   */
  private getWindow(tenantId: string): number[] {
    if (!this.windows.has(tenantId)) {
      this.windows.set(tenantId, []);
    }
    return this.windows.get(tenantId)!;
  }

  /**
   * Removes timestamps older than WINDOW_MS from a tenant's window.
   */
  private cleanExpired(tenantId: string): void {
    const cutoff = Date.now() - this.WINDOW_MS;
    const window = this.getWindow(tenantId);
    // Remove all timestamps that have fallen outside the sliding window
    const firstValid = window.findIndex((ts) => ts > cutoff);
    if (firstValid === -1) {
      window.length = 0;
    } else if (firstValid > 0) {
      window.splice(0, firstValid);
    }
  }

  /**
   * Checks whether a new request from `tenantId` is within the rate limit.
   * Cleans expired timestamps before checking.
   *
   * @returns true if the request is allowed (window < MAX_REQUESTS), false otherwise
   */
  isAllowed(tenantId: string): boolean {
    this.cleanExpired(tenantId);
    const window = this.getWindow(tenantId);
    return window.length < this.MAX_REQUESTS;
  }

  /**
   * Records a new request timestamp for `tenantId`.
   * Cleans expired timestamps before recording.
   */
  record(tenantId: string): void {
    this.cleanExpired(tenantId);
    const window = this.getWindow(tenantId);
    window.push(Date.now());
  }

  /**
   * Returns the number of seconds until the oldest request in the window
   * expires and a new request would be allowed.
   *
   * If the window is empty or under the limit, returns 0.
   */
  getRetryAfter(tenantId: string): number {
    const window = this.getWindow(tenantId);
    if (window.length === 0) return 0;

    // The oldest timestamp is at index 0 (window is maintained in insertion order,
    // and cleanExpired keeps it sorted ascending).
    const oldest = window[0];
    const secondsUntilExpiry = Math.ceil((oldest + this.WINDOW_MS - Date.now()) / 1000);
    return Math.max(0, secondsUntilExpiry);
  }
}

export const rateLimiter = new RateLimiter();
