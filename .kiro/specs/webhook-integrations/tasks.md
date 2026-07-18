# Implementation Plan: Webhook Integrations

## Overview

This plan implements a full webhook integration subsystem for Eteba Chat: database schema, REST API routes, event dispatcher with retry logic, HMAC signing, and a dashboard UI tab. Each task builds incrementally on the previous, starting with the data layer, then core utilities, API routes, dispatcher logic, and finally the frontend UI.

## Tasks

- [ ] 1. Database schema and core TypeScript interfaces
  - [ ] 1.1 Create SQL migration `sql/006-webhook-integrations.sql`
    - Create `webhook_endpoints` table with UUID PK, tenant_id FK, url, events array, signing_secret, is_active, consecutive_failures, timestamps
    - Create `delivery_logs` table with UUID PK, endpoint_id FK, tenant_id FK, event_type, payloads, status, attempt tracking, parent linkage
    - Add all indexes (tenant, active, endpoint+created_at, status, cleanup)
    - Add RLS policies for tenant isolation on both tables
    - Add constraints: url_length CHECK, url_https CHECK, unique_url_per_tenant UNIQUE
    - _Requirements: 1.1, 1.2, 2.8, 6.5, 8.1, 8.2, 8.3_

  - [ ] 1.2 Create TypeScript interfaces and types file `webhook-types.ts`
    - Define `EventType` union type with all valid event strings
    - Define `WebhookEndpoint` interface matching DB schema
    - Define `DeliveryLog` interface matching DB schema
    - Define `WebhookPayload` interface (id, event, timestamp, tenant_id, data)
    - Define `DeliveryResult` interface (success, statusCode, responseBody, error)
    - Export `VALID_EVENT_TYPES` constant array and `RETRY_DELAYS` constant
    - _Requirements: 1.4, 3.5, 7.1_

