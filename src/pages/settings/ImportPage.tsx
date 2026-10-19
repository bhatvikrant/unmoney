/**
 * Import from Money Manager (or any CSV/TSV/Excel sheet). A file gets here three ways: picked
 * with the file picker, shared from another Android app (src/sw.ts), or sent by the iPhone
 * "Send to UnMoney" shortcut to the Convex inbox (convex/imports.ts). Every source ends in the
 * same review: a dry run of the import against the local data, then the real import in chunks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Check, Copy, Download, FileSpreadsheet, Share2, Smartphone } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { applyOp, detectImportFormat, type ImportFormat, type NewImportAccount, type OpResult } from "../../../shared/ops";
import { accountNamesIn, ACCOUNT_KINDS, guessGroupKind } from "@/lib/csv";
import { CURRENCIES } from "../../../shared/currencies";
import { useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useBulkOps } from "@/lib/bulk";
import { LOCALE_FORMAT } from "@/lib/format";
import { IMPORT_ACCEPT, readImportFile, type ParsedImport } from "@/lib/importFile";
import { SHARE_CACHE, SHARE_KEY } from "@/lib/share";
import { isIOS, promptInstall, useInstallState } from "@/lib/pwa";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CHUNK = 400;
const SHORTCUT_FILE = "/send-to-unmoney.shortcut";

type Origin = { kind: "pick" } | { kind: "share" } | { kind: "pending"; id: Id<"pendingImports"> };
type Loaded = ParsedImport & { name: string; origin: Origin };
type DryRun = OpResult<"transactions.importRows">;

const isAndroid = () => /Android/i.test(navigator.userAgent);
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function ImportPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const pending = useQuery(api.imports.pending);
  const discard = useMutation(api.imports.discardPending);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const handled = useRef<string | null>(null);

  async function load(file: Blob, name: string, origin: Origin) {
    setReading(true);
    try {
      const parsed = await readImportFile(file, name);
      if (!parsed.rows.length) throw new Error("No entries found in that file.");
      setLoaded({ ...parsed, name, origin });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that file");
    }
    setReading(false);
  }

  // A file shared from another app (Android) or sent by the shortcut (iPhone).
  const source = sp.get("source");
  const pendingId = sp.get("pending");
  useEffect(() => {
    const key = `${source}:${pendingId}`;
    if (handled.current === key) return;
    if (source === "share") {
      handled.current = key;
      if (sp.get("empty")) { toast.error("Nothing came through from the share menu. Try again, or pick the file below."); return; }
      void (async () => {
        const res = await caches.open(SHARE_CACHE).then((c) => c.match(SHARE_KEY)).catch(() => undefined);
        if (!res) return;
        const name = decodeURIComponent(res.headers.get("X-File-Name") ?? "shared file");
        await load(await res.blob(), name, { kind: "share" });
      })();
    } else if (pendingId && pending) {
      handled.current = key;
      const p = pending.find((x) => x._id === pendingId);
      if (!p?.url) { toast.error("That file is no longer waiting. It may have been imported already."); return; }
      void (async () => {
        try {
          const res = await fetch(p.url!);
          if (!res.ok) throw new Error();
          await load(await res.blob(), p.name, { kind: "pending", id: p._id });
        } catch {
          toast.error("Could not download that file. Check your connection and try again.");
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pendingId, pending]);

  async function finish(origin: Origin) {
    if (origin.kind === "share") await caches.open(SHARE_CACHE).then((c) => c.delete(SHARE_KEY)).catch(() => {});
    if (origin.kind === "pending") await discard({ id: origin.id }).catch(() => {});
  }

  function closeReview() {
    setLoaded(null);
    if (source || pendingId) setSp({}, { replace: true });
  }

  return (
    <>
      <PageHeader back="/settings" title="Import" />
      <Page className="pb-10">
        {loaded ? (
          <Review
            loaded={loaded}
            onCancel={async () => { if (loaded.origin.kind === "share") await finish(loaded.origin); closeReview(); }}
            onDone={async () => { await finish(loaded.origin); nav("/", { replace: true }); }}
          />
        ) : (
          <>
            {pending?.length ? (
              <Section title="Waiting to import">
                {pending.map((p) => (
                  <Row
                    key={p._id}
                    label={p.name}
                    hint={`${kb(p.size)} · sent ${new Date(p.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                    right={
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => void discard({ id: p._id })}>Discard</Button>
                        <Button size="sm" disabled={reading} onClick={() => setSp({ pending: p._id })}>Review</Button>
                      </div>
                    }
                  />
                ))}
              </Section>
            ) : null}
            <MoneyManagerSteps />
            <Section title="Or pick the file">
              <Row
                label="Choose a file"
                hint="Money Manager's Excel export, or a CSV / TSV with Date, Account, Category, Amount and Income/Expense columns"
                right={<Button size="sm" variant="outline" disabled={reading} onClick={() => pickRef.current?.click()}>{reading ? "Reading…" : "Choose"}</Button>}
              />
              <input
                ref={pickRef}
                type="file"
                accept={IMPORT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void load(f, f.name, { kind: "pick" });
                  e.target.value = "";
                }}
              />
            </Section>
          </>
        )}
      </Page>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-3 border-b last:border-b-0 text-sm">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </li>
  );
}

function MoneyManagerSteps() {
  const install = useInstallState();
  if (isIOS()) return <IosSteps />;
  if (isAndroid()) {
    return (
      <Section title="From Money Manager">
        <ol>
          <Step n={1}>In Money Manager, open <b>Settings › Backup</b> and tap <b>Export to Excel</b>.</Step>
          <Step n={2}>
            <div>Share the file it makes and pick <b>UnMoney</b>. It opens here, ready to import.</div>
            {install !== "installed" ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1">UnMoney shows up in the share menu once it is installed.</span>
                {install === "prompt" ? <Button size="sm" onClick={() => void promptInstall()}>Install</Button> : null}
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground">If Money Manager saves the file without sharing it, share it from your Files app, or pick it below.</div>
          </Step>
        </ol>
      </Section>
    );
  }
  return (
    <Section title="From Money Manager">
      <ol>
        <Step n={1}>On your phone, open Money Manager's <b>Settings › Backup</b> and tap <b>Export to Excel</b>.</Step>
        <Step n={2}>Send the file to this computer (email, AirDrop, a cloud drive), then pick it below.</Step>
        <Step n={3}>
          <div className="text-muted-foreground">Or open UnMoney on that phone instead: on Android it appears in the share menu, and on iPhone a shortcut sends the file here.</div>
        </Step>
      </ol>
    </Section>
  );
}

/**
 * Whether the signed shortcut file is published. Signing needs a Mac signed into iCloud
 * (scripts/build-shortcut.py), so until it is there the steps show how to make it by hand.
 * A missing file comes back as the app's index.html, hence the content type check.
 */
