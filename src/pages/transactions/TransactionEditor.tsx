import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftRight, Calculator, ChevronRight, ExternalLink, Globe, Mail, Repeat, Star, Copy, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useOp, useStore, useView } from "@/lib/store";
import { bookmarksList, draftGet, draftMatches, draftsOpen, noteSuggestions, recentCategories, txGet, txTags, type TxDetail } from "../../../shared/views";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { senderAddress } from "../../../shared/gmail/mail";
import { gmailUrl } from "@/lib/gmail";
import { useApp, useRefreshRates } from "@/lib/app";
import { staleLabel, useFxState } from "@/lib/fxRates";
import { amountInput, localNumber, LOCALE_DECIMAL } from "@/lib/format";
import { addDays, todayISO } from "../../../shared/dates";
import { evaluateExpression, formatRate, toMinor } from "../../../shared/money";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { clearLeaveGuard, setLeaveGuard, useCloseEntry, useOpenEntry } from "@/lib/nav";
import { useColumn } from "@/components/shell/SplitLayout";
import { offerUndo, useUndoableDelete } from "@/lib/undo";
import { AccountPicker, CategoryPicker } from "@/components/tx/pickers";
import { AmountKeypad } from "@/components/tx/AmountKeypad";
import { RepeatSheet, repeatLabel, type RepeatChoice } from "@/components/tx/RepeatSheet";
import { PhotoField, TagInput } from "@/components/tx/fields";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DeleteSeriesEntryDialog } from "@/components/tx/DeleteSeriesEntryDialog";
import { SplitDialog } from "@/components/tx/SplitDialog";
import { expenseUrl } from "@/lib/unsplit";
import { cn } from "@/lib/utils";
import { fromTemplate, isEntryLink, linkEntry, parseEntryLink, templateUsable } from "../../../shared/quickAdd";
import type { TxFields } from "../../../shared/ops";
import { useQuickSave } from "@/components/tx/QuickAdd";
import { useToday } from "@/lib/today";
import { useEntryBudgets } from "@/components/tx/entryBudgets";
import { EntryBudgetHint } from "@/components/BudgetBars";

/** Links already acted on (by history entry), so a re-render or React's double effect never saves twice. */
const savedLinks = new Set<string>();

type TxType = "income" | "expense" | "transfer";

/** The account a new entry starts on: the chosen default while it is still visible, else the first visible one. Archived ones never. */
function defaultAccount(accounts: { _id: Id<"accounts">; hidden?: boolean; archivedAt?: number }[], preferred?: Id<"accounts">) {
  const visible = accounts.filter((a) => !a.hidden && !a.archivedAt);
  return (visible.find((a) => a._id === preferred) ?? visible[0])?._id;
}

const PICK_CATEGORY = "Pick a category";

type Form = {
  type: TxType;
  date: string;
  time: string;
  accountId?: Id<"accounts">;
  toAccountId?: Id<"accounts">;
  categoryId?: Id<"categories">;
  subcategoryId?: Id<"categories">;
  amount: string;
  subCurrency: string;
  subAmount: string;
  rate?: number;
  /** The rate came from the feed when the currency was picked (not saved with the entry, not typed in). */
  rateFromFeed?: boolean;
  note: string;
  description: string;
  tags: string[];
  feeOn: boolean;
  fee: string;
  photoIds: Id<"_storage">[];
  repeat: RepeatChoice;
  /** An expense that is money back (a negative amount): it comes off its category instead of counting as income. */
  refund: boolean;
};

