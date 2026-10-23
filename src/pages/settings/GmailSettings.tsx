/**
 * More › Gmail: connect a mailbox so money mail becomes draft entries, see what the checks found,
 * tune which senders are read, and disconnect. The consent screen is Google's own page; this
 * screen sends the browser there and reads the outcome from ?gmail= when it comes back.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Mail, Pause, Play, RefreshCw, Unplug, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { LOOKBACKS, normaliseSender, SENDER_PRESETS, windowStart, type Lookback } from "../../../shared/gmail/query";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const DAY = 24 * 60 * 60 * 1000;
/** "23 Sep". */
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** How long before this page loads the first check may have started. */
const FIRST_CHECK_SLACK_MS = 2 * 60 * 1000;

const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught ConvexError: /, "").replace(/\n[\s\S]*$/, "") : "Something went wrong");

export default function GmailSettings() {
  const nav = useNavigate();
  const s = useQuery(api.gmail.status);
  const connectUrl = useAction(api.gmail.connectUrl);
  const disconnect = useAction(api.gmail.disconnect);
  const syncNow = useAction(api.gmail.syncNow);
  const update = useMutation(api.gmail.updateSettings);
  const muteSender = useMutation(api.gmail.muteSender);
  const claimConnection = useMutation(api.gmail.claimConnection);
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const [lookback, setLookback] = useState<Lookback>(30);
  const [busy, setBusy] = useState<null | "connect" | "check" | "disconnect">(null);
  const [newSender, setNewSender] = useState("");
  /**
   * Back from connecting: the first check is running, and what it finds opens as a list to pick
   * from. It started as Google sent the browser back, a moment before this page loaded.
   */
  const [waitingSince, setWaitingSince] = useState<number | null>(() => (sp.get("gmail") === "claim" || sp.get("gmail") === "connected" ? Date.now() - FIRST_CHECK_SLACK_MS : null));
  const firstCheck = waitingSince !== null && s?.connected ? s.log.find((l) => l.at >= waitingSince) : undefined;
  const waiting = waitingSince !== null && !!s?.connected && s.lookbackDays !== 0 && !firstCheck;
  const handled = useRef(false);
  const claimed = useRef<string | null>(null);

  // back from Google's consent screen
  useEffect(() => {
    const outcome = sp.get("gmail");
    if (!outcome) return;
    if (outcome === "claim") {
      // Google gave the grant to this browser: attach it, if this account is the one that asked
      const claim = sp.get("claim") ?? "";
      // once: a second claim of the same grant (StrictMode runs effects twice) would read as expired
      if (claimed.current === claim) return;
      claimed.current = claim;
      void claimConnection({ claim }).then((r) => {
        if (r === "connected") return void toast.success("Gmail connected");
        setWaitingSince(null);
        if (r === "other-account") toast.error("That Gmail link was started from another UnMoney account, so nothing was connected. To connect your Gmail, use Connect below.", { duration: 10000 });
        else toast.error("That link has expired. Connect again.");
      }, () => { setWaitingSince(null); toast.error("Could not connect Gmail. Try again."); });
    } else if (outcome === "connected") toast.success("Gmail connected");
    else if (outcome === "denied") toast("Gmail was not connected.");
    else if (outcome === "no-scope") toast.error("Google didn't give UnMoney access to your mail. Connect again and tick the Gmail box on Google's screen.", { duration: 10000 });
    else if (outcome === "api-off") toast.error("Gmail can't be connected yet: the Gmail API is switched off in UnMoney's Google Cloud project.", { duration: 10000 });
    else toast.error("Could not connect Gmail. Try again.");
    const n = new URLSearchParams(sp);
    n.delete("gmail");
    n.delete("claim");
    setSp(n, { replace: true });
  }, [sp, setSp, claimConnection]);

  // the first check finished: show what it found before anything is imported
  useEffect(() => {
    if (handled.current || waitingSince === null || !s?.connected) return;
    if (s.lookbackDays === 0) {
      handled.current = true;
      toast("New money mail will show up in From Gmail for you to pick from.");
      return;
    }
    if (!firstCheck) return;
    handled.current = true;
    if (firstCheck.error) toast.error(`The first check failed: ${firstCheck.error}`);
    else if (s.open) nav("/gmail");
    else toast(`No money mail found in the last ${s.lookbackDays} days. New mail is checked every hour.`);
  }, [waitingSince, firstCheck, s, nav]);

  async function connect() {
    setBusy("connect");
    try {
      // reconnecting keeps the look-back already chosen; only a first connection takes the picker's
      window.location.assign(await connectUrl({ lookbackDays: s?.connected ? s.lookbackDays : lookback }));
    } catch (e) {
      toast.error(errorText(e));
      setBusy(null);
    }
  }

  async function check() {
    setBusy("check");
    try {
      const r = await syncNow({});
      if (!r.ran) toast("Checked less than a minute ago.");
      else if (r.error) toast.error(`The check failed: ${r.error}`);
      else if (r.found) toast.success(`Found ${r.found} new ${r.found === 1 ? "entry" : "entries"}`, { action: { label: "Pick what to import", onClick: () => nav("/gmail") } });
      else toast.success("Nothing new.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: "Disconnect Gmail?",
      description: `UnMoney stops reading ${s?.email ?? "this mailbox"} and forgets its access. Entries you saved stay; drafts still waiting are removed.`,
      action: "Disconnect",
    });
    if (!ok) return;
    setBusy("disconnect");
    try {
      await disconnect({});
      toast("Gmail disconnected.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function patch(args: Parameters<typeof update>[0]) {
    try {
      await update(args);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function changeLookback(d: Lookback) {
    if (!s || d === s.lookbackDays) return;
    try {
      await update({ lookbackDays: d });
      const back = day(windowStart({ lookbackDays: d, readsFrom: Date.now() - d * DAY }, Date.now()));
      toast(d === 0 ? "Only new mail is read from now on." : `The next check reads back to ${back}.`, d ? { action: { label: "Check now", onClick: () => void check() } } : undefined);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function clearSenders() {
    if (!s) return;
    const ok = await confirm({
      title: "Clear all senders?",
      description: `All ${s.senders.length} are removed. Only mail with a payment in its subject${s.scanPurchases ? " or filed under Purchases" : ""} will be read until you add some back; presets bring them back in one tap.`,
      action: "Clear all",
    });
    if (ok) void patch({ senders: [] });
  }

  function addSender() {
    const entry = normaliseSender(newSender);
    if (!entry || !s) return;
    if (!/^[a-z0-9.@_+-]+\.[a-z]{2,}$/i.test(entry)) { toast.error("Enter an address like alerts@bank.com or a domain like bank.com"); return; }
    if (s.senders.includes(entry)) { setNewSender(""); return; }
    void patch({ senders: [...s.senders, entry] });
    setNewSender("");
  }

  return (
    <>
      <PageHeader back="/settings" title="Gmail" />
      <Page className="pb-10">
        {s === undefined ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div> : null}

        {s && !s.connected ? (
          <>
            <Section>
              <div className="px-4 py-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Mail className="size-4" /></span>
                  <div className="text-sm">
                    <div className="font-medium">Turn money mail into entries</div>
                    <div className="mt-0.5 text-muted-foreground">Let UnMoney read the mail your bank, cards and shops send about payments. Each one becomes a faded entry on its day in the ledger, for you to check and save.</div>
                  </div>
                </div>
                <ul className="ml-12 list-disc space-y-1 text-xs text-muted-foreground">
                  <li>Reads mail only. It cannot send, delete or label anything.</li>
                  <li>Keeps the amount, date, merchant and which card: never the mail itself.</li>
                  <li>Nothing counts in your balances or stats until you save it.</li>
                  <li>Disconnect any time; saved entries stay, waiting drafts are removed.</li>
                </ul>
              </div>
            </Section>
            <Section title="Look back">
              <div className="px-4 py-3">
                <LookbackPicker value={lookback} onChange={setLookback} />
                <div className="mt-2 text-xs text-muted-foreground">{lookback === 0 ? "Only mail that arrives after you connect. Nothing already in your inbox is read." : `Every hourly check reads money mail from the last ${lookback} days. You can change this later.`}</div>
              </div>
            </Section>
            <div className="px-4 pt-4">
              <Button className="w-full h-11" disabled={busy !== null || !s.configured} onClick={() => void connect()}>
                <Mail className="size-4" />{busy === "connect" ? "Opening Google…" : "Connect Gmail"}
              </Button>
              {!s.configured ? <p className="mt-2 text-xs text-muted-foreground">Gmail sync isn't set up on this server yet (GMAIL_TOKEN_KEY is missing).</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">Google will show its consent screen. Until UnMoney finishes Google's app verification it may warn that the app is unverified; Advanced › Continue gets past that.</p>
            </div>
          </>
        ) : null}

        {s && s.connected ? (
          <>
            {waiting ? (
              <div className="mx-4 mt-4 flex items-start gap-3 rounded-lg border bg-card p-3 text-sm" role="status">
                <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                <div>
                  <div className="font-medium">Looking for money mail in your inbox…</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">This takes a few seconds. You'll see everything it finds and pick what to import; nothing is added before that.</div>
                </div>
              </div>
            ) : null}
            {s.status === "reauth" ? (
              <div className="mx-4 mt-4 rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                <div className="font-medium">Gmail needs reconnecting</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Google no longer accepts the saved access{s.lastError ? ` (${s.lastError})` : ""}. Connect again to carry on.</div>
                <Button size="sm" className="mt-2" disabled={busy !== null} onClick={() => void connect()}>Reconnect</Button>
              </div>
            ) : null}

            <Section>
              <div className="flex items-start gap-3 px-4 pt-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Mail className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">Connected to <span className="font-medium break-all">{s.email}</span></div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", s.status === "ok" ? "bg-income" : s.status === "paused" ? "bg-muted-foreground" : "bg-amber-500")} />
                    <span>
                      {s.status === "ok" ? "Checks every hour" : s.status === "paused" ? "Paused" : "Needs reconnecting"}
                      {" · "}{s.lastSyncAt ? `last checked ${ago(s.lastSyncAt)}` : "not checked yet"}
                    </span>
                  </div>
                  {s.status === "paused" && s.lastError ? <div className="mt-1 text-xs text-destructive">Paused after repeated failures: {s.lastError}</div> : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-4">
                <Button variant="outline" disabled={busy !== null || s.status !== "ok"} onClick={() => void check()}>
                  <RefreshCw className={cn("size-4", busy === "check" && "animate-spin")} />{busy === "check" ? "Checking…" : "Check now"}
                </Button>
                {s.status === "paused" ? (
                  <Button variant="outline" onClick={() => void patch({ paused: false })}><Play className="size-4" />Resume</Button>
                ) : (
                  <Button variant="outline" disabled={s.status === "reauth"} onClick={() => void patch({ paused: true })}><Pause className="size-4" />Pause</Button>
                )}
              </div>
              <Row
                label={s.open ? `${s.open} ${s.open === 1 ? "draft" : "drafts"} waiting` : "Nothing waiting"}
                hint={s.open ? "Faded rows in the ledger, or review them all" : "New money mail shows up here to pick from"}
                className="border-t"
                onClick={s.open ? () => nav("/gmail") : undefined}
                right={s.open ? <span className="flex items-center gap-1 text-sm font-medium">Review<ChevronRight className="size-4 text-muted-foreground" /></span> : null}
              />
            </Section>

            <Section title="Look back">
              <div className="px-4 py-3">
                <LookbackPicker value={s.lookbackDays} onChange={(d) => void changeLookback(d)} />
                <div className="mt-2 text-xs text-muted-foreground">
                  {s.lookbackDays === 0
                    ? <>Only mail that arrives from {day(s.readsFrom ?? Date.now())} on is read. Nothing older in your inbox.</>
                    : <>Every hourly check reads money mail from the last {s.lookbackDays} days, now back to <span className="text-foreground">{day(windowStart({ lookbackDays: s.lookbackDays, readsFrom: s.readsFrom ?? undefined, syncedUpTo: s.syncedUpTo ?? undefined }, Date.now()))}</span>. Mail that already became a draft is skipped.</>}
                </div>
              </div>
            </Section>

            <Section title="What is read">
              <Row label="Mail Gmail files under Purchases" hint="Receipts from shops the sender list doesn't name" right={<Switch aria-label="Read mail Gmail files under Purchases" checked={s.scanPurchases} onCheckedChange={(v) => void patch({ scanPurchases: v })} />} />
              <Collapsible label="Senders" hint={s.senders.length ? `${s.senders.length} addresses and domains always read` : "None: only mail with a payment in its subject"} count={s.senders.length}>
                <div className="text-xs text-muted-foreground">Mail from these is always read. Mail from anyone else only when its subject mentions a payment.</div>
                <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Presets</div>
                <div className="mt-1 -mx-4 divide-y border-y">
                  {SENDER_PRESETS.map((p) => {
                    const have = p.senders.filter((x) => s.senders.includes(x)).length;
                    const all = have === p.senders.length;
                    return (
                      <label key={p.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{p.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{have && !all ? `${have} of ${p.senders.length} on your list · ` : ""}{p.senders.join(", ")}</span>
                        </span>
                        <Switch aria-label={p.name} checked={all} onCheckedChange={(on) => void patch({ senders: on ? [...s.senders, ...p.senders.filter((x) => !s.senders.includes(x))] : s.senders.filter((x) => !p.senders.includes(x)) })} />
                      </label>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Your list · {s.senders.length}</span>
                  {s.senders.length ? <Button variant="ghost" size="sm" className="h-7 -mr-2 text-destructive hover:text-destructive" onClick={() => void clearSenders()}>Clear all</Button> : null}
                </div>
                {s.senders.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.senders.map((x) => <Chip key={x} label={x} remove={`Remove ${x}`} onRemove={() => void patch({ senders: s.senders.filter((y) => y !== x) })} />)}
                  </div>
                ) : <div className="mt-1.5 text-xs text-muted-foreground">No senders. Turn on a preset or add one below.</div>}
                <div className="mt-3 flex gap-2">
                  <Input value={newSender} onChange={(e) => setNewSender(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSender(); } }} placeholder="alerts@bank.com or bank.com" className="h-9 text-sm" aria-label="Add a sender" />
                  <Button variant="outline" className="h-9" onClick={addSender} disabled={!newSender.trim()}>Add</Button>
                </div>
              </Collapsible>
              {s.muted.length ? (
                <Collapsible label="Never read" hint="Senders you said send no money mail" count={s.muted.length}>
                  <div className="text-xs text-muted-foreground">Remove one to read its mail again.</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.muted.map((x) => <Chip key={x} label={x} remove={`Read mail from ${x} again`} onRemove={() => void muteSender({ from: x, muted: false }).catch(() => toast.error("Could not change it"))} />)}
                  </div>
                </Collapsible>
              ) : null}
            </Section>

            <Section>
              <Collapsible label="Recent checks" count={s.log.length}
                hint={s.log[0] ? `${s.log[0].error ? "Failed" : `Scanned ${s.log[0].scanned}, found ${s.log[0].found}`} · ${ago(s.log[0].at)}` : "No checks yet"}>
                {s.log.length === 0 ? <div className="text-sm text-muted-foreground">No checks yet.</div> : null}
                <div className="-mx-4 divide-y border-y">
                  {s.log.map((l) => (
                    <div key={l.at} className="flex items-start gap-3 px-4 py-2 text-sm">
                      <span className="w-24 shrink-0 pt-0.5 text-xs text-muted-foreground">{new Date(l.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="min-w-0 flex-1">
                        {l.error ? <span className="text-destructive">{l.error}</span> : <>Scanned {l.scanned}, found {l.found}</>}
                        {l.note ? <span className="block text-xs text-muted-foreground">{l.note}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Mail no rule can read is read by AI: {s.aiCalls} of {s.aiCap} AI reads used this month.</div>
              </Collapsible>
            </Section>

            <p className="px-4 pt-6 text-xs text-muted-foreground">UnMoney keeps only what it read from each mail (amount, date, merchant, card digits) and the mail's id, so a saved entry can link back to it in Gmail. The mail itself is never stored.</p>

            <Section>
              <Row label={<span className="text-destructive">{busy === "disconnect" ? "Disconnecting…" : "Disconnect Gmail"}</span>} hint="Saved entries stay; drafts still waiting are removed"
                icon={<Unplug />} iconClassName="text-destructive" onClick={busy === null ? () => void onDisconnect() : undefined} />
            </Section>
          </>
        ) : null}
      </Page>
    </>
  );
}

function LookbackPicker({ value, onChange }: { value: Lookback; onChange: (d: Lookback) => void }) {
  return (
    <div role="radiogroup" aria-label="Look back" className="grid grid-cols-4 gap-2">
      {LOOKBACKS.map((d) => (
        <button key={d} type="button" role="radio" aria-checked={value === d} onClick={() => onChange(d)}
          className={cn("h-9 rounded-md border text-sm transition-colors", value === d ? "border-primary text-foreground font-medium bg-accent/40" : "text-muted-foreground hover:bg-accent/40")}>
          {d === 0 ? "From now" : `${d} days`}
        </button>
      ))}
    </div>
  );
}

/** A row that opens to show more below it, for the long parts of this page. */
function Collapsible({ label, hint, count, children }: { label: string; hint?: ReactNode; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-b last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 active:bg-accent">
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{label}</span>
          {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
        </span>
        {count !== undefined ? <span className="text-sm tabular text-muted-foreground">{count}</span> : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div id={id} className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function Chip({ label, remove, onRemove }: { label: string; remove: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button type="button" aria-label={remove} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" onClick={onRemove}><X className="size-3" /></button>
    </span>
  );
}
