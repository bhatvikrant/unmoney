import { useEffect, useState } from "react";
import { todayISO } from "../../shared/dates";

/** Today's date, moving on at midnight (checked each minute and whenever the app comes back to the front). */
export function useToday(): string {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const check = () => setToday(todayISO());
    const timer = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, []);
  return today;
}