/** `panel`: shown beside a list on a wide screen (LedgerRoute, SplitLayout) rather than as its own screen. */
export default function TransactionEditor(props: { panel?: boolean }) {
  const column = useColumn();
  const panel = props.panel ?? column === "detail";
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const view = useView();
  const { resolveId } = useStore();
  const realId = id ? resolveId(id) : undefined;
  const existing = useMemo(() => (realId ? txGet(view, realId) : undefined), [view, realId]);
  // a draft from Gmail: the form starts from what the mail said, and Save turns it into the entry
  const draftId = sp.get("draft");
  const draft = useMemo(() => (draftId ? draftGet(view, draftId) : null), [view, draftId]);
  const bookmarks = useMemo(() => (sp.get("bookmark") ? bookmarksList(view) : undefined), [view, sp]);
  const { settings, accounts, currencies } = useApp();
  // a link from a Shortcut, Back Tap or a bookmark's copied link: /t/new?amount=…&category=…[&save=1]
  const link = useMemo(() => (!id && !draftId && isEntryLink(sp) ? parseEntryLink(sp, view) : null), [id, draftId, sp, view]);
  useSaveFromLink(link, bookmarks, !id && !draftId && sp.get("save") === "1", () => setSp((p) => { const n = new URLSearchParams(p); n.delete("save"); return n; }, { replace: true }));

  const initial = useMemo<Form | null>(() => {
    const base: Form = {
      type: (sp.get("type") as TxType) || "expense",
      date: sp.get("date") || todayISO(),
      time: settings.timeInputEnabled ? new Date().toTimeString().slice(0, 5) : "",
      accountId: defaultAccount(accounts, settings.defaultAccountId),
      amount: "", subCurrency: "", subAmount: "", note: "", description: "", tags: [], feeOn: false, fee: "", photoIds: [], repeat: { kind: "none" }, refund: false,
    };
    if (id) {
      if (!existing) return null;
      const cur = existing.subCurrency ? currencies.find((c) => c.code === existing.subCurrency) : undefined;
      return {
        ...base,
        type: existing.type,
        date: existing.date,
        time: existing.time ?? "",
        accountId: existing.accountId,
        toAccountId: existing.toAccountId,
        categoryId: existing.categoryId,
        subcategoryId: existing.subcategoryId,
        amount: amountInput(Math.abs(existing.amount), settings.decimals),
        refund: existing.type === "expense" && existing.amount < 0,
        subCurrency: existing.subCurrency ?? "",
        subAmount: existing.subAmount !== undefined && cur ? amountInput(Math.abs(existing.subAmount), cur.decimals) : "",
        rate: existing.exchangeRate,
        note: existing.note,
        description: existing.description ?? "",
        tags: existing.tags,
        feeOn: !!existing.feeAmount,
        fee: existing.feeAmount ? amountInput(existing.feeAmount, settings.decimals) : "",
        photoIds: existing.photoIds,
      };
    }
    if (draftId) {
      if (!draft || draft.status !== "open") return null;
      const p = draft.proposal;
      const cur = p.subCurrency ? currencies.find((c) => c.code === p.subCurrency) : undefined;
      const rate = cur && p.subAmount && p.amount ? (p.subAmount / 10 ** cur.decimals) / (p.amount / 10 ** settings.decimals) : undefined;
      return {
        ...base,
        type: p.type,
        date: p.date,
        time: p.time ?? "",
        accountId: p.accountId,
        toAccountId: p.toAccountId,
        categoryId: p.categoryId,
        subcategoryId: p.subcategoryId,
        amount: p.amount ? amountInput(Math.abs(p.amount), settings.decimals) : "",
        refund: p.type === "expense" && p.amount < 0,
        subCurrency: cur ? cur.code : "",
        subAmount: p.subAmount !== undefined && cur ? amountInput(Math.abs(p.subAmount), cur.decimals) : "",
        rate,
        note: p.note,
        description: p.description ?? "",
      };
    }
    const bm = sp.get("bookmark");
    if (bm) {
      if (!bookmarks) return null;
      const b = bookmarks.find((x) => x._id === bm);
      if (b) {
        return {
          ...base,
          type: b.template.type,
          accountId: b.template.accountId,
          toAccountId: b.template.toAccountId,
          categoryId: b.template.categoryId,
          subcategoryId: b.template.subcategoryId,
          amount: b.template.amount ? amountInput(b.template.amount, settings.decimals) : "",
          note: b.template.note,
          description: b.template.description ?? "",
          tags: b.template.tags,
          feeOn: !!b.template.feeAmount,
          fee: b.template.feeAmount ? amountInput(b.template.feeAmount, settings.decimals) : "",
        };
      }
    }
    if (link) {
      return {
        ...base,
        type: link.type ?? "expense",
        date: link.date ?? base.date,
        accountId: link.accountId ?? base.accountId,
        toAccountId: link.toAccountId,
        categoryId: link.categoryId,
        subcategoryId: link.subcategoryId,
        amount: link.amount ? amountInput(link.amount, settings.decimals) : "",
        note: link.note ?? "",
        tags: link.tags ?? [],
      };
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, existing, bookmarks, sp, draftId, draft, link]);

  if (!initial) return <div className="p-8 text-center text-sm text-muted-foreground">{id ? "Entry not found" : draftId ? "This draft was already saved or dismissed." : "Loading…"}</div>;
  return <Editor key={realId ?? (draftId ? `draft:${draftId}` : "new")} initial={initial} id={realId as Id<"transactions"> | undefined} existing={existing ?? undefined} draft={draftId && draft ? draft : undefined} panel={panel} />;
}

/**
 * `save=1` on a new-entry link: save it straight away and go to the ledger (Undo in the toast).
 * A link that can't be saved as it is (a name not found, no amount) opens the form instead, filled
 * in as far as it goes, and says what is missing.
 */
function useSaveFromLink(link: ReturnType<typeof parseEntryLink> | null, bookmarks: Doc<"bookmarks">[] | undefined, wanted: boolean, dropSave: () => void) {
  const { key } = useLocation();
  const [sp] = useSearchParams();
  const view = useView();
  const nav = useNavigate();
  const today = useToday();
  const save = useQuickSave();
  const { settings, accounts } = useApp();
  const bm = sp.get("bookmark");
  const ready = !bm || !!bookmarks;
  useEffect(() => {
    if (!ready || savedLinks.has(key)) return;
    if (!wanted) {
      if (link?.unknown.length) { savedLinks.add(key); toast.error(`Couldn't find ${link.unknown.join(", ")}`); }
      return;
    }
    savedLinks.add(key);
    let fields: TxFields | null = null;
    let missing = "";
    if (bm) {
      const b = bookmarks?.find((x) => x._id === bm);
      if (!b) missing = "That bookmark is gone";
      else if (!b.template.amount) missing = "That bookmark has no amount";
      else if (!templateUsable(view, b.template)) missing = "A payment method or category of that bookmark was deleted";
      else fields = fromTemplate(b.template, sp.get("date") || today);
    } else if (link) {
      const r = linkEntry(link, defaultAccount(accounts, settings.defaultAccountId), today);
      if ("fields" in r) fields = r.fields;
      else missing = r.missing;
    }
    if (fields) {
      void save(fields);
      nav("/", { replace: true });
    } else {
      toast.error(`${missing || "Nothing to save"}. Check the entry and save it.`);
      dropSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, wanted, key]);
}

type Existing = TxDetail;

function Editor({ initial, id, existing, draft, panel }: { initial: Form; id?: Id<"transactions">; existing?: Existing; draft?: Doc<"drafts">; panel: boolean }) {
  const nav = useNavigate();
  const closeEntry = useCloseEntry();
  const openEntry = useOpenEntry();
  const undoable = useUndoableDelete();
  const ask = useConfirm();
  const { settings, accountName, categoryLabel, currencies, fmt, accounts, categories } = useApp();
  const [f, setF] = useState<Form>(initial);
  /** The form as it started, or as "Continue" left it: what counts as no changes. */
  const [baseline, setBaseline] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const [sheet, setSheet] = useState<null | "account" | "to" | "category" | "keypad" | "feeKeypad" | "repeat" | "currency" | "split">(null);
  const [noteFocus, setNoteFocus] = useState(false);
  const [notePicked, setNotePicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "copy" | "scope">(null);
  // What the user picked in this form; a note suggestion fills in the rest (the default method, no category yet).
  const chosen = useRef({ account: !!(id || draft) || initial.accountId !== defaultAccount(accounts, settings.defaultAccountId), category: !!initial.categoryId });

  const view = useView();
  const create = useOp("transactions.create");
  const update = useOp("transactions.update");
  const copy = useOp("transactions.copy");
  const addBookmark = useOp("bookmarks.create");
  const removeBookmark = useOp("bookmarks.remove");
  const setSplit = useOp("transactions.setSplit");
  const acceptDraft = useOp("drafts.accept");
  const dismissDrafts = useOp("drafts.dismiss");
  const reopenDrafts = useOp("drafts.reopen");
  // reviewing drafts one by one: the next one still waiting, to go straight on to after saving this one
  const nextDraft = useMemo(() => {
    if (!draft) return undefined;
    // not the "maybe already added" ones: served up as plain forms they would be saved as duplicates
    const matched = draftMatches(view);
    const all = draftsOpen(view).filter((d) => d._id === draft._id || !matched.has(d._id));
    const open = all.filter((d) => d._id !== draft._id);
    const at = all.findIndex((d) => d._id === draft._id);
    return open[Math.max(0, at)] ?? open[0];
  }, [view, draft]);
  // the saved entry, for the split: only an expense that is saved can be shared, and the link lives on it
  const saved = useMemo(() => (id ? view.transactions.find((t) => t._id === id) : undefined), [view, id]);
  const bookmarked = useMemo(() => (id ? view.bookmarks.find((b) => b.transactionId === id) : undefined), [view, id]);
  const tagList = useMemo(() => txTags(view), [view]);
  const wantSuggestions = settings.autocompleteEnabled && noteFocus && !notePicked && f.type !== "transfer";
  const suggestions = useMemo(() => (wantSuggestions ? noteSuggestions(view, f.note, f.type) : undefined), [view, wantSuggestions, f.note, f.type]);
  const recent = useMemo(() => (!id && f.type !== "transfer" ? recentCategories(view, f.type) : []), [view, id, f.type]);
  // what the budget this expense counts against has left, before and after it
  const budgets = useEntryBudgets(f, id);

  const sub = f.subCurrency ? currencies.find((c) => c.code === f.subCurrency) : undefined;
  const refreshRates = useRefreshRates();
  const fx = useFxState(settings.mainCurrency);
  const rateAge = sub && f.rateFromFeed ? staleLabel(fx) : null;
  // A rate from the feed follows the latest one while it is current (say, back online with the
  // editor open); when it is not, the stored rate is used and its age is shown.
  const rate = (sub && f.rateFromFeed && !rateAge ? fx.rates?.rates[sub.code] : undefined) ?? f.rate;
  // Custom currencies (gold, points) never come from the feed: with only those, say nothing about it.
  const usesFeed = currencies.some((c) => !c.isCustom);
  const ratesAge = usesFeed ? staleLabel(fx, "Rates") : null;
  const mainSide = { code: settings.mainCurrency, symbol: settings.symbol, symbolPosition: settings.symbolPosition };

  /** Use the latest rate for a newly picked currency; an entry keeps the rate it was saved with. */
  function pickCurrency(c: (typeof currencies)[number]) {
    const keep = existing?.subCurrency === c.code && existing.exchangeRate ? existing.exchangeRate : undefined;
    const fromFeed = !keep && !c.isCustom;
    setF((p) => ({ ...p, subCurrency: c.code, rate: keep ?? c.rate, rateFromFeed: fromFeed, subAmount: p.subAmount || p.amount }));
    setSheet(null);
    if (!fromFeed) return;
    void refreshRates();
  }

  const mainMajor = useMemo(() => {
    if (!sub) return evaluateExpression(f.amount, LOCALE_DECIMAL);
    const s = evaluateExpression(f.subAmount, LOCALE_DECIMAL);
    if (s === null) return null;
    return rate ? s / rate : null;
  }, [f.amount, f.subAmount, rate, sub]);

  // An entry or draft opens with the amount it has; it is worked out again only once the second
  // currency, its amount or the rate is changed (a rounded or stale rate must not rewrite it).
  const untouched = useRef(true);
  const openedWith = `${initial.subCurrency}|${initial.subAmount}|${initial.rate}`;
  useEffect(() => {
    if (untouched.current && `${f.subCurrency}|${f.subAmount}|${rate}` === openedWith) return;
    untouched.current = false;
    if (sub && mainMajor !== null) set("amount", localNumber(Math.round(mainMajor * 10 ** settings.decimals) / 10 ** settings.decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMajor, sub]);

  const isEdit = !!id;
  const inSeries = !!existing?.repeatId;

  // Unsaved changes: leaving through the app (Back, Close, Esc, another row) asks first. The rate and,
  // with a second currency, the converted amount follow from what was typed, so they don't count.
  const comparable = (x: Form) => JSON.stringify({ ...x, rate: undefined, rateFromFeed: undefined, amount: x.subCurrency ? "" : x.amount });
  const dirty = comparable(f) !== comparable(baseline);
  useEffect(() => {
    if (!dirty) return;
    const guard = () => ask({ title: "Discard changes?", description: "Your changes to this entry haven't been saved.", action: "Discard" });
    setLeaveGuard(guard);
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", unload);
    return () => { clearLeaveGuard(guard); window.removeEventListener("beforeunload", unload); };
  }, [dirty, ask]);
  /** Leaving on purpose (saved, deleted, copied): nothing to ask about. */
  const done = (go: () => void) => { setLeaveGuard(null); go(); };

  // Accounts can arrive after the form is created on a fresh load: fill the default then.
  useEffect(() => {
    // a draft whose mail named no known method stays empty, so the user picks rather than the default slipping in
    if (!draft && !f.accountId && accounts.length) set("accountId", defaultAccount(accounts, settings.defaultAccountId));
  }, [accounts, f.accountId, settings.defaultAccountId, draft]);

  // New entries start with the cursor in the amount, and go back there after "Continue". The tap
  // that opened this screen primed the iOS keyboard (primeKeyboard); take focus over before paint.
  const amountRef = useRef<HTMLInputElement>(null);
  // a draft already has its amount: no keyboard popping up over a review
  useLayoutEffect(() => {
    if (!isEdit && !draft) amountRef.current?.focus();
  }, [isEdit, draft]);

  // Desktop: Enter saves (Ctrl/⌘+Enter even from the description), Esc goes back. A field that
  // uses Enter itself (tags) prevents it first; an open sheet or dialog keeps its own keys.
  const saveRef = useRef(save);
  useLayoutEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || busy || sheet || confirm) return;
      const t = e.target as HTMLElement;
      // beside the ledger, keys meant for the list or one of its dialogs are not the form's
      if (panel && (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') || !(t === document.body || t.closest('[aria-label="Entry"]')))) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (t.tagName === "INPUT" && !e.shiftKey))) { e.preventDefault(); void saveRef.current("save"); }
      // from a field only while nothing has changed: there Esc may just mean "leave this field"
      else if (e.key === "Escape" && (!dirty || !(t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) closeEntry();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, sheet, confirm, closeEntry, panel, dirty]);

  function buildArgs() {
    const amountMajor = evaluateExpression(f.amount, LOCALE_DECIMAL);
    if (amountMajor === null) throw new Error("Enter an amount");
    const typed = toMinor(amountMajor, settings.decimals);
    if (typed === 0) throw new Error("Enter an amount");
    // a refund is stored below zero, so every total nets it against the category
    const refund = f.type === "expense" && f.refund;
    const amount = refund ? -Math.abs(typed) : typed;
    const subTyped = sub ? toMinor(evaluateExpression(f.subAmount, LOCALE_DECIMAL) ?? 0, sub.decimals) : undefined;
    if (!f.accountId) throw new Error("Pick an account");
    if (f.type !== "transfer" && !f.categoryId) throw new Error(PICK_CATEGORY);
    if (f.type === "transfer" && !f.toAccountId) throw new Error("Pick a payment method to transfer to");
    const fee = f.type === "transfer" && f.feeOn ? toMinor(evaluateExpression(f.fee, LOCALE_DECIMAL) ?? 0, settings.decimals) : undefined;
    return {
      type: f.type,
      date: f.date,
      time: settings.timeInputEnabled && f.time ? f.time : undefined,
      accountId: f.accountId,
      toAccountId: f.type === "transfer" ? f.toAccountId : undefined,
      categoryId: f.type !== "transfer" ? f.categoryId : undefined,
      subcategoryId: f.type !== "transfer" ? f.subcategoryId : undefined,
      amount,
      subAmount: subTyped !== undefined && refund ? -Math.abs(subTyped) : subTyped,
      subCurrency: sub ? sub.code : undefined,
      exchangeRate: sub ? rate : undefined,
      note: f.note,
      description: f.description || undefined,
      tags: f.tags,
      feeAmount: fee || undefined,
      photoIds: f.photoIds,
    };
  }

  async function save(mode: "save" | "continue" | "next", scope?: "one" | "future") {
    // Focus now, while still inside the tap: iOS will not open the keyboard after the await below.
    if (mode === "continue") amountRef.current?.focus();
    setBusy(true);
    try {
      const args = buildArgs();
      if (isEdit) {
        if (inSeries && !scope) { setConfirm("scope"); setBusy(false); return; }
        await update({ id: id!, ...args, scope });
        done(closeEntry);
      } else if (draft) {
        await acceptDraft({ id: draft._id, ...args });
        if (mode === "next" && nextDraft) done(() => openEntry("new", { draft: nextDraft._id }));
        else done(closeEntry);
      } else {
        await create({
          ...args,
          repeat: f.repeat.kind === "repeat" ? { frequency: f.repeat.frequency, endDate: f.repeat.endDate } : undefined,
          installment: f.repeat.kind === "installment" ? { count: f.repeat.count } : undefined,
        });
        if (mode === "continue") {
          const next: Form = { ...f, amount: "", subAmount: "", note: "", description: "", tags: [], photoIds: [], fee: "", feeOn: false, repeat: { kind: "none" }, refund: false };
          setF(next);
          setBaseline(next);
        } else {
          done(closeEntry);
        }
      }
    } catch (e) {
      // the one thing missing is the category: offer the picker rather than an error
      if (e instanceof Error && e.message === PICK_CATEGORY) setSheet("category");
      else toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  /** "Not an entry": the draft goes, the mail is not offered again. */
  async function notAnEntry() {
    if (!draft) return;
    setBusy(true);
    try {
      await dismissDrafts({ ids: [draft._id] });
      offerUndo("Dismissed. This mail won't be offered again.", () => reopenDrafts({ ids: [draft._id] }));
      done(closeEntry);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not dismiss");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBookmark() {
    try {
      if (bookmarked) {
        await removeBookmark({ id: bookmarked._id });
        return;
      }
      const a = buildArgs();
      await addBookmark({ transactionId: id, template: { type: a.type, accountId: a.accountId, toAccountId: a.toAccountId, categoryId: a.categoryId, subcategoryId: a.subcategoryId, amount: a.amount, note: a.note, description: a.description, tags: a.tags, feeAmount: a.feeAmount } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not bookmark");
    }
  }

  const typeColor = { income: "text-income border-income", expense: "text-expense border-expense", transfer: "text-foreground border-foreground" } as const;
  const title = f.type === "income" ? "Income" : f.type === "expense" ? "Expense" : "Transfer";

  return (
    <>
      <PageHeader back={!panel} title={title} right={panel ? <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={() => closeEntry()}><X className="size-4" /></Button> : undefined} />
      <Page className={panel ? "pb-4" : isEdit ? "pb-36" : "pb-24"}>
        {draft ? <GmailBanner from={draft.from} receivedAt={draft.receivedAt} subject={draft.subject} messageId={draft.messageId} /> : existing?.source ? <GmailBanner messageId={existing.source.messageId} /> : null}
        <div className="grid grid-cols-3 gap-2 p-4">
          {(["income", "expense", "transfer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={f.type === t}
              onClick={() => { chosen.current.category = false; setF((p) => ({ ...p, type: t, categoryId: undefined, subcategoryId: undefined })); }}
              className={cn("h-10 rounded-md border text-sm capitalize transition-colors", f.type === t ? typeColor[t] + " font-medium bg-accent/40" : "text-muted-foreground")}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="divide-y border-y bg-card">
          <Field label="Date">
            <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Input type="date" aria-label="Date" value={f.date} onChange={(e) => set("date", e.target.value)} className="h-8 w-auto min-w-0 flex-[3] px-2" />
              {settings.timeInputEnabled ? <Input type="time" aria-label="Time" value={f.time} onChange={(e) => set("time", e.target.value)} className="h-8 w-auto min-w-0 flex-[2] px-2" /> : null}
              {!isEdit && !draft ? (
                <button type="button" onClick={() => setSheet("repeat")} className={cn("flex flex-col items-center shrink-0 text-[10px] text-muted-foreground px-1", f.repeat.kind !== "none" && "text-primary")}>
                  <Repeat className="size-4" />
                  <span className="max-w-24 truncate">{f.repeat.kind === "none" ? "Repeat" : repeatLabel(f.repeat)}</span>
                </button>
              ) : inSeries ? (
                <button type="button" onClick={() => nav("/settings/repeats")} className="text-[10px] text-primary flex items-center gap-1"><Repeat className="size-3" />{existing?.installmentIndex ? `${existing.installmentIndex}/${existing.installmentCount}` : "In a series"}</button>
              ) : null}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {[["Today", todayISO()], ["Yesterday", addDays(todayISO(), -1)]].map(([label, date]) => (
                <QuickPick key={label} active={f.date === date} onClick={() => set("date", date)}>{label}</QuickPick>
              ))}
            </div>
            </div>
          </Field>

          {f.type === "transfer" ? (
            <>
              <Field label="From" onClick={() => setSheet("account")} value={f.accountId ? accountName(f.accountId) : "Select"} />
              <Field label="To" onClick={() => setSheet("to")} value={f.toAccountId ? accountName(f.toAccountId) : "Select"} right={
                <Button variant="ghost" size="icon" className="size-7" aria-label="Swap payment methods" onClick={(e) => { e.stopPropagation(); setF((p) => ({ ...p, accountId: p.toAccountId, toAccountId: p.accountId })); }}><ArrowLeftRight className="size-4" /></Button>
              } />
            </>
          ) : (
            <>
              <Field label="Method" onClick={() => setSheet("account")} value={f.accountId ? accountName(f.accountId) : "Select"} />
              <div>
              <Field label="Category" onClick={() => setSheet("category")} value={f.categoryId ? categoryLabel({ categoryId: f.categoryId, subcategoryId: f.subcategoryId }) : "Select"} />
              {recent.length ? (
                <div className="flex items-center gap-2 px-4 pb-2.5">
                  <div className="w-20 shrink-0 text-xs text-muted-foreground">Recent</div>
                  <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                    {recent.map((c) => (
                      <QuickPick key={`${c.categoryId}|${c.subcategoryId ?? ""}`} active={f.categoryId === c.categoryId && f.subcategoryId === c.subcategoryId}
                        onClick={() => { chosen.current.category = true; setF((p) => ({ ...p, categoryId: c.categoryId, subcategoryId: c.subcategoryId })); }}>
                        {categoryLabel(c)}
                      </QuickPick>
                    ))}
                  </div>
                </div>
              ) : null}
              </div>
            </>
          )}

          <Field label="Amount">
            <div className="flex-1 flex items-center gap-2">
              {sub ? (
                <>
                  <PrefixedInput ref={amountRef} aria-label={`Amount in ${sub.code}`} prefix={sub.code} inputMode="decimal" value={f.subAmount} onChange={(e) => set("subAmount", e.target.value)} placeholder="0" />
                </>
              ) : (
                <>
                  <PrefixedInput ref={amountRef} aria-label="Amount" prefix={settings.symbol} inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" onBlur={() => { const v = evaluateExpression(f.amount, LOCALE_DECIMAL); if (v !== null && /[+\-*/×÷]/.test(f.amount.slice(1))) set("amount", localNumber(v)); }} />
                </>
              )}
              <Button variant="ghost" size="icon" className="size-8" aria-label="Calculator" onClick={() => setSheet("keypad")}><Calculator className="size-4" /></Button>
              {currencies.length ? <Button variant="ghost" size="icon" className={cn("size-8", sub && "text-primary")} aria-label="Currency" onClick={() => { setSheet("currency"); if (usesFeed) void refreshRates(); }}><Globe className="size-4" /></Button> : null}
            </div>
          </Field>
          {sub ? (
            <Field label="Converted">
              <div className="flex-1 flex items-center gap-2 text-sm">
                <PrefixedInput aria-label={`Amount in ${settings.mainCurrency}`} prefix={settings.symbol} inputMode="decimal" value={f.amount} onChange={(e) => { set("amount", e.target.value); const m = evaluateExpression(e.target.value, LOCALE_DECIMAL); const s = evaluateExpression(f.subAmount, LOCALE_DECIMAL); if (m && s) setF((p) => ({ ...p, rate: s / m, rateFromFeed: false })); }} />
                <span className="flex flex-col items-end text-xs text-muted-foreground whitespace-nowrap">
                  <span>{rate ? formatRate(mainSide, sub, rate) : "No rate"}</span>
                  {rateAge ? <span className="text-[11px] text-muted-foreground/80">{rateAge}</span> : null}
                </span>
              </div>
            </Field>
          ) : null}

          {budgets.hints.length ? (
            <Field label="Budget">
              <div className="flex-1 min-w-0 space-y-2">{budgets.hints.map((h) => <EntryBudgetHint key={h.key} name={h.name} when={h.when} item={h.item} amount={h.amount} />)}</div>
            </Field>
          ) : null}
          {f.type === "expense" ? (
            <Field label="Refund">
              <div className="flex-1 flex items-center gap-3">
                <Switch checked={f.refund} onCheckedChange={(v) => set("refund", v)} aria-label="Refund" />
                <span className="text-xs text-muted-foreground">{f.refund ? "Money back: comes off this category's spending, not counted as income" : "Money back from a shop or service"}</span>
              </div>
            </Field>
          ) : null}
          {f.type === "transfer" ? (
            <Field label="Fees">
              <div className="flex-1 flex items-center gap-3">
                <Switch aria-label="Transfer fee" checked={f.feeOn} onCheckedChange={(v) => set("feeOn", v)} />
                {f.feeOn ? <Input aria-label="Fee amount" inputMode="decimal" value={f.fee} onChange={(e) => set("fee", e.target.value)} placeholder="0" className="h-8 tabular" /> : <span className="text-xs text-muted-foreground">Record a transfer fee as an expense</span>}
              </div>
            </Field>
          ) : null}

          <Field label="Note">
            <div className="flex-1 relative">
              <Input aria-label="Note" value={f.note} onChange={(e) => { setNotePicked(false); set("note", e.target.value); }} onFocus={() => { setNotePicked(false); setNoteFocus(true); }} onBlur={() => setTimeout(() => setNoteFocus(false), 150)} placeholder={f.type === "transfer" ? "Optional" : "Store, payee, item…"} className="h-8" />
              {noteFocus && suggestions?.length ? (
                <div className="absolute z-20 left-0 right-0 top-9 rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.note}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setNotePicked(true);
                        // what was used with this note last time, except what the user picked in this form
                        const useCategory = !chosen.current.category && !!s.categoryId && categories.some((c) => c._id === s.categoryId && !c.deletedAt && !c.archivedAt);
                        const useAccount = !chosen.current.account && accounts.some((a) => a._id === s.accountId && !a.archivedAt);
                        setF((p) => ({
                          ...p,
                          note: s.note,
                          categoryId: useCategory ? s.categoryId : p.categoryId,
                          subcategoryId: useCategory ? s.subcategoryId : p.subcategoryId,
                          amount: p.amount || amountInput(s.amount, settings.decimals),
                          accountId: useAccount ? s.accountId : p.accountId,
                        }));
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between gap-2"
                    >
                      <span className="truncate">{s.note}</span>
                      <span className="text-xs text-muted-foreground truncate">{categoryLabel(s)} · {fmt(s.amount)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Field>
        </div>

        <div className="mt-3 border-y bg-card divide-y">
          <div className="px-4 py-2">
            <Textarea aria-label="Description" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Description" className="min-h-16 resize-none" />
          </div>
          <div className="px-4 py-2"><TagInput tags={f.tags} onChange={(t) => set("tags", t)} suggestions={tagList.map((t) => t.tag)} /></div>
          <div className="px-4 py-3"><PhotoField photoIds={f.photoIds} onChange={(ids) => set("photoIds", ids)} /></div>
        </div>

        {saved?.type === "expense" ? (
          <div className="mt-3 border-y bg-card">
            {saved.split ? (
              <div className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <Users className="size-4 text-muted-foreground shrink-0" />
                <a href={expenseUrl(saved.split.expenseId)} target="_blank" rel="noopener" className="flex-1 min-w-0 flex items-center gap-1 hover:underline underline-offset-4">Split on UnSplit <ExternalLink className="size-3 text-muted-foreground" /></a>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void setSplit({ ids: [saved._id], split: null }).then(() => toast("Link to the split removed"))}>Unlink</Button>
              </div>
            ) : (
              <button type="button" onClick={() => setSheet("split")} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-accent/40">
                <Users className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1">Split on UnSplit</span>
                <span className="text-xs text-muted-foreground">Share it with others</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            )}
          </div>
        ) : null}

      </Page>

      <div className={cn("z-30 bg-background border-t", panel ? "sticky bottom-0" : "fixed bottom-[var(--tabbar-h)] md:bottom-0 inset-x-0 md:left-56 md:safe-bottom")}>
        <div className="mx-auto max-w-3xl space-y-2 p-3">
          {isEdit ? (
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="h-10 text-destructive hover:text-destructive" onClick={async () => { if (inSeries) return setConfirm("delete"); if (await ask({ title: "Delete this entry?", description: "You can undo this for a few seconds afterwards." })) void undoable.entry(id!).then(() => done(closeEntry)); }}><Trash2 className="size-4" />Delete</Button>
              <Button variant="outline" className="h-10" onClick={() => setConfirm("copy")}><Copy className="size-4" />Copy</Button>
              <Button variant="outline" className={cn("h-10", bookmarked && "border-amber-400/60 text-amber-500 hover:text-amber-500")} aria-pressed={!!bookmarked} onClick={toggleBookmark}>
                <Star key={bookmarked ? "on" : "off"} className={cn("size-4", bookmarked && "fill-current animate-in zoom-in-50 duration-300")} />
                {bookmarked ? "Bookmarked" : "Bookmark"}
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            {draft && nextDraft ? (
              <>
                <Button className="h-11 flex-1 px-2" disabled={busy} onClick={() => save("next")}>Save &amp; next</Button>
                <Button variant="outline" className="h-11 flex-1 px-2" disabled={busy} onClick={() => save("save")}>Save</Button>
              </>
            ) : <Button className="h-11 flex-1 text-base" disabled={busy} onClick={() => save("save")}>{draft ? "Save entry" : "Save"}</Button>}
            {draft ? <Button variant="outline" className={cn("h-11 flex-1", nextDraft ? "px-2" : "text-base")} disabled={busy} onClick={() => void notAnEntry()}>Not an entry</Button>
              : !isEdit ? <Button variant="outline" className="h-11 flex-1 text-base" disabled={busy} onClick={() => save("continue")}>Continue</Button> : null}
          </div>
        </div>
      </div>

      <AccountPicker open={sheet === "account"} onOpenChange={(o) => !o && setSheet(null)} onPick={(a) => { chosen.current.account = true; set("accountId", a); }} title={f.type === "transfer" ? "From" : "Payment method"} exclude={f.type === "transfer" ? f.toAccountId : undefined} />
      <AccountPicker open={sheet === "to"} onOpenChange={(o) => !o && setSheet(null)} onPick={(a) => set("toAccountId", a)} title="To" exclude={f.accountId} />
      {f.type !== "transfer" ? (
        <CategoryPicker open={sheet === "category"} onOpenChange={(o) => !o && setSheet(null)} type={f.type} budgets={budgets.byCategory} onPick={(c, s) => { chosen.current.category = true; setF((p) => ({ ...p, categoryId: c, subcategoryId: s })); }} />
      ) : null}
      {sheet === "keypad" ? (
        <AmountKeypad open onOpenChange={(o) => !o && setSheet(null)} initial={sub ? f.subAmount : f.amount} currencyLabel={sub ? sub.code : settings.mainCurrency} onDone={(v) => set(sub ? "subAmount" : "amount", v)} />
      ) : null}
      <RepeatSheet open={sheet === "repeat"} onOpenChange={(o) => !o && setSheet(null)} value={f.repeat} onChange={(r) => set("repeat", r)} />
      {saved ? <SplitDialog open={sheet === "split"} onOpenChange={(o) => !o && setSheet(null)} txs={[saved]} /> : null}
      <BottomSheet open={sheet === "currency"} onOpenChange={(o) => !o && setSheet(null)} title="Currency">
        <div className="grid grid-cols-2 gap-1.5 px-2">
          <button type="button" className={cn("rounded-md border px-3 py-2 text-sm text-left", !sub && "bg-accent")} onClick={() => { setF((p) => ({ ...p, subCurrency: "", subAmount: "", rate: undefined, rateFromFeed: false })); setSheet(null); }}>{settings.mainCurrency} <span className="text-muted-foreground text-xs">main</span></button>
          {currencies.map((c) => (
            <button key={c._id} type="button" className={cn("rounded-md border px-3 py-2 text-sm text-left", sub?.code === c.code && "bg-accent")} onClick={() => pickCurrency(c)}>
              {c.code} <span className="text-muted-foreground text-xs">{formatRate(mainSide, c, c.rate)}</span>
            </button>
          ))}
        </div>
        {ratesAge ? <p className="text-xs text-muted-foreground mt-3 px-2">{ratesAge}</p> : null}
        <button type="button" className="text-xs text-muted-foreground underline mt-3 px-2" onClick={() => { setSheet(null); nav("/settings/sub-currencies"); }}>Manage sub-currencies and rates</button>
      </BottomSheet>

      <DeleteSeriesEntryDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} onPick={(scope) => void undoable.entry(id!, scope).then(() => done(closeEntry))} />
      <AlertDialog open={confirm === "copy"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Copy this entry</AlertDialogTitle><AlertDialogDescription>Which date should the copy use?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => copy({ id: id!, useToday: false }).then((nid) => done(() => openEntry(nid)))}>Date of entry</AlertDialogAction>
            <AlertDialogAction onClick={() => copy({ id: id!, useToday: true, today: todayISO() }).then((nid) => done(() => openEntry(nid)))}>Today's date</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirm === "scope"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Apply changes to</AlertDialogTitle><AlertDialogDescription>This entry is part of a series.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(null); save("save", "future"); }}>This and future</AlertDialogAction>
            <AlertDialogAction onClick={() => { setConfirm(null); save("save", "one"); }}>Only this one</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Where an entry came from: the mail, with a way to open it in Gmail. On a draft it also says who sent it and when. */
function GmailBanner({ from, receivedAt, subject, messageId }: { from?: string; receivedAt?: number; subject?: string; messageId: string }) {
  const who = from ? from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || senderAddress(from) : "";
  // the connected mailbox, so the link opens there rather than in the browser's first Google account
  const email = useQuery(api.gmail.status)?.email;
  const when = receivedAt ? new Date(receivedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        {who ? (
          <>
            <div className="truncate">From <span className="font-medium">{who}</span>{when ? <span className="text-muted-foreground"> · {when}</span> : null}</div>
            {subject ? <div className="truncate text-muted-foreground">{subject}</div> : null}
          </>
        ) : <div>Read from Gmail</div>}
      </div>
      <a href={gmailUrl(messageId, email)} target="_blank" rel="noopener" className="flex shrink-0 items-center gap-1 hover:underline underline-offset-4">Open in Gmail <ExternalLink className="size-3" /></a>
    </div>
  );
}

/** A small choice beside a field: a recent category, Today / Yesterday. */
function QuickPick({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("shrink-0 max-w-40 truncate rounded-md border px-2 py-0.5 text-xs transition-colors", active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60")}>
      {children}
    </button>
  );
}

function PrefixedInput({ prefix, className, ...props }: React.ComponentProps<typeof Input> & { prefix: string }) {
  return (
    <div className="relative flex-1 min-w-0">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>
      <Input {...props} className={cn("h-8 tabular", prefix.length > 1 ? "pl-11" : "pl-7", className)} />
    </div>
  );
}

function Field({ label, children, onClick, value, right }: { label: string; children?: React.ReactNode; onClick?: () => void; value?: string; right?: React.ReactNode }) {
  const body = (
    <>
      <div className="w-20 shrink-0 text-sm text-muted-foreground">{label}</div>
      {children ?? <div className={cn("flex-1 text-sm text-left truncate", value === "Select" && "text-muted-foreground")}>{value}</div>}
    </>
  );
  if (!onClick) return <div className="flex items-center gap-2 px-4 py-2">{body}{right}</div>;
  return (
    <div className="flex items-center pr-2 hover:bg-accent/40">
      <button type="button" onClick={onClick} className="flex-1 min-w-0 flex items-center gap-2 px-4 py-2.5 text-left">{body}</button>
      {right}
    </div>
  );
}

