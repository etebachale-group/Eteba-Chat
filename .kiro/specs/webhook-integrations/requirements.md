# Requirements Document

## Introduction

This feature adds webhook integration support to the Eteba Chat platform. Dashboard users will be able to register HTTP endpoint URLs to receive real-time notifications when key events occur within their tenant (new orders, conversations, messages, and catalog updates). The feature includes full CRUD management of webhook endpoints, test delivery, delivery history/logs, retry of failed deliveries, and HMAC-based payload signing for security.

## Glossary

- **Webhook_Endpoint**: A registered URL belonging to a tenant that receives HTTP POST notifications when subscribed events occur.
- **Webhook_Event**: A specific occurrence within a tenant (e.g., new order placed) that triggers notification delivery to subscribed endpoints.
- **Delivery**: A single HTTP POST request sent from the Webhook_Dispatcher to a Webhook_Endpoint carrying event payload data.
- **Delivery_Log**: A persisted record of a Delivery attempt including status code, response body, timestamps, and success/failure status.
- **Signing_Secret**: A cryptographic key (HMAC-SHA256) unique to each Webhook_Endpoint, used to sign payloads so receivers can verify authenticity.
- **Webhook_Dispatcher**: The server-side component responsible for sending HTTP POST requests to registered Webhook_Endpoints when events occur.
- **Dashboard**: The Eteba Chat administration panel used by tenant owners to manage their business.
- **Tenant**: A business (company) using the Eteba Chat platform, identified by a unique tenant ID.

## Requirements

### Requirement 1: Register Webhook Endpoints

**User Story:** As a dashboard user, I want to register webhook endpoint URLs, so that my external systems receive notifications when events happen in my tenant.

#### Acceptance Criteria

1. WHEN a dashboard user submits a valid URL and selects at least one event type, THE Dashboard SHALL create a new Webhook_Endpoint associated with the current Tenant.
2. THE Dashboard SHALL validate that the URL uses HTTPS protocol and does not exceed 2048 characters before allowing registration.
3. WHEN a Webhook_Endpoint is created, THE Webhook_Dispatcher SHALL generate a unique cryptographically random Signing_Secret of at least 32 bytes and associate it with the endpoint.
4. THE Dashboard SHALL allow the user to subscribe a Webhook_Endpoint to one or more of the following event types: `order.created`, `conversation.started`, `message.received`, `catalog.updated`.
5. THE Dashboard SHALL display the generated Signing_Secret to the user only during the same page view in which it was created, with a copy-to-clipboard action, and SHALL NOT display the full secret again on subsequent page loads.
6. IF a dashboard user attempts to register a URL that is not a valid HTTPS URL, THEN THE Dashboard SHALL display an error message in Spanish indicating the URL must use HTTPS.
7. THE Dashboard SHALL enforce a maximum of 10 Webhook_Endpoints per Tenant.
8. IF a dashboard user attempts to register an endpoint beyond the maximum limit, THEN THE Dashboard SHALL display an error message in Spanish indicating the limit has been reached.
9. IF a dashboard user attempts to register a URL that is already registered for the same Tenant, THEN THE Dashboard SHALL display an error message in Spanish indicating the URL is already in use.

### Requirement 2: Manage Webhook Endpoints

**User Story:** As a dashboard user, I want to edit and delete my webhook endpoints, so that I can keep my integrations up to date.

#### Acceptance Criteria

1. WHEN a dashboard user navigates to the Integraciones tab, THE Dashboard SHALL display a list of all Webhook_Endpoints registered for the current Tenant, ordered by creation date descending.
2. THE Dashboard SHALL display for each Webhook_Endpoint: the URL, subscribed event types, creation date, and active/inactive status.
3. WHEN a dashboard user submits an edited URL and event type selection for a Webhook_Endpoint, THE Dashboard SHALL allow modification of the URL and subscribed event types, enforcing that the URL uses HTTPS protocol and at least one event type remains selected.
4. IF a dashboard user submits an edit with an invalid URL or no event types selected, THEN THE Dashboard SHALL display an error message in Spanish indicating the validation failure and SHALL NOT persist the changes.
5. WHEN a dashboard user toggles the active status of a Webhook_Endpoint, THE Dashboard SHALL persist the status change without requiring a separate save action and SHALL reflect the new status in the list within 3 seconds.
6. WHILE a Webhook_Endpoint is inactive, THE Webhook_Dispatcher SHALL skip delivery to that endpoint.
7. THE Dashboard SHALL require a confirmation dialog before deleting a Webhook_Endpoint, stating that the endpoint and all associated Delivery_Logs will be permanently removed.
8. WHEN a dashboard user confirms deletion of a Webhook_Endpoint, THE Dashboard SHALL remove the endpoint and all associated Delivery_Logs and SHALL remove the entry from the displayed list.
9. IF the Tenant has no registered Webhook_Endpoints, THEN THE Dashboard SHALL display an empty-state message in Spanish indicating no endpoints are configured.