- [ ] 2. HMAC signing utility and validation helpers
  - [ ] 2.1 Create `webhook-signing.ts` with signing functions
    - Implement `generateSigningSecret()` — crypto.randomBytes(32).toString('hex')
    - Implement `signPayload(payloadJson: string, secret: string, timestamp: number): string` — HMAC-SHA256 over `${timestamp}.${payloadJson}`
    - Return format: `sha256=<hex_digest>`
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [ ]* 2.2 Write property test for signing secret generation (Property 3)
    - **Property 3: Signing Secret Generation Quality**
    - Verify generated secrets are ≥64 hex chars (32 bytes) and unique across runs
    - **Validates: Requirements 1.3, 4.5**

  - [ ]* 2.3 Write property test for HMAC-SHA256 round trip (Property 4)
    - **Property 4: HMAC-SHA256 Signing Round Trip**
    - Verify determinism: same payload + secret + timestamp → same signature
    - Verify format: `sha256=` prefix followed by exactly 64 hex characters
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 2.4 Write property test for secret regeneration invalidation (Property 17)
    - **Property 17: Secret Regeneration Invalidates Previous Secret**
    - Verify new secret differs from old; payload signed with old secret fails verification with new
    - **Validates: Requirements 4.5**

  - [ ] 2.5 Create `webhook-validation.ts` with input validation functions
    - Implement `validateUrl(url: string): { valid: boolean; error?: string }` — HTTPS check, length ≤ 2048
    - Implement `validateEventTypes(events: string[]): { valid: boolean; error?: string }` — non-empty, all in VALID_EVENT_TYPES
    - Implement `truncateBody(body: string, maxLen?: number): string` — truncate to 1024 chars with indicator
    - _Requirements: 1.2, 1.4, 1.6, 6.4_

  - [ ]* 2.6 Write property test for URL validation (Property 1)
    - **Property 1: URL Validation Accepts Only Valid HTTPS URLs Under 2048 Characters**
    - Verify acceptance iff starts with `https://` AND length ≤ 2048
    - **Validates: Requirements 1.2, 1.6, 2.3, 2.4**

  - [ ]* 2.7 Write property test for event type validation (Property 2)
    - **Property 2: Event Type Subscription Validation**
    - Verify acceptance iff set is non-empty and all elements are valid event types
    - **Validates: Requirements 1.4, 2.3**

  - [ ]* 2.8 Write property test for response body truncation (Property 14)
    - **Property 14: Response Body Truncation**
    - Verify stored value length = min(L, 1024); truncation indicator appended if L > 1024
    - **Validates: Requirements 6.4**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Webhook API routes — CRUD endpoints
  - [ ] 4.1 Add auth middleware helper `extractTenantId` in `server.ts`
    - Extract tenant ID from base64url token (Authorization header or query param)
    - Return null if token is missing/invalid
    - Reuse existing token format from `/auth/me` endpoint
    - _Requirements: 8.1, 8.4, 8.5_

  - [ ] 4.2 Implement `POST /api/webhooks` — Create endpoint
    - Validate auth (401 if missing), extract tenantId
    - Validate URL (HTTPS, ≤ 2048), validate events array (non-empty, valid types)
    - Check tenant endpoint limit (max 10, return 409 if exceeded)
    - Check duplicate URL for tenant (return 409 if exists)
    - Generate signing secret via `generateSigningSecret()`
    - Insert into `webhook_endpoints` table
    - Return 201 with endpoint data and signing_secret (shown only once)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 8.1_

  - [ ] 4.3 Implement `GET /api/webhooks` — List endpoints
    - Validate auth, extract tenantId
    - Query all endpoints for tenant ordered by created_at DESC
    - Exclude signing_secret from response
    - Return empty array if none exist
    - _Requirements: 2.1, 2.2, 2.9, 8.5_

  - [ ] 4.4 Implement `PUT /api/webhooks/:id` — Update endpoint
    - Validate auth, verify endpoint belongs to tenant (403 if not)
    - Validate URL and events same as create
    - Update url, events, and updated_at
    - _Requirements: 2.3, 2.4, 8.1, 8.4_

  - [ ] 4.5 Implement `PATCH /api/webhooks/:id/toggle` — Toggle active status
    - Validate auth, verify ownership
    - Flip `is_active` boolean and persist
    - Return new is_active value
    - _Requirements: 2.5, 2.6_

  - [ ] 4.6 Implement `DELETE /api/webhooks/:id` — Delete endpoint
    - Validate auth, verify ownership
    - Delete endpoint (cascade removes delivery_logs via FK)
    - Return success
    - _Requirements: 2.7, 2.8, 8.1_

  - [ ]* 4.7 Write property test for tenant isolation (Property 8)
    - **Property 8: Tenant Isolation on All Operations**
    - Verify tenant A cannot access/modify/list tenant B's endpoints or logs
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

  - [ ]* 4.8 Write property test for toggle inversion (Property 9)
    - **Property 9: Toggle Inverts Active Status**
    - Verify toggling state S produces !S
    - **Validates: Requirements 2.5**

  - [ ]* 4.9 Write property test for endpoint list ordering (Property 18)
    - **Property 18: Endpoint List Ordering**
    - Verify list returns endpoints ordered by created_at descending
    - **Validates: Requirements 2.1**

