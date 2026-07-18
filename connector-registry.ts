import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@insforge/sdk';
import {
  encryptToken,
  decryptToken,
  generateToken,
  maskToken,
} from './connector-encryption.js';
import { connectorCache, type ConnectorConfig, type BusinessType } from './connector-cache.js';

// ============================================================
// Connector Registry Module
// CRUD operations for tenant connector configurations.
// Tokens are stored encrypted; masked on public reads; decrypted
// only for internal proxy dispatch (getConnectorRaw).
// ============================================================

// --- InsForge client ---

const insforge = createClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  anonKey: process.env.INSFORGE_API_KEY!,
});

// --- Input interfaces ---

export interface ConnectorCreateInput {
  proxy_url: string;
  connector_token?: string; // Auto-generated if not provided
  business_type: BusinessType;
  display_name: string;
}

export interface ConnectorUpdateInput {
  proxy_url?: string;
  connector_token?: string;
  business_type?: BusinessType;
  display_name?: string;
  enabled?: boolean;
}

// --- Typed error objects ---

interface ConnectorError {
  status: number;
  message: string;
  missingFields?: string[];
}

// --- Validation helpers ---

const VALID_BUSINESS_TYPES = new Set<BusinessType>([
  'ecommerce',
  'appointments',
  'restaurant',
  'services',
  'general',
]);

/**
 * Validates a proxy_url value.
 * Must start with "https://", be a valid URL, and be ≤2048 characters.
 * Returns null on success, or throws a ConnectorError on failure.
 */
function validateProxyUrl(url: string): void {
  if (!url.startsWith('https://') || url.length > 2048) {
    throw { status: 400, message: 'proxy_url must be a valid HTTPS URL' } as ConnectorError;
  }
  try {
    new URL(url);
  } catch {
    throw { status: 400, message: 'proxy_url must be a valid HTTPS URL' } as ConnectorError;
  }
}

/**
 * Validates required fields for connector creation.
 * Returns a list of missing field names; throws if any are missing.
 */
function validateRequiredFields(input: ConnectorCreateInput): void {
  const missing: string[] = [];

  if (!input.proxy_url || input.proxy_url.trim() === '') missing.push('proxy_url');
  if (!input.business_type || !VALID_BUSINESS_TYPES.has(input.business_type)) {
    // business_type presence check — invalid type is a 400 but not "missing"
    if (!input.business_type) missing.push('business_type');
  }
  if (!input.display_name || input.display_name.trim() === '') missing.push('display_name');

  if (missing.length > 0) {
    throw {
      status: 400,
      message: `Missing required fields: ${missing.join(', ')}`,
      missingFields: missing,
    } as ConnectorError;
  }
}

/**
 * Checks whether an InsForge error represents a unique-constraint violation.
 * InsForge / Postgres surfaces these as code '23505'.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return (
    e['code'] === '23505' ||
    (typeof e['message'] === 'string' &&
      (e['message'] as string).toLowerCase().includes('unique'))
  );
}

// --- DB row type (as stored in InsForge) ---

interface ConnectorRow {
  id: string;
  tenant_id: string;
  proxy_url: string;
  connector_token_encrypted: string;
  connector_token_iv: string;
  connector_token_tag: string;
  business_type: BusinessType;
  display_name: string;
  enabled: boolean;
  status: 'active' | 'inactive' | 'error';
  failure_count: number;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Maps a DB row to a ConnectorConfig with the token field set to the
 * masked value (public-facing).
 */
