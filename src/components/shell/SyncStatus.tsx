import { CloudOff, RefreshCw, Check, AlertTriangle } from "lucide-react";
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

/** A dot on the mobile "More" tab when something is pending or the app is offline. */
export function SyncDot() {
  const { status } = useStore();
  if (status.connected && !status.pending && !status.lastError) return null;
  return <span className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", !status.connected ? "bg-muted-foreground" : status.lastError && !status.pending ? "bg-destructive" : "bg-primary")} aria-hidden />;
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
