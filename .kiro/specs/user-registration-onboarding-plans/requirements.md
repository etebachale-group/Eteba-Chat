# Requirements Document

## Introduction

Eteba Chat currently authenticates users exclusively through Google OAuth with no structured onboarding after sign-in. New tenants land directly on the dashboard without understanding the platform, without selecting a plan, and without configuring basic settings. This feature introduces a complete registration and onboarding flow: a sign-up page with Google OAuth and optional email/password registration, a multi-step onboarding wizard that guides new tenants through business setup, and a subscription plan system (Free, Starter, Business, Enterprise) that enforces usage limits throughout the platform. The system covers plan selection at sign-up, trial periods, usage enforcement, plan upgrades and downgrades, and billing management.

## Glossary

- **Registration_Flow**: The sequence of screens from the initial sign-up action through account creation and into onboarding
- **Onboarding_Wizard**: The multi-step guided setup process presented to new tenants after their first sign-in
- **Onboarding_Step**: A single screen in the Onboarding_Wizard with a focused task (e.g., name the business, select plan, configure assistant)
- **Plan**: A subscription tier (Free, Starter, Business, Enterprise) with defined limits and features
- **Plan_Limits**: Quantitative constraints associated with a Plan (e.g., monthly query cap, number of products, number of connectors)
- **Subscription**: A record associating a tenant with a Plan, billing cycle, status, and renewal date
- **Trial**: A time-bounded period (14 days) during which a tenant has access to Business-tier features without payment
- **Usage_Tracker**: The system component that records and checks a tenant's consumption against their Plan_Limits
- **Enforcement_Gate**: A middleware check that blocks an action when the tenant has exceeded their Plan_Limits
- **Billing_Portal**: The UI section where tenants view their current plan, usage, and manage upgrades or downgrades
- **Plan_Badge**: A visual indicator in the Dashboard showing the tenant's current plan tier
- **Onboarding_Progress**: The percentage or step count tracking how far a tenant has advanced in the Onboarding_Wizard
- **Business_Type**: An existing classification (ecommerce, appointments, services, restaurant, general) reused from the connector system
- **Tenant**: A business account in Eteba Chat (stored in the `companies` table), owned by a user
- **Server**: The Express/TypeScript API backend (server.ts)
- **Dashboard**: The vanilla JS administrative interface (scripts/dashboard.js + index.html)
- **Registration_Page**: A dedicated sign-up page or modal accessible from the landing page CTA

## Requirements

---

### Requirement 1: Registration Page and Sign-Up Flow

**User Story:** As a prospective tenant, I want a clear registration page where I can create my account, so that I can start using Eteba Chat for my business.

#### Acceptance Criteria

1. THE Registration_Page SHALL display a sign-up form with the following options: "Continue with Google" (OAuth) and an email/password form with fields for full name, email address, password (minimum 8 characters), and password confirmation
2. WHEN a visitor clicks any "Get Started", "Registrarse", or "Sign Up" CTA on the landing page, THE Registration_Page SHALL be presented without navigating away from the single-page app
3. WHEN a user submits the email/password form with all required fields valid, THE Server SHALL create a new user record and a corresponding `companies` record with default values, set the user's `role` to "tenant", and return an auth token
4. IF a user submits the email/password form with an email that already exists in the `users` table, THEN THE Server SHALL reject the registration with an error message indicating the email is already registered and offering a "Sign In" link
5. IF a user submits the email/password form with a password shorter than 8 characters or where password and confirmation do not match, THEN THE Registration_Page SHALL display an inline error indicating the validation failure before submitting to the server
6. WHEN a user completes Google OAuth and their email does not exist in the `users` table, THE Server SHALL create a new user and company record and redirect to the Onboarding_Wizard
7. WHEN a user completes Google OAuth and their email already exists in the `users` table, THE Server SHALL sign them in and redirect to the Dashboard (skipping onboarding if already completed)
8. THE Registration_Page SHALL display a "Already have an account? Sign In" link that presents the login form
9. WHEN a new account is created via any method, THE Server SHALL send a welcome email to the registered email address containing the user's name and a link to the platform

