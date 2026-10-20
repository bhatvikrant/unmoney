# Google OAuth verification for Gmail sync

Gmail sync asks for `https://www.googleapis.com/auth/gmail.readonly`, a **restricted** scope (see [specs/gmail-sync.md](specs/gmail-sync.md) §3.3). Until Google verifies the app, the Gmail consent screen says "Google hasn't verified this app" (Advanced › Continue gets past it) and at most 100 users can grant the scope. Verification has two parts: Google's **scope review** (this checklist, sections 1 to 6) and a yearly **CASA Tier 2** security assessment (section 7).

Everything below happens in the Google Cloud project that owns the production OAuth client (the one whose client ID is `AUTH_GOOGLE_ID` on the `brilliant-cheetah-609` Convex deployment). The console calls this area **Google Auth Platform** (Branding, Audience, Clients, Data access, Verification center); older docs call it the "OAuth consent screen".

## 1. Before you start

- [x] **Contact address.** `CONTACT_EMAIL` in [src/pages/legal/PrivacyPage.tsx](../src/pages/legal/PrivacyPage.tsx) is `vik.bhat223@gmail.com`; use the same address as the support and developer contact below.
- [ ] **Privacy policy is live** at <https://unmoney.vercel.app/privacy>, opens signed out, and its date is current. It must stay accurate to the code; re-read it whenever `convex/gmail.ts`, `shared/gmail/ai.ts` or what is stored changes.
- [ ] **Homepage** is <https://unmoney.vercel.app/>. Signed out it is the sign-in screen, which says what UnMoney does, mentions the optional Gmail connection, and links the privacy policy in its footer. Google checks that the homepage is public (no sign-in needed to read it), names the app as the consent screen does, explains the app, and links the same privacy policy URL.
- [ ] **Production is set up for Gmail**: `GMAIL_TOKEN_KEY` and `ANTHROPIC_API_KEY` are set with `--prod`, and the redirect URI `https://brilliant-cheetah-609.convex.site/gmail/callback` is on the OAuth client (README › Gmail sync). The reviewer will try the flow.
- [ ] **Verify both domains in Google Search Console** (section 1a below). Both hosts must be verified: the app's, and the Convex one the sign-in and Gmail redirect URIs live on.
- [ ] **Take the dev deployment off this client.** If the production OAuth client also lists `https://fortunate-bass-165.convex.site/...` redirect URIs, that domain would need authorizing and verifying as well. Simpler: give dev its own Google Cloud project and OAuth client, left in Testing with yourself as a test user, and set its `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` on the dev deployment only.
- [ ] **Project contacts are current**: Cloud project Owners/Editors and the developer contact email below are addresses you read. Google's reviewers write from `api-oauth-dev-verification-reply@google.com` and expect replies in the same thread.

## 1a. Domain verification, step by step

Google only accepts domains that a project Owner or Editor has proven they own in Search Console. UnMoney has two, and because `vercel.app` and `convex.site` are both public suffixes, each subdomain is verified on its own as a **URL prefix** property (there is no DNS to edit). Do this signed in to Google as the account that owns the Cloud project.

**A. `https://unmoney.vercel.app/` (the app)**

1. Open <https://search.google.com/search-console>, click the property picker (top left) › **Add property**.
2. In the right-hand box, **URL prefix**, enter `https://unmoney.vercel.app/` and press Continue.
3. Under **HTML file**, download the file (named like `google1a2b3c4d5e6f7a8b.html`).
4. Put it in this repo's `public/` folder, commit and push to `main` (or send it to Claude to do). Vercel serves files in `public/` before the app's catch-all rewrite.
5. Once the deploy is live, check `https://unmoney.vercel.app/google1a2b3c4d5e6f7a8b.html` shows one line of text, then press **Verify** in Search Console.

**B. `https://brilliant-cheetah-609.convex.site/` (the server)**

This one needs no file: `convex/http.ts` serves a page at `/` with Google's meta tag, filled in from an env var. This PR must be merged and deployed first.

1. Search Console › **Add property** › **URL prefix** › `https://brilliant-cheetah-609.convex.site/` › Continue.
2. Open **HTML tag** (under "Other verification methods"). It shows `<meta name="google-site-verification" content="SOME_TOKEN" />`. Copy just the `SOME_TOKEN` part.
3. In this repo, run:

   ```bash
   npx convex env set --prod GOOGLE_SITE_VERIFICATION SOME_TOKEN
   ```