function useShortcutFile(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    let off = false;
    fetch(SHORTCUT_FILE, { method: "HEAD", cache: "no-store" })
      .then((r) => { if (!off) setHas(r.ok && !(r.headers.get("content-type") ?? "").includes("text/html")); })
      .catch(() => { if (!off) setHas(false); });
    return () => { off = true; };
  }, []);
  return has;
}

/** iPhone: iOS has no share menu entry for web apps, so a Shortcut carries the file over. */
function IosSteps() {
  const hasFile = useShortcutFile();
  const status = useQuery(api.imports.linkStatus);
  const createLink = useAction(api.imports.createLink);
  const revoke = useMutation(api.imports.revokeLink);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function copyNewLink() {
    setBusy(true);
    const made = createLink({}).then((r) => r.url);
    try {
      // Safari only lets a page write the clipboard during the tap, so hand it the pending text.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": made.then((u) => new Blob([u], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await made);
      }
      setCopied(true);
      toast.success("Import link copied");
    } catch {
      // clipboard refused: the link is shown below to copy by hand
    }
    try {
      setLink(await made);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not make a link. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <Section title="From Money Manager on iPhone">
      <ol>
        <Step n={1}>
          <div><b>Once:</b> copy your import link. The shortcut uses it to send files to your account.</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void copyNewLink()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{status ? "Copy a new link" : "Copy import link"}
            </Button>
            {status ? (
              <Button size="sm" variant="ghost" onClick={async () => { await revoke({}); setLink(null); setCopied(false); toast.success("Import link turned off"); }}>Turn off link</Button>
            ) : null}
          </div>
          {link ? <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-8 text-xs" aria-label="Import link" /> : null}
          {status && !link ? (
            <div className="text-xs text-muted-foreground">
              A link is set up (made {new Date(status.createdAt).toLocaleDateString()}). A new link turns the old one off, so set up the shortcut again with it.
            </div>
          ) : null}
        </Step>
        <Step n={2}>
          <div><b>Once:</b> add the <b>Send to UnMoney</b> shortcut.</div>
          {hasFile ? (
            <>
              <Button size="sm" variant="outline" asChild>
                <a href={SHORTCUT_FILE} download="Send to UnMoney.shortcut"><Download className="size-4" />Get the shortcut</a>
              </Button>
              <div className="text-xs text-muted-foreground">Paste the link when Shortcuts asks for it. If the file downloads instead of opening Shortcuts, open it from the Downloads folder in the Files app.</div>
            </>
          ) : null}
          <details open={hasFile === false} className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{hasFile ? "Or make it yourself" : "Make it in the Shortcuts app (about a minute)"}</summary>
            <ol className="mt-2 ml-4 list-decimal space-y-1">
              <li>In Shortcuts, tap <b>+</b> and name the new shortcut <b>Send to UnMoney</b>.</li>
              <li>Open its details (the <b>ⓘ</b> or the name menu) and turn on <b>Show in Share Sheet</b>. Set it to receive <b>Files</b>.</li>
              <li>Add <b>Get Contents of URL</b> and paste your import link as the URL. Under <b>Show More</b>, set Method to <b>POST</b>, Request Body to <b>File</b>, and the file to <b>Shortcut Input</b>.</li>
              <li>Add <b>Show Result</b> and give it <b>Contents of URL</b>, so you see whether the file arrived.</li>
            </ol>
          </details>
        </Step>
        <Step n={3}>
          In Money Manager, open <b>Settings › Backup</b>, tap <b>Export to Excel</b>, then choose <span className="inline-flex items-center gap-1"><Share2 className="size-3.5" /><b>Send to UnMoney</b></span> in the share menu.
        </Step>
        <Step n={4}>
          <span className="inline-flex items-center gap-1"><Smartphone className="size-3.5" />Come back to UnMoney.</span> The file shows up at the top of this page, ready to import.
        </Step>
      </ol>
    </Section>
  );
}

function Review({ loaded, onCancel, onDone }: { loaded: Loaded; onCancel: () => void | Promise<void>; onDone: () => void | Promise<void> }) {
  const view = useView();
  const { userId, status, dispatchTracked, whenSynced } = useStore();
  const { settings } = useApp();
  const bulk = useBulkOps();
  const [saving, setSaving] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [createAccounts, setCreateAccounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // How the file writes dates and numbers, read from all its rows; the user can correct it below.
  const [format, setFormat] = useState<ImportFormat>(() => detectImportFormat(loaded.rows, LOCALE_FORMAT));
  const hasSlashDates = useMemo(() => loaded.rows.some((r) => /^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test((r.date ?? "").trim())), [loaded.rows]);
  // Accounts the file names that do not exist yet, each with a type the user can correct, so cards keep a billing cycle.
  const newNames = useMemo(() => {
    const have = new Set(view.accounts.filter((a) => !a.deletedAt).map((a) => a.name.trim().toLowerCase()));
    return accountNamesIn(loaded.rows).filter((n) => !have.has(n.toLowerCase()));
  }, [loaded.rows, view.accounts]);
  const [kinds, setKinds] = useState<Record<string, NewImportAccount["groupKind"]>>({});
  const newAccounts = useMemo<NewImportAccount[] | undefined>(
    () => (createAccounts ? newNames.map((name) => ({ name, groupKind: kinds[name] ?? guessGroupKind(name) })) : undefined),
    [createAccounts, newNames, kinds],
  );
  const hasCommas = useMemo(() => loaded.rows.some((r) => (r.amount ?? "").includes(",")), [loaded.rows]);

  // Dry run against the local data: what would be imported, created and skipped.
  const dry = useMemo<DryRun | { error: string }>(() => {
    try {
      const op = { id: "dryrun", kind: "transactions.importRows" as const, args: { rows: loaded.rows, format, newAccounts, createMissing, createAccounts, skipInvalid: true, skipDuplicates: true }, at: 0 };
      return applyOp(view, op, { userId: (userId ?? "") as Id<"users"> }).result as DryRun;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "This file cannot be imported" };
    }
  }, [loaded.rows, view, userId, format, newAccounts, createMissing, createAccounts]);

  const fileCurrency = loaded.currency && loaded.currency !== settings.mainCurrency && CURRENCIES.some((c) => c.code === loaded.currency) ? loaded.currency : null;
  const noEntriesYet = view.transactions.length === 0;

  async function run() {
    if ("error" in dry) return;
    setBusy(true);
    let inserted = 0;
    // Duplicates were found over the whole file in the dry run; checking per chunk would also
    // catch identical entries the file itself has in two different chunks.
    const dup = new Set(dry.duplicates);
    const rows = loaded.rows.filter((_, i) => !dup.has(i + 1));
    const opIds: string[] = [];
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { id, result } = await dispatchTracked("transactions.importRows", { rows: rows.slice(i, i + CHUNK), format, newAccounts, createMissing, createAccounts, skipInvalid: true, rowOffset: i });
        opIds.push(id);
        inserted += result.inserted;
        setProgress(Math.min(1, (i + CHUNK) / rows.length));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
      return;
    }
    // Only a confirmed import counts: until then the file stays in the inbox, so it can be tried again.
    setSaving(true);
    const { rejected } = await whenSynced(opIds);
    setSaving(false);
    if (rejected.length) {
      toast.error(`${rejected.length} of ${opIds.length} parts of the import could not be saved: ${rejected[0].error}. Import the file again to add the rest; entries already in are skipped.`);
      setBusy(false);
      return;
    }
    toast.success(`Imported ${inserted} ${inserted === 1 ? "entry" : "entries"}`);
    await onDone();
  }

  const skipped = "error" in dry ? 0 : dry.errors.length;
  const ready = "error" in dry ? 0 : dry.inserted;
  return (
    <>
      <Section title="Review">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <FileSpreadsheet className="size-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{loaded.name}</div>
            <div className="text-xs text-muted-foreground">
              {loaded.rows.length} rows{loaded.skippedTransferIn ? ` · ${loaded.skippedTransferIn} Transfer-In ${loaded.skippedTransferIn === 1 ? "row" : "rows"} left out (each transfer is already in its Transfer-Out row)` : ""}
            </div>
          </div>
        </div>
        {"error" in dry ? (
          <div className="px-4 py-3 text-sm text-destructive">{dry.error}</div>
        ) : (
          <div className="px-4 py-3 space-y-1 text-sm">
            <div><b className="tabular">{ready}</b> {ready === 1 ? "entry" : "entries"} ready to import.</div>
            {dry.duplicates.length ? <div className="text-muted-foreground">{dry.duplicates.length} {dry.duplicates.length === 1 ? "entry is" : "entries are"} already in UnMoney and will be left out.</div> : null}
            {skipped ? (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer text-destructive">{skipped} {skipped === 1 ? "row" : "rows"} will be skipped</summary>
                <div className="mt-1 max-h-40 overflow-y-auto text-xs space-y-0.5">
                  {dry.errors.slice(0, 100).map((e) => <div key={e.row}>Row {e.row}: {e.reason}</div>)}
                </div>
              </details>
            ) : null}
          </div>
        )}
        {fileCurrency ? (
          <div className="flex items-center gap-3 px-4 py-3 border-t text-sm">
            <div className="min-w-0 flex-1">
              The amounts in this file are in <b>{fileCurrency}</b>, but your main currency is <b>{settings.mainCurrency}</b>.
              {noEntriesYet ? null : <span className="text-muted-foreground"> Change it in Settings › Main currency first if they should be {fileCurrency}.</span>}
            </div>
            {noEntriesYet ? <Button size="sm" variant="outline" onClick={() => void bulk.changeMainCurrency(fileCurrency, true).catch(() => {})}>Use {fileCurrency}</Button> : null}
          </div>
        ) : null}
      </Section>
      {createAccounts && newNames.length ? (
        <Section title="New accounts">
          {newNames.map((name) => (
            <Row key={name} label={name} right={
              <Select value={kinds[name] ?? guessGroupKind(name)} onValueChange={(v) => setKinds((k) => ({ ...k, [name]: v as NewImportAccount["groupKind"] }))}>
                <SelectTrigger className="h-8 w-40" aria-label={`Type of ${name}`}><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            } />
          ))}
          <p className="px-4 py-2 text-xs text-muted-foreground">Credit cards bill the first bank account, settle on the 1st and are paid on the 15th; change that in Accounts after the import.</p>
        </Section>
      ) : null}
      <Section title="Options">
        <label className="flex items-center gap-3 px-4 py-3 border-b text-sm"><Checkbox checked={createMissing} onCheckedChange={(v) => setCreateMissing(!!v)} />Create categories that don't exist yet</label>
        <label className="flex items-center gap-3 px-4 py-3 text-sm"><Checkbox checked={createAccounts} onCheckedChange={(v) => setCreateAccounts(!!v)} />Create accounts that don't exist yet</label>
        {hasSlashDates ? (
          <Row label="Dates are written" right={
            <Select value={format.dateOrder} onValueChange={(v) => setFormat((f) => ({ ...f, dateOrder: v as ImportFormat["dateOrder"] }))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="dmy">Day first (31/12)</SelectItem><SelectItem value="mdy">Month first (12/31)</SelectItem></SelectContent>
            </Select>
          } />
        ) : null}
        {hasCommas ? (
          <Row label="Amounts are written" right={
            <Select value={format.decimal} onValueChange={(v) => setFormat((f) => ({ ...f, decimal: v as ImportFormat["decimal"] }))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value=".">1,234.50</SelectItem><SelectItem value=",">1.234,50</SelectItem></SelectContent>
            </Select>
          } />
        ) : null}
      </Section>
      <Section title="First rows">
        <div className="overflow-x-auto max-h-64">
          <table className="text-xs w-full">
            <thead className="bg-muted sticky top-0">
              <tr>{["Date", "Account", "Category", "Note", "Amount", "Type"].map((h) => <th key={h} className="text-left px-2 py-1 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {loaded.rows.slice(0, 50).map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                  <td className="px-2 py-1">{r.account}</td>
                  <td className="px-2 py-1">{r.category}{r.subcategory ? ` › ${r.subcategory}` : ""}</td>
                  <td className="px-2 py-1 max-w-32 truncate">{r.note}</td>
                  <td className="px-2 py-1 tabular">{r.amount}</td>
                  <td className="px-2 py-1">{r.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="flex gap-2 px-4 pt-4 md:px-4">
        <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void onCancel()}>Cancel</Button>
        <Button className="flex-1" disabled={busy || !ready} onClick={() => void run()}>
          {saving ? (status.connected ? "Saving to your account…" : "Waiting for a connection to save…") : busy ? `Importing… ${Math.round(progress * 100)}%` : !ready ? "Nothing new to import" : skipped ? `Import ${ready}, skip ${skipped}` : `Import ${ready}`}
        </Button>
      </div>
    </>
  );
}
