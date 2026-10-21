/**
 * A change in plain words, for the toast when the server turns it down: "Your edit to “Coffee”",
 * "Deleting 3 entries". Worked out from the op alone, since what it changed may be gone by then.
 */
const NOUNS: Record<string, string> = {
  transactions: "entry", accounts: "payment method", accountGroups: "group", categories: "category", budgets: "budget",
  notes: "note", bookmarks: "bookmark", repeats: "repeat", currencies: "currency", drafts: "Gmail draft", settings: "settings",
};

export function opLabel(kind: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const note = typeof a.note === "string" && a.note.trim() ? `“${a.note.trim()}”` : "";
  const count = Array.isArray(a.ids) ? a.ids.length : 0;
  switch (kind) {
    case "transactions.create": return note ? `The new entry ${note}` : "A new entry";
    case "transactions.update": return note ? `Your edit to ${note}` : "Your edit to an entry";
    case "transactions.remove": return "Deleting an entry";
    case "transactions.bulkRemove": return `Deleting ${count} ${count === 1 ? "entry" : "entries"}`;
    case "transactions.bulkUpdate": return `Changing ${count} ${count === 1 ? "entry" : "entries"}`;
    case "transactions.importRows": return "An import";
    case "files.upload": return "A photo upload";
    case "backup.restore": return "Restoring a backup";
  }
  const [table, verb = ""] = kind.split(".");
  const noun = NOUNS[table] ?? "item";
  const an = /^[aeiou]/i.test(noun) ? "an" : "a";
  if (table === "settings") return "A settings change";
  if (/^(create|add|upsert)$/.test(verb)) return `A new ${noun}`;
  if (/^(remove|delete|permanentlyDelete)$/.test(verb)) return `Deleting ${an} ${noun}`;
  return `A change to ${an} ${noun}`;
}