### Requirement 3: Deliver Webhook Notifications

**User Story:** As a dashboard user, I want my registered endpoints to receive HTTP notifications when events occur, so that my external systems stay synchronized with Eteba Chat.

#### Acceptance Criteria

1. WHEN an `order.created` event occurs for a Tenant, THE Webhook_Dispatcher SHALL send an HTTP POST request to all active Webhook_Endpoints of that Tenant subscribed to `order.created`.
2. WHEN a `conversation.started` event occurs for a Tenant, THE Webhook_Dispatcher SHALL send an HTTP POST request to all active Webhook_Endpoints of that Tenant subscribed to `conversation.started`.
3. WHEN a `message.received` event occurs for a Tenant, THE Webhook_Dispatcher SHALL send an HTTP POST request to all active Webhook_Endpoints of that Tenant subscribed to `message.received`.
4. WHEN a `catalog.updated` event occurs for a Tenant, THE Webhook_Dispatcher SHALL send an HTTP POST request to all active Webhook_Endpoints of that Tenant subscribed to `catalog.updated`.
5. THE Webhook_Dispatcher SHALL include a JSON payload containing: a unique delivery ID, the event type string, the event timestamp in ISO 8601 format, the tenant ID, and an event-specific `data` object containing the resource ID and changed attributes relevant to the event.
6. THE Webhook_Dispatcher SHALL set the `Content-Type` header to `application/json` on all deliveries.
7. THE Webhook_Dispatcher SHALL wait a maximum of 10 seconds for a response before considering the delivery as failed due to timeout.
8. WHEN a delivery receives an HTTP response with status code between 200 and 299, THE Webhook_Dispatcher SHALL mark the Delivery_Log as successful and record the response status code and response body (truncated to 1024 characters).
9. IF a delivery receives an HTTP response with status code outside 200-299, times out, or encounters a connection error (DNS resolution failure, connection refused, or TLS handshake failure), THEN THE Webhook_Dispatcher SHALL mark the Delivery_Log as failed and record the failure reason.
10. THE Webhook_Dispatcher SHALL deliver events to each subscribed Webhook_Endpoint independently, so that a failure or slow response from one endpoint does not delay delivery to other endpoints of the same Tenant.

### Requirement 4: Sign Webhook Payloads

**User Story:** As a dashboard user, I want webhook payloads to be signed with a secret, so that my receiving server can verify the request originates from Eteba Chat.

#### Acceptance Criteria

1. THE Webhook_Dispatcher SHALL compute an HMAC-SHA256 signature over the raw UTF-8 encoded JSON payload bytes using the Webhook_Endpoint Signing_Secret.
2. THE Webhook_Dispatcher SHALL include the signature in the `X-Eteba-Signature` HTTP header with the format `sha256=<hex_digest>`.
3. THE Webhook_Dispatcher SHALL include a `X-Eteba-Timestamp` header containing the Unix timestamp (seconds) at the moment the delivery request is dispatched, enabling receivers to reject payloads older than a 5-minute tolerance window.
4. IF the Signing_Secret for a Webhook_Endpoint is missing or unreadable at dispatch time, THEN THE Webhook_Dispatcher SHALL skip delivery for that endpoint and record a delivery failure indicating an invalid signing secret.
5. WHEN a dashboard user requests to regenerate the Signing_Secret for a Webhook_Endpoint, THE Dashboard SHALL generate a new cryptographically random Signing_Secret of at least 32 bytes and immediately invalidate the previous one.
6. THE Dashboard SHALL display the regenerated Signing_Secret to the user only during the same page view in which it was generated, with a copy-to-clipboard action, and SHALL NOT display the full secret again on subsequent page loads.

### Requirement 5: Test Webhook Delivery

**User Story:** As a dashboard user, I want to send a test payload to my webhook endpoint, so that I can verify the integration works before real events occur.

#### Acceptance Criteria

1. WHEN a dashboard user triggers a test delivery for a Webhook_Endpoint, THE Webhook_Dispatcher SHALL send an HTTP POST request to the endpoint URL with a payload containing the event type `test.ping` and a generated timestamp, applying a timeout of 10 seconds for the request.
2. THE Webhook_Dispatcher SHALL include the event type `test.ping` in the test payload.
3. THE Webhook_Dispatcher SHALL sign the test payload using the same HMAC-SHA256 mechanism used for real deliveries.
4. WHEN the endpoint responds with an HTTP 2xx status code within the 10-second timeout, THE Dashboard SHALL display a success message in Spanish including the response status code.
5. IF the endpoint does not respond within 10 seconds, the connection is refused, or the endpoint responds with a non-2xx HTTP status code, THEN THE Dashboard SHALL display an error message in Spanish indicating the specific failure reason (timeout, connection error, or the HTTP error code received).
6. THE Webhook_Dispatcher SHALL record the test delivery in the Delivery_Log with a flag indicating it is a test, including the response status code or failure reason and the timestamp of the attempt.
7. IF the dashboard user has triggered a test delivery within the previous 5 seconds for the same Webhook_Endpoint, THEN THE Dashboard SHALL reject the request and display a rate-limit message in Spanish indicating the user must wait before retrying.

