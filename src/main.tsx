import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Toaster } from "@/components/ui/sonner";
import { OfflineProvider } from "@/lib/store";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ForcedUpdate } from "@/components/ForcedUpdate";
import { startPwa } from "@/lib/pwa";
import { startAnalytics } from "@/lib/analytics";
import "./index.css";
import App from "./App";

startPwa();
// Off the startup path: once the page has loaded and the browser has a quiet moment, so parsing PostHog
// never competes with the ledger's first render. Errors reported before then wait for it (src/lib/analytics.ts).
const whenIdle = (fn: () => void) =>
  "requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500);
if (document.readyState === "complete") whenIdle(() => void startAnalytics());
else window.addEventListener("load", () => whenIdle(() => void startAnalytics()), { once: true });

// Every change is queued in IndexedDB and sent again after a reload, so closing the tab mid-send loses
// nothing: Convex's own "changes may not be saved" prompt would only be wrong here.
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string, { unsavedChangesWarning: false });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <OfflineProvider>
          <BrowserRouter>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
            <Toaster position="top-center" richColors closeButton />
          </BrowserRouter>
        </OfflineProvider>
      </ConvexAuthProvider>
    </ErrorBoundary>
    <ForcedUpdate />
  </StrictMode>,
);
