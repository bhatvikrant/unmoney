import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Toaster } from "@/components/ui/sonner";
import { OfflineProvider } from "@/lib/store";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { startPwa } from "@/lib/pwa";
import "./index.css";
import App from "./App";

startPwa();

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

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
  </StrictMode>,
);
