/**
 * On the ledger, under the recap card: how many drafts from Gmail wait in the month shown, with
 * the way to the review page; or, when the connection broke, the way to reconnect. One tappable
 * line, never a card or a dialog, so the ledger keeps the screen (spec §6.1).
 */
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
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
  const update = useMutation(api.gmail.updateSettings);
  if (status?.connected && status.status === "reauth") {
    return <Strip warn label="Gmail needs reconnecting" action="Reconnect" onClick={() => nav("/settings/gmail")} />;
  }
  // stopped after failing several times in a row (a warning), or paused by the user (a quiet reminder)
  if (status?.connected && status.status === "paused") {
    const resume = () => update({ paused: false }).then(() => toast.success("Gmail checks resumed"), () => toast.error("Could not resume. Try again from Settings › Gmail."));
    return status.lastError
      ? <Strip warn label={`Gmail checks stopped: ${status.lastError}`} action="Resume" onClick={() => void resume()} />
      : <Strip muted label="Gmail checks paused" action="Resume" onClick={() => void resume()} />;
  }
  if (!here && !matched) return null;
  const label = here ? `${here} ${here === 1 ? "entry" : "entries"} found in Gmail` : `Gmail found ${matched} you may already have`;
  // the "may already be added" count rides along, muted, so the strip stays one line
  const extra = here && matched ? `+${matched} maybe added` : undefined;
  return <Strip label={label} extra={extra} action="Review" onClick={() => nav("/gmail")} />;
}

const CHECK_AFTER_MS = 15 * 60_000;

/**
 * New money mail without waiting for the hourly check: when the app opens or comes back to the
 * front and the last check is over 15 minutes old, check now (the server allows one a minute).
 */
export function useGmailCheckOnFocus() {
  const status = useQuery(api.gmail.status);
  const syncNow = useAction(api.gmail.syncNow);
  const latest = useRef(status);
  const tried = useRef(0);
  useEffect(() => { latest.current = status; }, [status]);
  const ready = !!status?.connected && status.status === "ok";
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const s = latest.current;
      if (document.visibilityState !== "visible" || !s?.connected || s.status !== "ok" || s.syncing) return;
      const now = Date.now();
      if (now - (s.lastSyncAt ?? 0) < CHECK_AFTER_MS || now - tried.current < CHECK_AFTER_MS) return;
      tried.current = now;
      void syncNow().catch(() => {});
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, [ready, syncNow]);
}

/**
 * One tappable line, shaped like the "Filtered" strip under the summary bar: the whole row is the
 * target. Tinted amber like the other Gmail notices (red when it is a warning, grey when it only
 * reminds), whatever the accent, so it does not read as a day header.
 */
function Strip({ label, extra, action, warn, muted, onClick }: { label: string; extra?: string; action: string; warn?: boolean; muted?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 border-b px-4 py-2 text-left text-xs", warn ? "bg-destructive/10 text-destructive active:bg-destructive/20" : muted ? "bg-muted/40 text-muted-foreground active:bg-muted" : "bg-amber-50 active:bg-amber-100 dark:bg-amber-950/30 dark:active:bg-amber-950/50")}>
      <Mail className={cn("size-3.5 shrink-0", !warn && !muted && "text-amber-600 dark:text-amber-400")} />
      <span className="truncate font-medium">{label}</span>
      {extra ? <span className="shrink-0 text-muted-foreground">· {extra}</span> : null}
      <span className="ml-auto flex shrink-0 items-center text-muted-foreground">{action}<ChevronRight className="size-3.5" /></span>
    </button>
  );
}
