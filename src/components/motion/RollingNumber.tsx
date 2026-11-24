import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { playTicks } from "@/lib/sound";

/**
 * A formatted number whose digits roll to their new value like an odometer when it changes.
 * Digits are matched from the right, so "₹999" → "₹1,000" rolls the units, tens and hundreds and
 * adds the new ones. Screen readers get the plain text. The first render doesn't animate, and
 * with reduced motion the digits jump.
 *
 * `ticks`: play one quiet tick per digit that changed. Only pass it where the change follows the
 * person's own action.
 */
export function RollingNumber({ value, className, ticks }: { value: string; className?: string; ticks?: boolean }) {
  const prev = useRef(value);
  const still = useReducedMotion() ?? false;
  useEffect(() => {
    if (prev.current === value) return;
    if (ticks) playTicks(changedDigits(prev.current, value));
    prev.current = value;
  }, [value, ticks]);

  const chars = [...value];
  return (
    <span className={cn("tabular relative inline-block whitespace-nowrap", className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden>
        {chars.map((ch, i) => {
          const fromRight = chars.length - i;
          return /\d/.test(ch) ? <Digit key={`d${fromRight}`} d={Number(ch)} order={fromRight} still={still} /> : <span key={`s${fromRight}:${ch}`}>{ch}</span>;
        })}
      </span>
    </span>
  );
}

function Digit({ d, order, still }: { d: number; order: number; still: boolean }) {
  // clip-path rather than overflow:hidden, which would move the baseline to the bottom edge; the
  // mask fades the window's top and bottom so a rolling digit slides in rather than appearing cut
  return (
    <span className="relative inline-block" style={{ clipPath: "inset(0 -0.15em)", maskImage: DIGIT_MASK, WebkitMaskImage: DIGIT_MASK }}>
      <span className="invisible">{d}</span>
      <span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        style={{
          transform: `translateY(${-d * 10}%)`,
          transition: still ? "none" : `transform 560ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(order, 6) * 18}ms`,
        }}
      >
        {DIGITS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const DIGIT_MASK = "linear-gradient(transparent, #000 14%, #000 86%, transparent)";

/** How many digit positions (matched from the right) differ between two formatted numbers. */
function changedDigits(a: string, b: string): number {
  const x = a.replace(/\D/g, "");
  const y = b.replace(/\D/g, "");
  let n = 0;
  for (let i = 1; i <= Math.max(x.length, y.length); i++) if (x[x.length - i] !== y[y.length - i]) n++;
  return n;
}
