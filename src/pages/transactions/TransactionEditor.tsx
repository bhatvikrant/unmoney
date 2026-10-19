import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftRight, Calculator, Globe, Repeat, Star, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp, useStore, useView } from "@/lib/store";
import { bookmarksList, noteSuggestions, txGet, txTags, type TxDetail } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { amountInput, localNumber, LOCALE_DECIMAL } from "@/lib/format";
import { todayISO } from "../../../shared/dates";
import { evaluateExpression, toMinor } from "../../../shared/money";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { useGoBack } from "@/lib/nav";
import { useUndoableDelete } from "@/lib/undo";
import { AccountPicker, CategoryPicker } from "@/components/tx/pickers";
import { AmountKeypad } from "@/components/tx/AmountKeypad";
import { RepeatSheet, repeatLabel, type RepeatChoice } from "@/components/tx/RepeatSheet";
import { PhotoField, TagInput } from "@/components/tx/fields";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type TxType = "income" | "expense" | "transfer";

/** The account a new entry starts on: the chosen default while it is still visible, else the first visible one. */
function defaultAccount(accounts: { _id: Id<"accounts">; hidden?: boolean }[], preferred?: Id<"accounts">) {
  const visible = accounts.filter((a) => !a.hidden);
  return (visible.find((a) => a._id === preferred) ?? visible[0])?._id;
}

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
  note: string;
  description: string;
  tags: string[];
  feeOn: boolean;
  fee: string;
  photoIds: Id<"_storage">[];
  repeat: RepeatChoice;
};

export default function TransactionEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const view = useView();
  const { resolveId } = useStore();
  const realId = id ? resolveId(id) : undefined;
  const existing = useMemo(() => (realId ? txGet(view, realId) : undefined), [view, realId]);
  const bookmarks = useMemo(() => (sp.get("bookmark") ? bookmarksList(view) : undefined), [view, sp]);
  const { settings, accounts, currencies } = useApp();

  const initial = useMemo<Form | null>(() => {
    const base: Form = {
      type: (sp.get("type") as TxType) || "expense",
      date: sp.get("date") || todayISO(),
      time: settings.timeInputEnabled ? new Date().toTimeString().slice(0, 5) : "",
      accountId: defaultAccount(accounts, settings.defaultAccountId),
      amount: "", subCurrency: "", subAmount: "", note: "", description: "", tags: [], feeOn: false, fee: "", photoIds: [], repeat: { kind: "none" },
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
        amount: amountInput(existing.amount, settings.decimals),
        subCurrency: existing.subCurrency ?? "",
        subAmount: existing.subAmount !== undefined && cur ? amountInput(existing.subAmount, cur.decimals) : "",
        rate: existing.exchangeRate,
        note: existing.note,
        description: existing.description ?? "",
        tags: existing.tags,
        feeOn: !!existing.feeAmount,
        fee: existing.feeAmount ? amountInput(existing.feeAmount, settings.decimals) : "",
        photoIds: existing.photoIds,
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
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, existing, bookmarks, sp]);

  if (!initial) return <div className="p-8 text-center text-sm text-muted-foreground">{id ? "Entry not found" : "Loading…"}</div>;
  return <Editor key={realId ?? "new"} initial={initial} id={realId as Id<"transactions"> | undefined} existing={existing ?? undefined} />;
}

type Existing = TxDetail;