---

### Requirement 2: Multi-Step Onboarding Wizard

**User Story:** As a newly registered tenant, I want a guided onboarding wizard after sign-up, so that I can configure my business and understand the platform before using the dashboard.

#### Acceptance Criteria

1. WHEN a new tenant logs in for the first time (identified by `onboarding_completed = false` on their user record), THE Dashboard SHALL display the Onboarding_Wizard instead of the standard dashboard view
2. THE Onboarding_Wizard SHALL consist of exactly 5 sequential steps: (1) Welcome & Business Name, (2) Business Type Selection, (3) Plan Selection, (4) Assistant Personality Setup, (5) Widget Installation Preview
3. THE Onboarding_Wizard SHALL display a progress indicator showing the current step number and total steps (e.g., "Step 2 of 5") and a visual progress bar
4. WHEN a tenant completes an Onboarding_Step and advances to the next step, THE Server SHALL persist the step data immediately so progress is not lost on page refresh
5. WHEN a tenant returns to the platform with `onboarding_completed = false`, THE Dashboard SHALL resume the Onboarding_Wizard at the last saved step
6. THE Onboarding_Wizard Step 1 SHALL collect: business display name (required, 2–128 characters) and business country/region (required, from a predefined list)
7. THE Onboarding_Wizard Step 2 SHALL present Business_Type options (ecommerce, appointments, services, restaurant, general) with icons, short descriptions, and example use cases for each
8. THE Onboarding_Wizard Step 3 SHALL present the available Plans with their features and pricing, with the Free plan pre-selected, and SHALL allow the tenant to select a plan or start a 14-day Trial of the Business plan
9. THE Onboarding_Wizard Step 4 SHALL provide a text area for the assistant's operational manual/personality (pre-filled with a template based on the selected Business_Type), a business language selector (Spanish, French, English, or multilingual), and a test greeting preview
10. THE Onboarding_Wizard Step 5 SHALL display the widget installation code snippet pre-filled with the tenant's ID, a "Copy Code" button, and a live preview of the widget launcher button
11. WHEN a tenant completes Step 5 and clicks "Finish Setup", THE Server SHALL set `onboarding_completed = true` and `onboarding_completed_at` to the current timestamp on the user record, and redirect to the standard Dashboard
12. THE Onboarding_Wizard SHALL allow tenants to go back to previous steps without losing data entered in later steps
13. WHEN a tenant clicks "Skip Setup" at any step after Step 1, THE Dashboard SHALL assign the Free plan, set `onboarding_completed = true`, and redirect to the Dashboard, with a persistent banner offering to resume onboarding

---

### Requirement 3: Subscription Plans Definition

**User Story:** As the platform operator, I want well-defined subscription tiers with distinct limits, so that I can monetize the platform and serve different business sizes appropriately.

#### Acceptance Criteria

1. THE Plan system SHALL define exactly 4 tiers with the following names and identifiers: Free (`free`), Starter (`starter`), Business (`business`), Enterprise (`enterprise`)
2. THE Free plan SHALL enforce the following limits: 500 AI queries per month, 50 products in catalog, 1 data connector, 0 API keys, widget embedding allowed, no custom assistant personality, no priority support
3. THE Starter plan SHALL enforce the following limits: 3,000 AI queries per month, 500 products in catalog, 1 data connector, 2 API keys, widget embedding allowed, custom assistant personality allowed, email support
4. THE Business plan SHALL enforce the following limits: 15,000 AI queries per month, 5,000 products in catalog, 3 data connectors, 10 API keys, widget embedding allowed, custom assistant personality allowed, priority support, analytics dashboard
5. THE Enterprise plan SHALL enforce no query, product, or connector count limits, allow unlimited API keys, provide all Business features plus dedicated support and custom integrations
6. THE Plan system SHALL store plan definitions in a `plans` database table with fields: id (string), name (string), monthly_query_limit (integer, NULL for unlimited), product_limit (integer, NULL for unlimited), connector_limit (integer), api_key_limit (integer, NULL for unlimited), price_monthly_usd (numeric), price_yearly_usd (numeric), features (JSONB array of feature strings)
7. THE Plan system SHALL store each tenant's active Subscription in a `subscriptions` table with fields: id (UUID), tenant_id (UUID), plan_id (string), status (active, trialing, past_due, cancelled), trial_ends_at (timestamp, nullable), current_period_start (timestamp), current_period_end (timestamp), created_at (timestamp), updated_at (timestamp)
8. WHEN a new tenant account is created, THE Server SHALL automatically create a Subscription record for that tenant with plan_id `free`, status `active`, and current_period_end set to the end of the current calendar month