### Requirement 6: View Delivery Logs

**User Story:** As a dashboard user, I want to view the delivery history for each webhook endpoint, so that I can monitor and troubleshoot integrations.

#### Acceptance Criteria

1. WHEN a dashboard user selects a Webhook_Endpoint, THE Dashboard SHALL display the Delivery_Log entries for that endpoint ordered by most recent delivery timestamp first.
2. THE Dashboard SHALL display for each Delivery_Log entry: event type, delivery timestamp in the format "YYYY-MM-DD HH:MM:SS" in the user's local timezone, HTTP response status code, success/failure status, and whether it was a test delivery.
3. THE Dashboard SHALL paginate Delivery_Log entries showing 20 entries per page with navigation controls to move to the next and previous pages.
4. WHEN a dashboard user expands a Delivery_Log entry, THE Dashboard SHALL display the request payload and response body, each truncated to a maximum of 1024 characters with a truncation indicator appended if the original content exceeds 1024 characters.
5. THE Webhook_Dispatcher SHALL retain Delivery_Log entries for a maximum of 30 days, after which they are automatically deleted.
6. IF a Webhook_Endpoint has no Delivery_Log entries, THEN THE Dashboard SHALL display an empty-state message indicating that no deliveries have been recorded for this endpoint.
7. IF the request payload or response body for a Delivery_Log entry is unavailable, THEN THE Dashboard SHALL display a placeholder message indicating the data is not available.

### Requirement 7: Retry Failed Deliveries

**User Story:** As a dashboard user, I want to retry failed webhook deliveries, so that temporary failures do not cause missed notifications.

#### Acceptance Criteria

1. WHEN a delivery attempt receives an HTTP response with status code outside the 2xx range, or the connection times out after 10 seconds, or the connection is refused, THE Webhook_Dispatcher SHALL classify the delivery as failed and automatically retry the delivery up to 3 times using exponential backoff (delays of 30 seconds, 5 minutes, and 30 minutes).
2. THE Webhook_Dispatcher SHALL record each retry attempt as a separate Delivery_Log entry linked to the original delivery, including the attempt number, timestamp, and the failure reason.
3. WHEN all 3 automatic retries are exhausted without receiving a 2xx HTTP response, THE Webhook_Dispatcher SHALL mark the delivery as permanently failed.
4. WHEN a dashboard user manually triggers a retry for a permanently failed Delivery_Log entry, THE Webhook_Dispatcher SHALL send the original payload to the Webhook_Endpoint within 5 seconds and, IF the retry receives a 2xx response, THEN THE Webhook_Dispatcher SHALL update the delivery status to delivered.
5. THE Dashboard SHALL allow manual retry only for deliveries with a permanently failed status.
6. IF a Webhook_Endpoint accumulates 50 consecutive failed deliveries, THEN THE Webhook_Dispatcher SHALL deactivate the endpoint, cancel any pending automatic retries for that endpoint, and THE Dashboard SHALL display a warning indicating the endpoint was auto-disabled due to consecutive failures.
7. IF a manual retry for a permanently failed delivery does not receive a 2xx HTTP response or times out after 10 seconds, THEN THE Webhook_Dispatcher SHALL keep the delivery status as permanently failed and record the failed manual attempt as a new Delivery_Log entry.

### Requirement 8: Tenant Isolation

**User Story:** As a platform operator, I want webhook data to be isolated per tenant, so that no tenant can access another tenant's webhook configuration or delivery logs.

#### Acceptance Criteria

1. THE Dashboard SHALL restrict Webhook_Endpoint management operations (create, read, update, delete, test, and regenerate secret) to the authenticated user's Tenant.
2. THE Webhook_Dispatcher SHALL only deliver events to Webhook_Endpoints belonging to the Tenant where the event originated.
3. THE Dashboard SHALL restrict Delivery_Log visibility to the Tenant that owns the corresponding Webhook_Endpoint.
4. IF an API request references a Webhook_Endpoint or Delivery_Log belonging to a different Tenant, THEN THE Dashboard SHALL return a 403 Forbidden response.
5. WHEN listing Webhook_Endpoints or Delivery_Logs, THE Dashboard SHALL return only records belonging to the authenticated user's Tenant, ensuring that enumeration cannot reveal the existence of other Tenants' data.
