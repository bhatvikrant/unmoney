/**
 * /privacy — the privacy policy, outside the app shell and the sign-in gate so Google's reviewers
 * (and anyone signed out) can read it. Written to match what the code does: convex/gmail.ts,
 * shared/gmail/ai.ts, convex/account.ts, convex/sync.ts (pruneDrafts). Change it when they change.
 */
import { useEffect, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Logo } from "@/components/shell/Logo";
import { Button } from "@/components/ui/button";
import { useGoBack } from "@/lib/nav";
import { applyTheme } from "@/lib/theme";

/** Fill in before submitting the consent screen for Google's verification (docs/google-verification.md). */
const CONTACT_EMAIL = "privacy@example.com";
const UPDATED = "20 October 2026";
const USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";
const LIMITED_USE = "https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes";

export default function PrivacyPage() {
  const goBack = useGoBack();
  // Signed out, nothing has applied a theme yet: follow the system, as the sign-in screen does.
  useEffect(() => {
    if (!document.documentElement.dataset.colorset) applyTheme("system", "neutral", "A");
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => goBack("/")}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
          <Logo size={24} className="ml-auto" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-8 pb-16 text-sm leading-relaxed text-foreground/90">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Privacy policy</h1>
        <p className="mt-1 text-muted-foreground">Last updated {UPDATED}</p>

        <p className="mt-6">
          UnMoney is an expense tracker. You sign in with Google, record your income, expenses and transfers, and the app keeps
          them in step across your devices. If you choose, it can also read the mail your bank, cards and shops send about
          payments and turn each one into a draft entry for you to check. This page says what UnMoney collects, what it does
          with it, who else sees it, and how to remove it.
        </p>

        <Section title="In short">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Your data is used for one thing: showing you your own ledger. It is never sold, never used for ads, and never shared except with the services that run the app, listed below.</li>
            <li>Gmail access is read-only and optional. It is asked for separately, only when you turn it on.</li>
            <li>UnMoney never stores the mail itself, only what it read from it (amount, date, merchant, card digits) and the mail's id.</li>
            <li>You can disconnect Gmail or delete your account at any time, from inside the app.</li>
          </ul>
        </Section>

        <Section title="What UnMoney collects">
          <Sub title="When you sign in with Google">
            Your name, email address and profile picture, from Google's basic profile. They identify your account and are shown
            on the More page. UnMoney does not see your Google password.
          </Sub>
          <Sub title="What you put in">
            The entries, payment methods, categories, budgets, repeats, notes, bookmarks and receipt photos you add, and your
            settings. A passcode, if you set one, is kept only as a salted hash. A copy of your ledger is also kept in your
            browser so the app works offline; signing out clears it.
          </Sub>
          <Sub title="If you connect Gmail">
            Gmail is connected from More › Gmail, through a second Google consent screen that asks for read-only access to your
            mail (the <code className="rounded bg-muted px-1 py-0.5 text-[12px]">gmail.readonly</code> scope). See the next section.
          </Sub>
        </Section>

        <Section title="Gmail: what is read and what is kept">
          <p>
            Once connected, UnMoney checks your mailbox about once an hour, and when you tap Check now. Each check searches for
            mail about money: from the senders listed on the Gmail settings page (banks, cards, payment apps, shops), mail Gmail
            files under Purchases if you leave that on, and mail whose subject mentions a payment. For each new match it reads
            the sender, subject, date and text, works out whether it describes a payment, and if so writes a draft entry.
          </p>
          <p className="mt-3">
            The access is read-only. UnMoney cannot send, delete, label or change anything in your mailbox.
          </p>
          <p className="mt-3">What is stored, in UnMoney's database:</p>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
            <li>For each draft: the mail's Gmail id and thread id, the sender, the subject cut to 120 characters, when it arrived, and the fields read from it (type, amount, currency, date, time, merchant, which payment method and category it seems to belong to, and the last four digits of a card or account when the mail names them).</li>
            <li>On a saved entry: the Gmail id of the mail it came from, so the entry can link back to it in Gmail.</li>
            <li>For the connection: your Gmail address, Google's refresh token encrypted with AES-256-GCM, your sender list and options, which card digits you matched to which payment method, and a log of the last ten checks (when, how many mails, how many drafts, and any error).</li>
          </ul>
          <p className="mt-3">
            What is not stored: the text of your mail, attachments, other headers, and anything from mail that turned out not
            to be a payment. Mail text is held in memory only while a check runs. The short-lived access tokens Google issues for
            each check are never stored.
          </p>
        </Section>

        <Section title="How Gmail data is used">
          <p>
            Only to show you your own draft entries, so you can check them and save the right ones to your ledger. Nothing from
            Gmail counts in your balances or stats until you save it, and you decide every time. Gmail data is not used for
            advertising, not used to build profiles, not used to judge creditworthiness or for lending, and not used to train
            AI or machine-learning models, UnMoney's or anyone else's.
          </p>
          <p className="mt-3">
            No one at UnMoney reads your mail or the drafts made from it, unless you ask us to (for example, to look into a
            draft that was read wrong), it is needed for security (such as investigating abuse), or the law requires it.
          </p>
        </Section>

        <Section title="Reading mail with Claude">
          <p>
            Most bank and shop mail is read by rules that run on UnMoney's server. When a mail looks like a payment but no rule
            can read it, its sender, subject, date received and up to 2,500 characters of its text are sent to Anthropic's API,
            where the Claude model picks out the amount, date and merchant. With them go the names of your categories and
            payment methods (with the last four digits of cards and accounts), so the answer uses your own names. The same API
            suggests category clean-ups in More › Categories › Tidy up, when you ask for it, from your category names, how
            much each is used and its most common notes.
          </p>
          <p className="mt-3">
            Anthropic processes this only to return the answer to UnMoney. Under Anthropic's commercial terms, data sent
            through its API is not used to train its models, and it is deleted after a limited retention period. UnMoney checks
            every answer against your real categories and payment methods before it becomes a draft.
          </p>
        </Section>

        <Section title="Who else handles your data">
          <p>UnMoney does not sell, rent or share your data. These services run the app and handle it on UnMoney's behalf:</p>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
            <li><strong className="font-medium text-foreground">Convex</strong>: the database and server. Everything listed above is stored here.</li>
            <li><strong className="font-medium text-foreground">Vercel</strong>: serves the web app's files. It does not receive your ledger or your mail.</li>
            <li><strong className="font-medium text-foreground">Google</strong>: sign-in, and the Gmail API if you connect Gmail.</li>
            <li><strong className="font-medium text-foreground">Anthropic</strong>: reads the mail no rule could read, as described above.</li>
          </ul>
          <p className="mt-3">
            Your data could also be disclosed if the law requires it, or passed to a new owner if UnMoney were ever sold or
            merged, in which case you would be told first. There are no ads and no third-party analytics or tracking in the app.
          </p>
        </Section>

        <Section title="How long things are kept">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Drafts waiting for you: until you save or dismiss them, or disconnect Gmail.</li>
            <li>Drafts you saved or dismissed: deleted 90 days after you did.</li>
            <li>The encrypted Gmail token and connection settings: until you disconnect Gmail or delete your account.</li>
            <li>Your entries (including ones saved from Gmail), and the rest of your ledger: until you delete them or your account.</li>
          </ul>
        </Section>

        <Section title="Disconnecting Gmail and deleting your data">
          <p>
            <strong className="font-medium text-foreground">Disconnect Gmail</strong> in More › Gmail. UnMoney tells Google to
            revoke its access, deletes the token and connection, and deletes every draft still waiting. Entries you saved stay in
            your ledger; drafts you already saved or dismissed are deleted on the 90-day schedule above. You can also remove
            UnMoney's access from your Google Account at{" "}
            <A href="https://myaccount.google.com/connections">myaccount.google.com/connections</A>; UnMoney then stops reading
            your mail and asks you to reconnect, and Disconnect removes what is left.
          </p>
          <p className="mt-3">
            <strong className="font-medium text-foreground">Delete account</strong> at the bottom of the More page. UnMoney
            revokes its Gmail access at Google and deletes your account and everything in it: entries, payment methods,
            categories, photos, drafts, the Gmail connection and your sign-in. This cannot be undone, so export a backup first
            (More › Backup &amp; export) if you want one.
          </p>
          <p className="mt-3">If you cannot sign in any more and want your data deleted, write to the address below.</p>
        </Section>

        <Section title="Google API Services User Data Policy">
          <p>
            UnMoney's use and transfer to any other app of information received from Google APIs will adhere to the{" "}
            <A href={USER_DATA_POLICY}>Google API Services User Data Policy</A>, including the{" "}
            <A href={LIMITED_USE}>Limited Use requirements</A>.
          </p>
          <p className="mt-3">In particular, data from Gmail is:</p>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
            <li>used only to provide the feature you see: draft entries in your own ledger;</li>
            <li>transferred to others only as needed to provide that feature (to Anthropic, for reading mail, as above), to comply with the law, or as part of a merger or sale with your consent;</li>
            <li>never used or transferred for advertising, including personalised or retargeted ads;</li>
            <li>never sold, and never used to determine creditworthiness or for lending;</li>
            <li>never used to develop, improve or train generalised AI or machine-learning models;</li>
            <li>never read by people, except with your consent, for security, or to comply with the law.</li>
          </ul>
        </Section>

        <Section title="Security">
          Data travels over HTTPS. The Gmail refresh token is encrypted before it is stored, with a key held only on the server.
          Mail is read only inside the server's functions, never in the browser. Each account can reach only its own data.
        </Section>

        <Section title="Children">
          UnMoney is not meant for children under 13 and does not knowingly collect their data.
        </Section>

        <Section title="Changes">
          If this policy changes, the date at the top changes with it. A change in how Gmail data is used will be shown in the
          app before it takes effect.
        </Section>

        <Section title="Contact">
          Questions, or a request to see or delete your data: <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>.
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="mb-2.5 text-base font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a href={href} className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/70" {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}
