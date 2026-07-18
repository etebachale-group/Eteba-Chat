// ============================================================
// Connector Cache Module
// In-memory cache with 5-minute TTL for connector configurations.
// Avoids per-request DB lookups while keeping changes responsive.
// Cache is evicted on CRUD operations.
// ============================================================

// --- Shared types ---

export type BusinessType = 'ecommerce' | 'appointments' | 'restaurant' | 'services' | 'general';

export interface ConnectorConfig {
  id: string;
  tenant_id: string;
  proxy_url: string;
  connector_token: string;
  business_type: BusinessType;
  display_name: string;
  enabled: boolean;
  status: 'active' | 'inactive' | 'error';
  last_error: string | null;
  last_error_at: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface CachedConnector {
  config: ConnectorConfig;
  cachedAt: number; // Unix timestamp in ms (Date.now())
}

// --- ConnectorCache class ---

class ConnectorCache {
  private cache: Map<string, CachedConnector>;
  private readonly TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor() {
    this.cache = new Map();
  }

  /**
   * Returns the cached ConnectorConfig for the given tenantId if it exists
   * and has not expired. Returns null (and evicts the entry) if expired or
   * not present.
   */
  get(tenantId: string): ConnectorConfig | null {
    const entry = this.cache.get(tenantId);

    if (entry === undefined) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(tenantId);
      return null;
    }

    return entry.config;
  }

  /**
   * Stores the ConnectorConfig for the given tenantId, stamped with the
   * current timestamp.
   */
  set(tenantId: string, config: ConnectorConfig): void {
    this.cache.set(tenantId, {
      config,
      cachedAt: Date.now(),
    });
  }

  /**
   * Removes the cache entry for the given tenantId immediately, regardless
   * of TTL. Should be called after any CRUD mutation to the connector.
   */
  evict(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /**
   * Returns true if the cached entry is older than the 5-minute TTL.
   */
  isExpired(entry: CachedConnector): boolean {
    return Date.now() - entry.cachedAt > this.TTL;
  }
}

// --- Singleton instance ---

export const connectorCache = new ConnectorCache();

// Named export of the class for testing and extension
export { ConnectorCache };
