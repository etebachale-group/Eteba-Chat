# Implementation Plan: Tenant Data Connectors

## Overview

This plan converts the tenant-data-connectors design into incremental implementation steps. Each task builds on previous ones, starting with the database migration and core modules, then wiring them into the existing Express server and router, adding the dashboard UI, and finally ensuring backward compatibility with Rotteri. Property-based tests use `fast-check`.

## Tasks

- [x] 1. Database migration and encryption utilities
  - [x] 1.1 Create SQL migration file `sql/006-connector-registry.sql`
    - Create the `connector_registry` table with all columns (id, tenant_id, proxy_url, connector_token_encrypted, connector_token_iv, connector_token_tag, business_type, display_name, enabled, status, failure_count, last_error, last_error_at, created_at, updated_at)
    - Add unique partial index on `(tenant_id) WHERE enabled = true`
    - Add standard index on `tenant_id`
    - Enable RLS and create tenant isolation policy
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Create token encryption module `connector-encryption.ts`
    - Implement `encryptToken(plaintext: string): EncryptedToken` using AES-256-GCM with `CONNECTOR_ENCRYPTION_KEY` from env
    - Implement `decryptToken(encrypted: EncryptedToken): string`
    - Implement `generateToken(): string` producing 64-char hex from `crypto.randomBytes(32)`
    - Implement `maskToken(token: string): string` returning `****` + last 4 chars
    - Fail-fast on startup if `CONNECTOR_ENCRYPTION_KEY` is missing or invalid length
    - _Requirements: 1.4, 2.1, 2.4, 11.1_

  - [ ]* 1.3 Write property tests for token encryption (Property 1, 4, 5)
    - **Property 1: Token Encryption Round-Trip** — encrypt then decrypt returns original for any string(1,512)
    - **Property 4: Token Masking** — masked output ends with last 4 chars, contains no other plaintext chars
    - **Property 5: Token Generation Format** — output is exactly 64 chars matching `/^[0-9a-f]{64}$/`
    - **Validates: Requirements 1.4, 2.1, 2.4, 11.1**

