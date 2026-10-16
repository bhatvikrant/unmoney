# UnMoney

A web rebuild of Money Manager (Realbyte) with every feature unlocked and no paywall. Installable as a PWA, works fully offline, and syncs across devices through Convex.

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

## Offline

The app never waits for the network. Every screen renders from a local copy of your data in IndexedDB, and every add, edit or delete is applied to that copy immediately and queued. The queue is sent to Convex whenever the connection is up; the sidebar (desktop) and the dot on the **More** tab (phone) show "Offline", "Syncing" or "Synced", and Settings › Sync has the details.

How it fits together:

- `shared/ops.ts` is the single source of truth for writes: a catalogue of ops (`transactions.create`, `accounts.update`, …) and a pure reducer that applies one to a snapshot of a user's documents. The browser runs it on the local copy; `convex/sync.ts` runs the same reducer on the real documents and writes the difference. New documents get deterministic temporary ids (`tmp_<opId>_<n>`) on both sides, and the server reports the real id each one received.
- `shared/views.ts` holds the read models (ledger, stats, budgets, search, exports) as pure functions over that snapshot, so nothing needs a server query.
- `src/lib/store.tsx` keeps the replica, the queue and the id map in IndexedDB (`src/lib/db.ts`), streams the server's tables with `sync.table` subscriptions, replays queued ops on top, and drains the queue in order with the idempotent `sync.apply` mutation (`syncOps` table). A rejected op (for example a category deleted on another device meanwhile) is undone locally and reported in a toast.
- Receipt photos are queued too: the file is kept in IndexedDB and uploaded when online. Photos already seen are cached by the service worker.
- The service worker (`vite-plugin-pwa`) precaches the app shell, so the app opens with no connection at all. The first load on a new device, signing in, and creating an account still need a connection. When a new version is deployed, the app shows a "new version is ready" toast and reloads into it when you tap Reload (queued changes are in IndexedDB, so nothing is lost); installed apps check for a new version hourly and whenever they come back to the front.

Conflicts are resolved last-writer-wins per op: two devices editing the same entry offline end up with whichever synced last.

To try it: build (`npm run build`), serve `dist/` (`npm run preview`), open it once signed in, then switch the browser to offline in DevTools (Network › Offline) or turn off Wi-Fi, reload, and keep using the app.

## Install on a phone

UnMoney is a PWA: installed, it opens full screen from the home screen with its own icon and works offline.

- **Android (Chrome, Edge, Samsung Internet):** the browser offers to install it; Settings › Install app shows the same prompt. Long-press the icon for the Add transaction and Stats shortcuts.
- **iPhone / iPad:** in Safari (or Chrome / Edge on iOS 16.4+), Share › Add to Home Screen. The app shows this hint once, and Settings › Install app explains it. The installed app has its own storage on iOS, so sign in once inside it.

Icons in `public/` are generated from `public/icon.svg` with `npm run icons` (`pwa-assets.config.ts`); the manifest and service worker are configured in `vite.config.ts`, and `src/lib/pwa.ts` registers the worker and tracks install state.

## Layout

```
convex/        schema, auth, every query/mutation, cron
shared/        pure helpers used by both sides: dates, periods, money, ledger rules, defaults
src/           React app (pages/, components/, lib/)
replica/       recon map, feature matrix and architecture notes from the rebuild
```

## Features

Transactions (income / expense / transfer with fees), daily / calendar / weekly / monthly / summary views, custom month start day and week start day, carry-over, search with filters and bulk edit, filters by account and category, bookmarks, repeat schedules and installments, daily notes, stats by category with trends, budgets (total and per category, weekly / monthly / yearly, per-period overrides), accounts in groups with assets vs liabilities, credit cards with settlement and payment days (payable / outstanding, Pay), debit cards linked to a bank account, loans and overdrafts, hide / exclude / reorder accounts, deleted-account restore, transfer-as-expense, subcategories, sub-currencies with editable rates and custom currencies, passcode lock, light / dark / accent themes, CSV / TSV / Excel (.xlsx) import (incl. Money Manager), CSV / TSV export, JSON backup and restore, PWA install.
