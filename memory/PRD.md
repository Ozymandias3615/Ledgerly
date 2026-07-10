# Ledgerly — Product Requirements

## Original Problem Statement
> Can you create an app that automates bookkeeping, tracks daily cash flow, sends professional invoices, runs employee payroll, and generates vital tax and financial reports? I also want to be able to export files into a CSV or XLSX. I also want to be able to visualize the data that I put into the app, as well as track revenue and business growth.

## User Choices (2026-02)
- Auth: JWT email/password **+** Emergent-managed Google social login
- AI: Claude Sonnet 4.5 for financial insights (via Emergent LLM key)
- Invoice delivery: downloadable PDF only
- Currency: multi-currency (USD, EUR, GBP, JMD, GHS, CAD, INR, AUD, JPY)
- Modules: all core (bookkeeping, cash flow, invoices, payroll, reports, charts, CSV/XLSX)

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT cookies, Emergent Google Auth, `emergentintegrations` for Claude, ReportLab for PDF, openpyxl for XLSX.
- Frontend: React 19 + React Router v7, Shadcn UI, Recharts, @phosphor-icons/react, sonner toasts, IBM Plex Sans / Manrope typefaces (Swiss High-Contrast design).

## What's Implemented (2026-02-09)
- ✅ JWT email/password auth (register/login/logout/me) + Emergent Google OAuth callback route.
- ✅ Bookkeeping module: transactions CRUD with tax, category, multi-currency.
- ✅ Invoices: line-item invoices with auto-numbering, subtotal/tax/total calc, status, PDF download.
- ✅ Payroll: employees CRUD, payroll runs with payslips (gross/tax/net) auto-logging as expense.
- ✅ Reports: dashboard KPIs, P&L by category, tax summary (period-based).
- ✅ Exports: transactions/invoices/payroll → CSV and XLSX.
- ✅ Visualisation: monthly cash-flow line chart, expense pie chart, net profit bar chart.
- ✅ AI Insights (Claude Sonnet 4.5) with graceful degradation when LLM credits are 0.
- ✅ Admin seed (`admin@ledgerly.com` / `Admin@12345`).

## Backlog (P1)
- Invoice email delivery (Resend/SendGrid).
- Recurring/scheduled invoices and reminders.
- Bank/CSV transaction import wizard.
- Client & vendor directory.
- Multi-user teams with role-based access.

## Backlog (P2)
- OCR receipt capture (attach files to expenses).
- FX conversion between currencies with historical rates.
- Balance sheet & cash-flow statement (GAAP).
- Sales-tax rule engine (per-region tax categories).

## Known
- Emergent LLM key balance may be 0 – add balance under Profile → Universal Key → Add Balance to enable AI Insights.
