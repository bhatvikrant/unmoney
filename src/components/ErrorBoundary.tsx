import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** One render error would otherwise blank the whole app. Queued changes are in IndexedDB, so a reload keeps them. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Something went wrong.</p>
        <p className="text-sm text-muted-foreground max-w-sm">Your changes on this device are kept. Reloading usually fixes it.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
