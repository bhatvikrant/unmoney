import { useLocation, useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Id } from "../../../convex/_generated/dataModel";

/** Everything about payment methods that is not the list itself: defaults, groups, order, what counts, deleted ones. */
export default function PaymentMethodsSettings() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { settings: s, accounts, archivedAccounts } = useApp();
  const update = useOp("settings.update");
  const setDefaultAccount = useOp("settings.setDefaultAccount");
  const visibleAccounts = accounts.filter((a) => !a.hidden && !a.archivedAt);
  const defaultAccount = visibleAccounts.some((a) => a._id === s.defaultAccountId) ? s.defaultAccountId! : "first";
  const link = (label: string, to: string, value?: string, info?: string) => <Row label={label} value={value} info={info} active={pathname === to || pathname.startsWith(`${to}/`)} onClick={() => nav(to)} right={<ChevronRight className="size-4 text-muted-foreground" />} />;
  return (
    <>
      <PageHeader back="/settings" title="Payment methods" />
      <Page className="pb-8">
        <Section title="Defaults">
          <Row label="Default payment method" info="The payment method a new entry starts on. You can still pick another one on the entry itself. With no default, new entries start on the first visible one." right={
            <Select value={defaultAccount} onValueChange={(v) => setDefaultAccount({ id: v === "first" ? undefined : (v as Id<"accounts">) })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="first">First in list</SelectItem>{visibleAccounts.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
          } />
          <Row label="Card expenses display" hint="At the time, or as a lump sum on the payment date" info="At the time: a credit-card purchase counts as an expense on the day you make it. Lump sum: card purchases count as transfers until you pay the card off, and the payment to the card is what counts as the expense." right={
            <Select value={s.cardExpenseDisplay} onValueChange={(v) => update({ patch: { cardExpenseDisplay: v as "atTime" | "lumpSum" } })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="atTime">At the time</SelectItem><SelectItem value="lumpSum">Lump sum</SelectItem></SelectContent></Select>
          } />
        </Section>
        <Section title="Organise">
          {link("Groups", "/settings/groups", undefined, "Folders for your payment methods. Deleting one moves its methods to No group.")}
          {link("Order & visibility", "/payment-methods/order")}
          {link("Totals & visibility", "/settings/transfer-expense", undefined, "Per payment method: whether it counts in your totals, whether it is shown, and whether money moved into it (savings, loans, investments) counts as spending.")}
        </Section>
        <Section>
          {link("Deleted payment methods", "/settings/deleted-payment-methods", archivedAccounts.length ? `${archivedAccounts.length}` : undefined, "Payment methods you have deleted, with their transactions kept. Restore one to bring it back, or delete it permanently.")}
        </Section>
      </Page>
    </>
  );
}
