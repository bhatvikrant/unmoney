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

Live at https://unmoney.vercel.app. Backend: Convex production deployment `brilliant-cheetah-609` (same project as the dev deployment); frontend: Vercel project `unmoney`. This is what was run to get there:

```bash
npx convex deploy                                   # creates the prod deployment and pushes convex/
npx @convex-dev/auth --prod --web-server-url https://unmoney.vercel.app   # SITE_URL, JWT_PRIVATE_KEY, JWKS on prod
npm i -g vercel && vercel login && vercel link       # Vercel project "unmoney"
npx convex deployment token create vercel --prod    # prints a prod deploy key
vercel env add CONVEX_DEPLOY_KEY production         # paste that key
vercel deploy --prod
vercel git connect                                  # link github.com/bhatvikrant/unmoney
```

The Vercel project is connected to the GitHub repo, so every push to `main` builds and deploys to production; other branches get preview deployments.

`vercel.json` sets the build command to `npx convex deploy --cmd 'npm run build'`, so every Vercel build pushes `convex/` to production and bakes the production `VITE_CONVEX_URL` into the bundle (it needs `CONVEX_DEPLOY_KEY` in the Vercel env). It also rewrites every path to `index.html` so React Router deep links work.

If the production URL ever changes (custom domain), update it on the backend: `npx convex env set --prod SITE_URL https://<new host>`.

### Google sign-in in production

Not configured yet; "Continue with Google" fails until it is. In Google Cloud, create an OAuth client (Web application) with this redirect URI:

```
https://brilliant-cheetah-609.convex.site/api/auth/callback/google
```

Then set the credentials on the production deployment:

```bash
npx convex env set --prod AUTH_GOOGLE_ID <client id>
npx convex env set --prod AUTH_GOOGLE_SECRET <client secret>
```

(For the dev deployment use the same steps without `--prod` and the `fortunate-bass-165.convex.site` redirect URI.)

## Layout

```
convex/        schema, auth, every query/mutation, cron
shared/        pure helpers used by both sides: dates, periods, money, ledger rules, defaults
src/           React app (pages/, components/, lib/)
replica/       recon map, feature matrix and architecture notes from the rebuild
```

## Features

Transactions (income / expense / transfer with fees), daily / calendar / weekly / monthly / summary views, custom month start day and week start day, carry-over, search with filters and bulk edit, filters by account and category, bookmarks, repeat schedules and installments, daily notes, stats by category with trends, budgets (total and per category, weekly / monthly / yearly, per-period overrides), accounts in groups with assets vs liabilities, credit cards with settlement and payment days (payable / outstanding, Pay), debit cards linked to a bank account, loans and overdrafts, hide / exclude / reorder accounts, deleted-account restore, transfer-as-expense, subcategories, sub-currencies with editable rates and custom currencies, passcode lock, light / dark / accent themes, CSV / TSV export and import, JSON backup and restore, PWA install.
