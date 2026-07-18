# Implementation Plan: CSV Import Upsert

## Overview

Convert the existing `POST /api/catalog/bulk` endpoint from a blind INSERT into an upsert operation with change detection, batch deduplication, and import summary response. The implementation is split into: database migration, pure logic module, endpoint refactoring, and frontend toast updates.

## Tasks

- [ ] 1. Database migration and schema update
  - [ ] 1.1 Create `sql/006-bulk-upsert.sql` migration file
    - Add `updated_at TIMESTAMPTZ DEFAULT now()` column to `products` table
    - Backfill existing rows: `UPDATE products SET updated_at = created_at WHERE updated_at IS NULL`
    - Create index `idx_products_tenant_name ON products(tenant_id, lower(trim(name)))` for efficient upsert matching
    - _Requirements: 1.1, 1.3_

- [ ] 2. Implement pure upsert logic module
  - [ ] 2.1 Create `upsert-logic.ts` with types and `normalizeName` function
    - Define interfaces: `IncomingProduct`, `ExistingProduct`, `UpsertAction`, `UpsertBatchResult`
    - Implement `normalizeName(name: string): string` — lowercase and trim
    - _Requirements: 1.1, 1.3_

  - [ ] 2.2 Implement `normalizeFields` function in `upsert-logic.ts`
    - Round `price` to 2 decimal places
    - Round `stock` to integer, defaulting to 0 if missing/NaN
    - Trim text fields (`description`, `image_url`), treat null/undefined/empty string as equivalent (normalize to `null`)
    - _Requirements: 2.3, 2.4, 3.4_

  - [ ] 2.3 Implement `hasChanges` function in `upsert-logic.ts`
    - Compare incoming normalized fields against existing product fields
    - Return `true` if at least one field differs, `false` otherwise
    - _Requirements: 2.1, 2.2_

  - [ ] 2.4 Implement `deduplicateBatch` function in `upsert-logic.ts`
    - Iterate through incoming products in array order
    - Build a `Map<string, IncomingProduct>` keyed by normalized name
    - Last occurrence wins for duplicate names within the batch
    - _Requirements: 1.4, 3.3_

  - [ ] 2.5 Implement `processUpsertBatch` function in `upsert-logic.ts`
    - Deduplicate incoming batch via `deduplicateBatch`
    - For each unique product, match against existing products by normalized name
    - When multiple existing products match (legacy duplicates), use the one with latest `created_at`
    - Classify each product as `insert`, `update`, or `unchanged` using `hasChanges`
    - Return `{ actions, toInsert, toUpdate, unchangedCount }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.3_

  - [ ]* 2.6 Write property test: Name Normalization (Property 1)
    - **Property 1: Name Normalization is Case-Insensitive and Trim-Invariant**
    - Use fast-check to verify `normalizeName` produces identical output regardless of casing or leading/trailing whitespace
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 2.7 Write property test: Batch Deduplication Last-Wins (Property 2)
    - **Property 2: Batch Deduplication Last-Wins**
    - Use fast-check to verify `deduplicateBatch` keeps only the last occurrence per normalized name
    - **Validates: Requirements 1.4, 3.3**

  - [ ]* 2.8 Write property test: Changed Products Classified as Updates (Property 3)
    - **Property 3: Changed Products are Classified as Updates**
    - Use fast-check to verify products with at least one differing field are classified as `update`
    - **Validates: Requirements 2.1**

  - [ ]* 2.9 Write property test: Identical Products Classified as Unchanged (Property 4)
    - **Property 4: Identical Products are Classified as Unchanged**
    - Use fast-check to verify products with all fields identical are classified as `unchanged`
    - **Validates: Requirements 2.2**

  - [ ]* 2.10 Write property test: Field Normalization Equivalences (Property 5)
    - **Property 5: Field Normalization Equivalences**
    - Use fast-check to verify normalizeFields treats null/undefined/empty as equivalent and rounds numeric fields correctly
    - **Validates: Requirements 2.3, 2.4, 3.4**

  - [ ]* 2.11 Write property test: Unmatched Products Classified as Inserts (Property 6)
    - **Property 6: Unmatched Products are Classified as Inserts**
    - Use fast-check to verify products with no matching existing product are classified as `insert`
    - **Validates: Requirements 3.1**

  - [ ]* 2.12 Write property test: Result Counts Partition (Property 7)
    - **Property 7: Result Counts are a Partition of the Deduplicated Batch**
    - Use fast-check to verify `toInsert.length + toUpdate.length + unchangedCount` always equals deduplicated batch size
    - **Validates: Requirements 4.1**

- [ ] 3. Checkpoint - Verify upsert logic module
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Refactor bulk endpoint in `server.ts`
  - [ ] 4.1 Add batch size validation to `POST /api/catalog/bulk`
    - Reject requests with more than 500 products with status 400 and message "Máximo 500 productos por importación"
    - _Requirements: 5.4_

  - [ ] 4.2 Implement existing product fetch and upsert orchestration
    - Import `processUpsertBatch` from `upsert-logic.ts`
    - Fetch all existing products for the tenant from the database
    - Call `processUpsertBatch` with incoming products and existing products
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1_

  - [ ] 4.3 Implement atomic database transaction for inserts and updates
    - Execute inserts for `toInsert` products (assign `tenant_id`) in a single operation
    - Execute updates for `toUpdate` products (update changed fields and `updated_at`)
    - Wrap both operations so that failure rolls back all changes (use InsForge RPC or sequential with error handling)
    - _Requirements: 3.2, 5.1, 5.2_

  - [ ] 4.4 Update endpoint response to include Import_Summary fields
    - Return `{ success: true, created: N, updated: N, unchanged: N }` on success
    - Return `{ error: "<reason>" }` with status 500 on transaction failure
    - Maintain backward compatibility: keep `success: true` field in response
    - _Requirements: 4.1, 5.2, 6.1, 6.2, 6.3_

  - [ ]* 4.5 Write unit tests for the updated bulk endpoint
    - Test 400 response for batch > 500 products
    - Test response shape includes `success`, `created`, `updated`, `unchanged`
    - Test that existing request format continues to work (backward compatibility)
    - _Requirements: 5.4, 6.1, 6.2, 6.3_

- [ ] 5. Checkpoint - Verify endpoint changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Update frontend CSV importer in `scripts/dashboard.js`
  - [ ] 6.1 Add 500-product client-side limit before sending
    - If `valid.length > 500`, show error toast "Máximo 500 productos por importación" without calling the endpoint
    - If `valid.length === 0` and `skipped > 0`, show toast "No se encontraron productos válidos en el archivo" without calling the endpoint
    - _Requirements: 5.3, 5.4_

  - [ ] 6.2 Update toast message to display Import_Summary counts
    - On successful response, display toast with `created`, `updated`, `unchanged` counts (e.g., "Importación: 3 creados, 2 actualizados, 5 sin cambios")
    - Include skipped rows count from client-side validation alongside the summary
    - When all CSV rows are invalid (zero valid products), display error toast indicating no valid products found
    - _Requirements: 4.2, 4.3, 4.4_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `upsert-logic.ts` module is intentionally pure (no I/O) for easy testing
- The database migration (`006-bulk-upsert.sql`) should be run manually against the InsForge database before testing the endpoint

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.4"] },
    { "id": 2, "tasks": ["2.3", "2.5"] },
    { "id": 3, "tasks": ["2.6", "2.7", "2.10", "2.11"] },
    { "id": 4, "tasks": ["2.8", "2.9", "2.12"] },
    { "id": 5, "tasks": ["4.1", "4.2"] },
    { "id": 6, "tasks": ["4.3"] },
    { "id": 7, "tasks": ["4.4", "4.5"] },
    { "id": 8, "tasks": ["6.1", "6.2"] }
  ]
}
```
