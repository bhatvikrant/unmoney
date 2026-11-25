import { useMemo, useState } from "react";
import { useAction, useConvex } from "convex/react";
import { ConvexError } from "convex/values";
import { Copy, ExternalLink, ScanText, X } from "lucide-react";
import { AiHow } from "@/components/shell/misc";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useApp } from "@/lib/app";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image";
import { isTmpId } from "../../../shared/ops";
import { RECEIPT_MAX_BYTES, RECEIPT_MAX_EDGE, isReceiptMediaType } from "../../../shared/receiptAi";
import { itemLabel, sharesText, splitShares, type Bill } from "../../../shared/billSplit";
import { buildHandoff, canSplit, handoffUrl, withBill } from "@/lib/unsplit";
import type { Tx } from "@/components/tx/TransactionList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;
/** The person splitting the bill: always one of the people, and first, so an odd unit on a shared line is theirs. */
const ME = "Me";

/**
 * What happens next, before leaving for UnSplit: the chosen entries go there as one expense (a line
 * each when there are several), and the browser comes back here once it is saved (src/lib/unsplit.ts).
 * One entry with a photo can first have its bill read by Claude and split by who had what
 * (shared/billSplit.ts); without that, or when the read fails, the entry goes over whole as before.
 */
export function SplitDialog({ open, onOpenChange, txs }: { open: boolean; onOpenChange: (open: boolean) => void; txs: Tx[] }) {
  const { settings, fmt, categoryLabel } = useApp();
  const { user, status, resolveId } = useStore();
  const convex = useConvex();
  const readBill = useAction(api.ai.readBill);
  const chosen = useMemo(() => txs.filter(canSplit), [txs]);
  const skipped = txs.length - chosen.length;
  const relinked = chosen.filter((t) => t.split).length;
  // an entry made offline has no id UnSplit could send back yet
  const unsynced = chosen.filter((t) => isTmpId(t._id)).length;
  const total = chosen.reduce((sum, t) => sum + t.amount, 0);
  const n = chosen.length;

  const one = n === 1 ? chosen[0] : undefined;
  // shortcut: an entry in a second currency is left out, since its bill is in that currency and its amount here is not; check against subAmount if that is ever wanted.
  const canRead = !!one && one.photoIds.length > 0 && !one.subCurrency && !!user?.ai && !!settings.receiptAiEnabled;
  /** The last read and the entry it was of: its bill, or the sentence saying why there is none. */
  const [read, setRead] = useState<{ id: string; bill?: Bill; problem?: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [people, setPeople] = useState([ME]);
  const [name, setName] = useState("");
  /** "item|person" for each person taken off an item: everyone starts on every line, as on UnSplit. */
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  // a bill read for another entry, or before this one's amount was changed, is not this entry's bill
  const mine = read?.id === one?._id ? read : null;
  const bill = mine?.bill && mine.bill.total === one?.amount ? mine.bill : null;
  const who = useMemo(() => bill?.items.map((_, i) => people.filter((p) => !off.has(`${i}|${p}`))) ?? [], [bill, people, off]);
  const shares = bill ? splitShares(bill, people, who) : null;

  /**
   * Nothing is sent until this is tapped. The photo is the entry's first, fetched by the link the server
   * gives only its owner (convex/files.ts urls) and shrunk the way photo reading shrinks it.
   */
  async function readItems() {
    if (!one) return;
    const failed = (problem: string) => setRead({ id: one._id, problem });
    setReading(true);
    setRead(null);
    try {
      const photoId = resolveId(one.photoIds[0]);
      if (isTmpId(photoId)) return failed("The photo has not synced yet.");
      const url = (await convex.query(api.files.urls, { ids: [photoId] }))[photoId];
      const res = url ? await fetch(url, { signal: AbortSignal.timeout(30_000) }) : null;
      const blob = res?.ok ? await res.blob() : null;
      const small = blob ? await compressImage(new File([blob], "bill", { type: blob.type }), RECEIPT_MAX_EDGE) : null;
      if (!small || !isReceiptMediaType(small.type) || small.size > RECEIPT_MAX_BYTES) return failed("That photo can't be read.");
      const r = await readBill({ image: await small.arrayBuffer(), mediaType: small.type, amount: one.amount });
      if (!r.ok) return failed(r.reason);
      setOff(new Set());
      setRead({ id: one._id, bill: r.bill });
    } catch (e) {
      // a sentence meant for the person (turned off, the month's limit); anything else is a read that did not work
      failed(e instanceof ConvexError ? String(e.data) : "Couldn't read the bill from the photo.");
    } finally {
      setReading(false);
    }
  }
  function addPerson() {
    const p = name.replace(/\s+/g, " ").trim();
    if (p && !people.some((x) => x.toLowerCase() === p.toLowerCase())) setPeople([...people, p]);
    setName("");
  }
  const toggle = (key: string) => setOff((s) => { const next = new Set(s); if (!next.delete(key)) next.add(key); return next; });
  // no clipboard on a page that is not served over https
  const copyShares = () => void (navigator.clipboard?.writeText(sharesText(shares ?? [], settings.decimals)) ?? Promise.reject()).then(() => toast.success("Shares copied"), () => toast.error("Couldn't copy the shares"));

  const go = () => {
    const h = buildHandoff(chosen, { currency: settings.mainCurrency, decimals: settings.decimals, categoryLabel });
    if (h) window.location.assign(handoffUrl(bill ? withBill(h, bill, people, who, settings.decimals) : h));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={bill ? "max-h-[calc(100dvh-2rem)] overflow-y-auto" : undefined}>
        <DialogHeader>
          <DialogTitle>Split on UnSplit</DialogTitle>
          <DialogDescription>
            {n === 1 ? `This entry (${fmt(total)}) opens` : `These ${entries(n)} (${fmt(total)} together) open`} in UnSplit as one expense{n > 1 ? ", a line for each, so every line can go to different people" : ""}.
            Pick the group and who paid there. Once it is saved you come back here, and the {n === 1 ? "entry gets" : "entries get"} a link to the split.
          </DialogDescription>
        </DialogHeader>
        {skipped || relinked || unsynced ? (
          <ul className="text-sm text-muted-foreground space-y-1">
            {skipped ? <li>{entries(skipped)} left out: only expenses can be split.</li> : null}
            {relinked ? <li>{relinked === 1 ? "One of them is" : `${relinked} of them are`} already split; the new split replaces that link.</li> : null}
            {unsynced ? <li>{entries(unsynced)} {unsynced === 1 ? "has" : "have"} not synced yet. Try again in a moment.</li> : null}
          </ul>
        ) : null}
        {canRead && !bill ? (
          <div className="space-y-1.5">
            <Button variant="outline" size="sm" onClick={() => void readItems()} disabled={reading || !status.connected}><ScanText className="size-4" />{reading ? "Reading the bill…" : "Read items from the photo"}</Button>
            <p className="text-xs text-muted-foreground">To split it by who had what. This sends the entry's photo to Anthropic's Claude, which lists the items on the bill. <AiHow feature="split" /></p>
            {mine?.problem ? <p role="alert" className="text-sm text-destructive">{mine.problem} You can still split the whole amount.</p> : null}
          </div>
        ) : null}
        {bill ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {people.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs">
                  {p}
                  {p !== ME ? <button type="button" aria-label={`Remove ${p}`} className="relative after:absolute after:-inset-2 after:content-['']" onClick={() => setPeople(people.filter((x) => x !== p))}><X className="size-3" /></button> : null}
                </span>
              ))}
              <form className="flex flex-1 min-w-36 gap-1.5" onSubmit={(e) => { e.preventDefault(); addPerson(); }}>
                <Input aria-label="Add a person" placeholder="Add a person" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
                <Button type="submit" variant="outline" size="sm" disabled={!name.trim()}>Add</Button>
              </form>
            </div>
            <p className="text-xs text-muted-foreground">Everyone starts on every item. Tap a name to take them off one.</p>
            <ul className="divide-y border-y">
              {bill.items.map((it, i) => (
                <li key={i} className="py-2 space-y-1.5">
                  <div className="flex justify-between gap-3"><span className="min-w-0 break-words">{itemLabel(it)}</span><span className="shrink-0 tabular-nums">{fmt(it.amount)}</span></div>
                  <div role="group" aria-label={`Who had ${it.name}`} className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <button key={p} type="button" aria-pressed={who[i].includes(p)} onClick={() => toggle(`${i}|${p}`)} className={cn("rounded-full border px-3 py-1.5 text-xs", who[i].includes(p) && "bg-primary text-primary-foreground border-primary")}>{p}</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {bill.charges.length ? <p className="text-xs text-muted-foreground">{bill.charges.map((c) => `${c.label} ${fmt(c.amount)}`).join(", ")}: spread over the items in proportion.</p> : null}
            {shares ? (
              <dl className="space-y-1">
                {shares.map((s) => <div key={s.name} className="flex justify-between gap-3"><dt>{s.name}</dt><dd className="tabular-nums font-medium">{fmt(s.amount)}</dd></div>)}
              </dl>
            ) : <p role="alert" className="text-destructive">Pick who had each item.</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!shares} onClick={copyShares}><Copy className="size-4" />Copy shares</Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setRead(null)}>Split without the items</Button>
            </div>
            <p className="text-xs text-muted-foreground">UnSplit takes the bill's lines but not who had them. Each line opens there with its tax and tip included and these names beside it, for you to tick the people; the shares go in the expense's notes.</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={n === 0 || unsynced > 0 || (!!bill && !shares)}><ExternalLink className="size-4" />Open UnSplit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
