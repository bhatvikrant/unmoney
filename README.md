# unmoney

A web rebuild of Money Manager (Realbyte) with every feature unlocked and no paywall. Installable as a PWA, synced across devices through Convex.

## Stack

- Vite + React 19 + TypeScript, React Router, Tailwind 4, shadcn/ui, Framer Motion, Recharts
- Convex: database, reactive queries, file storage for receipt photos, daily cron for repeat schedules
- Convex Auth: email + password, and Google (optional)

## Run it

```bash
npm install
npx convex dev        # first run: creates/links a Convex project and writes .env.local
npm run dev           # http://localhost:5173
```

`npx convex dev` keeps pushing the functions in `convex/` while you edit. Leave it running in a second terminal.

### Auth setup (once per deployment)

```bash
npx @convex-dev/auth --web-server-url http://localhost:5173
```

This sets `SITE_URL`, `JWT_PRIVATE_KEY` and `JWKS` on the deployment. Email + password works right away.

For Google sign-in, create an OAuth client (Web application) in Google Cloud with the redirect URI `https://<your-deployment>.convex.site/api/auth/callback/google`, then:

```bash
npx convex env set AUTH_GOOGLE_ID <client id>
npx convex env set AUTH_GOOGLE_SECRET <client secret>
```

### Demo data (dev only)

```bash
npx convex run seed:demo '{"email":"you@example.com"}'
```

## Deploy

Backend: `npx convex deploy` (then run the auth setup with `--prod` and your production `--web-server-url`).
Frontend: any static host. On Vercel, set the build command to `npx convex deploy --cmd 'npm run build'` so `VITE_CONVEX_URL` points at production.

## Layout

```
convex/        schema, auth, every query/mutation, cron
shared/        pure helpers used by both sides: dates, periods, money, ledger rules, defaults
src/           React app (pages/, components/, lib/)
replica/       recon map, feature matrix and architecture notes from the rebuild
```

## Features

Transactions (income / expense / transfer with fees), daily / calendar / weekly / monthly / summary views, custom month start day and week start day, carry-over, search with filters and bulk edit, filters by account and category, bookmarks, repeat schedules and installments, daily notes, stats by category with trends, budgets (total and per category, weekly / monthly / yearly, per-period overrides), accounts in groups with assets vs liabilities, credit cards with settlement and payment days (payable / outstanding, Pay), debit cards linked to a bank account, loans and overdrafts, hide / exclude / reorder accounts, deleted-account restore, transfer-as-expense, subcategories, sub-currencies with editable rates and custom currencies, passcode lock, light / dark / accent themes, CSV / TSV export and import, JSON backup and restore, PWA install.