- [x] 2. Core infrastructure modules
  - [x] 2.1 Create `connector-cache.ts`
    - Implement `ConnectorCache` class with `Map<string, CachedConnector>` backing store
    - `get(tenantId)` returns config if not expired, else null
    - `set(tenantId, config)` stores with current timestamp
    - `evict(tenantId)` removes entry
    - `isExpired(entry)` checks 5-minute TTL
    - _Requirements: 8.4_

  - [ ]* 2.2 Write property test for ConnectorCache (Property 10)
    - **Property 10: Cache TTL and Eviction** — before TTL returns cached value; after TTL returns null; evict forces miss
    - **Validates: Requirements 8.4**

  - [x] 2.3 Create `rate-limiter.ts`
    - Implement `RateLimiter` class with sliding window per tenant
    - `isAllowed(tenantId)` checks if under 60 req/min
    - `record(tenantId)` adds timestamp to window
    - `getRetryAfter(tenantId)` returns seconds until next allowed request
    - Clean up expired timestamps on each check
    - _Requirements: 11.5, 11.6_

  - [ ]* 2.4 Write property test for RateLimiter (Property 12)
    - **Property 12: Rate Limiter Sliding Window** — allows at most 60 requests in any 60-second window; Retry-After is accurate
    - **Validates: Requirements 11.5, 11.6**

  - [x] 2.5 Create `health-tracker.ts`
    - Implement `HealthTracker` class with consecutive failure counts per tenant
    - `recordSuccess(tenantId)` resets failure count to 0
    - `recordFailure(tenantId, error)` increments count; marks "error" at threshold 3 and persists to DB
    - `resetStatus(tenantId)` sets status back to "active" with failure_count=0
    - `getStatus(tenantId)` returns current status
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 2.6 Write property test for HealthTracker (Property 11)
    - **Property 11: Health Tracker State Machine** — transitions to "error" iff last 3+ consecutive outcomes are failures; test-connection success always resets to "active"
    - **Validates: Requirements 10.1, 10.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Connector registry and proxy dispatcher
  - [x] 4.1 Create `connector-registry.ts`
    - Implement `createConnector(tenantId, input)` — validates fields, encrypts token, inserts into DB, evicts cache
    - Implement `getConnector(tenantId)` — fetches from DB, returns config with masked token
    - Implement `getConnectorRaw(tenantId)` — fetches from DB, returns config with decrypted token (internal use)
    - Implement `updateConnector(tenantId, input)` — validates changed fields, re-encrypts token if changed, updates DB, evicts cache
    - Implement `deleteConnector(tenantId)` — removes from DB, evicts cache
    - Implement URL validation: must start with `https://`, valid URL, ≤2048 chars
    - Implement required fields validation returning exact list of missing fields
    - Handle unique constraint violation (409 conflict)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ]* 4.2 Write property tests for ConnectorRegistry validation (Property 2, 3, 6)
    - **Property 2: URL Validation Correctness** — accepts iff starts with `https://`, valid URL, ≤2048 chars
    - **Property 3: Missing Fields Detection** — error lists exactly the set of missing required fields
    - **Property 6: One Active Connector Per Tenant** — at most one enabled=true record per tenant
    - **Validates: Requirements 1.3, 1.5, 1.6, 1.7, 2.3, 11.2, 11.3**

  - [x] 4.3 Create `proxy-dispatcher.ts`
    - Implement `ProxyDispatcher` class with 8-second timeout via `AbortController`
    - `dispatch(config, request)` sends POST to `proxy_url` with JSON body `{action, ...params}`
    - Include `X-Chat-Token` header with decrypted token
    - Handle HTTP errors (4xx/5xx), non-JSON responses, timeouts
    - Return structured `ProxyResponse` with data/meta/error
    - Log failures with tenant_id, proxy_url, error type (no token leakage)
    - _Requirements: 3.1, 3.2, 3.4, 3.7, 3.9, 8.2, 8.5, 8.6, 11.4_

  - [ ]* 4.4 Write property tests for ProxyDispatcher (Property 8, 9)
    - **Property 8: Dispatch Authentication Header** — X-Chat-Token contains decrypted token, token not in body/URL/other headers
    - **Property 9: Proxy Error Handling Consistency** — all failure modes log properly and return user-facing message without proxy details
    - **Validates: Requirements 8.2, 8.5, 11.4**