- [ ] 5. Webhook API routes — Delivery, test, and retry endpoints
  - [ ] 5.1 Implement `POST /api/webhooks/:id/test` — Test delivery
    - Validate auth, verify ownership
    - Rate limit: reject if test sent within last 5 seconds (in-memory map)
    - Build test.ping payload with generated UUID, timestamp, tenant_id
    - Sign payload with endpoint's signing_secret
    - POST to endpoint URL with 10s timeout (AbortController)
    - Record delivery_log with is_test=true
    - Return success/failure with status code or error message
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ] 5.2 Implement `POST /api/webhooks/:id/regenerate-secret` — Regenerate signing secret
    - Validate auth, verify ownership
    - Generate new secret, update endpoint record
    - Return new signing_secret (shown once)
    - _Requirements: 4.5, 4.6_

  - [ ] 5.3 Implement `GET /api/webhooks/:id/logs` — Delivery logs (paginated)
    - Validate auth, verify endpoint belongs to tenant
    - Accept `page` and `limit` query params (default 1, 20; max 20)
    - Query delivery_logs ordered by created_at DESC with pagination
    - Return logs array + pagination metadata (page, limit, total, totalPages)
    - _Requirements: 6.1, 6.2, 6.3, 8.3_

  - [ ] 5.4 Implement `POST /api/webhooks/logs/:logId/retry` — Manual retry
    - Validate auth, verify log belongs to tenant
    - Reject if delivery status is not `permanently_failed` (400)
    - Fetch original payload, re-deliver to endpoint with current signing secret
    - Record new delivery_log entry linked to original (parent_delivery_id, attempt_number)
    - Update status to delivered on 2xx, or keep permanently_failed otherwise
    - _Requirements: 7.4, 7.5, 7.7_

  - [ ]* 5.5 Write property test for manual retry precondition (Property 13)
    - **Property 13: Manual Retry Precondition**
    - Verify only `permanently_failed` deliveries are eligible for manual retry
    - **Validates: Requirements 7.5**

  - [ ]* 5.6 Write property test for delivery log pagination (Property 15)
    - **Property 15: Delivery Log Pagination**
    - Verify at most 20 entries per page, ordered by created_at DESC, totalPages = ceil(N/20)
    - **Validates: Requirements 6.1, 6.3**

  - [ ]* 5.7 Write property test for test delivery flag (Property 16)
    - **Property 16: Test Delivery Flag**
    - Verify test.ping deliveries have is_test=true, real deliveries have is_test=false
    - **Validates: Requirements 5.6**

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Webhook Dispatcher — Event routing and delivery engine
  - [ ] 7.1 Create `webhook-dispatcher.ts` with core dispatcher logic
    - Implement `emitEvent(tenantId, eventType, data)` — query active endpoints subscribed to event, deliver in parallel (fire-and-forget)
    - Implement `deliverToEndpoint(endpoint, payload)` — build JSON, sign with HMAC, POST with 10s timeout via AbortController
    - Set headers: Content-Type, X-Eteba-Signature, X-Eteba-Timestamp
    - Classify response: 2xx → delivered, else → failed with reason
    - Record delivery_log entry with status, status_code, truncated response body
    - Skip delivery if signing_secret is missing (record failure reason)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4_

  - [ ] 7.2 Implement retry logic with exponential backoff
    - Implement `scheduleRetry(deliveryLogId, endpoint, payload, attempt)` using setTimeout
    - Retry delays: 30s, 5min, 30min (max 3 retries)
    - After 3rd retry fails → mark permanently_failed
    - Record each retry as linked delivery_log entry (parent_delivery_id, attempt_number)
    - Increment consecutive_failures on each failure
    - Reset consecutive_failures on success
    - Auto-disable endpoint at 50 consecutive failures (cancel pending retries)
    - Store timeout IDs per endpoint for cancellation
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [ ] 7.3 Implement delivery log cleanup interval
    - setInterval running every 24 hours
    - Delete delivery_logs older than 30 days
    - Initialize on server startup
    - _Requirements: 6.5_

  - [ ]* 7.4 Write property test for event routing correctness (Property 5)
    - **Property 5: Event Routing Correctness**
    - Verify events delivered only to endpoints that are both active AND subscribed to the event type
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 2.6**

  - [ ]* 7.5 Write property test for delivery status classification (Property 6)
    - **Property 6: Delivery Status Classification**
    - Verify 2xx → delivered, non-2xx/timeout/error → failed
    - **Validates: Requirements 3.8, 3.9**

  - [ ]* 7.6 Write property test for payload structure (Property 7)
    - **Property 7: Payload Structure Completeness**
    - Verify payload contains: non-empty UUID id, correct event string, valid ISO 8601 timestamp, correct tenant_id, data object
    - **Validates: Requirements 3.5**

  - [ ]* 7.7 Write property test for retry backoff schedule (Property 11)
    - **Property 11: Retry Backoff Schedule**
    - Verify at most 3 retries with delays 30s, 5min, 30min; permanently_failed after exhaustion
    - **Validates: Requirements 7.1, 7.3**

  - [ ]* 7.8 Write property test for retry log linkage (Property 12)
    - **Property 12: Retry Log Linkage**
    - Verify retry logs have correct parent_delivery_id and sequential attempt_number
    - **Validates: Requirements 7.2**

