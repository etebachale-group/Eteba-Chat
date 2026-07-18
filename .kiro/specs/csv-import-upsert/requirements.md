# Requirements Document

## Introduction

Enhancement to the existing CSV product import feature in the Eteba Chat dashboard. Currently, `POST /api/catalog/bulk` performs a blind INSERT of every row, creating duplicates when the same product is imported again. This feature converts the bulk import into an upsert operation: products that already exist (matched by name within the same tenant) are updated only if any field has changed, and new products are inserted. The response provides a clear breakdown of what was created, updated, and skipped.

## Glossary

- **Bulk_Import_Endpoint**: The `POST /api/catalog/bulk` API endpoint in `server.ts` that receives an array of product objects from the frontend CSV import flow.
- **CSV_Importer**: The client-side module in `scripts/dashboard.js` responsible for parsing the CSV file, validating rows, and sending valid products to the Bulk_Import_Endpoint.
- **Product**: A row in the `products` table identified by id, belonging to a tenant, with fields: name, description, price, stock, image_url.
- **Tenant**: A company/business identified by tenant_id. Product uniqueness is scoped within a single Tenant.
- **Match_Key**: The combination of `tenant_id` and `name` (case-insensitive) used to determine if a product already exists in the catalog.
- **Change_Detection**: The process of comparing an incoming product's fields (description, price, stock, image_url) against the existing product's fields to determine if an update is necessary.
- **Import_Summary**: The response object returned by the Bulk_Import_Endpoint detailing how many products were created, updated, and unchanged.

## Requirements

### Requirement 1: Product Matching by Name Within Tenant

**User Story:** As a dashboard user, I want the import to recognize products that already exist in my catalog by name, so that I do not get duplicate entries.

#### Acceptance Criteria

1. WHEN a CSV row is processed, THE Bulk_Import_Endpoint SHALL identify an existing product by performing a case-insensitive match on the `name` field scoped to the current `tenant_id`.
2. WHEN multiple products in the database share the same tenant_id and name (legacy duplicates), THE Bulk_Import_Endpoint SHALL match against the most recently created product (latest `created_at`).
3. THE Bulk_Import_Endpoint SHALL treat leading and trailing whitespace in the product name as insignificant for matching purposes, comparing names after trimming both the incoming value and the stored value.
4. WHEN two or more rows in the same CSV batch share the same product name (after case-insensitive trimmed comparison), THE Bulk_Import_Endpoint SHALL process them in row order so that the last occurrence determines the final state of that product.

### Requirement 2: Conditional Update on Change

**User Story:** As a dashboard user, I want only changed products to be updated during import, so that unchanged products are not touched unnecessarily.

#### Acceptance Criteria

1. WHEN a matching product is found and at least one field (description, price, stock, image_url) differs between the incoming row and the existing product, THE Bulk_Import_Endpoint SHALL update all four compared fields on the existing product with the incoming row's values.
2. WHEN a matching product is found and all fields (description, price, stock, image_url) are identical to the existing product, THE Bulk_Import_Endpoint SHALL skip the row without performing any database write and without modifying the existing product's `updated_at` timestamp.
3. THE Change_Detection SHALL compare numeric fields (price, stock) by value equality after rounding to 2 decimal places for price and to integer for stock, and text fields (description, image_url) by trimmed string equality, treating null, undefined, and empty string as equivalent.
4. IF an incoming row omits an optional field (description, stock, or image_url is not present in the row), THEN THE Bulk_Import_Endpoint SHALL treat the missing field as null for both comparison and update purposes.

### Requirement 3: Insert New Products

**User Story:** As a dashboard user, I want new products in the CSV to be added to my catalog, so that I can grow my product list through import.

#### Acceptance Criteria

1. WHEN no existing product matches the incoming row's name for the given tenant_id, THE Bulk_Import_Endpoint SHALL insert a new product with all provided fields (name, description, price, stock, image_url).
2. THE Bulk_Import_Endpoint SHALL assign the current tenant_id to every newly inserted product.
3. WHEN multiple rows in the same CSV batch share the same name (case-insensitive, trimmed) and no existing product matches that name, THE Bulk_Import_Endpoint SHALL insert only one product for that name, using the values from the last occurrence in the batch.
4. WHEN inserting a new product with optional fields (description, stock, image_url) not provided, THE Bulk_Import_Endpoint SHALL store null for text fields and 0 for stock.

### Requirement 4: Import Summary Response

**User Story:** As a dashboard user, I want to see a summary of what happened during the import, so that I know how many products were created, updated, or left unchanged.

#### Acceptance Criteria

1. WHEN the import operation completes successfully, THE Bulk_Import_Endpoint SHALL return a JSON response with HTTP status 200 containing: `created` (number of new products inserted), `updated` (number of existing products modified), and `unchanged` (number of existing products skipped).
2. WHEN the CSV_Importer receives a successful response from the Bulk_Import_Endpoint, THE CSV_Importer SHALL display a toast message including the counts from the Import_Summary (created, updated, unchanged).
3. WHEN the import contains rows that were skipped due to validation errors, THE CSV_Importer SHALL include the skipped count in the toast message alongside the Import_Summary counts.
4. IF all rows in the CSV are skipped due to validation errors and zero products are sent to the Bulk_Import_Endpoint, THEN THE CSV_Importer SHALL display a toast message indicating that no products were imported and showing the total number of skipped rows.

### Requirement 5: Atomicity and Error Handling

**User Story:** As a dashboard user, I want the import to either fully succeed or report clear errors, so that my catalog does not end up in a partial state.

#### Acceptance Criteria

1. THE Bulk_Import_Endpoint SHALL process all rows in a single database transaction so that either all changes (inserts and updates) are committed or none are.
2. IF the database transaction fails, THEN THE Bulk_Import_Endpoint SHALL roll back all changes, preserve the catalog in its pre-import state, and return a JSON response with status 500 containing an `error` field with a message indicating the reason for the failure.
3. IF the request body contains zero valid products after the frontend validation, THEN THE CSV_Importer SHALL display an error toast indicating that no valid products were found in the file, without calling the Bulk_Import_Endpoint.
4. IF the request body contains more than 500 products, THEN THE Bulk_Import_Endpoint SHALL reject the request with status 400 and an error message indicating the maximum allowed batch size.

### Requirement 6: Backward Compatibility

**User Story:** As a developer, I want the updated endpoint to remain compatible with the existing API contract, so that no other consumers break.

#### Acceptance Criteria

1. THE Bulk_Import_Endpoint SHALL continue to accept the same request format: `{ tenantId: string, products: Array<{ name, description?, price, stock?, image_url? }> }`.
2. THE Bulk_Import_Endpoint SHALL include a `success: true` field in successful responses alongside the Import_Summary fields.
3. WHEN the endpoint is called with the existing request format, THE Bulk_Import_Endpoint SHALL function without requiring any changes to the caller's request structure.