- [x] 5. Intent mapping and template generation
  - [x] 5.1 Create `intent-mapper.ts`
    - Define action mappings for each business type (ecommerce, appointments, restaurant, services, general)
    - Implement `mapIntentToAction(intentType, businessType, query)` returning action name + params
    - Implement `getBusinessTypeKeywords(businessType)` returning type-specific intent keywords
    - Implement `getSystemPromptInstructions(businessType)` returning LLM prompt additions
    - Ecommerce: search_products, get_product_detail, list_categories, insert_order, list_stores
    - Appointments: check_availability, list_services, book_appointment, cancel_appointment
    - Restaurant: get_menu, check_item_availability, place_order
    - Services: search, get_detail, submit_inquiry
    - _Requirements: 4.1–4.6, 5.1–5.5, 6.1–6.4, 7.1–7.4, 8.7, 14.1–14.5_

  - [ ]* 5.2 Write property tests for IntentMapper (Property 13, 16)
    - **Property 13: Intent-to-Action Mapping Validity** — mapped action always belongs to the defined set for that business type
    - **Property 16: Business-Type Keyword Set Correctness** — keywords contain all type-specific terms and none exclusive to other types
    - **Validates: Requirements 4.1–7.4, 8.7, 14.1–14.5**

  - [x] 5.3 Create `template-generator.ts`
    - Implement `generateTemplate(language, businessType, connectorToken?)` returning file content string
    - Support PHP, Node.js (Express), and Python (Flask) templates
    - Include all actions for the selected business_type + universal "ping" action
    - Include token validation logic, CORS headers, error handling patterns
    - Include inline documentation for each action's input/output
    - Pre-fill connector_token if provided
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 5.4 Write property tests for TemplateGenerator (Property 14, 15)
    - **Property 14: Template Generation Completeness** — output contains handlers for all business-type actions + ping + token validation + CORS + error handling
    - **Property 15: Template Token Pre-fill** — output contains the provided token string as a configuration value
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.5, 12.6**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Router generalization and Rotteri compatibility
  - [x] 7.1 Refactor `router.ts` to use connector system
    - Import ConnectorCache, ProxyDispatcher, HealthTracker, RateLimiter, IntentMapper
    - Modify `hybridQuery` to check for connector config before dispatching
    - Replace hardcoded `rotteriTenantId` checks with dynamic connector lookup
    - Add rate limiting check before proxy dispatch (return 429 + Retry-After if exceeded)
    - On proxy success: record health success, return results
    - On proxy failure: record health failure, fall back to InsForge Postgres search
    - Use `mapIntentToAction` to determine proxy action based on business_type
    - Use `getBusinessTypeKeywords` to adjust heuristic classifier per tenant
    - Use `getSystemPromptInstructions` in LLM prompt generation
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 14.1–14.5_

  - [ ]* 7.2 Write property test for routing dispatch (Property 7)
    - **Property 7: Routing Dispatch Correctness** — dispatches to proxy iff connector exists with enabled=true and status≠"error"; else falls back to Postgres
    - **Validates: Requirements 8.1, 8.3**

  - [x] 7.3 Implement Rotteri backward compatibility in router
    - Check connector_registry first for Rotteri's tenant_id
    - If no registry record, fall back to `ROTTERI_PROXY_URL` + `ROTTERI_PROXY_TOKEN` env vars
    - If env vars set but token missing, log warning and reject requests
    - If neither available, treat as no connector (error response)
    - Rotteri's existing actions (search_products, insert_order, list_stores, get_product_detail) already conform to ecommerce protocol — no translation needed
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 8. API routes in server.ts
  - [x] 8.1 Add connector CRUD API routes to `server.ts`
    - `POST /api/connectors` — create connector (validate ownership, fields, URL)
    - `GET /api/connectors` — get tenant's connector (masked token)
    - `PUT /api/connectors` — update connector (same validations)
    - `DELETE /api/connectors` — delete connector
    - `POST /api/connectors/test` — test connection (send ping action)
    - `POST /api/connectors/generate-token` — generate secure 64-char hex token
    - `GET /api/connectors/template` — download proxy template (query params: language, businessType)
    - Enhance `GET /api/config` to include connector health status
    - All routes verify tenant ownership (403 if mismatch)
    - _Requirements: 2.1–2.8, 3.3, 9.5, 9.6, 9.7, 10.4, 11.7, 11.8, 12.5_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Dashboard connector management UI
  - [x] 10.1 Add connector management section to `scripts/dashboard.js`
    - Add "Data Connector" section in tenant settings area
    - Create connector form: display name, proxy URL, connector token, business type selector
    - Client-side validation: required fields, URL starts with `https://`
    - Display current connector status with visual indicator (green=active, gray=inactive, red=error)
    - Add "Test Connection" button that calls `POST /api/connectors/test`
    - Show success message with reported business_type and version on test success
    - Show error message with troubleshooting guidance on test failure
    - Add generate-token button that calls `POST /api/connectors/generate-token`
    - Add template download section with language selector (PHP, Node.js, Python)
    - Wire create/update/delete operations to API endpoints
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 10.2 Add connector UI styles to `styles/dashboard.css`
    - Style connector form, status indicators, test button, error/success messages
    - Responsive layout matching existing dashboard patterns
    - _Requirements: 9.1, 9.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `fast-check` library must be added as a dev dependency (`npm install -D fast-check`)
- A test runner (e.g., `vitest` or `jest`) should be configured if not already present
- The `CONNECTOR_ENCRYPTION_KEY` environment variable (32-byte hex string) must be added to `.env.local` and `.env.example`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.3", "2.5"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.1", "5.3"] },
    { "id": 4, "tasks": ["4.4", "5.2", "5.4", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["10.1", "10.2"] }
  ]
}
```
