/**
 * A handful of paper bills that drift from one element to another, for the moment money changes
 * hands (recording a payment). Drawn in a fixed layer on top of everything and removed when done,
 * so the caller's layout never changes. Returns how long the flight takes in ms (0 when skipped
 * for reduced motion), so the caller can wait for it before closing a dialog.
 */
export function flyMoney(from: Element | null, to: Element | null, count = 8): number {
  if (!from || !to || typeof document === "undefined") return 0;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100;overflow:hidden";
  document.body.appendChild(layer);

  const duration = 620;
  const stagger = 45;
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2;
  const y1 = b.top + b.height / 2;
  for (let i = 0; i < count; i++) {
    const bill = document.createElement("i");
    bill.className = "money-bill";
    layer.appendChild(bill);
    const jx = (Math.random() - 0.5) * Math.min(a.width, 80);
    const jy = (Math.random() - 0.5) * 16;
    const lift = 28 + Math.random() * 26;
    const r0 = Math.random() * 50 - 25;
    const r1 = r0 + (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 60);
    const midX = (x0 + x1) / 2 + jx / 2;
    const midY = Math.min(y0, y1) - lift;
    bill.animate(
      [
        { transform: `translate(${x0 + jx}px, ${y0 + jy}px) rotate(${r0}deg) scale(.7)`, opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: `translate(${midX}px, ${midY}px) rotate(${(r0 + r1) / 2}deg) scale(1)`, offset: 0.5 },
        { opacity: 1, offset: 0.8 },
        { transform: `translate(${x1 + jx / 3}px, ${y1 + jy / 2}px) rotate(${r1}deg) scale(.8)`, opacity: 0 },
      ],
      { duration, delay: i * stagger, easing: "cubic-bezier(.3,.6,.4,1)", fill: "both" },
    );
  }
  const total = duration + (count - 1) * stagger;
  window.setTimeout(() => layer.remove(), total + 50);
  return total;
}
