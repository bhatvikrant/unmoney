import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, Sprout } from "lucide-react";
import { useView } from "@/lib/store";
import { sipsInRange } from "../../../shared/sips";
import { Money } from "@/components/shell/Money";

/**
 * Payments filed under a SIP are not on the ledger, so the month says where they went: one quiet
 * line, shaped like the Gmail strip, that opens the SIPs page. Nothing when the month has none.
 */
export function SipNudge({ from, to }: { from: string; to: string }) {
  const snap = useView();
  const nav = useNavigate();
  const { total, count } = useMemo(() => sipsInRange(snap, from, to), [snap, from, to]);
  if (!count) return null;
  return (
    <button type="button" onClick={() => nav("/sips")} className="flex w-full items-center gap-2 border-b bg-muted/40 px-4 py-2 text-left text-xs text-muted-foreground active:bg-muted">
      <Sprout className="size-3.5 shrink-0" />
      <span className="truncate" title={`${count} payment${count === 1 ? "" : "s"} into SIPs, not counted as spending`}><Money amount={total} className="font-medium text-foreground" /> into SIPs · not spending</span>
      <span className="ml-auto flex shrink-0 items-center">SIPs<ChevronRight className="size-3.5" /></span>
    </button>
  );
}
