import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section, EmptyState } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";

export default function DeletedAccounts() {
  const data = useQuery(api.accounts.listDeleted);
  const restore = useMutation(api.accounts.restore);
  const purge = useMutation(api.accounts.permanentlyDelete);
  const restoreGroup = useMutation(api.accountGroups.restore);
  return (
    <>
      <PageHeader back="/settings" title="Deleted accounts" />
      <Page>
        {data && !data.accounts.length && !data.groups.length ? <EmptyState title="Nothing deleted" /> : null}
        {data?.accounts.length ? (
          <Section title="Accounts">
            {data.accounts.map((a) => (
              <Row key={a._id} label={a.name} hint={a.groupName} right={<div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => restore({ id: a._id })}>Restore</Button><Button size="sm" variant="destructive" onClick={async () => { if (window.confirm(`Permanently delete ${a.name} and all its transactions?`)) { await purge({ id: a._id }); toast.success("Deleted"); } }}>Delete</Button></div>} />
            ))}
          </Section>
        ) : null}
        {data?.groups.length ? (
          <Section title="Account groups">
            {data.groups.map((g) => <Row key={g._id} label={g.name} right={<Button size="sm" variant="outline" onClick={() => restoreGroup({ id: g._id })}>Restore</Button>} />)}
          </Section>
        ) : null}
      </Page>
    </>
  );
}
