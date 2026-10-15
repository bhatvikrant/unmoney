import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { backupExport, txExportRows } from "../../../shared/views";
import type { BackupData } from "../../../shared/ops";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { downloadText, toCSV } from "@/lib/csv";
import { toMajor } from "../../../shared/money";

export default function BackupSettings() {
  const view = useView();
  const nav = useNavigate();
  const { settings } = useApp();
  const restore = useOp("backup.restore");
  const wipe = useOp("backup.wipeAll");
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportJSON() {
    const data = backupExport(view);
    downloadText(`UnMoney-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), "application/json");
  }
  async function exportCSV(delim: "," | "\t") {
    const rows = txExportRows(view);
    const csv = toCSV(rows.map((r) => ({ Date: r.date, Account: r.account, Category: r.category, Subcategory: r.subcategory, Note: r.note, Amount: toMajor(Number(r.amount), settings.decimals), "Income/Expense": r.type, Description: r.description, "Amount Sub": r.subAmount === "" ? "" : r.subAmount, Currency: r.subCurrency, Fee: r.fee === "" ? "" : toMajor(Number(r.fee), settings.decimals), Tags: r.tags })), delim);
    downloadText(`UnMoney-transactions.${delim === "," ? "csv" : "tsv"}`, csv, delim === "," ? "text/csv" : "text/tab-separated-values");
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
          <Row label="Export to Excel (CSV)" right={<Button size="sm" variant="outline" onClick={() => exportCSV(",")}>CSV</Button>} />
          <Row label="Export as TSV" hint="Re-importable here and in Money Manager" right={<Button size="sm" variant="outline" onClick={() => exportCSV("\t")}>TSV</Button>} />
        </Section>
        <Section title="Import">
          <Row label="Import from Money Manager, Excel, CSV or TSV" hint="Review what will be added before anything is imported" onClick={() => nav("/import")} right={<ChevronRight className="size-4 text-muted-foreground" />} />
        </Section>
        <Section title="Danger zone">
          <Row label="Delete all entries" hint="Removes transactions, notes, schedules, bookmarks and budgets. Accounts and categories stay." right={<Button size="sm" variant="destructive" onClick={async () => { if (window.confirm("Delete every transaction? This cannot be undone.")) { await wipe({ confirm: "DELETE" }); toast.success("Entries deleted"); } }}>Delete</Button>} />
        </Section>
      </Page>
    </>
  );
}
