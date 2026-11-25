import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useStore } from "@/lib/store";
import { listSafetyCopies, readSafetyCopy, SAFETY_DAYS, SAFETY_REASON, type SafetyCopyInfo } from "@/lib/safetyCopy";
import { useBulkOps } from "@/lib/bulk";
import { backupExport, txCsvRows } from "../../../shared/views";
import { backupProblem, isTmpId, type BackupData } from "../../../shared/ops";
import { orGiveUp, packBackup, readBackupFile, type BackupPhotos } from "@/lib/backupFile";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { downloadBlob, downloadText, toCSV } from "@/lib/csv";
import { completeSheets, moneyManagerSheet } from "../../../shared/export";
import { downloadWorkbook, downloadXlsx } from "@/lib/xlsx";

export default function BackupSettings() {
  const { view, status } = useStore();
  const convex = useConvex();
  const nav = useNavigate();
  const bulk = useBulkOps();
  const confirm = useConfirm();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The receipt photos the entries name, fetched from the server. One that can't be fetched (offline, still
   * waiting to upload, gone) is simply not in the map: the backup is made without it and says how many.
   */
  async function fetchPhotos(ids: string[]): Promise<Map<string, Blob>> {
    const photos = new Map<string, Blob>();
    const real = ids.filter((id) => !isTmpId(id)) as Id<"_storage">[];
    // the socket being down means the URL query would wait for it; photos are fetched 6 at a time
    for (let i = 0; status.connected && i < real.length; i += 200) {
      const got = await orGiveUp(convex.query(api.files.urls, { ids: real.slice(i, i + 200) }).catch(() => ({} as Record<string, string | null>)));
      // no answer: the connection went after Download was tapped. The backup is made with what has been fetched.
      if (!got) break;
      const urls = Object.entries(got);
      for (let j = 0; j < urls.length; j += 6) {
        await Promise.all(urls.slice(j, j + 6).map(async ([id, url]) => {
          const res = url ? await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null) : null;
          const blob = res?.ok ? await res.blob().catch(() => null) : null;
          if (blob) photos.set(id, blob);
        }));
      }
    }
    return photos;
  }
  async function exportJSON() {
    const data = backupExport(view);
    const name = `UnMoney-backup-${new Date().toISOString().slice(0, 10)}`;
    const ids = [...new Set(view.transactions.flatMap((t) => t.photoIds as string[]))];
    if (!ids.length) { downloadBlob(`${name}.json`, (await packBackup(data, new Map())).blob); return; }
    setBusy(true);
    const progress = toast.loading(`Collecting ${ids.length.toLocaleString()} ${ids.length === 1 ? "photo" : "photos"}…`);
    try {
      const photos = await fetchPhotos(ids);
      // a zip this device can't build (too large for it) still leaves a backup of everything else
      let tooLarge = false;
      const file = await packBackup(data, photos).catch(() => { tooLarge = true; return packBackup(data, new Map()); });
      downloadBlob(`${name}.${file.ext}`, file.blob);
      const left = ids.length - photos.size;
      if (tooLarge) toast.warning(`${photos.size.toLocaleString()} receipt photos are too much for one backup file on this device, so this backup has everything except the photos.`, { duration: 10_000 });
      else if (left) toast.warning(`${left.toLocaleString()} of ${ids.length.toLocaleString()} receipt photos could not be fetched, so they are not in this backup. Download it again when you are online to include them.`, { duration: 10_000 });
      else toast.success(`Backup downloaded with ${photos.size.toLocaleString()} ${photos.size === 1 ? "photo" : "photos"}`);
    } catch {
      toast.error("Could not make the backup");
    } finally {
      toast.dismiss(progress);
      setBusy(false);
    }
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
    let data: BackupData, photos: BackupPhotos;
    try { ({ data, photos } = await readBackupFile(file)); }
    catch { toast.error("That file is not a backup"); reset(); return; }
    const problem = backupProblem(data);
    if (problem) { toast.error(problem); reset(); return; }
    const made = data.exportedAt && !Number.isNaN(Date.parse(data.exportedAt)) ? new Date(data.exportedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
    const count = (n: number | undefined, one: string, many: string) => `${(n ?? 0).toLocaleString()} ${n === 1 ? one : many}`;
    const has = `${count(data.transactions?.length, "entry", "entries")}, ${count(data.accounts?.length, "payment method", "payment methods")} and ${count(data.categories?.length, "category", "categories")}${photos.size ? `, with ${count(photos.size, "receipt photo", "receipt photos")}` : ""}`;
    const description = `${made ? `This backup from ${made}` : "This backup"} has ${has}. Restoring replaces ALL current data with it. A safety copy of what you have now is kept on this device for a week.`;
    if (!(await confirm({ title: "Restore this backup?", description, action: "Restore" }))) { reset(); return; }
    setBusy(true);
    // the toast from bulk.restore reports how the sync ends
    try { await bulk.restore(data, photos); }
    catch (e) { if (!(e as { reported?: boolean }).reported) toast.error(e instanceof Error ? e.message : "Could not restore"); }
    setBusy(false);
    reset();
  }
  return (
    <>
      <PageHeader back="/settings" title="Backup & data" />
      <Page className="pb-10">
        <Section title="Backup">
          <Row label="Download backup" hint="Accounts, categories, entries, budgets, schedules and settings. With receipt photos it is a .zip that holds them too, so they come back in any account" right={<Button size="sm" variant="outline" disabled={busy} onClick={() => void exportJSON()}>Download</Button>} />
          <Row label="Restore from backup" hint="Replaces all current data" right={<Button size="sm" variant="outline" disabled={busy} onClick={() => restoreRef.current?.click()}>Choose file</Button>} />
          <input ref={restoreRef} type="file" accept="application/json,.json,application/zip,.zip" className="hidden" onChange={(e) => onRestoreFile(e.target.files?.[0])} />
        </Section>
        <Section title="Export">
          <Row label="Money Manager Excel (.xlsx)" hint="Same layout as Money Manager's own export. Import it there or back here, any time" right={<Button size="sm" variant="outline" onClick={exportMoneyManager}>Excel</Button>} />
          <Row label="Complete workbook (.xlsx)" hint="Entries with time, fees, tags and rates, plus accounts, categories, budgets, repeats, notes and currencies" right={<Button size="sm" variant="outline" onClick={exportWorkbook}>Excel</Button>} />
          <Row label="Export as CSV" right={<Button size="sm" variant="outline" onClick={() => exportCSV(",")}>CSV</Button>} />
          <Row label="Export as TSV" hint="Re-importable here" right={<Button size="sm" variant="outline" onClick={() => exportCSV("\t")}>TSV</Button>} />
        </Section>
        <Section title="Import">
          <Row label="Import from Money Manager or a bank statement" hint="Excel, CSV or TSV. Review what will be added before anything is imported" onClick={() => nav("/import")} right={<ChevronRight className="size-4 text-muted-foreground" />} />
        </Section>
        <SafetyCopies busy={busy} setBusy={setBusy} />
        <Section title="Danger zone">
          <Row label="Delete all entries" hint="Removes transactions, notes, schedules, bookmarks and budgets. Payment methods and categories stay." right={<Button size="sm" variant="destructive" onClick={async () => { if (await confirm({ title: "Delete all entries?", description: "Removes every transaction, note, schedule, bookmark and budget. Payment methods and categories stay. A safety copy is kept on this device for a week.", action: "Delete all" })) void bulk.wipeAll().catch(() => {}); }}>Delete</Button>} />
        </Section>
      </Page>
    </>
  );
}

