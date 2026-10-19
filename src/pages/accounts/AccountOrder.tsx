import { useOp } from "@/lib/store";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router";
import { NO_GROUP, NO_GROUP_NAME } from "../../../shared/views";

export default function AccountOrder() {
  const nav = useNavigate();
  const { accounts, groups } = useApp();
  const reorder = useOp("accounts.reorder");
  const setHidden = useOp("accounts.setHidden");
  const live = groups.filter((g) => !g.deletedAt).sort((a, b) => a.order - b.order);
  // Archived methods keep their place but are left out here (they are listed under Archived on the Payment methods tab).
  const ordered = accounts.filter((a) => !a.archivedAt).sort((a, b) => a.order - b.order);
  const commit = (list: typeof ordered) => reorder({ items: list.map((a) => ({ id: a._id, groupId: a.groupId })) });
  const move = (id: string, dir: -1 | 1) => {
    const inGroup = ordered.filter((a) => a.groupId === ordered.find((x) => x._id === id)!.groupId);
    const i = inGroup.findIndex((a) => a._id === id);
    const j = i + dir;
    if (j < 0 || j >= inGroup.length) return;
    const list = [...ordered];
    const ai = list.indexOf(inGroup[i]);
    const aj = list.indexOf(inGroup[j]);
    [list[ai], list[aj]] = [list[aj], list[ai]];
    commit(list);
  };
  const changeGroup = (id: string, groupId: string) => commit(ordered.map((a) => (a._id === id ? { ...a, groupId: groupId === NO_GROUP ? undefined : (groupId as Id<"accountGroups">) } : a)));
  const sections = [...live.map((g) => ({ id: g._id as string, name: g.name })), { id: NO_GROUP, name: NO_GROUP_NAME }];
  return (
    <>
      <PageHeader back="/payment-methods" title="Order & visibility" right={<Button variant="ghost" size="sm" onClick={() => nav("/settings/groups")}>Groups</Button>} />
      <Page className="pb-8">
        {sections.map((g) => {
          const items = ordered.filter((a) => (a.groupId ?? NO_GROUP) === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} className="mt-3">
              <div className="px-4 py-1 text-xs text-muted-foreground">{g.name}</div>
              <div className="bg-card border-y">
                {items.map((a) => (
                  <div key={a._id} className="flex items-center gap-1 px-2 py-1.5 border-b last:border-b-0 text-sm">
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Up" onClick={() => move(a._id, -1)}><ArrowUp className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Down" onClick={() => move(a._id, 1)}><ArrowDown className="size-4" /></Button>
                    <span className="flex-1 truncate px-1">{a.name}</span>
                    <Select value={a.groupId ?? NO_GROUP} onValueChange={(v) => changeGroup(a._id, v)}><SelectTrigger className="h-7 w-32 text-xs" aria-label={`Group of ${a.name}`}><SelectValue /></SelectTrigger><SelectContent>{sections.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={a.hidden ? "Show" : "Hide"} onClick={() => setHidden({ id: a._id, hidden: !a.hidden })}>{a.hidden ? <EyeOff className="size-4 text-muted-foreground" /> : <Eye className="size-4" />}</Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <p className="px-4 py-3 text-xs text-muted-foreground">Hidden payment methods stay in the totals but disappear from lists and pickers.</p>
      </Page>
    </>
  );
}
