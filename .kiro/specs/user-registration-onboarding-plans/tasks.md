# Implementation Plan: User Registration, Onboarding & Plans

## Overview

Extend Eteba Chat into a full self-serve SaaS platform by adding email/password registration,
a 5-step onboarding wizard, a subscription plan system with four tiers, atomic usage tracking,
an enforcement gate middleware, billing portal UI, dashboard usage widgets, landing page pricing
section, email notifications, and all supporting SQL migrations and RLS policies.

All backend code is TypeScript added to `server.ts` and new module files. All frontend code is
vanilla JS in `scripts/`. Database migrations follow the existing numbered convention in `sql/`.
Property-based tests use `fast-check`; unit tests use the existing test runner pattern in `tests/`.

## Tasks

- [x] 1. Database Migrations
  - [x] 1.1 Create `sql/007-plans-subscriptions.sql`
    - Write the `plans`, `subscriptions`, `usage_monthly`, and `subscription_events` DDL exactly
      as defined in the design: primary keys, foreign keys, check constraints, indexes
    - Seed the four plan rows (free, starter, business, enterprise) with the exact limit and
      price values from the design
    - Add RLS policies: tenant read-own for `subscriptions`, `usage_monthly`,
      `subscription_events`; all writes server-side (service key) only
    - _Requirements: 3.1–3.8, 5.1, 11.1, 11.4_

  - [x] 1.2 Create `sql/008-onboarding-users.sql`
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS` for `password_hash`, `onboarding_completed`,
      `onboarding_completed_at`, `onboarding_step`, `onboarding_step_data`
    - Create partial index `idx_users_onboarding` on `onboarding_completed = false`
    - _Requirements: 2.1, 2.4, 2.11_


- [x] 2. Core TypeScript Modules — Auth, Plans Cache, Email Service
  - [x] 2.1 Create `plans-cache.ts` — in-memory plan limits cache
    - Export `getPlanLimits(planId: string)` with 5-minute TTL (`Map<string, {limits, fetchedAt}>`)
    - Fetch from InsForge `plans` table on cache miss; return typed `PlanRecord`
    - Export `invalidatePlanCache()` for use in tests
    - _Requirements: 3.1–3.5, 6.10_

  - [x] 2.2 Create `usage-tracker.ts` — atomic usage operations
    - Export `incrementQueryCount(tenantId)` using atomic SQL
      `UPDATE usage_monthly SET query_count = query_count + 1 WHERE tenant_id=$1 AND period_year=$2 AND period_month=$3`
    - Export `syncResourceCounts(tenantId)` that computes `product_count`, `connector_count`,
      `api_key_count` from actual table rows via InsForge
    - Export `getUsageSummary(tenantId): Promise<UsageSummary>` returning counts + limits +
      percentages as defined in the design interface
    - Upsert `usage_monthly` row on first access for a new period
    - _Requirements: 5.1–5.6_

  - [ ]* 2.3 Write property test for `usage-tracker` — Property 9
    - **Property 9: Query Count Increments Are Consistent**
    - Fire N concurrent `incrementQueryCount` calls (N drawn from `fc.nat({max: 200})`),
      then assert `query_count === N` for that period
    - **Validates: Requirements 5.2, 5.6, 11.5**

  - [ ]* 2.4 Write property test for `usage-tracker` — Property 10
    - **Property 10: Resource Count Reflects Actual Rows**
    - Generate a sequence of `fc.array(fc.constantFrom('create','delete'))` operations on
      products/connectors/api_keys; after each op call `syncResourceCounts`; assert count
      equals actual rows at all times
    - **Validates: Requirements 5.3**

  - [x] 2.5 Create `email-service.ts` — plan email notifications
    - Export `sendPlanEmail(tenantId, emailType, payload)` wrapping `insforge.email.send()`
    - Implement `soft_limit_warning` deduplication: check `soft_limit_email_sent_at` in
      `usage_monthly`; skip if already sent this period
    - Implement retry: up to 3 attempts, max one retry cycle per 24 hours; log failures with
      `{tenantId, emailType, error, attempt}` — never throw to caller
    - Email types: `welcome`, `trial_expiry`, `soft_limit_warning`, `hard_limit_reached`,
      `upgrade_confirmed`, `downgrade_warning`, `downgrade_confirmed`, `past_due_downgrade`
    - _Requirements: 1.9, 10.1–10.7_

  - [ ]* 2.6 Write property test for `email-service` — Property 19
    - **Property 19: Soft Limit Warning Email Sent At Most Once Per Period**
    - Generate `fc.nat({min:1, max:10})` threshold crossings for the same tenant/period;
      assert `sendPlanEmail` mock is called at most once with `soft_limit_warning`
    - **Validates: Requirements 10.3**

  - [ ]* 2.7 Write property test for `email-service` — Property 3
    - **Property 3: Welcome Email Contains User Name**
    - Generate `fc.string({minLength:2, maxLength:64})` as user name; call the welcome
      email path; assert the captured email body contains the generated name string
    - **Validates: Requirements 1.9, 10.1**


- [x] 3. Enforcement Gate Middleware
  - [x] 3.1 Create `enforcement-gate.ts`
    - Export `enforcePlanLimit(resource: ResourceType, tenantId: string)` returning
      `{allowed, reason?, upgradeUrl?}`
    - Pull limits from `plans-cache.ts`; pull current counts from `usage_monthly` via InsForge
    - Apply NULL-limit bypass (Enterprise): unconditionally return `allowed: true`
    - Return HTTP-ready payload on block: `{error, plan, limit, upgradeUrl}` for query (429)
      and all other resources (403)
    - Export as Express middleware factory `requirePlanLimit(resource)` that reads `tenantId`
      from the verified auth token
    - _Requirements: 6.1–6.10_

  - [ ]* 3.2 Write property test for enforcement gate — Property 11
    - **Property 11: Enforcement Gate Allows if Count < Limit, Blocks if Count >= Limit**
    - Generate `fc.nat()` for `currentCount` and `fc.nat({min:1})` for `limit` (non-null);
      assert `allowed === (currentCount < limit)` for all four resource types, and verify
      correct HTTP status code in the block response
    - **Validates: Requirements 6.1–6.8**

  - [ ]* 3.3 Write property test for enforcement gate — Property 12
    - **Property 12: NULL Limit Bypasses All Enforcement**
    - For each resource type with `limit = null` (Enterprise), generate any `fc.nat()` for
      `currentCount`; assert `allowed === true` unconditionally
    - **Validates: Requirements 6.10**


- [x] 4. Registration and Auth Routes (`server.ts`)
  - [x] 4.1 Add `POST /auth/register` — email/password sign-up
    - Validate `RegisterRequest`: name 2–128 chars, valid email, password ≥ 8 chars,
      passwords match — return 400 with field errors on failure
    - Hash password with bcrypt cost factor 12 before storing in `users.password_hash`
    - Insert `users` row then `companies` row with `owner_id = userId`; if email unique
      index fires return 409 `{error:"email_exists", signInUrl:"/auth/login"}`
    - Create Free `subscriptions` row for the new tenant (`plan_id='free'`, `status='active'`,
      `current_period_end` = last second of current calendar month)
    - Call `sendPlanEmail(tenantId, 'welcome', {...})` fire-and-forget
    - Return `RegisterResponse` with signed JWT via `signToken`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.9, 3.8_

  - [x] 4.2 Add `POST /auth/login` — email/password sign-in
    - Validate `LoginRequest`, look up user by email, compare bcrypt hash
    - Return 401 `{error:"invalid_credentials"}` on mismatch
    - Return signed JWT with same shape as Google OAuth token on success
    - _Requirements: 1.1, 1.8_

  - [x] 4.3 Extend `GET /auth/google/callback` — new-user detection for onboarding
    - After creating a new Google-OAuth user, also create `companies` row and Free
      `subscriptions` row, then send welcome email (same as 4.1)
    - Set redirect target to `/?auth_token=...&new_user=true` for new users so the frontend
      knows to launch the Onboarding Wizard
    - Returning users (already in DB) redirect to `/?auth_token=...` unchanged
    - _Requirements: 1.6, 1.7, 1.9, 3.8_

  - [ ]* 4.4 Write property test for registration — Property 1
    - **Property 1: Valid Registration Always Creates Tenant Records**
    - Generate `fc.record({name: fc.string({minLength:2,maxLength:128}), email: fc.emailAddress(), password: fc.string({minLength:8,maxLength:64})})`
    - Call `POST /auth/register`; assert exactly one `users` row, one `companies` row with
      correct `owner_id`, and a valid JWT returned
    - **Validates: Requirements 1.3, 3.8**

  - [ ]* 4.5 Write property test for registration — Property 2
    - **Property 2: Password Validation Rejects All Short Passwords**
    - Generate `fc.string({minLength:1, maxLength:7})` as password; call server directly;
      assert 400 response and zero new `users` rows created
    - **Validates: Requirements 1.5**

  - [ ]* 4.6 Write property test for registration — Property 4
    - **Property 4: New Tenant Always Gets Free Subscription**
    - Generate valid registration payloads; call `POST /auth/register`; assert exactly one
      `subscriptions` row with `plan_id='free'`, `status='active'`, and
      `current_period_end` at end of current calendar month
    - **Validates: Requirements 3.8**


- [x] 5. Onboarding Routes (`server.ts`)
  - [x] 5.1 Add `POST /api/onboarding/step` — persist step data
    - Auth-guard with `getTenantIdFromRequest`
    - Validate `OnboardingStepRequest`: `step` in 1–5, `data` matches the union type for
      that step number; return 400 on schema violation
    - Upsert `users.onboarding_step_data[step] = data` and `onboarding_step = step`
      using InsForge `update` with the service key
    - _Requirements: 2.4_

  - [x] 5.2 Add `GET /api/onboarding/status` — return current wizard state
    - Auth-guard; query `users` for `onboarding_completed`, `onboarding_step`,
      `onboarding_step_data`
    - Return `OnboardingStatusResponse`
    - _Requirements: 2.5_

  - [x] 5.3 Add `POST /api/onboarding/complete` — finalize wizard
    - Auth-guard; set `onboarding_completed = true`,
      `onboarding_completed_at = now()` on the user row
    - Apply any plan selected in step 3 to the subscription (upgrade from free if needed)
    - Return `OnboardingCompleteResponse`
    - _Requirements: 2.11_

  - [ ]* 5.4 Write property test for onboarding — Property 5
    - **Property 5: Onboarding Step Data Survives Page Reload**
    - Generate `fc.constantFrom(1,2,3,4)` for step number and valid step payloads; call
      `POST /api/onboarding/step` then `GET /api/onboarding/status`; assert the returned
      `stepData[step]` equals the submitted payload regardless of intermediate reloads
    - **Validates: Requirements 2.4, 2.5**


- [x] 6. Plan & Subscription Routes (`server.ts`)
  - [x] 6.1 Add `GET /api/plans` — public plan listing
    - Query `plans` table; return array of `PlanRecord`; no auth required
    - _Requirements: 3.1–3.6_

  - [x] 6.2 Add `GET /api/subscription` — tenant subscription + usage summary
    - Auth-guard; join `subscriptions` with `plans` for current tenant; call
      `getUsageSummary(tenantId)`; compute `daysUntilTrialEnd` when status is `trialing`
    - Return `SubscriptionResponse`
    - _Requirements: 7.1, 8.1, 8.2_

  - [x] 6.3 Add `POST /api/subscription/trial` — activate Business trial
    - Auth-guard; reject with 409 if `trial_used_at` is non-null
    - Set `plan_id='business'`, `status='trialing'`,
      `trial_ends_at = now + 14 days`, `trial_used_at = now()`
    - Write audit entry to `subscription_events` (`event_type='trial_start'`,
      `triggered_by='user'`) before updating subscription
    - _Requirements: 4.1, 4.5, 11.3_

  - [ ]* 6.4 Write property test for trial — Property 6
    - **Property 6: Trial Subscription Sets Correct Expiry**
    - Generate `fc.uuid()` for tenantId; call `POST /api/subscription/trial`; assert
      `status='trialing'`, `plan_id='business'`, and
      `trial_ends_at ∈ [now + 13d 23h, now + 14d 1h]`
    - **Validates: Requirements 4.1**

  - [ ]* 6.5 Write property test for trial — Property 7
    - **Property 7: Trial Cannot Be Activated Twice**
    - For any tenant with non-null `trial_used_at`; call `POST /api/subscription/trial`;
      assert 409 response and subscription record unchanged
    - **Validates: Requirements 4.5**

  - [ ]* 6.6 Write property test for trial — Property 8
    - **Property 8: Trialing Tenants Get Business-Tier Limits**
    - For any tenant with `status='trialing'` and future `trial_ends_at`; call
      `enforcePlanLimit` for each resource type; assert limits equal Business plan values
      (queries=15000, products=5000, connectors=3, api_keys=10)
    - **Validates: Requirements 4.2**

  - [x] 6.7 Add `POST /api/subscription/upgrade`
    - Auth-guard; validate `newPlanId` is a known plan id and ranks higher than current
    - Write audit entry (`event_type='upgrade'`) first, then update subscription:
      `plan_id=newPlanId`, `status='active'`, `current_period_start=now()`,
      `current_period_end=now()+30d`
    - Call `sendPlanEmail(tenantId, 'upgrade_confirmed', {...})` fire-and-forget
    - _Requirements: 7.1, 7.2, 11.2, 11.3_

  - [ ]* 6.8 Write property test for upgrade — Property 17
    - **Property 17: Upgrade Preserves Plan Monotonicity**
    - For any valid (from, to) upgrade pair where `to` ranks higher; after calling upgrade
      assert `plan_id=newPlanId`, `status='active'`,
      `current_period_end ∈ [now+29d23h, now+30d1h]`
    - **Validates: Requirements 7.2**

  - [x] 6.9 Add `POST /api/subscription/downgrade`
    - Auth-guard; validate `newPlanId` ranks lower than current; return 400 otherwise
    - Set `scheduled_plan_id=newPlanId`; do NOT change `plan_id` immediately
    - Write audit entry (`event_type='downgrade'`, `triggered_by='user'`)
    - If current usage exceeds new plan limits, include warning list in response body
    - _Requirements: 7.3, 7.4, 7.5, 11.3_

  - [ ]* 6.10 Write property test for downgrade — Property 18
    - **Property 18: Downgrade Is Always Scheduled, Never Immediate**
    - For any valid downgrade request with `current_period_end` in the future; immediately
      after the call assert `plan_id` unchanged and `scheduled_plan_id = requestedPlanId`
    - **Validates: Requirements 7.3, 7.4**

  - [x] 6.11 Add `POST /api/subscription/cancel`
    - Auth-guard; set `status='cancelled'`; write audit entry
    - Schedule `plan_id='free'` at `current_period_end` via `scheduled_plan_id`
    - _Requirements: 7.7_


- [x] 7. Subscription Audit Log — Correctness Properties
  - [x] 7.1 Wire audit entry writes in all subscription mutation routes
    - Ensure every state transition path (trial, upgrade, downgrade, cancel, trial_expiry,
      past_due downgrade) writes one `subscription_events` row with correct `event_type`,
      `old_plan_id`, `new_plan_id`, `triggered_by` BEFORE updating `subscriptions`
    - Add helper `writeAuditEntry(subscriptionId, eventType, oldPlan, newPlan, triggeredBy)`
      in `server.ts` to avoid duplicated DB logic
    - _Requirements: 11.3_

  - [ ]* 7.2 Write property test for audit — Property 15
    - **Property 15: Every Subscription Transition Creates an Audit Entry**
    - For each event type (`fc.constantFrom('upgrade','downgrade','trial_start',
      'trial_expiry','cancellation','past_due_downgrade')`); trigger the matching route;
      assert exactly one new `subscription_events` row with correct fields
    - **Validates: Requirements 11.3**

  - [ ]* 7.3 Write property test for audit — Property 16
    - **Property 16: Audit Log Forms a Valid Transition Chain**
    - Generate `fc.array(fc.constantFrom('free','starter','business'), {minLength:2})`
      as transition sequence; apply each upgrade/downgrade; retrieve `subscription_events`
      ordered by `created_at`; assert each event's `old_plan_id` equals the preceding
      event's `new_plan_id`
    - **Validates: Requirements 11.6**

- [~] 8. Checkpoint — Core Backend Tests Pass
  - Ensure all tests pass, ask the user if questions arise.


- [x] 9. Wire Enforcement Gate into Existing Routes (`server.ts`)
  - [x] 9.1 Apply `requirePlanLimit('query')` middleware to `POST /api/query`
    - Call `incrementQueryCount(tenantId)` only after a successful query response
    - Remove the current fire-and-forget `query_counts` insert and replace with
      `incrementQueryCount` from `usage-tracker.ts`
    - Check 80% and 100% thresholds after increment; fire soft/hard limit emails
      using `sendPlanEmail` fire-and-forget
    - _Requirements: 6.1, 6.2, 5.2, 10.3, 10.4_

  - [x] 9.2 Apply `requirePlanLimit('product')` to `POST /api/catalog` and
        `POST /api/catalog/bulk`, call `syncResourceCounts` after successful insert/delete
    - _Requirements: 6.3, 6.4, 5.3_

  - [x] 9.3 Apply `requirePlanLimit('connector')` to `POST /api/connectors`, call
        `syncResourceCounts` after successful connector create/delete
    - _Requirements: 6.5, 6.6, 5.3_

  - [x] 9.4 Apply `requirePlanLimit('api_key')` to `POST /api/keys/generate`, call
        `syncResourceCounts` after successful key creation
    - _Requirements: 6.7, 6.8, 5.3_

  - [x] 9.5 Add `GET /api/usage` route — returns `getUsageSummary(tenantId)` (auth-guarded)
    - _Requirements: 5.5, 8.2_


- [x] 10. Trial Expiry Background Job (`server.ts`)
  - [x] 10.1 Create `trial-expiry-job.ts` — periodic trial checker
    - Export `checkTrialExpirations(now?: () => Date)` with injected clock for testability
    - Query `subscriptions WHERE status='trialing' AND trial_ends_at <= now()`
    - For each expired row: write audit entry (`trial_expiry`, `triggered_by='trial_expiry'`),
      update `plan_id='free'`, `status='active'`, call `sendPlanEmail` with `trial_expiry`
    - _Requirements: 4.3_

  - [x] 10.2 Schedule `checkTrialExpirations` every hour via `setInterval` in `server.ts`
    - Wire it after the `app.listen` call
    - Also add `past_due` auto-downgrade: query `subscriptions WHERE status='past_due'`
      and `updated_at <= now() - 7 days`; downgrade to `free`, send `past_due_downgrade`
      email, write audit entry
    - _Requirements: 4.3, 7.6_

  - [x] 10.3 Add downgrade scheduler — apply `scheduled_plan_id` at period end
    - In the same hourly job, query subscriptions with non-null `scheduled_plan_id` where
      `current_period_end <= now()`; apply `plan_id = scheduled_plan_id`,
      clear `scheduled_plan_id`; write audit entry; send `downgrade_confirmed` email
    - Also send `downgrade_warning` email 3 days before `current_period_end` for any
      subscription with a `scheduled_plan_id`
    - _Requirements: 7.3, 7.4, 10.6_


- [x] 11. Frontend — Registration Page (`scripts/registration.js`)
  - [x] 11.1 Create `scripts/registration.js` — RegistrationPage module
    - Export `RegistrationPage` IIFE matching the existing module pattern in `scripts/`
    - `show(preselectedPlan?)` renders a modal overlay with: Google OAuth button
      (`href=/auth/google`), email/password form (full name, email, password, confirm)
    - Client-side validation before submit: password ≥ 8 chars, passwords match — show
      inline field error messages without submit
    - `POST /auth/register`, handle 409 (email exists) with "Sign In" link, handle 400
      with field-level error display
    - On success: store token (`Auth.setToken`), check `new_user` flag, navigate to
      onboarding or dashboard
    - Show "Already have an account? Sign In" link toggling to a login form that calls
      `POST /auth/login`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.8_

  - [x] 11.2 Wire Registration CTAs in `index.html` and `scripts/app.js`
    - Add `onclick="RegistrationPage.show()"` to all "Get Started", "Registrarse" CTAs
    - Add `onclick="RegistrationPage.show('starter')"` and `show('business')` to the
      corresponding plan CTAs in the pricing section
    - Add `<script src="scripts/registration.js">` to `index.html` load order
    - _Requirements: 1.2, 9.2, 9.3_


- [x] 12. Frontend — Onboarding Wizard (`scripts/onboarding.js`)
  - [x] 12.1 Create `scripts/onboarding.js` — OnboardingWizard module
    - Export `OnboardingWizard` IIFE; `init()` calls `GET /api/onboarding/status`;
      if `completed=false` replaces dashboard content with wizard
    - Step controller: `renderStep(n)` renders one step at a time;
      `next()` validates + calls `POST /api/onboarding/step` + advances;
      `back()` retreats without data loss
    - Progress bar: `(currentStep / 5) * 100`; step counter "Step N of 5"
    - Step 1: business name (required, 2–128 chars) + country select
    - Step 2: Business_Type radio cards with icon + description + example per type
    - Step 3: plan cards (Free, Starter, Business, Enterprise) + trial option;
      Free pre-selected; hide trial option if `trial_used_at` non-null
    - Step 4: assistant manual textarea (pre-filled template by business type),
      language selector, live greeting preview
    - Step 5: widget code snippet with tenant ID pre-filled, "Copy Code" button, widget preview
    - "Skip Setup" (steps 2–5): calls `POST /api/onboarding/complete` with Free plan,
      redirects to dashboard with persistent "Complete Setup" banner
    - "Finish Setup" (step 5): calls `POST /api/onboarding/complete`, redirects to dashboard
    - _Requirements: 2.1–2.13_

  - [x] 12.2 Wire `OnboardingWizard.init()` in `scripts/app.js`
    - After `Auth.init()`, if `Auth.isLoggedIn()` call `OnboardingWizard.init()` before
      `Dashboard.loadDashboardData()`
    - Add `<script src="scripts/onboarding.js">` to `index.html`
    - _Requirements: 2.1_


- [x] 13. Frontend — Dashboard Usage Display and Plan Badge (`scripts/dashboard.js`)
  - [x] 13.1 Add `loadPlanBadge(tenantId)` to `Dashboard` in `scripts/dashboard.js`
    - Fetch `GET /api/subscription`; render Plan_Badge in the header with plan name and
      CSS class: `plan-badge--free` (gray), `plan-badge--starter` (blue),
      `plan-badge--business` (purple), `plan-badge--enterprise` (gold)
    - Show trial countdown banner when `status='trialing'` using `daysUntilTrialEnd`
    - Show "Complete Setup" banner if `onboarding_completed = false` with "Complete Setup"
      button that calls `OnboardingWizard.show()`
    - _Requirements: 8.1, 4.4, 8.6_

  - [ ]* 13.2 Write property test for plan badge — Property 13
    - **Property 13: Plan Badge Color Matches Plan Tier**
    - For each plan name `fc.constantFrom('free','starter','business','enterprise')`;
      call `loadPlanBadge`; assert exactly the corresponding CSS class is applied and no
      other plan's color class is present on the badge element
    - **Validates: Requirements 8.1**

  - [x] 13.3 Add `loadUsageSection(tenantId)` to `Dashboard` in `scripts/dashboard.js`
    - Fetch `GET /api/usage`; render four progress bars for queries, products, connectors,
      API keys showing `count / limit` percentage
    - Apply CSS class `usage--normal` when `< 80%`, `usage--warning` when `80% ≤ x < 95%`,
      `usage--critical` when `≥ 95%`
    - Show soft warning banner at 80%; show persistent error banner + upgrade link at 100%
    - _Requirements: 8.2, 8.3, 8.4_

  - [ ]* 13.4 Write property test for progress bar — Property 14
    - **Property 14: Progress Bar Color Class Reflects Usage Percentage**
    - Generate `fc.nat()` for `count` and `fc.nat({min:1})` for `limit`; assert
      `usage--normal` when `count/limit < 0.80`, `usage--warning` when
      `0.80 ≤ count/limit < 0.95`, `usage--critical` when `count/limit ≥ 0.95`
    - **Validates: Requirements 8.2**

  - [x] 13.5 Add Billing Portal tab to `scripts/dashboard.js`
    - Fetch `GET /api/subscription`; render current plan details (name, status,
      `current_period_end`, limits)
    - Render plan comparison cards for upgrade/downgrade selection
    - Wire upgrade button → `POST /api/subscription/upgrade` + refresh
    - Wire downgrade button → `POST /api/subscription/downgrade` + show confirmation
      message with effective date
    - Wire cancel button → `POST /api/subscription/cancel` + confirmation dialog
    - Add "Plans & Billing" tab to the sidebar via new `data-tab="billing"` item in
      `index.html`
    - _Requirements: 7.1, 7.3, 7.5, 8.5_


- [x] 14. Frontend — Landing Page Pricing Section (`index.html` + `styles/`)
  - [x] 14.1 Add pricing section HTML to `index.html`
    - Four plan cards: Free, Starter, Business, Enterprise in a CSS grid
    - Each card: plan name, monthly USD price, annual USD price with savings %, feature
      checklist using ✓ / ✗ marks
    - Business card has "Most Popular" badge
    - Billing toggle (monthly / annual) that swaps displayed price values via JS
    - CTA buttons: Free → `RegistrationPage.show()`, Starter/Business →
      `RegistrationPage.show('starter'/'business')`, Enterprise → contact link/form
    - _Requirements: 9.1–9.6_

  - [x] 14.2 Add pricing section styles to `styles/landing.css`
    - Grid layout for plan cards, badge styles, toggle switch, feature list checkmarks
    - Responsive: stack cards vertically on mobile
    - _Requirements: 9.1, 9.6_

- [~] 15. Checkpoint — Full Feature Integration Tests Pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. `fast-check` Test Setup and Integration Tests (`tests/`)
  - [x] 16.1 Install `fast-check` and update `package.json` devDependencies
    - Add `"fast-check": "^3.x.x"` as a dev dependency (exact version, not open range)
    - Add test script `"test": "ts-node tests/run-all.ts"` if not present
    - _Requirements: all property tests_

  - [ ]* 16.2 Write integration test: registration → onboarding → plan selection flow
    - POST /auth/register → GET /api/onboarding/status → POST /api/onboarding/step (×5)
      → POST /api/onboarding/complete; assert DB state at each step
    - _Requirements: 1.3, 2.11, 3.8_

  - [ ]* 16.3 Write integration test: trial expiry cycle
    - Activate trial; inject `now()` to simulate 15-day advance; call
      `checkTrialExpirations`; assert `plan_id='free'`, `status='active'`, email log entry
    - _Requirements: 4.3_

  - [ ]* 16.4 Write integration test: concurrent query enforcement at limit boundary
    - Set `query_count = limit - 1`; fire 10 simultaneous `POST /api/query` requests;
      assert exactly 1 succeeds, 9 return 429
    - _Requirements: 6.1, 6.2, 11.5_

  - [ ]* 16.5 Write integration test: RLS enforcement
    - Attempt `UPDATE subscriptions SET plan_id = 'enterprise'` using InsForge anon key;
      assert the operation is rejected with a permissions error
    - _Requirements: 11.1, 11.2_


- [~] 17. Final Checkpoint — All Tests Pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP build
- Each task references specific requirements for full traceability
- Checkpoints (tasks 8, 15, 17) ensure incremental validation before the next phase
- All 19 correctness properties defined in design.md are covered by property-based test sub-tasks
- Property tests use `fast-check` with minimum 100 iterations per property
- Unit tests use the existing `ts-node` test runner pattern already established in `tests/`
- All server mutations use the InsForge service-role key (never exposed to clients); anon key for
  reads only via RLS-protected routes
- The injected `now()` function pattern in `trial-expiry-job.ts` allows deterministic time-based
  tests without mocking system clocks
- Migrations 007 and 008 must be applied in order before any backend tasks are executed


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "1.2"]
    },
    {
      "id": 1,
      "tasks": ["2.1", "2.2", "2.5", "16.1"]
    },
    {
      "id": 2,
      "tasks": ["2.3", "2.4", "2.6", "2.7", "3.1"]
    },
    {
      "id": 3,
      "tasks": ["3.2", "3.3", "4.1", "4.2", "4.3", "5.1", "5.2", "5.3", "6.1"]
    },
    {
      "id": 4,
      "tasks": ["4.4", "4.5", "4.6", "5.4", "6.2", "6.3", "6.7", "6.9", "6.11"]
    },
    {
      "id": 5,
      "tasks": ["6.4", "6.5", "6.6", "6.8", "6.10", "7.1", "9.1", "9.2", "9.3", "9.4", "9.5"]
    },
    {
      "id": 6,
      "tasks": ["7.2", "7.3", "10.1", "11.1", "12.1"]
    },
    {
      "id": 7,
      "tasks": ["10.2", "10.3", "11.2", "12.2", "13.1", "14.1"]
    },
    {
      "id": 8,
      "tasks": ["13.2", "13.3", "13.5", "14.2"]
    },
    {
      "id": 9,
      "tasks": ["13.4", "16.2", "16.3", "16.4", "16.5"]
    }
  ]
}
```
