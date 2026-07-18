# Requirements Document

## Introduction

This document specifies the requirements for completing the missing functionality in the Eteba Chat administration dashboard. The dashboard currently has several tabs with partial or non-functional features. This spec covers: product editing, product deletion, conversations tab, full orders listing, CSV import, API key generation, and query count metrics.

## Glossary

- **Dashboard**: The Eteba Chat admin panel accessible at `/#dashboard`
- **Tenant**: A business account identified by a unique UUID (stored in `companies` table)
- **Product_Modal**: The dialog component used to create or edit products in the catalog
- **Catalog_API**: The Express endpoint at `/api/catalog` that handles product CRUD operations
- **Orders_API**: The Express endpoint at `/api/orders` that retrieves orders for a tenant
- **CSV_Parser**: The client-side module that reads and validates CSV files for bulk product import
- **Query_Tracker**: The server-side module that records and counts chat queries per tenant
- **API_Key_Generator**: The server-side module that creates and stores authentication tokens for tenants
- **Confirmation_Dialog**: A modal that asks the user to confirm destructive actions before executing them

## Requirements

### Requirement 1: Edit Product

**User Story:** As a business admin, I want to edit existing products in my catalog, so that I can keep product information up to date.

#### Acceptance Criteria

1. WHEN the admin clicks the "Editar" button on a product row, THE Product_Modal SHALL open pre-filled with that product's current name, description, price, stock, and image_url values
2. WHEN the admin submits the edit form with valid data, THE Catalog_API SHALL update the product record matching the product ID via a PUT request
3. WHEN the product is updated successfully, THE Dashboard SHALL refresh the catalog table to reflect the changes
4. IF the update request fails, THEN THE Dashboard SHALL display an error toast with a descriptive message

### Requirement 2: Delete Product

**User Story:** As a business admin, I want to delete products from my catalog, so that I can remove items that are no longer available.

#### Acceptance Criteria

1. THE Dashboard SHALL display a "Eliminar" button on each product row in the catalog table
2. WHEN the admin clicks the "Eliminar" button, THE Confirmation_Dialog SHALL appear asking the admin to confirm the deletion
3. WHEN the admin confirms the deletion, THE Catalog_API SHALL delete the product record matching the product ID via a DELETE request
4. WHEN the product is deleted successfully, THE Dashboard SHALL refresh the catalog table and display a success toast
5. WHEN the admin cancels the deletion, THE Confirmation_Dialog SHALL close without performing any action

### Requirement 3: Conversations Tab

**User Story:** As a business admin, I want to view recent chat conversations, so that I can understand what customers are asking.

#### Acceptance Criteria

1. WHEN the admin navigates to the Conversaciones tab, THE Dashboard SHALL fetch recent queries for the tenant from the Query_Tracker
2. WHEN queries exist, THE Dashboard SHALL display them in a table with columns: query text, timestamp, and user identifier if available
3. WHEN no queries exist, THE Dashboard SHALL display a message indicating no conversations have been recorded yet
4. THE Dashboard SHALL order conversations from most recent to oldest
5. THE Dashboard SHALL limit the displayed conversations to the 50 most recent entries

### Requirement 4: Full Orders Listing

**User Story:** As a business admin, I want to view all my orders (not just the 5 most recent), so that I can have a complete view of my sales history.

#### Acceptance Criteria

1. WHEN the admin navigates to the Pedidos tab, THE Orders_API SHALL return all orders for the tenant without limiting to 5 records
2. THE Dashboard SHALL display all orders in a table with columns: product name, client name, delivery city, and date
3. THE Dashboard SHALL order the list from most recent to oldest
4. IF the orders request fails, THEN THE Dashboard SHALL display a user-friendly error message in the tab

### Requirement 5: CSV Product Import

**User Story:** As a business admin, I want to import products from a CSV file, so that I can bulk-add my catalog without entering each product manually.

#### Acceptance Criteria

1. WHEN the admin clicks the "Importar CSV" button, THE Dashboard SHALL open a file input dialog accepting only `.csv` files
2. WHEN a valid CSV file is selected, THE CSV_Parser SHALL parse the file expecting columns: name, description, price, stock, image_url
3. WHEN parsing completes successfully, THE Catalog_API SHALL receive a bulk insert request with all parsed products
4. WHEN the bulk insert succeeds, THE Dashboard SHALL refresh the catalog table and display a success toast with the count of imported products
5. IF the CSV file contains rows with missing required fields (name, price), THEN THE CSV_Parser SHALL skip those rows and report the count of skipped rows to the admin
6. IF the CSV file cannot be parsed, THEN THE Dashboard SHALL display an error toast indicating the file format is invalid

### Requirement 6: Generate API Key

**User Story:** As a business admin, I want to generate an API key for my tenant, so that I can authenticate programmatic access to the platform.

#### Acceptance Criteria

1. WHEN the admin clicks the "Generar API Key" button, THE API_Key_Generator SHALL create a unique token associated with the tenant
2. WHEN the key is generated successfully, THE Dashboard SHALL display the new key in the API Keys section
3. THE API_Key_Generator SHALL store the generated key in the database associated with the tenant ID
4. THE Dashboard SHALL allow the admin to copy the generated key to clipboard with a single click
5. IF the key generation fails, THEN THE Dashboard SHALL display an error toast with a descriptive message

### Requirement 7: Query Count Metrics

**User Story:** As a business admin, I want to see how many chat queries my assistant has received, so that I can understand usage and engagement.

#### Acceptance Criteria

1. WHEN a chat query is processed via `/api/query`, THE Query_Tracker SHALL increment a counter for the corresponding tenant
2. WHEN the admin loads the Overview tab, THE Dashboard SHALL fetch the total query count for the tenant and display it in the metrics section
3. THE Dashboard SHALL display the query count as an integer number replacing the current "—" placeholder
4. IF the query count cannot be retrieved, THEN THE Dashboard SHALL display "0" as the default value
