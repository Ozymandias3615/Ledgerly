# Ledgerly Personal — Design Doc (v1)

Status: draft. Scope: get budgeting live end-to-end; everything else in the
roadmap (savings goals, bill reminders, net worth, AI insights) follows the
same pattern once this lands.

## 1. Goals

- Let an existing Ledgerly account track *personal* finances — money that
  isn't any business's books — without touching the Business data model.
- Reuse the account, auth, hosting, and AI infra that already exist. Don't
  stand up a second backend/auth system for a roadmap item that's still
  finding its shape.
- Keep Personal and Business data **structurally incapable of mixing**. A bug
  that leaks a business transaction into someone's personal budget (or vice
  versa) is a trust-destroying bug for a finance app, so the two live in
  separate collections and separate endpoints rather than sharing
  `transactions` with a nullable `business_id`.

## 2. Non-goals (v1)

- Savings goals, bill reminders, net worth tracking, AI spending insights —
  designed later, same pattern, not blocking budgeting.
- Multi-user personal accounts (households/shared budgets). Personal data is
  single-user (`user_id`-scoped), no membership/role concept.
- Mobile app support. Web only for v1; mobile is currently single-business
  and has no context-switch concept at all (confirmed: no equivalent to
  `BusinessSwitcher` exists in `mobile/`).

## 3. Account & context model

Today, `users.active_business_id` tracks which business is "current," and
`GET /memberships` + `POST /memberships/switch` (`server.py:770-791`) let a
user flip between businesses they belong to. `_enrich_user()`
(`server.py:126-146`) merges the active business's derived fields
(`business_id`, `role`, `business_name`, `currency`, ...) onto the user object
returned by `/auth/me`.

Add a parallel, purely-presentational field:

```
users.active_context: "business" | "personal"   (default "business")
```

New endpoint, mirroring the switch pattern:

```
POST /api/context/switch   body: { context: "business" | "personal" }
```

Updates `active_context` and returns the re-enriched user. **This field does
not gate data access** — it only tells the frontend which nav/layout to
render. A user's personal budgets exist and stay queryable regardless of
which context is currently active, same as how switching business A → B
doesn't hide business A's data from existing business-scoped endpoints (it's
just not the *default* one anymore). Every personal endpoint scopes strictly
by `user_id` from `get_current_user()` — never by `active_context` — so
there's no failure mode where a stale/wrong context value exposes or hides
the wrong data.

Frontend: extend `BusinessSwitcher.jsx`'s popover with a "Personal" entry
(above or below the business list) that calls the new switch endpoint instead
of `/memberships/switch`. `AppLayout.jsx`'s `pageKey` (currently
`business_id:refreshNonce`, `AppLayout.jsx:61`) becomes
`active_context:business_id:refreshNonce` so switching context forces the
same remount-and-refetch behavior business-switching already gets for free.

Nav: when `active_context === "personal"`, swap the sidebar's business-mode
items (Invoices, Payroll, Inventory, Clients & Vendors) for personal-mode
items (Transactions, Budgets, ...). Dashboard, Settings stay but render
context-appropriate content.

## 4. Data model

Two new collections, both scoped by `user_id` only:

```
personal_transactions
  id, user_id, type ("income"|"expense"), amount, currency,
  category (free string, personal category list — see §6),
  description, date (ISO string), created_at

personal_budgets
  id, user_id, category, monthly_limit, currency, created_at, updated_at
```

`personal_budgets` is one row per category (not per month) — a budget is a
standing monthly limit, evaluated against whatever month is being viewed.
This matches "Set monthly budgets by category and see where you stand at a
glance" from the roadmap copy without needing a row-per-month.

No `business_id` field anywhere in either collection — that's the structural
guarantee against cross-contamination, not just a filter convention.

## 5. API

New router, mounted under `/api/personal` (separate file,
e.g. `backend/personal_router.py`, included into the main app — keeps this
domain out of the already-2000-line `server.py`):

```
POST   /api/context/switch                 { context }

GET    /api/personal/transactions          list (filters: type, category, date range)
POST   /api/personal/transactions          create
PUT    /api/personal/transactions/{id}     update
DELETE /api/personal/transactions/{id}     delete

GET    /api/personal/budgets               list
POST   /api/personal/budgets               create/upsert (one per category)
PUT    /api/personal/budgets/{id}          update limit
DELETE /api/personal/budgets/{id}          delete

GET    /api/personal/budgets/summary?month=YYYY-MM
       -> [{ category, limit, spent, remaining }] per budgeted category,
          computed by aggregating personal_transactions for that month.
```

All handlers: `Depends(get_current_user)`, filter every query by
`user["user_id"]`. No business/membership checks — a personal endpoint that
can't find a `business_id` to check against is itself a guard against
accidentally reusing business-scoped helper functions here.

## 6. Categories

Business's category list is a hardcoded frontend array
(`CATS_INCOME`/`CATS_EXPENSE` in `TransactionsPage.jsx:21-22`) with no
backend source of truth — reports just group by whatever string is on the
transaction. Personal needs its own list (Groceries, Rent/Mortgage,
Utilities, Subscriptions, Dining, Transportation, Healthcare, Entertainment,
Shopping, Savings, ...) since business categories (Office Supplies, Payroll,
Ads) don't apply. Same pattern: hardcoded frontend constant, no backend enum,
budgets reference these strings the same way transactions do.

## 7. Build order

1. `active_context` field + `/api/context/switch` + switcher UI entry
   (plumbing, no visible feature yet — verify context switch round-trips and
   nav swaps correctly)
2. `personal_transactions` CRUD + a minimal Personal Transactions page
   (budgeting needs *something* to compute spend against)
3. `personal_budgets` CRUD + Budgets page (set limits per category)
4. `GET /budgets/summary` + "at a glance" progress UI on the Budgets page
   (or Personal Dashboard) — this is the feature the roadmap copy promises

## 8. Decisions

- **Dashboard**: reuse the existing Dashboard route/shell. It renders
  personal widgets (budget progress, recent personal transactions) instead
  of business ones when `active_context === "personal"`, rather than a
  separate page. Avoids duplicating layout code.
- **Categories**: fixed list for v1 (§6), matching how Business categories
  work today. No backend category management to build.

## 9. Open questions

- Currency: personal budgets/transactions take a `currency` field like
  business transactions do, but there's no "business currency" concept to
  inherit a default from. Probably defaults to the user's browser locale or
  last-used personal currency, stored on the user doc
  (`personal_currency`?) — not resolved here, worth deciding before building
  step 2.
