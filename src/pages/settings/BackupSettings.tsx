import { useRef, useState } from "react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { backupExport, txExportRows } from "../../../shared/views";
import type { BackupData } from "../../../shared/ops";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCOUNT_KINDS, accountNamesIn, guessGroupKind, downloadText, mapImportRow, dropTransferIns, parseTable, parseXlsx, toCSV } from "@/lib/csv";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { NewImportAccount } from "../../../shared/ops";
import { completeSheets, moneyManagerSheet } from "../../../shared/export";
import { downloadWorkbook, downloadXlsx } from "@/lib/xlsx";
import { toMajor } from "../../../shared/money";

export default function BackupSettings() {
  const view = useView();
  const { settings } = useApp();
  const restore = useOp("backup.restore");
  const importRows = useOp("transactions.importRows");
  const wipe = useOp("backup.wipeAll");
  const restoreRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<null | { rows: ReturnType<typeof mapImportRow>[]; headers: string[] }>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [createAccounts, setCreateAccounts] = useState(true);
  const [accountKinds, setAccountKinds] = useState<Record<string, NewImportAccount["groupKind"]>>({});
  const [errors, setErrors] = useState<{ row: number; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function exportJSON() {
    const data = backupExport(view);
    downloadText(`UnMoney-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), "application/json");
  }
  async function exportCSV(delim: "," | "\t") {
    const rows = txExportRows(view);
    const csv = toCSV(rows.map((r) => ({ Date: r.time ? `${r.date} ${r.time}` : r.date, Account: r.account, Category: r.category, Subcategory: r.subcategory, Note: r.note, Amount: toMajor(Number(r.amount), settings.decimals), "Income/Expense": r.type, Description: r.description, "Amount Sub": r.subAmount === "" ? "" : r.subAmount, Currency: r.subCurrency, Fee: r.fee === "" ? "" : toMajor(Number(r.fee), settings.decimals), Tags: r.tags })), delim);
    downloadText(`UnMoney-transactions.${delim === "," ? "csv" : "tsv"}`, csv, delim === "," ? "text/csv" : "text/tab-separated-values");
  }
  async function exportMoneyManager() {
    try { await downloadXlsx(`UnMoney-money-manager-${new Date().toISOString().slice(0, 10)}.xlsx`, moneyManagerSheet(view)); }
    catch { toast.error("Export failed"); }
  }
  async function exportWorkbook() {
    try { await downloadWorkbook(`UnMoney-complete-${new Date().toISOString().slice(0, 10)}.xlsx`, completeSheets(view)); }
    catch { toast.error("Export failed"); }
  }
  async function onRestoreFile(file: File | undefined) {
    if (!file) return;
    if (!window.confirm("Restore replaces ALL current data with the backup. Continue?")) return;
    setBusy(true);
    try { await restore({ data: JSON.parse(await file.text()) as BackupData }); toast.success("Restored"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Restore failed"); }
    setBusy(false);
    if (restoreRef.current) restoreRef.current.value = "";
  }
  async function onImportFile(file: File | undefined) {
    if (!file) return;
    let parsed: { headers: string[]; rows: Record<string, string>[] };
    try {
      parsed = /\.xlsx$/i.test(file.name) ? await parseXlsx(file) : parseTable(await file.text());
    } catch {
      toast.error("Couldn't read that file");
      if (importRef.current) importRef.current.value = "";
      return;
    }
    const { headers, rows } = parsed;
    if (!rows.length) { toast.error("No rows found. Expected a Date and Amount column"); if (importRef.current) importRef.current.value = ""; return; }
    const { rows: mapped, dropped } = dropTransferIns(rows.map(mapImportRow));
    if (dropped) toast.info(`Skipped ${dropped} Transfer-In rows (each transfer is imported once, from its Transfer-Out row)`);
    const existing = new Set(view.accounts.filter((a) => !a.deletedAt).map((a) => a.name.trim().toLowerCase()));
    setAccountKinds(Object.fromEntries(accountNamesIn(mapped).filter((n) => !existing.has(n.toLowerCase())).map((n) => [n, guessGroupKind(n)])));
    setPreview({ headers, rows: mapped });
    setErrors([]);
    if (importRef.current) importRef.current.value = "";
  }
  async function runImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await importRows({ rows: preview.rows, createMissing, newAccounts: createAccounts ? Object.entries(accountKinds).map(([name, groupKind]) => ({ name, groupKind })) : undefined });
      if (res.errors.length) { setErrors(res.errors); toast.error(`${res.errors.length} rows need fixing; nothing was imported`); }
      else { toast.success(`Imported ${res.inserted} entries`); setPreview(null); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Import failed"); }
    setBusy(false);
  }
  return (
    <>
      <PageHeader back="/settings" title="Backup & data" />
      <Page className="pb-10">
        <Section title="Backup">
          <Row label="Download backup (JSON)" hint="Everything: accounts, categories, entries, budgets, schedules, settings" right={<Button size="sm" variant="outline" onClick={exportJSON}>Download</Button>} />
          <Row label="Restore from backup" hint="Replaces all current data" right={<Button size="sm" variant="outline" disabled={busy} onClick={() => restoreRef.current?.click()}>Choose file</Button>} />
          <input ref={restoreRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onRestoreFile(e.target.files?.[0])} />
        </Section>
        <Section title="Export">
          <Row label="Money Manager Excel (.xlsx)" hint="Same layout as Money Manager's own export. Import it there or back here, any time" right={<Button size="sm" variant="outline" onClick={exportMoneyManager}>Excel</Button>} />
          <Row label="Complete workbook (.xlsx)" hint="Entries with time, fees, tags and rates, plus accounts, categories, budgets, repeats, notes and currencies" right={<Button size="sm" variant="outline" onClick={exportWorkbook}>Excel</Button>} />
          <Row label="Export as CSV" right={<Button size="sm" variant="outline" onClick={() => exportCSV(",")}>CSV</Button>} />
          <Row label="Export as TSV" hint="Re-importable here" right={<Button size="sm" variant="outline" onClick={() => exportCSV("\t")}>TSV</Button>} />
        </Section>
        <Section title="Import">
          <Row label="Import from Excel / CSV / TSV" hint="Money Manager .xlsx exports work as-is. Columns: Date, Account, Category, Subcategory, Note, Amount, Income/Expense, Description, Amount Sub, Currency" right={<Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>Choose file</Button>} />
          <input ref={importRef} type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values" className="hidden" onChange={(e) => onImportFile(e.target.files?.[0])} />
        </Section>
        <Section title="Danger zone">
          <Row label="Delete all entries" hint="Removes transactions, notes, schedules, bookmarks and budgets. Accounts and categories stay." right={<Button size="sm" variant="destructive" onClick={async () => { if (window.confirm("Delete every transaction? This cannot be undone.")) { await wipe({ confirm: "DELETE" }); toast.success("Entries deleted"); } }}>Delete</Button>} />
        </Section>
      </Page>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Import {preview?.rows.length} rows</DialogTitle></DialogHeader>
          {preview ? (
            <div className="space-y-3 min-w-0">
              <div className="overflow-x-auto border rounded-md max-h-64">
                <table className="text-xs w-full whitespace-nowrap">
                  <thead className="bg-muted sticky top-0"><tr>{["date", "account", "category", "subcategory", "note", "amount", "type"].map((h) => <th key={h} className="text-left px-2 py-1 font-medium capitalize">{h}</th>)}</tr></thead>
                  <tbody>{preview.rows.slice(0, 50).map((r, i) => <tr key={i} className="border-t"><td className="px-2 py-1">{r.date}</td><td className="px-2 py-1">{r.account}</td><td className="px-2 py-1">{r.category}</td><td className="px-2 py-1">{r.subcategory}</td><td className="px-2 py-1 max-w-32 truncate">{r.note}</td><td className="px-2 py-1 tabular">{r.amount}</td><td className="px-2 py-1">{r.type}</td></tr>)}</tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={createMissing} onCheckedChange={(v) => setCreateMissing(!!v)} />Create categories that don't exist yet </label>
              {Object.keys(accountKinds).length ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={createAccounts} onCheckedChange={(v) => setCreateAccounts(!!v)} />Create {Object.keys(accountKinds).length} accounts that don't exist yet</label>
                  {createAccounts ? (
                    <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                      {Object.entries(accountKinds).map(([name, kind]) => (
                        <div key={name} className="flex items-center justify-between gap-2 px-2 py-1 min-w-0">
                          <span className="text-sm truncate min-w-0">{name}</span>
                          <Select value={kind} onValueChange={(v) => setAccountKinds((k) => ({ ...k, [name]: v as NewImportAccount["groupKind"] }))}>
                            <SelectTrigger className="h-8 w-36 shrink-0"><SelectValue /></SelectTrigger>
                            <SelectContent>{ACCOUNT_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {createAccounts && Object.values(accountKinds).includes("card") ? <p className="text-xs text-muted-foreground">Credit cards are billed to your first bank account with settlement day 1 and payment day 15. Adjust them later in Accounts.</p> : null}
                </div>
              ) : null}
              {errors.length ? <div className="max-h-32 overflow-y-auto text-xs text-destructive space-y-0.5">{errors.slice(0, 30).map((e) => <div key={e.row}>Row {e.row}: {e.reason}</div>)}</div> : null}
            </div>
          ) : null}
          <DialogFooter><Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button><Button disabled={busy} onClick={runImport}>Import</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