4. Open `https://brilliant-cheetah-609.convex.site/` and view the page source; the meta tag should be there with your token. Press **Verify** in Search Console.

**C. Tell the Cloud project**

1. In Google Cloud › Google Auth Platform › **Branding** › Authorized domains, add `unmoney.vercel.app` and `brilliant-cheetah-609.convex.site` and save.
2. Each should show as verified. If one doesn't, the Search Console property was verified by a Google account that isn't an Owner or Editor of the Cloud project: add that account in Search Console › Settings › Users and permissions as an Owner, or verify again with the right account.

(The alternative to all of this is a custom domain for both the app and the Convex site, verified once by DNS; `SITE_URL` and Convex Auth's `CUSTOM_AUTH_SITE_URL` would then change with it, and so would the redirect URIs.)

## 2. Branding

| Field | Value |
| --- | --- |
| App name | `UnMoney` (exactly as on the homepage; no "Google" or "Gmail" in the name) |
| User support email | `vik.bhat223@gmail.com` |
| App logo | optional; 120×120 PNG made from `public/pwa-512x512.png`. Adding or changing it triggers a brand review |
| Application home page | `https://unmoney.vercel.app` |
| Application privacy policy link | `https://unmoney.vercel.app/privacy` |
| Application terms of service link | leave empty (optional) |
| Authorized domains | `unmoney.vercel.app` and `brilliant-cheetah-609.convex.site` |
| Developer contact information | `vik.bhat223@gmail.com` |

## 3. Audience

- [ ] **User type: External.**
- [ ] **Publishing status: In production.** Press "Publish app" and keep it there. In Testing only listed test users can sign in, and refresh tokens expire after 7 days, so every Gmail connection would die weekly and need reconnecting. In production but unverified, anyone can connect through the "unverified app" warning, up to the 100-user cap for the restricted scope. Publishing does not need verification to have passed first.

## 4. Data access (scopes)

Add exactly these, nothing else:

| Scope | Type | Used by |
| --- | --- | --- |
| `openid` | non-sensitive | sign-in (Convex Auth) |
| `.../auth/userinfo.email` | non-sensitive | sign-in |
| `.../auth/userinfo.profile` | non-sensitive | sign-in |
| `https://www.googleapis.com/auth/gmail.readonly` | **restricted** | Gmail sync (`convex/lib/gmailApi.ts`, `SCOPE`) |

Gmail is asked for in a separate, later consent (`connectUrl` in `convex/gmail.ts`, with `include_granted_scopes`), never at sign-in; say so if the form asks how the scope is requested.

**How will the scopes be used?** (justification for `gmail.readonly`, paste and adjust):

> UnMoney is a personal expense tracker. Gmail sync is an optional feature the user turns on from Settings › Gmail, through a separate consent after sign-in. Once connected, UnMoney's server searches the user's mailbox about once an hour (and when the user taps "Check now") for transaction mail from their bank, card issuers, payment apps and shops: senders on a list the user can edit, mail in Gmail's Purchases category if the user leaves that on, and mail whose subject mentions a payment. For each matching message it reads the text to find the amount, date, merchant and card or account digits, and shows the result to the user as an unsaved draft entry in their own ledger. The user checks each draft and saves or dismisses it; nothing is added to their records without their action.
>
> We store only the message id, thread id, sender, a subject cut to 120 characters, the arrival time and the extracted fields; message bodies and attachments are never stored, and mail that is not a transaction leaves no trace. When our rules cannot read a transaction mail, its sender, subject, date and up to 2,500 characters of its text are sent to Anthropic's Claude API to extract the same fields; Anthropic does not train on API data. The data is used only to show the user their own draft entries. It is never sold, never used for advertising, never used to train AI models, and not read by people. The refresh token is encrypted at rest (AES-256-GCM). Disconnecting, or deleting the account, revokes the grant at Google and deletes the token and every waiting draft.
>
> The app never sends, deletes, labels or modifies mail.

**Why a narrower scope is not enough** (if asked):

> `gmail.metadata` gives headers but not the message body, and the amount, merchant and card digits of a bank alert or receipt are only in the body. There is no Gmail scope narrower than `gmail.readonly` that returns message bodies. The app needs no write access, so `gmail.modify`, `gmail.compose` and `gmail.send` are not requested. Push (`users.watch`) is not used.

## 5. Demo video

Upload to YouTube as **Unlisted** and paste the link in the verification form. English UI, roughly 3 to 5 minutes, one continuous recording of the **production** site in a desktop browser with the address bar visible throughout. Show, in order:

1. [ ] `https://unmoney.vercel.app` signed out: the homepage, then open **Privacy policy** from its footer and scroll through it briefly.
2. [ ] **Continue with Google** and sign in (the non-sensitive sign-in consent).
3. [ ] More › **Gmail**: the explanation of what the feature reads and keeps; pick a look-back and press **Connect Gmail**.
4. [ ] **The Gmail consent screen**, in full. Pause on it with the address bar zoomed in or clearly readable so the `client_id=` in the URL can be matched to the production OAuth client ID, and so the Gmail permission ("View your email messages and settings") is visible in the list. Click through the "unverified app" warning if it shows; that is expected before verification.
5. [ ] Back in UnMoney on Settings › Gmail, connected, with the first check's result in **Recent checks**. Press **Check now**.
6. [ ] **The scope in use**: open Gmail in another tab on one bank alert or receipt, then the ledger in UnMoney showing that mail as a faded draft row on its day ("Unsaved"), and the review page `/gmail`.
7. [ ] Open the draft: the "From …" banner, the fields read from the mail, and **Open in Gmail** going back to the same message. Press **Save entry** and show the row turn solid; dismiss another with **Not an entry**.
8. [ ] **Removing access**: Settings › Gmail › **Disconnect** and the confirmation, the page back to "not connected", and (optional) <https://myaccount.google.com/connections> no longer listing UnMoney's Gmail access. Mention that Delete account at the bottom of More does the same and removes everything.

Use a test mailbox with a few real-looking bank and shop mails, or blur anything personal in edit. Do not cut away from the consent screen before the redirect back: the reviewer needs to see that consent leads straight into the feature.

## 6. Submit and follow up

- [ ] Google Auth Platform › **Verification center** › **Prepare for verification**. Review the summary, add the demo video link, and answer the questions with the text from section 4. Submit.
- [ ] Watch the developer contact inbox. Reviewers usually ask follow-ups (a clearer video moment, a privacy policy wording change, the Limited Use statement); reply in the thread. The privacy page already carries the Limited Use statement in Google's wording, under "Google API Services User Data Policy".
- [ ] Once the scope review passes, Google sends the **CASA** request (a Letter of Assessment); the scope stays capped until it is done.

## 7. CASA Tier 2 security assessment

Restricted scopes need a [Cloud Application Security Assessment](https://appdefensealliance.dev/casa) (CASA) through the App Defense Alliance: Tier 2 for an app like this, renewed every 12 months.

- [ ] Pick an **authorized CASA lab** from the App Defense Alliance list and buy a Tier 2 assessment (labs set their own price; compare a few). Give the lab the scope: the web app `https://unmoney.vercel.app` and the backend `https://brilliant-cheetah-609.convex.cloud` / `.convex.site`.
- [ ] Run the **application scan** the lab asks for (Tier 2 is a scan you or the lab runs, plus a self-assessment questionnaire the lab reviews), fix what it finds, and rescan until it is clean.
- [ ] Fill in the **self-assessment questionnaire**. What to point to in this repo:
  - token storage: `convex/lib/gmailCrypto.ts` (AES-256-GCM, fresh IV, key in `GMAIL_TOKEN_KEY`, never in the repo);
  - mail handling: bodies only inside Convex actions (`convex/gmail.ts`, `convex/lib/gmailApi.ts`), never stored or logged (logs carry counts and token usage only);
  - access control: every query and mutation scopes to the signed-in user (`convex/lib/auth.ts`, `requireUser`);
  - deletion: Disconnect (`gmail.disconnect`) and Delete account (`convex/account.ts`) revoke at Google and purge; resolved drafts pruned after 90 days (`pruneDrafts` in `convex/sync.ts`);
  - transport: HTTPS only (Vercel and Convex);
  - dependencies: `npm audit` clean or explained.
- [ ] The lab sends its result to Google; Google confirms and lifts the cap. Put the renewal date in your calendar: the assessment and Google's re-verification come back every year.

## 8. After verification

- Any new Google scope, or a changed app name, logo, homepage or privacy policy URL, sends the app back through review. Change the policy text itself whenever the code changes what is read, stored or shared, and bump its date.
- Keep the `/` route in `convex/http.ts` with `GOOGLE_SITE_VERIFICATION` set, the `public/google…html` file, and the publishing status at In production: Google re-checks domain ownership now and then.
