import { cn } from "@/lib/utils";

/**
 * UnMoney mark: the "M" on a rounded ink tile, the same drawing as public/icon.svg.
 * The tile follows the foreground colour, so it is ink in light mode and paper in dark mode.
 */
export function Logo({ className, size = 28, wordmark = true }: { className?: string; size?: number; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0 drop-shadow-[0_1px_1px_rgba(0,0,0,0.12)]">
        <rect width="512" height="512" rx="112" className="fill-foreground" />
        <path d="M128 352V160h48l80 112 80-112h48v192h-48V240l-80 112-80-112v112z" className="fill-background" />
      </svg>
      {wordmark ? <span className="text-[17px] font-semibold tracking-tight text-foreground">UnMoney</span> : null}
    </span>
  );
}
