/**
 * iOS only opens the on-screen keyboard when an input is focused synchronously inside a tap.
 * Call this from the tap that leads to a screen whose input focuses itself on mount: it focuses
 * an invisible stand-in now, so the keyboard is already up, and iOS keeps it up when the real
 * input takes focus a moment later. The stand-in removes itself once it loses focus.
 */
export function primeKeyboard(from?: Element | null) {
  const el = document.createElement("input");
  el.type = "text";
  el.inputMode = "decimal";
  el.tabIndex = -1;
  el.setAttribute("aria-hidden", "true");
  // Visible to the browser (display:none cannot take focus), invisible to the person; 16px stops iOS zooming in.
  el.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;pointer-events:none;";
  // Inside an open sheet, stay within it so its focus trap does not pull focus straight back.
  (from?.closest('[role="dialog"]') ?? document.body).appendChild(el);
  el.addEventListener("blur", () => el.remove(), { once: true });
  el.focus({ preventScroll: true });
  // If nothing takes over (the screen never mounted), drop the keyboard rather than leave it up.
  setTimeout(() => { if (document.activeElement === el) el.blur(); }, 1500);
}
