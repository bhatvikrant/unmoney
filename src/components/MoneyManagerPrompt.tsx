/**
 * Two nudges toward the import screen: a one-time "Coming from Money Manager?" dialog for a new
 * account with no entries, and a toast when the iPhone shortcut has dropped a file in the inbox.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useStore, useView } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const seenKey = (userId: string) => `unmoney.mmPromptSeen.${userId}`;

function wasSeen(userId: string): boolean {
  try {
    return !!localStorage.getItem(seenKey(userId));
  } catch {
    return false;
  }
}

function markSeen(userId: string) {
  try {
    localStorage.setItem(seenKey(userId), "1");
  } catch {
    // private mode: the prompt may show again next time
  }
}

export function MoneyManagerPrompt() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { userId, status } = useStore();
  const view = useView();
  const [open, setOpen] = useState(false);
  const empty = view.transactions.length === 0;
  // Wait for the server's copy so a returning user on a new device is not asked.
  const eligible = !!userId && status.live && empty && pathname !== "/import" && !wasSeen(userId);

  useEffect(() => {
    if (!eligible) return;
    const t = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(t);
  }, [eligible]);

  function close(go: boolean) {
    if (userId) markSeen(userId);
    setOpen(false);
    if (go) nav("/import");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted"><ArrowRightLeft className="size-5" /></div>
          <DialogTitle>Coming from Money Manager?</DialogTitle>
          <DialogDescription>
            Bring over your payment methods, categories and every entry from Money Manager's Excel export. You see what will be added before anything is imported.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => close(false)}>Start fresh</Button>
          <Button onClick={() => close(true)}>Import from Money Manager</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Toast once per file the shortcut sends, unless the import screen is already open. */
export function usePendingImportToasts() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const pending = useQuery(api.imports.pending);
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (!pending || pathname === "/import") return;
    for (const p of pending) {
      if (shown.current.has(p._id)) continue;
      shown.current.add(p._id);
      toast("A file arrived from your shortcut", {
        description: p.name,
        duration: 15000,
        action: { label: "Review", onClick: () => nav(`/import?pending=${p._id}`) },
      });
    }
  }, [pending, pathname, nav]);
}
