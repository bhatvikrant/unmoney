import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router";

export default function AccountOrder() {
  const nav = useNavigate();
  const { accounts, groups } = useApp();
  const reorder = useMutation(api.accounts.reorder);
  const setHidden = useMutation(api.accounts.setHidden);
  const live = groups.filter((g) => !g.deletedAt).sort((a, b) => a.order - b.order);
  const ordered = [...accounts].sort((a, b) => a.order - b.order);
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
  const changeGroup = (id: string, groupId: string) => commit(ordered.map((a) => (a._id === id ? { ...a, groupId: groupId as Id<"accountGroups"> } : a)));
  return (
    <>
      <PageHeader back="/accounts" title="Order & visibility" right={<Button variant="ghost" size="sm" onClick={() => nav("/settings/account-groups")}>Groups</Button>} />
      <Page className="pb-8">
        {live.map((g) => {
          const items = ordered.filter((a) => a.groupId === g._id);
          if (!items.length) return null;
          return (
            <div key={g._id} className="mt-3">
              <div className="px-4 py-1 text-xs text-muted-foreground">{g.name}</div>
              <div className="bg-card border-y">
                {items.map((a) => (
                  <div key={a._id} className="flex items-center gap-1 px-2 py-1.5 border-b last:border-b-0 text-sm">
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Up" onClick={() => move(a._id, -1)}><ArrowUp className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Down" onClick={() => move(a._id, 1)}><ArrowDown className="size-4" /></Button>
                    <span className="flex-1 truncate px-1">{a.name}</span>
                    <Select value={a.groupId} onValueChange={(v) => changeGroup(a._id, v)}><SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent>{live.map((x) => <SelectItem key={x._id} value={x._id}>{x.name}</SelectItem>)}</SelectContent></Select>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={a.hidden ? "Show" : "Hide"} onClick={() => setHidden({ id: a._id, hidden: !a.hidden })}>{a.hidden ? <EyeOff className="size-4 text-muted-foreground" /> : <Eye className="size-4" />}</Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <p className="px-4 py-3 text-xs text-muted-foreground">Hidden accounts stay in the totals but disappear from lists and pickers.</p>
      </Page>
    </>
  );
}
