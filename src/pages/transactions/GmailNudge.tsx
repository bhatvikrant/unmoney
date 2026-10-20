/**
 * On the ledger, under the recap card: how many drafts from Gmail wait in the month shown, with
 * the way to the review page; or, when the connection broke, the way to reconnect. A card, never
 * a dialog, like the recap nudge.
 */
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { Mail } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useView } from "@/lib/store";
import { draftsRange } from "../../../shared/views";
import { Button } from "@/components/ui/button";

export function GmailNudge({ from, to }: { from: string; to: string }) {
  const nav = useNavigate();
  const view = useView();
  // online only: offline the card says what the local copy knows and nothing about the connection
  const status = useQuery(api.gmail.status);
  const here = useMemo(() => draftsRange(view, from, to).length, [view, from, to]);
  const matched = useMemo(() => view.drafts.filter((d) => d.status === "open" && !!d.matchedTransactionId).length, [view]);
  if (status?.connected && status.status === "reauth") {
    return (
      <Card title="Gmail needs reconnecting" hint="Google no longer accepts the saved access, so new money mail is not being read.">
        <Button size="sm" onClick={() => nav("/settings/gmail")}>Reconnect</Button>
      </Card>
    );
  }
  if (!here && !matched) return null;
  const title = here ? `${here} ${here === 1 ? "entry" : "entries"} found in Gmail` : `Gmail found ${matched} ${matched === 1 ? "entry" : "entries"} you may already have`;
  const hint = here
    ? `Tap a faded row to check it and save, or review them all.${matched ? ` ${matched} more may already be added.` : ""}`
    : "Each one looks like an entry you typed in. Say whether it is the same or new.";
  return (
    <Card title={title} hint={hint}>
      <Button size="sm" onClick={() => nav("/gmail")}>Review</Button>
    </Card>
  );
}

function Card({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="mx-3 my-2.5 flex items-start gap-3 rounded-lg border bg-card p-3 pl-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Mail className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        <div className="mt-2.5 flex gap-2">{children}</div>
      </div>
    </div>
  );
}
