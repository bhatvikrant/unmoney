/**
 * Import from Money Manager (or any CSV/TSV/Excel sheet). A file gets here three ways: picked
 * with the file picker, shared from another Android app (src/sw.ts), or sent by the iPhone
 * "Send to UnMoney" shortcut to the Convex inbox (convex/imports.ts). Every source ends in the
 * same review: a dry run of the import against the local data, then the real import in chunks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Check, Copy, Download, FileSpreadsheet, Loader2, Share2, Smartphone, WandSparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { applyOp, detectImportFormat, type ImportFormat, type ImportRow, type NewImportAccount, type OpResult } from "../../../shared/ops";
import { STATEMENT_MAX_LINES, applySuggestion, lineKey, lineOf, linesToAsk, type StatementSuggestion } from "../../../shared/statementAi";
import { accountNamesIn, guessKind } from "@/lib/csv";
import { ACCOUNT_KINDS } from "../../../shared/defaults";
import { CURRENCIES } from "../../../shared/currencies";
import { useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useBulkOps } from "@/lib/bulk";
import { LOCALE_FORMAT } from "@/lib/format";
import { IMPORT_ACCEPT, readImportFile, type ParsedImport } from "@/lib/importFile";
import { SHARE_CACHE, SHARE_KEY } from "@/lib/share";
import { isIOS, promptInstall, useInstallState } from "@/lib/pwa";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { AiHow, Row, Section } from "@/components/shell/misc";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { ColumnMapping } from "./ColumnMapping";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CHUNK = 400;
/** Rows the review lists at first, and more with each "Show more". */
const PAGE = 50;
const SHORTCUT_FILE = "/send-to-unmoney.shortcut";

type Origin = { kind: "pick" } | { kind: "share" } | { kind: "pending"; id: Id<"pendingImports"> };
/** mapped: a bank statement whose columns are matched, so the review shows (Back to columns clears it). */
type Loaded = ParsedImport & { name: string; origin: Origin; mapped?: boolean; /** Day or month first, where the column step knows (a layout worked out by AI) and the file's own dates cannot tell. */ dateOrder?: ImportFormat["dateOrder"] };
type DryRun = OpResult<"transactions.importRows">;
/** A category a row can be filed under, by name as an import row carries it. */
type CategoryChoice = Pick<ImportRow, "category" | "subcategory">;
const categoryLabel = (c: CategoryChoice) => `${c.category}${c.subcategory ? ` › ${c.subcategory}` : ""}`;
const sameCategory = (a: CategoryChoice, b: CategoryChoice) => categoryLabel(a).toLowerCase() === categoryLabel(b).toLowerCase();