- [ ] 8. Wire dispatcher into existing API routes
  - [ ] 8.1 Integrate `emitEvent` calls into existing server.ts endpoints
    - Add `webhookDispatcher.emitEvent(tenantId, 'order.created', {...})` in POST /api/orders (if exists) or order creation flow
    - Add `webhookDispatcher.emitEvent(tenantId, 'catalog.updated', {...})` in POST/PUT/DELETE /api/catalog endpoints
    - Add `webhookDispatcher.emitEvent(tenantId, 'message.received', {...})` in POST /api/query
    - Import dispatcher at top of server.ts
    - Use fire-and-forget pattern (`.catch(() => {})`) to not block responses
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.10_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Dashboard UI — Integraciones tab
  - [ ] 10.1 Add "Integraciones" tab to dashboard sidebar and routing
    - Add sidebar link with appropriate icon in `scripts/dashboard.js`
    - Add route handling in dashboard router/tab system
    - Load integraciones content when tab is selected
    - _Requirements: 2.1, 2.9_

  - [ ] 10.2 Create `scripts/integraciones.js` — Endpoint list and empty state
    - Render list of endpoints (URL, events as badges, created date, active status)
    - Show empty state message "No tienes endpoints configurados" when no endpoints
    - Add toggle switch for active/inactive (inline PATCH call)
    - Show action buttons: Probar, Editar, Ver Logs, Eliminar
    - Event badge color mapping: order.created=green, conversation.started=blue, message.received=purple, catalog.updated=orange
    - _Requirements: 2.1, 2.2, 2.5, 2.9_

  - [ ] 10.3 Implement create/edit endpoint modals
    - Create modal: URL input + event type checkboxes
    - Validate HTTPS URL and at least one event selected before submit
    - On success: display signing secret with copy-to-clipboard button and warning message
    - Edit modal: pre-filled URL + checkboxes, same validations
    - Show validation errors in Spanish
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.8, 1.9, 2.3, 2.4_

  - [ ] 10.4 Implement delete confirmation, test delivery, and regenerate secret UI
    - Delete: confirmation dialog using existing `showConfirmDialog` pattern, stating data will be permanently removed
    - Test delivery: button triggers POST, shows success/error toast with status code or error message
    - Regenerate secret: confirmation dialog, then display new secret once with copy button
    - Rate limit feedback: show toast if test attempted within 5s
    - _Requirements: 2.7, 4.5, 4.6, 5.4, 5.5, 5.7_

  - [ ] 10.5 Implement delivery logs panel with pagination
    - Expandable section or modal showing paginated log entries for selected endpoint
    - Display: event type, timestamp (local TZ), status code, success/failure badge, test flag
    - Expandable row to show request payload and response body (truncated)
    - Pagination controls (prev/next) with page indicator
    - Empty state: "No hay entregas registradas para este endpoint"
    - Manual retry button for permanently_failed entries
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 7.4, 7.5_

  - [ ]* 10.6 Write property test for cascade delete (Property 10)
    - **Property 10: Cascade Delete Removes Endpoint and All Logs**
    - Verify deleting endpoint removes both endpoint and all N delivery logs
    - **Validates: Requirements 2.8**

- [ ] 11. Add CSS styles for Integraciones tab
  - [ ] 11.1 Add styles to `styles/dashboard.css` for webhook UI components
    - Style endpoint cards, badge colors, toggle switches
    - Style modals (create/edit), log table, pagination controls
    - Responsive layout for endpoint list
    - Empty state styling
    - _Requirements: 2.1, 2.2_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The project uses TypeScript with Express.js; all server code compiles via `tsc`
- Database operations use InsForge SDK (`@insforge/sdk`) client pattern
- Frontend is vanilla JS following existing `scripts/dashboard.js` patterns
- Auth uses existing base64url token format (no new auth system needed)
- Retry scheduler uses in-memory setTimeout (acceptable for single-instance deployment)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.5"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.6", "2.7", "2.8"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 5, "tasks": ["4.7", "4.8", "4.9", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["5.5", "5.6", "5.7"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3"] },
    { "id": 9, "tasks": ["7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 10, "tasks": ["8.1"] },
    { "id": 11, "tasks": ["10.1", "11.1"] },
    { "id": 12, "tasks": ["10.2", "10.3"] },
    { "id": 13, "tasks": ["10.4", "10.5"] },
    { "id": 14, "tasks": ["10.6"] }
  ]
}
```
