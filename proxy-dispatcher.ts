// ============================================================
// ProxyDispatcher Module
// Handles outbound HTTP calls to external tenant proxies with:
//   - 8-second timeout via AbortController
//   - X-Chat-Token authentication header
//   - HTTP error handling (4xx/5xx)
//   - Non-JSON response handling
//   - Timeout handling
//   - Structured ProxyResponse output
//   - Security-safe logging (never logs the token)
//
// Requirements: 3.1, 3.2, 3.4, 3.7, 3.9, 8.2, 8.5, 8.6, 11.4
// ============================================================

import type { ConnectorConfig } from './connector-cache.js';

// --- Interfaces ---

export interface ProxyRequest {
  action: string;
  params: Record<string, unknown>;
}

export interface ProxyResponse {
  data: unknown;
  meta: {
    timestamp: string;   // ISO 8601
    action: string;
    execution_time_ms: number;
  };
  error?: string;
}

// Shape of the envelope the remote proxy is expected to return.
// The "data" field is action-specific; only meta is guaranteed.
interface RemoteProxyEnvelope {
  data?: unknown;
  error?: string;
  meta?: {
    timestamp?: string;
    action?: string;
    execution_time_ms?: number;
  };
}

// --- ProxyDispatcher class ---

class ProxyDispatcher {
  private readonly TIMEOUT = 8000; // 8 seconds — Requirement 8.6

  /**
   * Dispatch a request to an external tenant proxy.
   *
   * The HTTP body is `{ action, ...params }` as per Requirement 3.1.
   * Authentication is via the `X-Chat-Token` header (Requirement 3.2, 8.2, 11.4).
   *
   * @param config  - Connector configuration for the tenant. The
   *                  `connector_token` field must already be the **decrypted**
   *                  plaintext token (callers such as `getConnectorRaw` handle
   *                  decryption before passing config here).
   * @param request - The action and its parameters.
   * @returns       A structured ProxyResponse with data/meta/error.
   */
  async dispatch(config: ConnectorConfig, request: ProxyRequest): Promise<ProxyResponse> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

    try {
      // Build the request body: { action, ...params } — Requirement 3.1
      const body = JSON.stringify({
        action: request.action,
        ...request.params,
      });

      const response = await fetch(config.proxy_url, {
        method: 'POST',
        headers: this.buildHeaders(config.connector_token),
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // --- HTTP error handling (4xx / 5xx) — Requirements 8.5, 3.9 ---
      if (!response.ok) {
        const errorType = `http_${response.status}`;
        console.error('[ProxyDispatcher] HTTP error from proxy', {
          tenant_id: config.tenant_id,
          proxy_url: config.proxy_url,
          error_type: errorType,
          status: response.status,
          // NOTE: token is intentionally NOT logged — Requirement 11.4
        });

        // Special case: 401 → authentication failed message — design doc
        const userMessage =
          response.status === 401
            ? 'Connector authentication failed'
            : 'Data source temporarily unavailable';

        return {
          data: null,
          meta: {
            timestamp: new Date().toISOString(),
            action: request.action,
            execution_time_ms: Date.now() - startTime,
          },
          error: userMessage,
        };
      }

      // --- Parse JSON response — Requirement 3.4 ---
      let envelope: RemoteProxyEnvelope;
      try {
        envelope = (await response.json()) as RemoteProxyEnvelope;
      } catch {
        console.error('[ProxyDispatcher] Non-JSON response from proxy', {
          tenant_id: config.tenant_id,
          proxy_url: config.proxy_url,
          error_type: 'invalid_json',
        });

        return {
          data: null,
          meta: {
            timestamp: new Date().toISOString(),
            action: request.action,
            execution_time_ms: Date.now() - startTime,
          },
          error: 'Data source temporarily unavailable',
        };
      }

      // Success — surface the envelope as a structured ProxyResponse.
      // Prefer the proxy's own meta if present; fall back to locally computed values.
      return {
        data: envelope.data ?? (envelope as any).results ?? null,
        meta: {
          timestamp: envelope.meta?.timestamp ?? new Date().toISOString(),
          action: envelope.meta?.action ?? request.action,
          execution_time_ms: envelope.meta?.execution_time_ms ?? (Date.now() - startTime),
        },
        error: envelope.error,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      return this.handleError(err, config, request.action, startTime);
    }
  }

  /**
   * Build the HTTP headers for an outbound proxy request.
   *
   * The connector token is placed **exclusively** in `X-Chat-Token`.
   * It does NOT appear in the URL, body, or any other header.
   * Requirements: 3.2, 8.2, 11.4
   */
  private buildHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Chat-Token': token,
    };
  }

  /**
   * Convert a caught error into a structured ProxyResponse.
   *
   * Distinguishes between:
   *  - AbortError  → timeout (Requirement 8.6)
   *  - All others  → generic proxy failure
   *
   * Logs tenant_id, proxy_url and error_type — never the token.
   * Requirements: 8.5, 3.9, 11.4
   */
  private handleError(
    error: unknown,
    config: ConnectorConfig,
    action: string,
    startTime: number
  ): ProxyResponse {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('abort'));

    const errorType = isTimeout ? 'timeout' : 'network_error';
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('[ProxyDispatcher] Proxy call failed', {
      tenant_id: config.tenant_id,
      proxy_url: config.proxy_url,
      error_type: errorType,
      message: isTimeout ? 'Request timed out after 8 seconds' : errorMessage,
      // NOTE: token is intentionally NOT logged — Requirement 11.4
    });

    return {
      data: null,
      meta: {
        timestamp: new Date().toISOString(),
        action,
        execution_time_ms: Date.now() - startTime,
      },
      error: 'Data source temporarily unavailable',
    };
  }
}

// --- Singleton instance ---
export const proxyDispatcher = new ProxyDispatcher();

// Named class export for testing
export { ProxyDispatcher };