function rowToPublicConfig(row: ConnectorRow): ConnectorConfig {
  const plaintext = decryptToken({
    encrypted: row.connector_token_encrypted,
    iv: row.connector_token_iv,
    tag: row.connector_token_tag,
  });

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    proxy_url: row.proxy_url,
    connector_token: maskToken(plaintext),
    business_type: row.business_type,
    display_name: row.display_name,
    enabled: row.enabled,
    status: row.status,
    failure_count: row.failure_count,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Maps a DB row to a ConnectorConfig with the token field set to the
 * decrypted plaintext (internal use only — never sent to clients).
 */
function rowToRawConfig(row: ConnectorRow): ConnectorConfig {
  const plaintext = decryptToken({
    encrypted: row.connector_token_encrypted,
    iv: row.connector_token_iv,
    tag: row.connector_token_tag,
  });

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    proxy_url: row.proxy_url,
    connector_token: plaintext,
    business_type: row.business_type,
    display_name: row.display_name,
    enabled: row.enabled,
    status: row.status,
    failure_count: row.failure_count,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Creates a new connector for a tenant.
 *
 * - Validates required fields and URL format.
 * - Auto-generates a token if one is not provided.
 * - Encrypts the token before storing.
 * - Evicts any existing cache entry.
 * - Returns the created config with the token masked.
 *
 * Throws:
 *   { status: 400 } on validation failure
 *   { status: 409 } if an active connector already exists
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3
 */
export async function createConnector(
  tenantId: string,
  input: ConnectorCreateInput,
): Promise<ConnectorConfig> {
  // 1. Validate required fields
  validateRequiredFields(input);

  // 2. Validate URL
  validateProxyUrl(input.proxy_url);

  // 3. Validate business_type value (if present but invalid)
  if (input.business_type && !VALID_BUSINESS_TYPES.has(input.business_type)) {
    throw {
      status: 400,
      message: `business_type must be one of: ${Array.from(VALID_BUSINESS_TYPES).join(', ')}`,
    } as ConnectorError;
  }

  // 4. Generate or use provided token
  const plainToken = input.connector_token?.trim()
    ? input.connector_token.trim()
    : generateToken();

  // 5. Encrypt token
  const encrypted = encryptToken(plainToken);

  // 6. Insert into DB
  const now = new Date().toISOString();
  const { data, error } = await insforge.database
    .from('connector_registry')
    .insert([
      {
        tenant_id: tenantId,
        proxy_url: input.proxy_url,
        connector_token_encrypted: encrypted.encrypted,
        connector_token_iv: encrypted.iv,
        connector_token_tag: encrypted.tag,
        business_type: input.business_type,
        display_name: input.display_name,
        enabled: true,
        status: 'active',
        failure_count: 0,
        last_error: null,
        last_error_at: null,
        created_at: now,
        updated_at: now,
      },
    ])
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw {
        status: 409,
        message: 'An active connector already exists for this tenant',
      } as ConnectorError;
    }
    throw error;
  }

  // 7. Evict cache and return masked config
  connectorCache.evict(tenantId);
  return rowToPublicConfig(data as ConnectorRow);
}

/**
 * Returns the tenant's connector configuration with the token masked.
 * Reads from DB (does not hit cache — cache is populated by the router).
 * Returns null if no connector is found.
 *
 * Requirements: 2.1, 2.4
 */
export async function getConnector(tenantId: string): Promise<ConnectorConfig | null> {
  const { data, error } = await insforge.database
    .from('connector_registry')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return rowToPublicConfig(data as ConnectorRow);
}

/**
 * Returns the tenant's connector configuration with the token decrypted.
 * Intended for internal use by the proxy dispatcher only — never expose
 * the return value to API clients.
 *
 * Throws { status: 404 } if no connector exists.
 *
 * Requirements: 8.2
 */
export async function getConnectorRaw(tenantId: string): Promise<ConnectorConfig> {
  const { data, error } = await insforge.database
    .from('connector_registry')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw { status: 404, message: 'No connector found for this tenant' } as ConnectorError;
  }

  return rowToRawConfig(data as ConnectorRow);
}

/**
 * Updates an existing connector for a tenant.
 *
 * - Validates any changed fields using the same rules as creation.
 * - Re-encrypts the token if a new one is provided.
 * - Evicts the cache entry.
 * - Returns the updated config with the token masked.
 *
 * Throws:
 *   { status: 400 } on validation failure
 *   { status: 404 } if no connector exists
 *
 * Requirements: 2.5
 */
