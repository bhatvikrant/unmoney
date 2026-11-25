/**
 * AI insights for a recap, in a sheet over the story. Nothing is sent until the person taps "Get
 * insights" under the text that says what goes to Claude; the answer is stored on the server
 * (convex/recapAi.ts), so the sheet shows it again whenever the recap is reopened. For a month it
 * also lists suggested budgets, each set with one tap through the ordinary budget op, starting with
 * the current month so past months keep what they had. The page only offers the sheet once the
 * server has answered: offline, the recap is as it always was.
 */
import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { StoredInsights } from "../../../convex/recapAi";
import { monthKeyForDate } from "../../../shared/period";
import { buildRecapFacts, fillMoney } from "../../../shared/recapAi";
import { useOp, useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { monthLabel } from "@/lib/format";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { AiHow } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";

export function RecapInsights({ recapKey, stored, open, onOpenChange }: { recapKey: string; stored: StoredInsights | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const view = useView();
  const { status: sync } = useStore();
  const { fmt, settings, categoryById } = useApp();
  const today = useToday();
  const ask = useAction(api.recapAi.ask);
  const upsert = useOp("budgets.upsert");
  const [state, setState] = useState<{ kind: "idle" | "running" | "error"; text?: string }>({ kind: "idle" });
  // the server found the facts unchanged after all (it is the judge): stop offering a new run
  const [same, setSame] = useState(false);
  // the same fingerprint the server keeps with the answer: a different one means entries changed since
  const hash = useMemo(() => (open && stored ? buildRecapFacts(view, recapKey)?.hash : undefined), [open, stored, view, recapKey]);
  const changed = !!stored && !!hash && hash !== stored.hash && !same;
  const year = recapKey.length === 4;
  const from = monthKeyForDate(today, settings.monthStartDay);
  // a category deleted or archived since is not offered a budget
  const budgets = (stored?.budgets ?? []).flatMap((b) => {
    const c = categoryById.get(b.categoryId);
    if (!c || c.deletedAt || c.archivedAt) return [];
    const now = view.budgets.find((x) => x.period === "monthly" && x.categoryId === b.categoryId)?.amount;
    return [{ ...b, name: c.name, now }];
  });

  async function run() {
    setState({ kind: "running" });
    try {
      const res = await ask({ key: recapKey });
      if (stored && res.hash === stored.hash) setSame(true);
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", text: e instanceof ConvexError ? String(e.data) : "Couldn't get insights. Try again later." });
    }
  }
  const blocked = !sync.connected ? "Insights need a connection" : sync.pending ? "Syncing your changes… try again in a moment" : "";
  const running = state.kind === "running";
  const askButton = (label: string) => (
    <Button className="flex-1" disabled={running || !!blocked} onClick={() => void run()}>
      {running ? <Loader2 className="animate-spin" /> : null}{running ? "Reading your recap…" : label}
    </Button>
  );

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="AI insights">
      <div className="space-y-3 px-2 pb-2 text-sm">
        {stored ? (
          <>
            <ul className="space-y-2.5">
              {stored.insights.map((s) => <li key={s} className="rounded-lg border bg-card px-3 py-2.5">{fillMoney(s, fmt)}</li>)}
            </ul>
            {budgets.length ? (
              <div>
                <div className="pt-1 pb-1.5 text-xs font-medium text-muted-foreground">Suggested budgets, from {monthLabel(from)}</div>
                <ul className="divide-y rounded-lg border bg-card">
                  {budgets.map((b) => (
                    <li key={b.categoryId} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{b.name} · {fmt(b.amount)}</div>
                        <div className="text-xs text-muted-foreground">{[b.now !== undefined && b.now !== b.amount ? `Now ${fmt(b.now)}` : "", fillMoney(b.why, fmt)].filter(Boolean).join(" · ")}</div>
                      </div>
                      {b.now === b.amount
                        ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" />Set</span>
                        : <Button size="sm" variant="outline" className="h-8" onClick={() => void upsert({ categoryId: b.categoryId, period: "monthly", amount: b.amount, from })}>Set</Button>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">Written by Claude from this {year ? "year's" : "month's"} totals. The figures are UnMoney's own. <AiHow feature="recap" /></p>
            {changed ? (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">{blocked || "Your entries have changed since this was written. Asking again sends the same kind of summary."}</p>
                <div className="flex">{askButton("Ask again")}</div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              To point out what stands out{year ? "" : " and suggest next month's budgets"}, UnMoney sends Anthropic's Claude a summary of this{" "}
              {year ? "year and the two before it" : "month and the five before it"}: totals spent and received, your largest categories by name with
              what went out under each, your budgets and whether they held, and the notes you logged most often. It does not send individual
              entries, dates, accounts or photos. Nothing changes until you set a budget yourself. <AiHow feature="recap" />
            </p>
            {blocked ? <p className="text-xs text-muted-foreground">{blocked}</p> : null}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Not now</Button>
              {askButton(state.kind === "error" ? "Try again" : "Get insights")}
            </div>
          </>
        )}
        {state.kind === "error" ? <p className="text-xs text-destructive" role="alert">{state.text}</p> : null}
      </div>
    </BottomSheet>
  );
}