---

### Requirement 4: Trial Period

**User Story:** As a new tenant, I want a free trial of the Business plan, so that I can evaluate the full feature set before committing to a paid subscription.

#### Acceptance Criteria

1. WHEN a tenant selects "Start 14-Day Free Trial" during Onboarding Step 3, THE Server SHALL create a Subscription record with plan_id `business`, status `trialing`, trial_ends_at set to 14 days from the current timestamp, and no payment method required
2. WHILE a Subscription has status `trialing` and the current timestamp is before trial_ends_at, THE Enforcement_Gate SHALL apply Business plan limits for that tenant
3. WHEN the current timestamp reaches trial_ends_at and the tenant has not provided a payment method, THE Server SHALL automatically downgrade the Subscription status to `active` with plan_id `free` and send an email notification informing the tenant of the downgrade and providing an upgrade link
4. THE Dashboard SHALL display a countdown banner to tenants with status `trialing` showing the number of days remaining in the trial
5. IF a tenant has previously used a trial (identified by a non-null trial_used_at field on the Subscription record), THEN THE Server SHALL not allow a second trial for that tenant and SHALL not display the trial option during onboarding
6. WHEN a trialing tenant provides a payment method and confirms upgrade, THE Server SHALL transition the Subscription from `trialing` to `active` with the selected paid plan and set trial_used_at to the trial start timestamp

---

### Requirement 5: Usage Tracking

**User Story:** As the platform operator, I want accurate tracking of each tenant's resource usage, so that plan limits can be enforced fairly and tenants can see their consumption.

#### Acceptance Criteria

1. THE Usage_Tracker SHALL record each AI query against the tenant's monthly usage counter in a `usage_monthly` table with fields: id (UUID), tenant_id (UUID), period_year (integer), period_month (integer), query_count (integer), product_count (integer), connector_count (integer), api_key_count (integer), updated_at (timestamp)
2. WHEN an AI query is processed for a tenant, THE Usage_Tracker SHALL increment the query_count for that tenant's current month record using an atomic increment operation
3. THE Usage_Tracker SHALL update product_count, connector_count, and api_key_count by computing the current totals from their respective tables whenever those records are created or deleted, rather than on every query
4. WHEN the calendar month changes, THE Usage_Tracker SHALL reset query_count to 0 for all tenants by creating a new `usage_monthly` record for the new period, and SHALL retain historical records for past periods
5. THE Usage_Tracker SHALL provide a function `getUsageSummary(tenantId)` that returns the current month's usage counts alongside the tenant's Plan_Limits for display in the Dashboard
6. FOR ALL months where a tenant has usage records, the sum of all individual query_count increments applied during that month SHALL equal the final query_count for that period (count consistency property)

---

### Requirement 6: Plan Enforcement

**User Story:** As the platform operator, I want usage limits automatically enforced at the API level, so that tenants cannot exceed their plan allowances without upgrading.

#### Acceptance Criteria

