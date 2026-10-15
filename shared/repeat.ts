import { addDays, addMonths, addYears, clampDay, make, parts, type ISODate } from "./dates";

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

/** Next date after `current` on the schedule anchored at `start`. Monthly/yearly keep the anchor's day of month. */
export function nextOccurrence(current: ISODate, start: ISODate, frequency: Frequency): ISODate {
  switch (frequency) {
    case "daily":
      return addDays(current, 1);
    case "weekly":
      return addDays(current, 7);
    case "biweekly":
      return addDays(current, 14);
    case "monthly": {
      const anchor = parts(start).d;
      const n = parts(addMonths(make(parts(current).y, parts(current).m, 1), 1));
      return make(n.y, n.m, clampDay(n.y, n.m, anchor));
    }
    case "yearly": {
      const a = parts(start);
      const c = parts(current);
      const y = c.y + 1;
      return make(y, a.m, clampDay(y, a.m, a.d));
    }
  }
}

export function addYearsSafe(d: ISODate, n: number): ISODate {
  return addYears(d, n);
}