/**
 * Copies this device kept just before a restore, Delete all, a currency change or undoing an
 * import (src/lib/safetyCopy.ts). Putting one back is a restore, so it keeps a copy of now first.
 */
function SafetyCopies({ busy, setBusy }: { busy: boolean; setBusy: (b: boolean) => void }) {
  const { userId, view } = useStore();
  const bulk = useBulkOps();
  const confirm = useConfirm();
  const [copies, setCopies] = useState<SafetyCopyInfo[]>([]);
  const refresh = useCallback(() => { if (userId) void listSafetyCopies(userId).then(setCopies, () => setCopies([])); }, [userId]);
  // a new copy appears after the action that made it, which changes the data
  useEffect(refresh, [refresh, view.transactions.length]);
  if (!copies.length) return null;
  const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  async function putBack(c: SafetyCopyInfo) {
    const ok = await confirm({
      title: `Put back the copy from ${when(c.at)}?`,
      description: `It replaces ALL current data with what you had ${SAFETY_REASON[c.reason]} (${c.entries.toLocaleString()} ${c.entries === 1 ? "entry" : "entries"}). A copy of what you have now is kept first.`,
      action: "Put back",
    });
    if (!ok) return;
    const full = await readSafetyCopy(c.id);
    if (!full) { toast.error("That copy is gone"); refresh(); return; }
    setBusy(true);
    try { await bulk.restore(full.data); }
    catch (e) { if (!(e as { reported?: boolean }).reported) toast.error(e instanceof Error ? e.message : "Could not put it back"); }
    setBusy(false);
    refresh();
  }
  async function download(c: SafetyCopyInfo) {
    const full = await readSafetyCopy(c.id);
    if (full) downloadText(`UnMoney-safety-copy-${new Date(c.at).toISOString().slice(0, 10)}.json`, JSON.stringify(full.data, null, 1), "application/json");
  }
  return (
    <Section title="Safety copies">
      {copies.map((c) => (
        <Row key={c.id} label={when(c.at)} hint={`${SAFETY_REASON[c.reason][0].toUpperCase()}${SAFETY_REASON[c.reason].slice(1)} · ${c.entries.toLocaleString()} ${c.entries === 1 ? "entry" : "entries"}`}
          right={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => void download(c)}>Download</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void putBack(c)}>Put back</Button></div>} />
      ))}
      <p className="px-4 py-2 text-xs text-muted-foreground">Kept on this device only, for {SAFETY_DAYS} days.</p>
    </Section>
  );
}