function Editor({ initial, id, existing }: { initial: Form; id?: Id<"transactions">; existing?: Existing }) {
  const nav = useNavigate();
  const goBack = useGoBack();
  const undoable = useUndoableDelete();
  const { settings, accountName, categoryLabel, currencies, fmt, accounts } = useApp();
  const [f, setF] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const [sheet, setSheet] = useState<null | "account" | "to" | "category" | "keypad" | "feeKeypad" | "repeat" | "currency">(null);
  const [noteFocus, setNoteFocus] = useState(false);
  const [notePicked, setNotePicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "copy" | "scope">(null);

  const view = useView();
  const create = useOp("transactions.create");
  const update = useOp("transactions.update");
  const copy = useOp("transactions.copy");
  const addBookmark = useOp("bookmarks.create");
  const removeBookmark = useOp("bookmarks.remove");
  const bookmarked = useMemo(() => (id ? view.bookmarks.find((b) => b.transactionId === id) : undefined), [view, id]);
  const tagList = useMemo(() => txTags(view), [view]);
  const wantSuggestions = settings.autocompleteEnabled && noteFocus && !notePicked && f.type !== "transfer";
  const suggestions = useMemo(() => (wantSuggestions ? noteSuggestions(view, f.note, f.type) : undefined), [view, wantSuggestions, f.note, f.type]);

  const sub = f.subCurrency ? currencies.find((c) => c.code === f.subCurrency) : undefined;
  const mainMajor = useMemo(() => {
    if (!sub) return evaluateExpression(f.amount, LOCALE_DECIMAL);
    const s = evaluateExpression(f.subAmount, LOCALE_DECIMAL);
    if (s === null) return null;
    return f.rate ? s / f.rate : null;
  }, [f.amount, f.subAmount, f.rate, sub]);

  useEffect(() => {
    if (sub && mainMajor !== null) set("amount", localNumber(Math.round(mainMajor * 10 ** settings.decimals) / 10 ** settings.decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMajor, sub]);

  const isEdit = !!id;
  const inSeries = !!existing?.repeatId;

  // Accounts can arrive after the form is created on a fresh load: fill the default then.
  useEffect(() => {
    if (!f.accountId && accounts.length) set("accountId", defaultAccount(accounts, settings.defaultAccountId));
  }, [accounts, f.accountId, settings.defaultAccountId]);

  // New entries start with the cursor in the amount, and go back there after "Continue". The tap
  // that opened this screen primed the iOS keyboard (primeKeyboard); take focus over before paint.
  const amountRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!isEdit) amountRef.current?.focus();
  }, [isEdit]);

  function buildArgs() {
    const amountMajor = evaluateExpression(f.amount, LOCALE_DECIMAL);
    if (amountMajor === null) throw new Error("Enter an amount");
    const amount = toMinor(amountMajor, settings.decimals);
    if (amount === 0) throw new Error("Enter an amount");
    if (!f.accountId) throw new Error("Pick an account");
    if (f.type !== "transfer" && !f.categoryId) throw new Error("Pick a category");
    if (f.type === "transfer" && !f.toAccountId) throw new Error("Pick an account to transfer to");
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
      subAmount: sub ? toMinor(evaluateExpression(f.subAmount, LOCALE_DECIMAL) ?? 0, sub.decimals) : undefined,
      subCurrency: sub ? sub.code : undefined,
      exchangeRate: sub ? f.rate : undefined,
      note: f.note,
      description: f.description || undefined,
      tags: f.tags,
      feeAmount: fee || undefined,
      photoIds: f.photoIds,
    };
  }

  async function save(mode: "save" | "continue", scope?: "one" | "future") {
    // Focus now, while still inside the tap: iOS will not open the keyboard after the await below.
    if (mode === "continue") amountRef.current?.focus();
    setBusy(true);
    try {
      const args = buildArgs();
      if (isEdit) {
        if (inSeries && !scope) { setConfirm("scope"); setBusy(false); return; }
        await update({ id: id!, ...args, scope });
        toast.success("Saved");
        goBack();
      } else {
        await create({
          ...args,
          repeat: f.repeat.kind === "repeat" ? { frequency: f.repeat.frequency, endDate: f.repeat.endDate } : undefined,
          installment: f.repeat.kind === "installment" ? { count: f.repeat.count } : undefined,
        });
        toast.success("Saved");
        if (mode === "continue") {
          setF((p) => ({ ...p, amount: "", subAmount: "", note: "", description: "", tags: [], photoIds: [], fee: "", feeOn: false, repeat: { kind: "none" } }));
        } else {
          goBack();
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBookmark() {
    try {
      if (bookmarked) {
        await removeBookmark({ id: bookmarked._id });
        toast("Bookmark removed");
        return;
      }
      const a = buildArgs();
      await addBookmark({ transactionId: id, template: { type: a.type, accountId: a.accountId, toAccountId: a.toAccountId, categoryId: a.categoryId, subcategoryId: a.subcategoryId, amount: a.amount, note: a.note, description: a.description, tags: a.tags, feeAmount: a.feeAmount } });
      toast.success("Bookmarked", { description: "Find it under the star on the Transactions tab." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not bookmark");
    }
  }

  const typeColor = { income: "text-income border-income", expense: "text-expense border-expense", transfer: "text-foreground border-foreground" } as const;
  const title = f.type === "income" ? "Income" : f.type === "expense" ? "Expense" : "Transfer";

  return (
    <>
      <PageHeader back title={title} />
      <Page className={isEdit ? "pb-36" : "pb-24"}>
        <div className="grid grid-cols-3 gap-2 p-4">
          {(["income", "expense", "transfer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setF((p) => ({ ...p, type: t, categoryId: undefined, subcategoryId: undefined }))}
              className={cn("h-10 rounded-md border text-sm capitalize transition-colors", f.type === t ? typeColor[t] + " font-medium bg-accent/40" : "text-muted-foreground")}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="divide-y border-y bg-card">
          <Field label="Date">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} className="h-8 w-auto min-w-0 flex-[3] px-2" />
              {settings.timeInputEnabled ? <Input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} className="h-8 w-auto min-w-0 flex-[2] px-2" /> : null}
              {!isEdit ? (
                <button type="button" onClick={() => setSheet("repeat")} className={cn("flex flex-col items-center shrink-0 text-[10px] text-muted-foreground px-1", f.repeat.kind !== "none" && "text-primary")}>
                  <Repeat className="size-4" />
                  <span className="max-w-24 truncate">{f.repeat.kind === "none" ? "Repeat" : repeatLabel(f.repeat)}</span>
                </button>
              ) : inSeries ? (
                <button type="button" onClick={() => nav("/settings/repeats")} className="text-[10px] text-primary flex items-center gap-1"><Repeat className="size-3" />{existing?.installmentIndex ? `${existing.installmentIndex}/${existing.installmentCount}` : "In a series"}</button>
              ) : null}
            </div>
          </Field>

          {f.type === "transfer" ? (
            <>
              <Field label="From" onClick={() => setSheet("account")} value={f.accountId ? accountName(f.accountId) : "Select"} />
              <Field label="To" onClick={() => setSheet("to")} value={f.toAccountId ? accountName(f.toAccountId) : "Select"} right={
                <Button variant="ghost" size="icon" className="size-7" aria-label="Swap accounts" onClick={(e) => { e.stopPropagation(); setF((p) => ({ ...p, accountId: p.toAccountId, toAccountId: p.accountId })); }}><ArrowLeftRight className="size-4" /></Button>
              } />
            </>
          ) : (
            <>
              <Field label="Account" onClick={() => setSheet("account")} value={f.accountId ? accountName(f.accountId) : "Select"} />
              <Field label="Category" onClick={() => setSheet("category")} value={f.categoryId ? categoryLabel({ categoryId: f.categoryId, subcategoryId: f.subcategoryId }) : "Select"} />
            </>
          )}

          <Field label="Amount">
            <div className="flex-1 flex items-center gap-2">
              {sub ? (
                <>
                  <PrefixedInput ref={amountRef} prefix={sub.code} inputMode="decimal" value={f.subAmount} onChange={(e) => set("subAmount", e.target.value)} placeholder="0" />
                </>
              ) : (
                <>
                  <PrefixedInput ref={amountRef} prefix={settings.symbol} inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" onBlur={() => { const v = evaluateExpression(f.amount, LOCALE_DECIMAL); if (v !== null && /[+\-*/×÷]/.test(f.amount.slice(1))) set("amount", localNumber(v)); }} />
                </>
              )}
              <Button variant="ghost" size="icon" className="size-8" aria-label="Calculator" onClick={() => setSheet("keypad")}><Calculator className="size-4" /></Button>
              {currencies.length ? <Button variant="ghost" size="icon" className={cn("size-8", sub && "text-primary")} aria-label="Currency" onClick={() => setSheet("currency")}><Globe className="size-4" /></Button> : null}
            </div>
          </Field>
          {sub ? (
            <Field label="Converted">
              <div className="flex-1 flex items-center gap-2 text-sm">
                <PrefixedInput prefix={settings.symbol} inputMode="decimal" value={f.amount} onChange={(e) => { set("amount", e.target.value); const m = evaluateExpression(e.target.value, LOCALE_DECIMAL); const s = evaluateExpression(f.subAmount, LOCALE_DECIMAL); if (m && s) set("rate", s / m); }} />
                <span className="text-xs text-muted-foreground whitespace-nowrap">1 {settings.mainCurrency} = {f.rate ? (Math.round(f.rate * 10000) / 10000) : "?"} {sub.code}</span>
              </div>
            </Field>
          ) : null}

          {f.type === "transfer" ? (
            <Field label="Fees">
              <div className="flex-1 flex items-center gap-3">
                <Switch checked={f.feeOn} onCheckedChange={(v) => set("feeOn", v)} />
                {f.feeOn ? <Input inputMode="decimal" value={f.fee} onChange={(e) => set("fee", e.target.value)} placeholder="0" className="h-8 tabular" /> : <span className="text-xs text-muted-foreground">Record a transfer fee as an expense</span>}
              </div>
            </Field>
          ) : null}

          <Field label="Note">
            <div className="flex-1 relative">
              <Input value={f.note} onChange={(e) => { setNotePicked(false); set("note", e.target.value); }} onFocus={() => { setNotePicked(false); setNoteFocus(true); }} onBlur={() => setTimeout(() => setNoteFocus(false), 150)} placeholder={f.type === "transfer" ? "Optional" : "Store, payee, item…"} className="h-8" />
              {noteFocus && suggestions?.length ? (
                <div className="absolute z-20 left-0 right-0 top-9 rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.note}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setNotePicked(true); setF((p) => ({
                        ...p,
                        note: s.note,
                        categoryId: p.categoryId ?? s.categoryId,
                        subcategoryId: p.categoryId ? p.subcategoryId : s.subcategoryId,
                        amount: p.amount || amountInput(s.amount, settings.decimals),
                        accountId: p.accountId ?? s.accountId,
                      })); }}
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
            <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Description" className="min-h-16 resize-none" />
          </div>
          <div className="px-4 py-2"><TagInput tags={f.tags} onChange={(t) => set("tags", t)} suggestions={tagList.map((t) => t.tag)} /></div>
          <div className="px-4 py-3"><PhotoField photoIds={f.photoIds} onChange={(ids) => set("photoIds", ids)} /></div>
        </div>

      </Page>

      <div className="fixed bottom-[var(--tabbar-h)] md:bottom-0 inset-x-0 md:left-56 z-30 bg-background/95 backdrop-blur border-t md:safe-bottom">
        <div className="mx-auto max-w-3xl space-y-2 p-3">
          {isEdit ? (
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="h-10 text-destructive hover:text-destructive" onClick={() => (inSeries ? setConfirm("delete") : void undoable.entry(id!).then(() => goBack()))}><Trash2 className="size-4" />Delete</Button>
              <Button variant="outline" className="h-10" onClick={() => setConfirm("copy")}><Copy className="size-4" />Copy</Button>
              <Button variant="outline" className={cn("h-10", bookmarked && "border-amber-400/60 text-amber-500 hover:text-amber-500")} aria-pressed={!!bookmarked} onClick={toggleBookmark}>
                <Star key={bookmarked ? "on" : "off"} className={cn("size-4", bookmarked && "fill-current animate-in zoom-in-50 duration-300")} />
                {bookmarked ? "Bookmarked" : "Bookmark"}
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button className="h-11 flex-1 text-base" disabled={busy} onClick={() => save("save")}>Save</Button>
            {!isEdit ? <Button variant="outline" className="h-11 flex-1 text-base" disabled={busy} onClick={() => save("continue")}>Continue</Button> : null}
          </div>
        </div>
      </div>

      <AccountPicker open={sheet === "account"} onOpenChange={(o) => !o && setSheet(null)} onPick={(a) => set("accountId", a)} title={f.type === "transfer" ? "From" : "Account"} exclude={f.type === "transfer" ? f.toAccountId : undefined} />
      <AccountPicker open={sheet === "to"} onOpenChange={(o) => !o && setSheet(null)} onPick={(a) => set("toAccountId", a)} title="To" exclude={f.accountId} />
      {f.type !== "transfer" ? (
        <CategoryPicker open={sheet === "category"} onOpenChange={(o) => !o && setSheet(null)} type={f.type} onPick={(c, s) => setF((p) => ({ ...p, categoryId: c, subcategoryId: s }))} />
      ) : null}
      {sheet === "keypad" ? (
        <AmountKeypad open onOpenChange={(o) => !o && setSheet(null)} initial={sub ? f.subAmount : f.amount} currencyLabel={sub ? sub.code : settings.mainCurrency} onDone={(v) => set(sub ? "subAmount" : "amount", v)} />
      ) : null}
      <RepeatSheet open={sheet === "repeat"} onOpenChange={(o) => !o && setSheet(null)} value={f.repeat} onChange={(r) => set("repeat", r)} />
      <BottomSheet open={sheet === "currency"} onOpenChange={(o) => !o && setSheet(null)} title="Currency">
        <div className="grid grid-cols-2 gap-1.5 px-2">
          <button type="button" className={cn("rounded-md border px-3 py-2 text-sm text-left", !sub && "bg-accent")} onClick={() => { setF((p) => ({ ...p, subCurrency: "", subAmount: "", rate: undefined })); setSheet(null); }}>{settings.mainCurrency} <span className="text-muted-foreground text-xs">main</span></button>
          {currencies.map((c) => (
            <button key={c._id} type="button" className={cn("rounded-md border px-3 py-2 text-sm text-left", sub?.code === c.code && "bg-accent")} onClick={() => { setF((p) => ({ ...p, subCurrency: c.code, rate: c.rate, subAmount: p.subAmount || p.amount })); setSheet(null); }}>
              {c.code} <span className="text-muted-foreground text-xs">1 {settings.mainCurrency} = {c.rate}</span>
            </button>
          ))}
        </div>
        <button type="button" className="text-xs text-muted-foreground underline mt-3 px-2" onClick={() => { setSheet(null); nav("/settings/sub-currencies"); }}>Manage sub-currencies and rates</button>
      </BottomSheet>

      <AlertDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This entry belongs to a repeat or installment series.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => undoable.entry(id!, "future").then(() => goBack())}>This and future</AlertDialogAction>
            <AlertDialogAction onClick={() => undoable.entry(id!, "one").then(() => goBack())}>Only this one</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirm === "copy"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Copy this entry</AlertDialogTitle><AlertDialogDescription>Which date should the copy use?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => copy({ id: id!, useToday: false }).then((nid) => { toast.success("Copied"); nav(`/t/${nid}`, { replace: true }); })}>Date of entry</AlertDialogAction>
            <AlertDialogAction onClick={() => copy({ id: id!, useToday: true }).then((nid) => { toast.success("Copied"); nav(`/t/${nid}`, { replace: true }); })}>Today's date</AlertDialogAction>
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

