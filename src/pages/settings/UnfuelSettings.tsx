/**
 * More › Unfuel: the link Unfuel posts fuel fill-ups to (convex/unfuel.ts), and where they go. The
 * link is made here, shown once, and pasted into Unfuel (More › UnMoney). From then on a fill-up
 * sent from Unfuel becomes an expense in the payment method and category picked here.
 */
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { useConfirm } from "@/components/ConfirmDialog";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { AccountPicker, CategoryPicker } from "@/components/tx/pickers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const UNFUEL_URL = ((import.meta.env.VITE_UNFUEL_URL as string | undefined) || "https://unfuel.vikrantbhat.com").replace(/\/$/, "");

type Target = { accountId?: Id<"accounts">; categoryId?: Id<"categories">; subcategoryId?: Id<"categories"> };

export default function UnfuelSettings() {
  const { accountById, categoryById } = useApp();
  const status = useQuery(api.unfuel.linkStatus);
  const createLink = useAction(api.unfuel.createLink);
  const setTarget = useMutation(api.unfuel.setTarget);
  const revoke = useMutation(api.unfuel.revokeLink);
  const confirm = useConfirm();
  // what is picked before there is a link; once there is one, the link's own target is the truth
  const [draft, setDraft] = useState<Target>({});
  const [picking, setPicking] = useState<"account" | "category" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const where: Target = status ?? draft;
  const account = where.accountId ? accountById.get(where.accountId) : undefined;
  const category = where.categoryId ? categoryById.get(where.categoryId) : undefined;
  const sub = where.subcategoryId ? categoryById.get(where.subcategoryId) : undefined;
  // a payment method or category deleted since the link was made: entries would be refused until another is picked
  const broken = !!status && (!account || !!account.deletedAt || !category || !!category.deletedAt);
  const ready = !!where.accountId && !!where.categoryId;

  async function change(next: Target) {
    if (!status) { setDraft(next); return; }
    if (!next.accountId || !next.categoryId) return;
    try {
      await setTarget({ accountId: next.accountId, categoryId: next.categoryId, subcategoryId: next.subcategoryId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change it. Check your connection.");
    }
  }

  async function copyNewLink() {
    if (!where.accountId || !where.categoryId) return;
    if (status && !(await confirm({ title: "Make a new link?", description: "The link Unfuel has now stops working until you paste the new one there.", action: "Make a new link", destructive: false }))) return;
    setBusy(true);
    const made = createLink({ accountId: where.accountId, categoryId: where.categoryId, subcategoryId: where.subcategoryId }).then((r) => r.url);
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

  async function turnOff() {
    if (!(await confirm({ title: "Turn off the Unfuel link?", description: "Fill-ups sent from Unfuel stop arriving. The entries already here stay.", action: "Turn off" }))) return;
    // what was picked stays picked, so turning the link back on is one tap
    if (status) setDraft({ accountId: status.accountId, categoryId: status.categoryId, subcategoryId: status.subcategoryId });
    await revoke({});
    setLink(null);
    setCopied(false);
  }

  return (
    <>
      <PageHeader back="/settings" title="Unfuel" />
      <Page className="pb-10">
        <p className="px-4 pt-4 text-sm text-muted-foreground">
          <a href={UNFUEL_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">Unfuel</a> keeps your fuel log: mileage and cost per kilometre from a photo of the bill and the odometer.
          With a link from here, each fill-up you send from it is added to UnMoney as an expense, so you never type it twice.
        </p>

        <Section title="Where fill-ups go">
          <Row label="Payment method" value={account && !account.deletedAt ? account.name : "Pick one"} onClick={() => setPicking("account")} />
          <Row label="Category" value={category && !category.deletedAt ? (sub ? `${category.name} › ${sub.name}` : category.name) : "Pick one"} onClick={() => setPicking("category")} />
        </Section>
        {broken ? <p className="px-4 pt-2 text-xs text-expense">The payment method or category this link used is gone. Pick another, or fill-ups from Unfuel are refused.</p> : null}

        <Section title="The link">
          <div className="space-y-2 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => void copyNewLink()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{status ? "Copy a new link" : "Copy Unfuel link"}
              </Button>
              {status ? <Button size="sm" variant="ghost" onClick={() => void turnOff()}>Turn off link</Button> : null}
            </div>
            {!ready ? <div className="text-xs text-muted-foreground">Pick a payment method and a category first.</div> : null}
            {link ? (
              <>
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-8 text-xs" aria-label="Unfuel link" />
                <div className="text-xs text-muted-foreground">This is the only time the link is shown. Anyone who has it can add expenses to this payment method, so keep it to yourself.</div>
              </>
            ) : null}
            {status && !link ? (
              <div className="text-xs text-muted-foreground">
                A link is set up (made {new Date(status.createdAt).toLocaleDateString()}).{" "}
                {status.received
                  ? `${status.received} fill-up${status.received === 1 ? "" : "s"} received${status.lastReceivedAt ? `, the last on ${new Date(status.lastReceivedAt).toLocaleDateString()}` : ""}.`
                  : "No fill-up has come through yet."}{" "}
                A new link turns this one off.
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="In Unfuel">
          <ol className="list-decimal space-y-1.5 py-3 pr-4 pl-9 text-sm">
            <li>Open <b>More › UnMoney</b> and paste the link.</li>
            <li>Turn on <b>Send every fill-up</b> to have each one added here on its own, or leave it off and tap <b>Send to UnMoney</b> on the fill-ups you want.</li>
          </ol>
        </Section>
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          A fill-up is added once, in your main currency. Changing or deleting it in Unfuel afterwards does not change the entry here, and the other way round.
        </p>
      </Page>

      <AccountPicker open={picking === "account"} onOpenChange={(o) => !o && setPicking(null)} onPick={(accountId) => void change({ ...where, accountId })} />
      <CategoryPicker open={picking === "category"} onOpenChange={(o) => !o && setPicking(null)} type="expense"
        onPick={(categoryId, subcategoryId) => void change({ ...where, categoryId, subcategoryId })} />
    </>
  );
}
