import { BellRing } from "lucide-react";
import { useState } from "react";
import { play } from "@/lib/sound";
import { cn } from "@/lib/utils";

const seen = (key: string) => {
  try {
    if (localStorage.getItem(key)) return true;
    localStorage.setItem(key, "1");
  } catch {
    // no storage: wobble every visit
  }
  return false;
};

/**
 * A small bell for a good-news line. With `once`, it wobbles the first time this device shows that
 * line (the key is remembered) and stays still after. It makes no sound by itself, since nothing
 * plays on load; tapping it rings it.
 */
export function Bell({ once, className }: { once?: string; className?: string }) {
  const [ringing, setRinging] = useState(() => (once ? !seen(once) : false));
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={(e) => {
        e.stopPropagation();
        setRinging(false);
        requestAnimationFrame(() => setRinging(true));
        play("bell");
      }}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
    >
      <BellRing className={cn("size-[1em]", ringing && "bell-ring")} onAnimationEnd={() => setRinging(false)} aria-hidden />
    </button>
  );
}
