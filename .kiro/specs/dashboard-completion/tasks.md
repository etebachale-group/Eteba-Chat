# Implementation Plan: Dashboard Completion

## Overview

This plan implements seven missing features in the Eteba Chat administration dashboard: product editing, product deletion, conversations tab, full orders listing, CSV product import, API key generation, and query count metrics. The implementation extends the existing Express server (TypeScript) with new API endpoints and enhances the vanilla JavaScript frontend with corresponding UI interactions. Database schema changes are handled via SQL migration files.

## Tasks

- [x] 1. Database schema migration for new tables
  - [x] 1.1 Create SQL migration file `sql/005-dashboard-completion.sql`
    - Create `api_keys` table with columns: id (UUID PK), tenant_id (FK to companies), key_value (TEXT UNIQUE), label (TEXT DEFAULT 'default'), created_at (TIMESTAMPTZ)
    - Create `query_counts` table with columns: id (UUID PK), tenant_id (FK to companies), query_text (TEXT), user_id (TEXT), created_at (TIMESTAMPTZ)
    - Add indexes: `idx_api_keys_tenant` on api_keys(tenant_id), `idx_query_counts_tenant` on query_counts(tenant_id), `idx_query_counts_created` on query_counts(created_at DESC)
    - _Requirements: 6.3, 7.1_

- [x] 2. Implement Product Edit API and frontend
  - [x] 2.1 Add PUT `/api/catalog/:id` endpoint in `server.ts`
    - Accept body with tenantId, name, description, price, stock, image_url
    - Validate tenantId and name are present (400 if missing)
    - Verify product exists and belongs to tenant (404/403 if not)
    - Update product via InsForge `database.from('products').update(...).eq('id', id).eq('tenant_id', tenantId)`
    - Return `{ success: true, product }` on success
    - _Requirements: 1.2, 1.4_

  - [x] 2.2 Update `showProductModal()` in `scripts/dashboard.js` for edit mode
    - When `product` argument is passed, pre-fill all form fields with product data
    - Change modal title to "Editar Producto/Servicio" and button to "Actualizar"
    - On save in edit mode, send PUT to `/api/catalog/${product.id}` instead of POST
    - On success, refresh catalog table and show success toast
    - On failure, show error toast with message
    - _Requirements: 1.1, 1.3, 1.4_

  - [x] 2.3 Wire "Editar" buttons in catalog table to open edit modal
    - In `loadCatalog()`, attach click handlers to `[data-edit-product]` buttons
    - Fetch product data and pass to `showProductModal(product)`
    - _Requirements: 1.1_

  - [ ]* 2.4 Write property test for product update round-trip
    - **Property 1: Product update round-trip**
    - **Validates: Requirements 1.2**

- [x] 3. Implement Product Delete API and frontend
  - [x] 3.1 Add DELETE `/api/catalog/:id` endpoint in `server.ts`
    - Accept tenantId from query param or body
    - Verify product exists and belongs to tenant (404/403 if not)
    - Delete via InsForge `database.from('products').delete().eq('id', id).eq('tenant_id', tenantId)`
    - Return `{ success: true }` on success
    - _Requirements: 2.3_

  - [x] 3.2 Implement `showConfirmDialog(message)` in `scripts/dashboard.js`
    - Create a reusable confirmation modal that returns a `Promise<boolean>`
    - Resolve `true` on confirm click, `false` on cancel click or overlay click
    - Style with existing modal CSS patterns
    - _Requirements: 2.2, 2.5_

  - [x] 3.3 Add "Eliminar" button to product rows and wire delete flow
    - Add "Eliminar" button in `loadCatalog()` table rows alongside "Editar"
    - On click, call `showConfirmDialog("¿Estás seguro de eliminar este producto?")`
    - On confirm, send DELETE to `/api/catalog/${productId}?tenantId=xxx`
    - On success, refresh catalog and show success toast
    - On cancel, do nothing
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 3.4 Write property test for product delete invariant
    - **Property 2: Product delete invariant**
    - **Validates: Requirements 2.3**

- [x] 4. Checkpoint - Ensure product CRUD works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Query Tracker and Conversations Tab
  - [x] 5.1 Add query tracking logic to POST `/api/query` handler in `server.ts`
    - After successful query response, insert a record into `query_counts` table with tenant_id, query_text (prompt), user_id, and created_at
    - Keep tracking non-blocking (do not await or fail the main response if insert fails)
    - _Requirements: 7.1_

  - [x] 5.2 Add GET `/api/conversations` endpoint in `server.ts`
    - Accept `tenantId` and optional `limit` (default 50) as query params
    - Query `query_counts` table filtered by tenant_id, ordered by created_at DESC, limited to 50
    - Return `{ conversations: [...] }` with id, query_text, user_id, created_at
    - _Requirements: 3.1, 3.4, 3.5_

  - [x] 5.3 Add GET `/api/metrics/queries` endpoint in `server.ts`
    - Accept `tenantId` as query param
    - Count rows in `query_counts` for that tenant
    - Return `{ count: number }`
    - _Requirements: 7.2_

  - [x] 5.4 Implement `loadConversations(tenantId)` in `scripts/dashboard.js`
    - Fetch from `/api/conversations?tenantId=xxx`
    - Render table with columns: query text, timestamp (formatted), user identifier (or "Anónimo" placeholder)
    - Show "No hay conversaciones registradas aún" when empty
    - Wire to Conversaciones tab activation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.5 Implement `loadQueryMetrics(tenantId)` in `scripts/dashboard.js`
    - Fetch from `/api/metrics/queries?tenantId=xxx`
    - Update `#val-queries` element with the integer count
    - Default to "0" on fetch failure
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 5.6 Write property test for conversations limited and ordered
    - **Property 3: Conversations limited and ordered**
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 5.7 Write property test for query counter monotonic increment
    - **Property 11: Query counter monotonic increment**
    - **Validates: Requirements 7.1**

