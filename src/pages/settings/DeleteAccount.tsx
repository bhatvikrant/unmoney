import { useState } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useStore } from "@/lib/store";
import { backupExport } from "../../../shared/views";
import { downloadText } from "@/lib/csv";
import { clearUnlock } from "@/lib/passcode";
import { Row } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** Delete the account and everything in it, on the server and on this device. */
export function DeleteAccountRow() {
  const { status, clearLocal, view } = useStore();
  const { signOut } = useAuthActions();
  const deleteAccount = useMutation(api.account.deleteMyAccount);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await deleteAccount({ confirm: "DELETE" });
      clearUnlock();
      await clearLocal();
      await signOut();
      toast.success("Your account and all its data are being deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the account");
      setBusy(false);
    }
  }

  return (
    <>
      <Row label="Delete account" hint="Your entries, accounts, photos and sign-in, for good" right={<Button size="sm" variant="destructive" onClick={() => { setTyped(""); setOpen(true); }}>Delete</Button>} />
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your UnMoney account?</AlertDialogTitle>
            <AlertDialogDescription>
              Every entry, account, budget, note and receipt photo is deleted from the server and from this device, and you are signed out. This cannot be undone; download a backup first if you may want it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => downloadText(`UnMoney-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backupExport(view), null, 1), "application/json")}>Download backup</Button>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm" autoComplete="off" />
          {!status.connected ? <p className="text-xs text-destructive">Deleting needs a connection.</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={typed.trim() !== "DELETE" || !status.connected || busy} onClick={() => void confirm()}>{busy ? "Deleting…" : "Delete account"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
