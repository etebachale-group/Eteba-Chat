# Requirements Document

## Introduction

Eteba Chat is a multi-tenant AI chat platform that currently supports a single hardcoded external database connection (Rotteri's MySQL via a PHP proxy). This feature generalizes the pattern so that any tenant can configure their own external database connector, enabling businesses of any type (e-commerce, clinics, restaurants, services) to connect their platform data to Eteba Chat through a standardized proxy protocol. The system handles connector configuration, health monitoring, dynamic routing, multi-business-type behavior adaptation, and provides template proxy files for easy integration.

## Glossary

- **Connector**: A configured external data bridge linking a tenant's database/system to Eteba Chat via a proxy endpoint
- **Proxy**: A server-side script (PHP, Node.js, or Python) hosted on the tenant's infrastructure that receives requests from Eteba Chat and queries the tenant's database
- **Connector_Registry**: The InsForge database table storing all tenant connector configurations
- **Router**: The server-side TypeScript module (router.ts) that dispatches chat queries to the appropriate data source based on tenant configuration
- **Dashboard**: The vanilla JS administrative interface where tenants manage their Eteba Chat settings
- **Business_Type**: A classification (ecommerce, appointments, services, restaurant, general) that determines which proxy actions and chat behaviors are available
- **Proxy_Protocol**: The standardized HTTP JSON API contract that all external proxies must implement
- **Health_Check**: An automated or manual verification that a configured connector responds correctly
- **Action**: A named operation in the proxy protocol (e.g., search_products, list_appointments, check_availability)
- **Connector_Token**: A shared secret used to authenticate requests between Eteba Chat and a tenant's proxy
- **Template_Generator**: A system that produces ready-to-deploy proxy files in supported languages based on business type

## Requirements

### Requirement 1: Connector Configuration Storage

**User Story:** As a tenant administrator, I want to store my external database connector configuration, so that Eteba Chat can communicate with my platform's data.

#### Acceptance Criteria

1. THE Connector_Registry SHALL store connector configurations with the following fields: tenant_id (UUID, required), proxy_url (string, required, maximum 2048 characters), connector_token (string, required, maximum 512 characters), business_type (string, optional, maximum 64 characters), display_name (string, required, maximum 128 characters), enabled (boolean, required, default true), created_at (timestamp), and updated_at (timestamp)
2. WHEN a connector configuration is created, THE Connector_Registry SHALL associate the connector with exactly one tenant_id and set created_at to the current timestamp
3. IF a tenant already has a connector configuration with enabled set to true and a request is made to create a new connector for the same tenant, THEN THE Connector_Registry SHALL reject the request with an error message indicating that only one active connector per tenant is allowed
4. WHEN a connector configuration is stored, THE Connector_Registry SHALL encrypt the connector_token value at rest such that the stored value is not retrievable as plaintext without decryption
5. WHEN a connector configuration is submitted with a proxy_url value, THE Connector_Registry SHALL validate that the value begins with "https://", is a syntactically valid URL, and does not exceed 2048 characters, before storing
6. IF a connector configuration is submitted with proxy_url failing HTTPS URL validation, THEN THE Connector_Registry SHALL reject the request with an error message indicating the URL must be a valid HTTPS URL and SHALL NOT persist the configuration
7. IF a connector configuration is submitted without all required fields (tenant_id, proxy_url, connector_token, display_name), THEN THE Connector_Registry SHALL reject the request with an error message indicating which required fields are missing

### Requirement 2: Connector CRUD Operations

**User Story:** As a tenant administrator, I want to create, read, update, and delete my connector configuration, so that I can manage my external database integration.

#### Acceptance Criteria

1. WHEN a tenant submits a connector configuration with all required fields (proxy_url, connector_token, business_type, display_name), THE Server SHALL create the connector record and return the created configuration with the connector_token masked to only its last 4 characters
2. IF a tenant submits a connector configuration with missing or invalid fields (proxy_url not a valid HTTPS URL, business_type not one of the defined Business_Type values, or display_name empty), THEN THE Server SHALL reject the request with a 400 status code and an error message indicating which fields failed validation
3. IF a tenant attempts to create a connector when they already have an active connector configuration, THEN THE Server SHALL reject the request with a 409 status code and an error message indicating a connector already exists for that tenant
4. WHEN a tenant requests their connector configuration, THE Server SHALL return all fields except the full connector_token (returning only the last 4 characters for display)
5. WHEN a tenant updates their connector configuration, THE Server SHALL apply the same validation rules as creation to any changed fields and persist the valid changes
6. WHEN a tenant deletes their connector configuration, THE Server SHALL remove the record and immediately cease all proxy communication for that tenant
7. IF a tenant attempts to read, update, or delete a connector that does not exist for their tenant_id, THEN THE Server SHALL respond with a 404 status code and an error message indicating no connector was found
8. IF a tenant attempts to modify a connector belonging to a different tenant, THEN THE Server SHALL reject the request with a 403 status code

### Requirement 3: Standardized Proxy Protocol

**User Story:** As an external platform developer, I want a clear API contract for my proxy endpoint, so that I can integrate my database with Eteba Chat.

#### Acceptance Criteria

1. THE Proxy_Protocol SHALL define requests as HTTP POST with Content-Type "application/json", a JSON body no larger than 64 KB containing an "action" string field (maximum 64 characters) and action-specific parameters
2. THE Proxy_Protocol SHALL require proxies to authenticate incoming requests via the X-Chat-Token header matching the configured Connector_Token using constant-time string comparison
3. WHEN a proxy receives a "ping" action, THE Proxy SHALL respond within 5000 milliseconds with {"status": "ok", "business_type": "<type>", "version": "1.0"}
4. THE Proxy_Protocol SHALL define responses as JSON objects with an action-specific data field and an optional "error" field for failure cases
5. IF a proxy receives a request with an invalid or missing token, THEN THE Proxy SHALL respond with HTTP 401 and {"error": "unauthorized"}
6. IF a proxy receives an unsupported action, THEN THE Proxy SHALL respond with HTTP 400 and {"error": "unknown_action", "action": "<received_action>"}
7. THE Proxy_Protocol SHALL define that all responses include a "meta" object with fields: timestamp (ISO 8601 format), action (string echoing the requested action), and execution_time_ms (integer, milliseconds)
8. IF a proxy receives a request with a malformed or unparseable JSON body, THEN THE Proxy SHALL respond with HTTP 400 and {"error": "invalid_json"}
9. IF a proxy does not respond within 10000 milliseconds, THEN THE calling system SHALL treat the request as failed and report a timeout error to the caller

### Requirement 4: E-commerce Business Type Actions

**User Story:** As an e-commerce platform owner, I want the chat to search my products and process orders, so that customers can shop through the AI assistant.

#### Acceptance Criteria

1. WHERE business_type is "ecommerce", THE Proxy_Protocol SHALL support the "search_products" action with parameters: term (string), limit (integer, max 50)
2. WHERE business_type is "ecommerce", THE Proxy_Protocol SHALL support the "get_product_detail" action with parameter: id (integer or string)
3. WHERE business_type is "ecommerce", THE Proxy_Protocol SHALL support the "list_categories" action with no required parameters
4. WHERE business_type is "ecommerce", THE Proxy_Protocol SHALL support the "insert_order" action with parameters: product_id, customer_name, customer_phone, delivery_city, and optional notes
5. WHERE business_type is "ecommerce", THE Proxy_Protocol SHALL define product objects with fields: id, name, price, stock, description, image_url
6. WHERE business_type is "ecommerce", THE Proxy_Protocol SHALL support the "list_stores" action with no required parameters for multi-vendor marketplaces

### Requirement 5: Appointments Business Type Actions

**User Story:** As a clinic or service business owner, I want the chat to check and book appointments, so that clients can schedule through the AI assistant.

#### Acceptance Criteria

1. WHERE business_type is "appointments", THE Proxy_Protocol SHALL support the "check_availability" action with parameters: date (ISO 8601 string), service_type (optional string)
2. WHERE business_type is "appointments", THE Proxy_Protocol SHALL support the "list_services" action returning available services with fields: id, name, duration_minutes, price
3. WHERE business_type is "appointments", THE Proxy_Protocol SHALL support the "book_appointment" action with parameters: service_id, client_name, client_phone, preferred_date, preferred_time
4. WHERE business_type is "appointments", THE Proxy_Protocol SHALL support the "cancel_appointment" action with parameter: appointment_id
5. WHERE business_type is "appointments", THE Proxy_Protocol SHALL define availability responses with fields: date, time_slots (array of {start, end, available})

### Requirement 6: Restaurant Business Type Actions

**User Story:** As a restaurant owner, I want the chat to show my menu and take orders, so that customers can order through the AI assistant.

#### Acceptance Criteria

1. WHERE business_type is "restaurant", THE Proxy_Protocol SHALL support the "get_menu" action with optional parameter: category (string)
2. WHERE business_type is "restaurant", THE Proxy_Protocol SHALL support the "check_item_availability" action with parameter: item_id
3. WHERE business_type is "restaurant", THE Proxy_Protocol SHALL support the "place_order" action with parameters: items (array of {item_id, quantity}), customer_name, customer_phone, delivery_address (optional), order_type (dine_in, takeout, delivery)
4. WHERE business_type is "restaurant", THE Proxy_Protocol SHALL define menu item objects with fields: id, name, description, price, category, available, image_url

### Requirement 7: General Services Business Type Actions

**User Story:** As a general service business owner, I want the chat to search my offerings and handle inquiries, so that clients can discover my services through the AI assistant.

#### Acceptance Criteria

1. WHERE business_type is "services", THE Proxy_Protocol SHALL support the "search" action with parameters: term (string), limit (integer, max 30)
2. WHERE business_type is "services", THE Proxy_Protocol SHALL support the "get_detail" action with parameter: id (string or integer)
3. WHERE business_type is "services", THE Proxy_Protocol SHALL support the "submit_inquiry" action with parameters: service_id, client_name, client_phone, message
4. WHERE business_type is "services", THE Proxy_Protocol SHALL define service objects with fields: id, name, description, price (optional), availability, image_url (optional)

### Requirement 8: Dynamic Router Generalization

**User Story:** As the system, I want to dynamically route chat queries to the correct external proxy based on tenant configuration, so that each tenant's connector is used without hardcoded logic.

#### Acceptance Criteria

1. WHEN a chat query is received for a tenant whose Connector_Registry record has enabled=true and status≠"error", THE Router SHALL fetch the connector configuration from the Connector_Registry and dispatch the query to the configured proxy_url
2. WHEN the Router dispatches a request to an external proxy, THE Router SHALL include the X-Chat-Token header with the tenant's configured Connector_Token
3. WHEN a tenant has no Connector_Registry record, or their record has enabled=false or status="error", THE Router SHALL fall back to the existing InsForge-based product search (Postgres) for that query
4. THE Router SHALL cache connector configurations in memory with a time-to-live of 5 minutes, and SHALL evict a tenant's cached entry when that tenant's connector configuration is updated or deleted via the CRUD API
5. IF the external proxy returns an HTTP status code outside the 200–299 range, returns a response body that is not valid JSON, or fails to respond within the configured timeout, THEN THE Router SHALL log the failure details (tenant_id, proxy_url, error type) and respond to the user with a message indicating the data source is temporarily unavailable while preserving the conversation state
6. THE Router SHALL set a request timeout of 8 seconds for all external proxy calls
7. WHEN the Router processes a query, THE Router SHALL select the proxy action by mapping the heuristic intent classification result to the action set defined for the tenant's configured business_type (as specified in Requirements 4–7)

### Requirement 9: Dashboard Connector Management UI

**User Story:** As a tenant administrator, I want a visual interface to configure and manage my external connector, so that I can set up the integration without technical knowledge of the API.

#### Acceptance Criteria

1. THE Dashboard SHALL display a "Data Connector" section within the tenant settings area
2. THE Dashboard SHALL provide a form with fields: display name, proxy URL, connector token, and business type selector
3. WHEN the administrator submits the connector form, THE Dashboard SHALL validate that all required fields are filled and the URL starts with "https://"
4. THE Dashboard SHALL display the current connector status (active, inactive, error) with a visual indicator
5. THE Dashboard SHALL provide a "Test Connection" button that triggers a ping action against the configured proxy URL
6. WHEN the "Test Connection" succeeds, THE Dashboard SHALL display a success message with the proxy's reported business_type and version
7. IF the "Test Connection" fails, THEN THE Dashboard SHALL display the specific error (timeout, auth failure, unreachable) with troubleshooting guidance

### Requirement 10: Connection Health Checking

**User Story:** As a tenant administrator, I want automated health monitoring of my connector, so that I know when my proxy is down or misconfigured.

#### Acceptance Criteria

1. WHEN a connector's proxy fails to respond to 3 consecutive requests during normal chat usage, THE Health_Check SHALL mark the connector status as "error"
2. WHEN a connector status changes to "error", THE Health_Check SHALL record the failure timestamp and last error message in the Connector_Registry
3. WHEN a manual "Test Connection" succeeds for a connector in "error" status, THE Health_Check SHALL reset the connector status to "active"
4. THE Health_Check SHALL expose the connector health status through the existing /api/config endpoint for dashboard display

### Requirement 11: Security and Authentication

**User Story:** As the platform operator, I want secure communication between Eteba Chat and external proxies, so that tenant data is protected from unauthorized access.

#### Acceptance Criteria

1. WHEN a tenant requests token generation, THE Server SHALL generate a connector token using cryptographically secure random values of at least 32 bytes encoded as a 64-character hexadecimal string
2. THE Server SHALL transmit connector tokens only over HTTPS connections (proxy_url must use https:// scheme)
3. IF a tenant submits a proxy_url that does not use the https:// scheme, THEN THE Server SHALL reject the configuration with an error message indicating that HTTPS is required
4. WHEN the Router sends a request to an external proxy, THE Router SHALL include the token exclusively in the X-Chat-Token HTTP header
5. THE Server SHALL rate-limit proxy calls to a maximum of 60 requests per minute per tenant using a sliding time window
6. IF a tenant exceeds the rate limit, THEN THE Server SHALL respond with HTTP 429 and include a Retry-After header specifying the number of seconds until the next request is allowed
7. WHEN an authenticated user requests connector configuration changes, THE Server SHALL verify that the user is the owner of the target tenant before applying changes
8. IF the authenticated user does not own the target tenant, THEN THE Server SHALL reject the connector configuration request with HTTP 403 and an error message indicating insufficient ownership permissions

### Requirement 12: Template Proxy Generation

**User Story:** As an external platform developer, I want ready-to-use proxy template files for my technology stack, so that I can quickly deploy the integration without building from scratch.

#### Acceptance Criteria

1. THE Template_Generator SHALL produce proxy templates in PHP, Node.js (Express), and Python (Flask)
2. WHEN a template is generated, THE Template_Generator SHALL include all required actions for the selected business_type with placeholder database queries
3. THE Template_Generator SHALL include token validation logic, CORS headers, and error handling in all templates
4. THE Template_Generator SHALL include inline documentation explaining each action's expected input and output format
5. WHEN a tenant requests a template from the Dashboard, THE Template_Generator SHALL pre-fill the template with the tenant's configured connector_token
6. THE Template_Generator SHALL include a "ping" action implementation in all templates that returns the correct protocol response

### Requirement 13: Backward Compatibility with Rotteri

**User Story:** As the platform operator, I want the existing Rotteri integration to continue working without changes to Rotteri's proxy, so that the migration to the generalized system is non-disruptive.

#### Acceptance Criteria

1. WHEN the system starts with environment variables ROTTERI_PROXY_URL and ROTTERI_PROXY_TOKEN both set to non-empty values, THE Router SHALL route requests for Rotteri's tenant_id to ROTTERI_PROXY_URL using ROTTERI_PROXY_TOKEN as the authentication header, without requiring a Connector_Registry record
2. WHEN a connector record exists in the Connector_Registry for Rotteri's tenant_id, THE Router SHALL use exclusively the database-configured connector and ignore ROTTERI_PROXY_URL and ROTTERI_PROXY_TOKEN environment variables
3. THE Router SHALL map Rotteri's existing proxy actions (search_products, insert_order, list_stores, get_product_detail) to the standardized ecommerce protocol by translating each action request into its corresponding protocol operation and returning results in the protocol's response format, without requiring changes to Rotteri's PHP proxy
4. IF ROTTERI_PROXY_URL is set but ROTTERI_PROXY_TOKEN is empty or missing, THEN THE Router SHALL log a configuration warning at startup and reject requests for Rotteri's tenant_id with an error indicating incomplete connector configuration
5. IF neither environment variables nor a Connector_Registry record are available for Rotteri's tenant_id, THEN THE Router SHALL treat Rotteri requests as having no ecommerce connector and return an error indicating that no connector is configured for the tenant

### Requirement 14: Chat Behavior Adaptation

**User Story:** As a tenant, I want the AI chat to adapt its conversation style and intent detection based on my business type, so that the assistant feels natural for my industry.

#### Acceptance Criteria

1. WHEN a tenant has a configured connector with business_type "ecommerce", THE Router SHALL use product-search-oriented intent classification keywords
2. WHEN a tenant has a configured connector with business_type "appointments", THE Router SHALL use scheduling-oriented intent classification keywords (availability, book, cancel, reschedule)
3. WHEN a tenant has a configured connector with business_type "restaurant", THE Router SHALL use menu-oriented intent classification keywords (menu, order, dish, available today)
4. WHEN generating the LLM system prompt, THE Router SHALL include business-type-specific instructions from the Proxy_Protocol metadata
5. WHEN a connector business_type is configured, THE Router SHALL adjust the heuristic classifier to prioritize actions relevant to that business type over generic defaults
