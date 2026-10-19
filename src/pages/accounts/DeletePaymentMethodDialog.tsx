import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp } from "@/lib/store";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** Asks before deleting a payment method (its transactions stay, and it can be restored). Open while `method` is set. */
export function DeletePaymentMethodDialog({ method, onOpenChange, onDeleted }: {
  method: { _id: Id<"accounts">; name: string } | null; onOpenChange: (open: boolean) => void; onDeleted?: () => void;
}) {
  const remove = useOp("accounts.remove");
  return (
    <AlertDialog open={!!method} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete {method?.name}?</AlertDialogTitle><AlertDialogDescription>Its transactions are kept. You can restore it from Settings › Deleted payment methods.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={async () => {
            try { await remove({ id: method!._id }); onDeleted?.(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete it"); }
          }}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