1. WHEN an AI query request arrives for a tenant, THE Enforcement_Gate SHALL compare the tenant's current month query_count against their plan's monthly_query_limit before processing the query
2. IF a tenant's query_count has reached or exceeded their plan's monthly_query_limit, THEN THE Enforcement_Gate SHALL reject the query with an HTTP 429 response and a message indicating the monthly limit has been reached, including the plan name, limit, and an upgrade URL
3. WHEN a tenant attempts to add a product to their catalog, THE Enforcement_Gate SHALL compare the tenant's current product_count against their plan's product_limit before creating the product record
4. IF a tenant's product_count has reached or exceeded their plan's product_limit, THEN THE Enforcement_Gate SHALL reject the product creation with an HTTP 403 response and a message indicating the product limit has been reached for their plan
5. WHEN a tenant attempts to create a data connector, THE Enforcement_Gate SHALL compare the tenant's current connector_count against their plan's connector_limit before creating the record
6. IF a tenant's connector_count has reached or exceeded their plan's connector_limit, THEN THE Enforcement_Gate SHALL reject the connector creation with an HTTP 403 response and a message indicating the connector limit has been reached for their plan
7. WHEN a tenant attempts to create an API key, THE Enforcement_Gate SHALL compare the tenant's current api_key_count against their plan's api_key_limit before creating the key
8. IF a tenant's api_key_count has reached or exceeded their plan's api_key_limit, THEN THE Enforcement_Gate SHALL reject the API key creation with an HTTP 403 response and a message indicating the API key limit has been reached for their plan
9. WHEN a tenant on the Free plan attempts to access a feature restricted to paid plans (custom assistant personality, analytics, priority support), THE Enforcement_Gate SHALL block access and present an upgrade prompt
10. WHERE plan_limit is NULL (Enterprise unlimited), THE Enforcement_Gate SHALL skip all limit checks for that resource type and allow the action unconditionally

---

### Requirement 7: Plan Upgrade and Downgrade

**User Story:** As a tenant, I want to upgrade or downgrade my subscription plan at any time, so that I can adjust to my business needs and budget.

#### Acceptance Criteria

1. THE Billing_Portal SHALL display the tenant's current plan, status, current_period_end date, and a comparison table of all available plans
2. WHEN a tenant selects a higher-tier plan and confirms the upgrade, THE Server SHALL update the Subscription record to the new plan_id, set status to `active`, set current_period_start to the current timestamp, and set current_period_end to 30 days from the current timestamp
3. WHEN a tenant selects a lower-tier plan (downgrade), THE Server SHALL schedule the downgrade to take effect at the end of the current billing period (current_period_end) and display a confirmation message stating the exact date the downgrade will take effect
4. WHEN the current_period_end is reached for a scheduled downgrade, THE Server SHALL apply the new plan_id to the Subscription record
5. IF a tenant downgrades and their current usage exceeds the new plan's limits (e.g., product_count > new plan's product_limit), THEN THE Server SHALL allow the downgrade but display a warning listing which resources exceed the new limits and stating that no new resources can be added until usage is reduced below the new limits
6. WHEN a tenant's Subscription has status `past_due` for more than 7 days, THE Server SHALL automatically downgrade the Subscription to plan_id `free` and notify the tenant by email
7. WHEN a tenant cancels their subscription, THE Server SHALL set status to `cancelled`, retain access to the current plan until current_period_end, then downgrade to `free` on that date

---

### Requirement 8: Dashboard Plan and Usage Display

**User Story:** As a tenant, I want to see my current plan, usage statistics, and available limits clearly in my dashboard, so that I can make informed decisions about upgrading.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Plan_Badge in the navigation/header area showing the tenant's current plan name and a visual tier indicator (color-coded: gray for Free, blue for Starter, purple for Business, gold for Enterprise)
2. THE Dashboard SHALL display a Usage section in the Overview tab showing current usage vs limits for: monthly queries, products, connectors, and API keys, using progress bars that turn amber at 80% and red at 95% of each limit
3. WHEN a tenant's query_count reaches 80% of their monthly_query_limit, THE Dashboard SHALL display a soft warning banner recommending an upgrade
4. WHEN a tenant's query_count reaches 100% of their monthly_query_limit, THE Dashboard SHALL display a persistent error banner stating queries are blocked and providing a direct upgrade link
5. THE Dashboard SHALL include a "Plans & Billing" tab in the settings area that displays the Billing_Portal
6. THE Dashboard SHALL display an onboarding completion prompt in the Overview tab if `onboarding_completed = false`, with a "Complete Setup" button that resumes the Onboarding_Wizard