const isAndroid = () => /Android/i.test(navigator.userAgent);
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function ImportPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const pending = useQuery(api.imports.pending);
  const discard = useMutation(api.imports.discardPending);
  const confirm = useConfirm();
  const swipe = useSwipedRow();
  const discardPending = (p: { _id: Id<"pendingImports">; name: string }) =>
    confirm({ title: `Discard ${p.name}?`, description: "The file is removed and nothing from it is imported.", action: "Discard" })
      .then(async (ok) => { if (ok) await discard({ id: p._id }); }).finally(swipe.close);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const handled = useRef<string | null>(null);
  // What AI suggested for this file's descriptions. Kept here, above the review, so going back to the
  // columns and on again fills the rows from it instead of sending them a second time.
  const aiAnswers = useRef(new Map<string, StatementSuggestion>());

  async function load(file: Blob, name: string, origin: Origin) {
    setReading(true);
    try {
      const parsed = await readImportFile(file, name);
      if (!parsed.rows.length && !parsed.bank) throw new Error("No entries found in that file.");
      aiAnswers.current = new Map();
      setLoaded({ ...parsed, name, origin });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that file");
      closeReview(); // an inbox file can be tried again
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
      if (!p?.url) { toast.error("That file is no longer waiting. It may have been imported already."); closeReview(); return; }
      void (async () => {
        try {
          const res = await fetch(p.url!);
          if (!res.ok) throw new Error();
          await load(await res.blob(), p.name, { kind: "pending", id: p._id });
        } catch {
          toast.error("Could not download that file. Check your connection and try again.");
          closeReview();
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pendingId, pending]);

  async function finish(origin: Origin) {
    if (origin.kind === "share") await caches.open(SHARE_CACHE).then((c) => c.delete(SHARE_KEY)).catch(() => {});
    if (origin.kind === "pending") await discard({ id: origin.id }).catch(() => {});
  }

  /** Back to the list; the same inbox file can be reviewed again. */
  function closeReview() {
    handled.current = null;
    setLoaded(null);
    if (source || pendingId) setSp({}, { replace: true });
  }

  return (
    <>
      <PageHeader back="/settings" title="Import" />
      <Page className="pb-10">
        {loaded?.bank ? (
          // a bank statement: its columns first, then the same review. The step stays mounted behind the
          // review, so Back to columns finds it as the user left it.
          <div hidden={loaded.mapped}>
            <ColumnMapping name={loaded.name} grid={loaded.bank.grid} headerRow={loaded.bank.headerRow}
              onCancel={async () => { if (loaded.origin.kind === "share") await finish(loaded.origin); closeReview(); }}
              onContinue={(rows, noAmount, dateOrder) => setLoaded({ ...loaded, rows, noAmount, mapped: true, dateOrder })} />
          </div>
        ) : null}
        {loaded?.bank && !loaded.mapped ? null : loaded ? (
          <Review
            loaded={loaded}
            answers={aiAnswers.current}
            onBack={loaded.bank ? () => setLoaded({ ...loaded, mapped: false }) : undefined}
            onCancel={async () => { if (loaded.origin.kind === "share") await finish(loaded.origin); closeReview(); }}
            onDone={async () => { await finish(loaded.origin); nav("/", { replace: true }); }}
          />
        ) : (
          <>
            {pending?.length ? (
              <Section title="Waiting to import">
                {pending.map((p) => (
                  <SwipeToDelete key={p._id} className="border-b last:border-b-0" label="Discard" {...swipe.row(p._id)} onDelete={() => void discardPending(p)}>
                    <Row
                      label={p.name}
                      hint={`${kb(p.size)} · sent ${new Date(p.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                      right={
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => void discardPending(p)}>Discard</Button>
                          <Button size="sm" disabled={reading} onClick={() => setSp({ pending: p._id })}>Review</Button>
                        </div>
                      }
                    />
                  </SwipeToDelete>
                ))}
              </Section>
            ) : null}
            <RecentImports />
            <MoneyManagerSteps />
            <Section title="Or pick the file">
              <Row
                label="Choose a file"
                hint="Money Manager's Excel export, or a bank statement (CSV or Excel): you match its columns next"
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

/** The last imports, each with Undo: removes the entries it added (payment methods and categories it made stay). */
function RecentImports() {
  const view = useView();
  const { settings } = useApp();
  const bulk = useBulkOps();
  const confirm = useConfirm();
  const list = settings.recentImports ?? [];
  // what is left of each import now (entries deleted since don't count)
  const left = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of view.transactions) if (t.importId) m.set(t.importId, (m.get(t.importId) ?? 0) + 1);
    return m;
  }, [view.transactions]);
  if (!list.length) return null;
  async function undo(id: string, name: string, n: number) {
    const ok = await confirm({
      title: `Undo the import of ${name}?`,
      description: `Its ${n.toLocaleString()} ${n === 1 ? "entry is" : "entries are"} deleted, including any you edited since. Payment methods and categories it created stay. A safety copy is kept on this device for a week (Backup & data).`,
      action: "Undo import",
    });
    if (ok) await bulk.undoImport(id).catch(() => {});
  }
  return (
    <Section title="Recent imports">
      {list.map((x) => {
        const n = left.get(x.id) ?? 0;
        const when = new Date(x.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        return (
          <Row key={x.id} label={x.name}
            hint={x.undoneAt ? `${when} · undone` : `${when} · ${n.toLocaleString()} of ${x.count.toLocaleString()} ${x.count === 1 ? "entry" : "entries"} still here`}
            right={!x.undoneAt && n ? <Button size="sm" variant="outline" onClick={() => void undo(x.id, x.name, n)}>Undo</Button> : null} />
        );
      })}
    </Section>
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
  const confirm = useConfirm();
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
              <Button size="sm" variant="ghost" onClick={async () => { if (!(await confirm({ title: "Turn off the import link?", description: "The shortcut stops working until you copy a new link into it.", action: "Turn off" }))) return; await revoke({}); setLink(null); setCopied(false); }}>Turn off link</Button>
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

function Review({ loaded, answers, onBack, onCancel, onDone }: { loaded: Loaded; answers: Map<string, StatementSuggestion>; onBack?: () => void; onCancel: () => void | Promise<void>; onDone: () => void | Promise<void> }) {
  const view = useView();
  const { userId, user, status, dispatchTracked, whenSynced } = useStore();
  // the rows as they will be imported: a statement's notes and categories can be changed below, by hand or by AI
  const [rows, setRows] = useState(loaded.rows);
  const { settings } = useApp();
  const bulk = useBulkOps();
  // while the server takes the parts: entries confirmed so far, of those sent
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [createAccounts, setCreateAccounts] = useState(true);
  // rows that match an entry by day, payment method and amount but not by note: left out unless the user says otherwise
  const [skipLikely, setSkipLikely] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // While importing, the review reads the data as it was when Import was pressed: every chunk changes
  // the local copy, and re-running the whole file's dry run against the whole ledger once per chunk
  // stalled the screen and counted the file down to "0 ready".
  const frozen = useRef(view);
  if (!busy) frozen.current = view;
  const base = frozen.current;
  // How the file writes dates and numbers, read from all its rows; the user can correct it below.
  const [format, setFormat] = useState<ImportFormat>(() => detectImportFormat(loaded.rows, { ...LOCALE_FORMAT, dateOrder: loaded.dateOrder ?? LOCALE_FORMAT.dateOrder }));
  const hasSlashDates = useMemo(() => loaded.rows.some((r) => /^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test((r.date ?? "").trim())), [loaded.rows]);
  // Accounts the file names that do not exist yet, each with a type the user can correct, so cards keep a billing cycle.
  const newNames = useMemo(() => {
    const have = new Set(base.accounts.filter((a) => !a.deletedAt).map((a) => a.name.trim().toLowerCase()));
    return accountNamesIn(loaded.rows).filter((n) => !have.has(n.toLowerCase()));
  }, [loaded.rows, base.accounts]);
  const [kinds, setKinds] = useState<Record<string, NewImportAccount["kind"]>>({});
  const newAccounts = useMemo<NewImportAccount[] | undefined>(
    () => (createAccounts ? newNames.map((name) => ({ name, kind: kinds[name] ?? guessKind(name) })) : undefined),
    [createAccounts, newNames, kinds],
  );
  const hasCommas = useMemo(() => loaded.rows.some((r) => (r.amount ?? "").includes(",")), [loaded.rows]);

  // Dry run against the local data: what would be imported, created and skipped.
  const dry = useMemo<DryRun | { error: string }>(() => {
    try {
      const op = { id: "dryrun", kind: "transactions.importRows" as const, args: { rows, format, newAccounts, createMissing, createAccounts, skipInvalid: true, skipDuplicates: true }, at: 0 };
      return applyOp(base, op, { userId: (userId ?? "") as Id<"users"> }).result as DryRun;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "This file cannot be imported" };
    }
  }, [rows, base, userId, format, newAccounts, createMissing, createAccounts]);

  // Why a row will not be imported, by its number; a row that is not here is new.
  const left = useMemo(() => {
    const m = new Map<number, { label: string; why?: string }>();
    if ("error" in dry) return m;
    for (const n of dry.duplicates) m.set(n, { label: "In UnMoney" });
    for (const n of dry.likelyDuplicates) m.set(n, { label: "Looks like one you have" });
    for (const e of dry.errors) m.set(e.row, { label: "Skipped", why: e.reason });
    return m;
  }, [dry]);
  const [onlyNew, setOnlyNew] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const listed = useMemo(() => rows.map((_, i) => i).filter((i) => !onlyNew || !left.has(i + 1)), [rows, onlyNew, left]);
  const categoryChoices = useMemo(() => {
    const live = view.categories.filter((c) => !c.deletedAt && !c.archivedAt).sort((a, b) => a.order - b.order);
    const choices = { expense: [] as CategoryChoice[], income: [] as CategoryChoice[] };
    for (const c of live) {
      const parent = c.parentId ? live.find((p) => p._id === c.parentId) : undefined;
      if (!c.parentId) choices[c.type].push({ category: c.name });
      else if (parent) choices[c.type].push({ category: parent.name, subcategory: c.name });
    }
    return choices;
  }, [view.categories]);
  const change = (i: number, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function changeCategory(i: number, c: CategoryChoice) {
    setRows((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      // the old subcategory goes with the old category
      const { subcategory: _old, ...rest } = r;
      void _old;
      return { ...rest, ...c };
    }));
  }

  // ---- notes and categories suggested by Claude (shared/statementAi.ts), only when asked ----
  const suggestImport = useAction(api.ai.suggestImport);
  const [ai, setAi] = useState<{ kind: "idle" | "running" | "done" | "error"; text?: string }>({ kind: "idle" });
  // A statement's rows can be changed in the list below (a Money Manager file already has the person's
  // own notes and categories), but not while they are being imported or filled in.
  const editable = !!loaded.bank && !busy && ai.kind !== "running";
  // what each row asks about, from the file as it was read: an edited note does not change the question
  const lines = useMemo(() => loaded.rows.map(lineOf), [loaded.rows]);
  // rows already filled from an answer: asking again (after "Leave these out too" is unticked, say) leaves them and any edits alone
  const [filled, setFilled] = useState<ReadonlySet<number>>(new Set());
  // only rows that will be imported: what is already in UnMoney stays as it is, and is not sent
  const want = "error" in dry ? [] : rows.map((_, i) => i).filter((i) => lines[i] && !filled.has(i) && (!left.has(i + 1) || (!skipLikely && dry.likelyDuplicates.includes(i + 1))));
  async function suggest() {
    const ask = linesToAsk(want.map((i) => lines[i]), answers, STATEMENT_MAX_LINES - answers.size);
    setAi({ kind: "running" });
    let missed: "cap" | "failed" | undefined;
    try {
      if (ask.size) {
        const res = await suggestImport({ lines: [...ask.values()] });
        [...ask.keys()].forEach((key, j) => { const s = res.suggestions[j]; if (s) answers.set(key, s); });
        missed = res.missed;
      }
    } catch (e) {
      setAi({ kind: "error", text: e instanceof ConvexError ? String(e.data) : "Couldn't get AI suggestions. You can still import the file as it is." });
      return;
    }
    const got = want.filter((i) => answers.has(lineKey(lines[i]!)));
    setFilled(new Set([...filled, ...got]));
    const fill = new Set(got);
    setRows((rs) => rs.map((r, i) => (fill.has(i) ? applySuggestion(r, answers.get(lineKey(lines[i]!))!) : r)));
    const changed = got.filter((i) => { const s = answers.get(lineKey(lines[i]!))!; return s.note || s.category; }).length;
    const rest = want.length - got.length;
    setAi({
      kind: "done",
      text: `${changed} of ${want.length} ${want.length === 1 ? "row" : "rows"} filled in. Check them below.`
        + (!rest ? "" : missed === "cap" ? ` AI has reached its limit for the month, so ${rest} got nothing.` : missed === "failed" ? ` ${rest} got nothing: tap again to retry them.` : ` AI suggests for the first ${STATEMENT_MAX_LINES} different descriptions of a file, so ${rest} got nothing.`),
    });
  }

  const fileCurrency = loaded.currency && loaded.currency !== settings.mainCurrency && CURRENCIES.some((c) => c.code === loaded.currency) ? loaded.currency : null;
  const noEntriesYet = base.transactions.length === 0;

  async function run() {
    if ("error" in dry) return;
    setBusy(true);
    let inserted = 0;
    // Duplicates were found over the whole file in the dry run; checking per chunk would also
    // catch identical entries the file itself has in two different chunks.
    const dup = new Set([...dry.duplicates, ...(skipLikely ? dry.likelyDuplicates : [])]);
    const todo = rows.filter((_, i) => !dup.has(i + 1));
    const parts: { id: string; inserted: number }[] = [];
    // every chunk carries the same batch, so the whole file can be undone at once
    const batch = { id: `imp_${crypto.randomUUID?.() ?? Date.now().toString(36)}`, name: loaded.name };
    try {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const { id, result } = await dispatchTracked("transactions.importRows", { rows: todo.slice(i, i + CHUNK), format, newAccounts, createMissing, createAccounts, skipInvalid: true, rowOffset: i, batch });
        parts.push({ id, inserted: result.inserted });
        inserted += result.inserted;
        setProgress(Math.min(1, (i + CHUNK) / todo.length));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
      return;
    }
    // Only a confirmed import counts: until then the file stays in the inbox, so it can be tried again.
    // One wait per part, so the count moves as the server takes each.
    setSaving({ done: 0, total: inserted });
    const rejected: { id: string; error: string }[] = [];
    for (const part of parts) {
      const r = await whenSynced([part.id]);
      rejected.push(...r.rejected);
      if (!r.rejected.length) setSaving((x) => x && { ...x, done: x.done + part.inserted });
    }
    setSaving(null);
    if (rejected.length) {
      toast.error(`${rejected.length} of ${parts.length} parts of the import could not be saved: ${rejected[0].error}. Import the file again to add the rest; entries already in are skipped.`);
      setBusy(false);
      return;
    }
    toast.success(`Imported ${inserted} ${inserted === 1 ? "entry" : "entries"}`, {
      duration: 10000,
      action: { label: "Undo", onClick: () => void bulk.undoImport(batch.id).catch(() => {}) },
    });
    await onDone();
  }

  const skipped = "error" in dry ? 0 : dry.errors.length;
  const likely = "error" in dry ? 0 : dry.likelyDuplicates.length;
  // the dry run still counts likely duplicates as going in; the checkbox decides
  const ready = "error" in dry ? 0 : dry.inserted - (skipLikely ? likely : 0);
  return (
    <>
      <Section title="Review">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <FileSpreadsheet className="size-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{loaded.name}</div>
            <div className="text-xs text-muted-foreground">
              {loaded.rows.length} rows{loaded.skippedTransferIn ? ` · ${loaded.skippedTransferIn} Transfer-In ${loaded.skippedTransferIn === 1 ? "row" : "rows"} left out (each transfer is already in its Transfer-Out row)` : ""}
              {loaded.noAmount ? ` · ${loaded.noAmount} ${loaded.noAmount === 1 ? "row" : "rows"} without an amount left out` : ""}
            </div>
          </div>
          {onBack ? <Button size="sm" variant="outline" disabled={busy} onClick={onBack}>Back to columns</Button> : null}
        </div>
        {"error" in dry ? (
          <div className="px-4 py-3 text-sm text-destructive">{dry.error}</div>
        ) : (
          <div className="px-4 py-3 space-y-1 text-sm">
            <div><b className="tabular">{ready}</b> {ready === 1 ? "entry" : "entries"} ready to import.</div>
            {dry.duplicates.length ? <div className="text-muted-foreground">{dry.duplicates.length} {dry.duplicates.length === 1 ? "entry is" : "entries are"} already in UnMoney and will be left out.</div> : null}
            {likely ? (
              <div className="text-muted-foreground">
                {likely} {likely === 1 ? "looks like an entry" : "look like entries"} you already have: the same day, payment method and amount, with a different note.
                <label className="mt-1 flex items-center gap-2"><Checkbox checked={skipLikely} onCheckedChange={(v) => setSkipLikely(!!v)} />{likely === 1 ? "Leave it out too" : "Leave these out too"}</label>
              </div>
            ) : null}
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
        {loaded.bank && user?.ai && (want.length || ai.kind !== "idle") ? (
          <div className="flex items-center gap-3 px-4 py-3 border-t">
            {ai.kind === "running" ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <WandSparkles className="size-4 shrink-0 text-primary" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Suggest categories with AI</div>
              <div className={cn("text-xs", ai.kind === "error" ? "text-destructive" : "text-muted-foreground")}>
                {ai.kind === "running" ? "Reading the descriptions…" : ai.text
                  ?? (status.connected
                    ? <>Sends the bank's description of each new row, with your category names and the notes you use most, to Anthropic's Claude. No amounts or dates. Nothing is imported until you confirm. <AiHow feature="statement" newTab /></>
                    : "AI suggestions need a connection. You can import without them.")}
              </div>
            </div>
            {want.length && ai.kind !== "running" && status.connected && !busy ? <Button size="sm" className="h-8" onClick={() => void suggest()}>{ai.kind === "idle" ? "Suggest" : "Try again"}</Button> : null}
          </div>
        ) : null}
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
        <Section title="New payment methods">
          {newNames.map((name) => (
            <Row key={name} label={name} right={
              <Select value={kinds[name] ?? guessKind(name)} onValueChange={(v) => setKinds((k) => ({ ...k, [name]: v as NewImportAccount["kind"] }))}>
                <SelectTrigger className="h-8 w-40" aria-label={`Type of ${name}`}><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            } />
          ))}
          <p className="px-4 py-2 text-xs text-muted-foreground">They go outside any group. Credit cards bill the first bank account, settle on the 1st and are paid on the 15th; change that in Payment methods after the import.</p>
        </Section>
      ) : null}
      <Section title="Options">
        <label className="flex items-center gap-3 px-4 py-3 border-b text-sm"><Checkbox checked={createMissing} onCheckedChange={(v) => setCreateMissing(!!v)} />Create categories that don't exist yet</label>
        <label className="flex items-center gap-3 px-4 py-3 text-sm"><Checkbox checked={createAccounts} onCheckedChange={(v) => setCreateAccounts(!!v)} />Create payment methods that don't exist yet</label>
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
      <Section title="Rows">
        {left.size ? (
          <label className="flex items-center gap-3 px-4 py-2.5 border-b text-sm">
            <Checkbox checked={onlyNew} onCheckedChange={(v) => { setOnlyNew(!!v); setShown(PAGE); }} />Show only rows that are new to UnMoney ({rows.length - left.size})
          </label>
        ) : null}
        <div className="overflow-x-auto max-h-96">
          <table className="text-xs w-full">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>{["Date", "", "Payment method", "Category", "Note", "Amount", "Type"].map((h, k) => <th key={k} className="text-left px-2 py-1 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {listed.slice(0, shown).map((i) => {
                const r = rows[i];
                const out = left.get(i + 1);
                const choices = categoryChoices[/^in/i.test(r.type.trim()) ? "income" : "expense"];
                const at = choices.findIndex((c) => sameCategory(c, r));
                return (
                  // a row that is not going in is dimmed, so the new ones stand out
                  <tr key={i} className={cn("border-t", out && "text-muted-foreground")}>
                    <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                    <td className="px-2 py-1 whitespace-nowrap" title={out?.why}>
                      {out ? out.label : <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">New</span>}
                    </td>
                    <td className="px-2 py-1">{r.account}</td>
                    <td className="px-2 py-1">
                      {editable ? (
                        <Select value={String(at)} onValueChange={(v) => changeCategory(i, choices[Number(v)])}>
                          <SelectTrigger className="h-7 w-40 text-xs" aria-label={`Category of row ${i + 1}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {at < 0 ? <SelectItem value="-1">{categoryLabel(r)} (new)</SelectItem> : null}
                            {choices.map((c, k) => <SelectItem key={k} value={String(k)}>{categoryLabel(c)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : categoryLabel(r)}
                    </td>
                    <td className="px-2 py-1 max-w-48 truncate">
                      {editable ? (
                        // saved when the field is left: every change re-runs the dry run over the whole file
                        <Input key={r.note} defaultValue={r.note ?? ""} className="h-7 w-44 text-xs" aria-label={`Note of row ${i + 1}`}
                          onBlur={(e) => { const note = e.target.value.trim(); if (note !== (r.note ?? "")) change(i, { note }); }} />
                      ) : r.note}
                    </td>
                    <td className="px-2 py-1 tabular">{r.amount}</td>
                    <td className="px-2 py-1">{r.type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {listed.length > shown ? (
          <div className="px-4 py-2 border-t">
            <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show more ({listed.length - shown} left)</Button>
          </div>
        ) : null}
      </Section>
      <div className="flex gap-2 px-4 pt-4 md:px-4">
        <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void onCancel()}>Cancel</Button>
        <Button className="flex-1" disabled={busy || !ready} onClick={() => void run()}>
          {saving ? (status.connected ? `Saving… ${saving.done.toLocaleString()} of ${saving.total.toLocaleString()}` : "Waiting for a connection to save…") : busy ? `Importing… ${Math.round(progress * 100)}%` : !ready ? "Nothing new to import" : skipped ? `Import ${ready}, skip ${skipped}` : `Import ${ready}`}
        </Button>
      </div>
    </>
  );
}