export async function updateConnector(
  tenantId: string,
  input: ConnectorUpdateInput,
): Promise<ConnectorConfig> {
  // 1. Confirm the connector exists
  const { data: existing, error: fetchError } = await insforge.database
    .from('connector_registry')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!existing) {
    throw { status: 404, message: 'No connector found for this tenant' } as ConnectorError;
  }

  // 2. Validate changed fields
  if (input.proxy_url !== undefined) {
    validateProxyUrl(input.proxy_url);
  }

  if (input.business_type !== undefined && !VALID_BUSINESS_TYPES.has(input.business_type)) {
    throw {
      status: 400,
      message: `business_type must be one of: ${Array.from(VALID_BUSINESS_TYPES).join(', ')}`,
    } as ConnectorError;
  }

  if (input.display_name !== undefined && input.display_name.trim() === '') {
    throw {
      status: 400,
      message: 'Missing required fields: display_name',
      missingFields: ['display_name'],
    } as ConnectorError;
  }

  // 3. Build update payload
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.proxy_url !== undefined) updates['proxy_url'] = input.proxy_url;
  if (input.business_type !== undefined) updates['business_type'] = input.business_type;
  if (input.display_name !== undefined) updates['display_name'] = input.display_name.trim();
  if (input.enabled !== undefined) updates['enabled'] = input.enabled;

  // Re-encrypt token if a new one is provided
  if (input.connector_token !== undefined && input.connector_token.trim() !== '') {
    const encrypted = encryptToken(input.connector_token.trim());
    updates['connector_token_encrypted'] = encrypted.encrypted;
    updates['connector_token_iv'] = encrypted.iv;
    updates['connector_token_tag'] = encrypted.tag;
  }

  // 4. Persist update
  const { data, error } = await insforge.database
    .from('connector_registry')
    .update(updates)
    .eq('tenant_id', tenantId)
    .select()
    .single();

  if (error) throw error;

  // 5. Evict cache and return masked config
  connectorCache.evict(tenantId);
  return rowToPublicConfig(data as ConnectorRow);
}

/**
 * Deletes the tenant's connector and evicts the cache.
 *
 * Throws { status: 404 } if no connector exists.
 *
 * Requirements: 2.6, 2.7
 */
export async function deleteConnector(tenantId: string): Promise<void> {
  // Confirm existence first so we can return a proper 404
  const { data: existing, error: fetchError } = await insforge.database
    .from('connector_registry')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!existing) {
    throw { status: 404, message: 'No connector found for this tenant' } as ConnectorError;
  }

  const { error } = await insforge.database
    .from('connector_registry')
    .delete()
    .eq('tenant_id', tenantId);

  if (error) throw error;

  connectorCache.evict(tenantId);
}

/**
 * Updates the connector status and failure tracking.
 * Called by the HealthTracker's StatusChangeCallback — not exposed via HTTP.
 *
 * When status is 'error', persists the error message and timestamp.
 * When status is 'active', resets failure_count and clears last_error.
 *
 * Requirements: 10.1, 10.2, 10.3, 11.2, 11.3
 */
export async function updateConnectorStatus(
  tenantId: string,
  status: 'active' | 'error',
  errorMessage?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'error') {
    updates['last_error'] = errorMessage ?? null;
    updates['last_error_at'] = new Date().toISOString();
    // Increment failure_count via raw SQL expression is not available in SDK;
    // we read the current count and increment by 1 instead.
    const { data: current } = await insforge.database
      .from('connector_registry')
      .select('failure_count')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    updates['failure_count'] = ((current as any)?.failure_count ?? 0) + 1;
  } else {
    // Reset on recovery
    updates['failure_count'] = 0;
    updates['last_error'] = null;
    updates['last_error_at'] = null;
  }

  const { error } = await insforge.database
    .from('connector_registry')
    .update(updates)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error(
      `⚠️ connector-registry: failed to update status for tenant ${tenantId}:`,
      error,
    );
    // Non-fatal: log but don't throw — health tracking must not crash the request path
  }

  // Evict cache so the next request picks up the new status
  connectorCache.evict(tenantId);
}