---

### Requirement 9: Pricing Page on Landing

**User Story:** As a visitor, I want to see clear pricing information on the landing page, so that I can understand the cost before registering.

#### Acceptance Criteria

1. THE landing page pricing section SHALL display all 4 plans in a comparison card layout with: plan name, monthly price in USD, annual price with savings percentage, and a feature list using checkmarks and crosses
2. THE Free plan card SHALL display a "Get Started Free" CTA button that initiates the Registration_Flow
3. THE Starter and Business plan cards SHALL display a "Start Free Trial" CTA button that initiates the Registration_Flow with the selected plan pre-selected in Onboarding Step 3
4. THE Enterprise plan card SHALL display a "Contact Us" CTA button that opens a contact form or links to a contact email
5. THE pricing section SHALL include a billing toggle allowing visitors to switch between monthly and annual pricing display, with the annual option showing the equivalent monthly cost and total savings
6. THE pricing section SHALL highlight the Business plan as "Most Popular" with a visual badge

---

### Requirement 10: Email Notifications for Plan Events

**User Story:** As a tenant, I want to receive email notifications for important plan-related events, so that I am never caught off-guard by a limit or billing change.

#### Acceptance Criteria

1. WHEN a new tenant account is created, THE Server SHALL send a welcome email containing the tenant's name, their initial plan (Free), and a link to complete onboarding
2. WHEN a trial period expires and the account is downgraded to Free, THE Server SHALL send an email notifying the tenant of the downgrade, the features they have lost, and a direct upgrade link
3. WHEN a tenant's query_count reaches 80% of their monthly_query_limit, THE Server SHALL send a single soft-limit warning email per month per tenant (not repeated for the same period)
4. WHEN a tenant's query_count reaches 100% of their monthly_query_limit and queries are blocked, THE Server SHALL send a limit-reached notification email with the upgrade link
5. WHEN a plan upgrade is confirmed, THE Server SHALL send a confirmation email stating the new plan name, new limits, and effective date
6. WHEN a plan downgrade takes effect at period end, THE Server SHALL send a notification email 3 days before the downgrade date and a confirmation email on the day it takes effect
7. IF THE Server cannot deliver an email due to a provider error, THEN THE Server SHALL log the failure with the tenant_id, email type, and error details, and SHALL NOT retry more than 3 times within a 24-hour window

---

### Requirement 11: Security and Data Integrity for Subscriptions

**User Story:** As the platform operator, I want the subscription and plan data to be secure and consistent, so that tenants cannot manipulate their own plan records.

#### Acceptance Criteria

1. THE `subscriptions` table SHALL enforce Row Level Security (RLS) such that tenants can only read their own Subscription record and cannot directly write to the plan_id, status, or trial_ends_at fields
2. ALL Subscription state transitions (upgrade, downgrade, trial activation, trial expiry, cancellation) SHALL be performed exclusively by server-side functions, never by direct client-side database writes
3. WHEN a Subscription record is updated, THE Server SHALL write an audit entry to a `subscription_events` table with fields: id (UUID), subscription_id (UUID), event_type (string), old_plan_id (string), new_plan_id (string), triggered_by (string: "user", "system", "trial_expiry"), created_at (timestamp)
4. THE `usage_monthly` table SHALL enforce RLS such that tenants can only read their own usage records and cannot write to any field directly
5. IF a concurrent request causes a race condition on query_count increment, THE Usage_Tracker SHALL use a database-level atomic increment (UPDATE ... SET query_count = query_count + 1) to ensure no count is lost
6. FOR ALL subscription state transitions, the sequence of audit log entries in `subscription_events` SHALL form a valid transition chain where each event's old_plan_id matches the previous event's new_plan_id (audit consistency property)
