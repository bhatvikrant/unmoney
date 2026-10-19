import { useMemo } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { accountsListDeleted } from "../../../shared/views";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section, EmptyState } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";

export default function DeletedAccounts() {
  const view = useView();
  const data = useMemo(() => accountsListDeleted(view), [view]);
  const restore = useOp("accounts.restore");
  const purge = useOp("accounts.permanentlyDelete");
  const confirm = useConfirm();
  const restoreGroup = useOp("accountGroups.restore");
  const swipe = useSwipedRow();
  // Gone for good, so it always asks first, from the button or a swipe.
  const del = (a: { _id: Id<"accounts">; name: string }) =>
    confirm({ title: `Permanently delete ${a.name}?`, description: "This also deletes all its transactions. This cannot be undone." })
      .then(async (ok) => { if (ok) await purge({ id: a._id }); }).finally(swipe.close);
  return (
    <>
      <PageHeader back="/settings/payment-methods" title="Deleted payment methods" />
      <Page>
        {data && !data.accounts.length && !data.groups.length ? <EmptyState title="Nothing deleted" /> : null}
        {data?.accounts.length ? (
          <Section title="Payment methods">
            {data.accounts.map((a) => (
              <SwipeToDelete key={a._id} className="border-b last:border-b-0" {...swipe.row(a._id)} onDelete={() => void del(a)}>
                <Row label={a.name} hint={a.groupName} right={<div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => restore({ id: a._id })}>Restore</Button><Button size="sm" variant="destructive" onClick={() => void del(a)}>Delete</Button></div>} />
              </SwipeToDelete>
            ))}
          </Section>
        ) : null}
        {data?.groups.length ? (
          <Section title="Groups">
            {data.groups.map((g) => <Row key={g._id} label={g.name} right={<Button size="sm" variant="outline" onClick={() => restoreGroup({ id: g._id })}>Restore</Button>} />)}
          </Section>
        ) : null}
      </Page>
    </>
  );
}
