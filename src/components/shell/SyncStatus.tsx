import { CloudOff, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router";
import { useStore } from "@/lib/store";
import { InfoHint } from "./misc";
import { cn } from "@/lib/utils";

function describe(s: { connected: boolean; pending: number; syncing: boolean; lastError: string | null }) {
  if (!s.connected) return { icon: CloudOff, text: s.pending ? `Offline · ${s.pending} change${s.pending === 1 ? "" : "s"} waiting` : "Offline · saved on this device", tone: "text-muted-foreground" };
  if (s.syncing || s.pending) return { icon: RefreshCw, text: `Syncing ${s.pending} change${s.pending === 1 ? "" : "s"}…`, tone: "text-primary" };
  if (s.lastError) return { icon: AlertTriangle, text: "Last sync had a problem", tone: "text-destructive" };
  return { icon: Check, text: "Synced", tone: "text-muted-foreground" };
}

/** One line for the desktop sidebar. */
export function SyncLine({ className }: { className?: string }) {
  const { status } = useStore();
  const d = describe(status);
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 text-[11px]", d.tone, className)} aria-live="polite">
      <d.icon className={cn("size-3.5 shrink-0", status.syncing && "animate-spin")} />
      <span className="truncate">{d.text}</span>
    </div>
  );
}

/**
 * Phones (no sidebar): a line under the page header while offline or after a sync problem, saying
 * what waits ("Offline · 3 changes waiting"). Tapping it opens More, where sync is explained.
 */
export function SyncStrip() {
  const { status } = useStore();
  const nav = useNavigate();
  const problem = status.connected && !!status.lastError && !status.pending;
  if (status.connected && !problem) return null;
  const d = describe(status);
  return (
    <button type="button" onClick={() => nav("/settings")} aria-live="polite"
      className={cn("md:hidden flex w-full items-center justify-center gap-1.5 border-t px-4 py-1 text-xs bg-muted/50", d.tone)}>
      <d.icon className="size-3.5 shrink-0" />
      <span className="truncate">{d.text}</span>
    </button>
  );
}

/** A line under the user's name in Settings; the (i) explains how syncing works, or what went wrong. */
export function SyncBadge({ className }: { className?: string }) {
  const { status } = useStore();
  const d = describe(status);
  const problem = status.lastError && status.connected && !status.pending;
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", d.tone, className)} aria-live="polite">
      <d.icon className={cn("size-3.5 shrink-0", status.syncing && "animate-spin")} />
      <span className="min-w-0 truncate">{d.text}</span>
      <InfoHint
        label="About sync"
        text={problem ? status.lastError : "Everything you add, edit or delete is saved on this device first and sent to the server when you are online, so it shows up on your other devices."}
      />
    </div>
  );
}
