import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useView } from "@/lib/store";
import { useBulkOps } from "@/lib/bulk";
import { backupExport, txCsvRows } from "../../../shared/views";
import { backupProblem, type BackupData } from "../../../shared/ops";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { downloadText, toCSV } from "@/lib/csv";
import { completeSheets, moneyManagerSheet } from "../../../shared/export";
import { downloadWorkbook, downloadXlsx } from "@/lib/xlsx";

export default function BackupSettings() {
  const view = useView();
  const nav = useNavigate();
  const bulk = useBulkOps();
  const confirm = useConfirm();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportJSON() {
    const data = backupExport(view);
    downloadText(`UnMoney-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), "application/json");
  }
  async function exportCSV(delim: "," | "\t") {
    const csv = toCSV(txCsvRows(view), delim);
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
    const reset = () => { if (restoreRef.current) restoreRef.current.value = ""; };
    let data: BackupData;
    try { data = JSON.parse(await file.text()) as BackupData; }
    catch { toast.error("That file is not a backup"); reset(); return; }
    const problem = backupProblem(data);
    if (problem) { toast.error(problem); reset(); return; }
    const made = data.exportedAt && !Number.isNaN(Date.parse(data.exportedAt)) ? new Date(data.exportedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
    const count = (n: number | undefined, one: string, many: string) => `${(n ?? 0).toLocaleString()} ${n === 1 ? one : many}`;
    const has = `${count(data.transactions?.length, "entry", "entries")}, ${count(data.accounts?.length, "payment method", "payment methods")} and ${count(data.categories?.length, "category", "categories")}`;
    const description = `${made ? `This backup from ${made}` : "This backup"} has ${has}. Restoring replaces ALL current data with it. This cannot be undone.`;
    if (!(await confirm({ title: "Restore this backup?", description, action: "Restore" }))) { reset(); return; }
    setBusy(true);
    // the toast from bulk.restore reports how the sync ends
    try { await bulk.restore(data); }
    catch (e) { if (!(e as { reported?: boolean }).reported) toast.error(e instanceof Error ? e.message : "Could not restore"); }
    setBusy(false);
    reset();
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
          <Row label="Import from Money Manager, Excel, CSV or TSV" hint="Review what will be added before anything is imported" onClick={() => nav("/import")} right={<ChevronRight className="size-4 text-muted-foreground" />} />
        </Section>
        <Section title="Danger zone">
          <Row label="Delete all entries" hint="Removes transactions, notes, schedules, bookmarks and budgets. Payment methods and categories stay." right={<Button size="sm" variant="destructive" onClick={async () => { if (await confirm({ title: "Delete all entries?", description: "Removes every transaction, note, schedule, bookmark and budget. Payment methods and categories stay. This cannot be undone.", action: "Delete all" })) void bulk.wipeAll().catch(() => {}); }}>Delete</Button>} />
        </Section>
      </Page>
    </>
  );
}
