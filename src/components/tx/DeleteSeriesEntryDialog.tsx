import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/**
 * Deleting an entry that belongs to a repeat or installment series: just this one, or this one and
 * every later one. Open while `open`; `onPick` does the delete.
 */
export function DeleteSeriesEntryDialog({ open, onOpenChange, onPick }: {
  open: boolean; onOpenChange: (open: boolean) => void; onPick: (scope: "one" | "future") => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>This entry belongs to a repeat or installment series.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => onPick("future")}>This and future</AlertDialogAction>
          <AlertDialogAction variant="destructive" onClick={() => onPick("one")}>Only this one</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