- [x] 6. Implement Full Orders Listing
  - [x] 6.1 Update GET `/api/orders` endpoint in `server.ts` to remove `.limit(20)`
    - Remove the `.limit(20)` from the existing orders query
    - Keep ordering by `created_at` descending
    - _Requirements: 4.1, 4.3_

  - [x] 6.2 Update `loadRecentOrders(tenantId)` in `scripts/dashboard.js` to show all orders
    - Remove the `.slice(0, 5)` from the render logic
    - Ensure table shows all orders with columns: product name, client name, delivery city, formatted date
    - Show error message in tab if fetch fails
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 6.3 Write property test for orders API returns all records ordered descending
    - **Property 5: Orders API returns all records ordered descending**
    - **Validates: Requirements 4.1, 4.3**

- [x] 7. Checkpoint - Ensure conversations, metrics, and orders work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement CSV Product Import
  - [x] 8.1 Add POST `/api/catalog/bulk` endpoint in `server.ts`
    - Accept body with `tenantId` and `products` array
    - Validate array is non-empty (400 if empty)
    - Bulk insert via InsForge `database.from('products').insert(products.map(p => ({ tenant_id: tenantId, ...p })))`
    - Return `{ success: true, inserted: count }`
    - _Requirements: 5.3_

  - [x] 8.2 Implement `parseCSV(csvText)` function in `scripts/dashboard.js`
    - Parse header row to identify column positions (name, description, price, stock, image_url)
    - For each data row: extract fields, validate name is non-empty and price is numeric
    - Return `{ valid: Product[], skipped: number }`
    - Skip rows with missing name or non-numeric price
    - Handle quoted fields with commas inside
    - _Requirements: 5.2, 5.5_

  - [x] 8.3 Implement `handleCSVImport(tenantId)` in `scripts/dashboard.js`
    - Create hidden file input accepting only `.csv` files
    - On file selected, read with FileReader as text
    - Parse with `parseCSV()`, then POST valid products to `/api/catalog/bulk`
    - On success: refresh catalog, show toast with imported count and skipped count
    - On parse failure: show error toast "El formato del archivo no es válido"
    - Wire to "Importar CSV" button
    - _Requirements: 5.1, 5.4, 5.6_

  - [ ]* 8.4 Write property test for CSV parsing correctness
    - **Property 7: CSV parsing correctness**
    - **Validates: Requirements 5.2, 5.5**

  - [ ]* 8.5 Write property test for bulk insert persists all products
    - **Property 8: Bulk insert persists all products**
    - **Validates: Requirements 5.3**

- [x] 9. Implement API Key Generation
  - [x] 9.1 Add POST `/api/keys/generate` endpoint in `server.ts`
    - Accept body with `tenantId`
    - Generate key using `crypto.randomBytes(32).toString('hex')`
    - Insert into `api_keys` table with tenant_id and key_value
    - Return `{ success: true, key: generatedKey }`
    - Handle DB errors with 500 response
    - _Requirements: 6.1, 6.3, 6.5_

  - [x] 9.2 Implement `generateApiKey(tenantId)` in `scripts/dashboard.js`
    - POST to `/api/keys/generate` with tenantId
    - On success, display the key in the API Keys section of the dashboard
    - Add a "Copiar" button that copies the key to clipboard using `navigator.clipboard.writeText()`
    - On failure, show error toast
    - Wire to "Generar API Key" button
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

  - [ ]* 9.3 Write property test for API key uniqueness
    - **Property 9: API key uniqueness**
    - **Validates: Requirements 6.1**

  - [ ]* 9.4 Write property test for API key persistence round-trip
    - **Property 10: API key persistence round-trip**
    - **Validates: Requirements 6.3**

- [x] 10. Final integration and wiring
  - [x] 10.1 Wire all tab activations and data loading in `scripts/dashboard.js`
    - On Conversaciones tab click: call `loadConversations(tenantId)`
    - On Pedidos tab click: call full orders load (updated function)
    - On Overview tab load: call `loadQueryMetrics(tenantId)`
    - Ensure "Importar CSV" button exists in catalog tab and triggers `handleCSVImport()`
    - Ensure "Generar API Key" button exists in API Keys section and triggers `generateApiKey()`
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 7.2_

  - [ ]* 10.2 Write integration tests for full flows
    - Test: create → edit → verify → delete → verify gone
    - Test: import CSV → verify products in catalog → verify count toast
    - Test: send queries → check conversations tab → check metrics count
    - Test: generate API key → verify stored → verify displayed
    - _Requirements: 1.1-1.4, 2.1-2.5, 3.1-3.5, 4.1-4.4, 5.1-5.6, 6.1-6.5, 7.1-7.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The server uses TypeScript and the frontend uses vanilla JavaScript, matching existing project conventions
- Database operations use the InsForge SDK pattern: `insforge.database.from('table').method()`
- All new endpoints follow the existing error handling pattern: `res.status(code).json({ error: message })`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "5.2", "5.3", "8.1", "9.1"] },
    { "id": 3, "tasks": ["2.4", "3.3", "5.4", "5.5", "6.2", "8.2", "9.2"] },
    { "id": 4, "tasks": ["3.4", "5.6", "5.7", "6.3", "8.3", "9.3", "9.4"] },
    { "id": 5, "tasks": ["8.4", "8.5", "10.1"] },
    { "id": 6, "tasks": ["10.2"] }
  ]
}
```
