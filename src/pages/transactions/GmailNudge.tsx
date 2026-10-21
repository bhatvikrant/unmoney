/**
 * On the ledger, under the recap card: how many drafts from Gmail wait in the month shown, with
 * the way to the review page; or, when the connection broke, the way to reconnect. One tappable
 * line, never a card or a dialog, so the ledger keeps the screen (spec §6.1).
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { ChevronRight, Mail } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useView } from "@/lib/store";
import { draftMatches, draftsRange } from "../../../shared/views";
import { cn } from "@/lib/utils";

export function GmailNudge({ from, to }: { from: string; to: string }) {
  const nav = useNavigate();
  const view = useView();
  // online only: offline the card says what the local copy knows and nothing about the connection
  const status = useQuery(api.gmail.status);
  const here = useMemo(() => draftsRange(view, from, to).length, [view, from, to]);
  const matched = useMemo(() => draftMatches(view).size, [view]);
  if (status?.connected && status.status === "reauth") {
    return <Strip warn label="Gmail needs reconnecting" action="Reconnect" onClick={() => nav("/settings/gmail")} />;
  }
  if (!here && !matched) return null;
  const label = here ? `${here} ${here === 1 ? "entry" : "entries"} found in Gmail` : `Gmail found ${matched} you may already have`;
  // the "may already be added" count rides along, muted, so the strip stays one line
  const extra = here && matched ? `+${matched} maybe added` : undefined;
  return <Strip label={label} extra={extra} action="Review" onClick={() => nav("/gmail")} />;
}

/** One tappable line, like the "Filtered" strip under the summary bar: the whole row is the target. */
function Strip({ label, extra, action, warn, onClick }: { label: string; extra?: string; action: string; warn?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 border-b bg-muted/50 px-4 py-2 text-left text-xs active:bg-muted", warn && "text-destructive")}>
      <Mail className="size-3.5 shrink-0" />
      <span className="truncate font-medium">{label}</span>
      {extra ? <span className="shrink-0 text-muted-foreground">· {extra}</span> : null}
      <span className="ml-auto flex shrink-0 items-center text-muted-foreground">{action}<ChevronRight className="size-3.5" /></span>
    </button>
  );
}
