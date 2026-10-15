import type { ReactNode } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

/** A bottom sheet on every screen size: the picker pattern the original uses. */
export function BottomSheet({ open, onOpenChange, title, children, className, description }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode; className?: string; description?: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={cn("md:max-w-xl md:mx-auto md:rounded-t-xl", className)}>
        <DrawerHeader className="py-2">
          <DrawerTitle className="text-sm">{title}</DrawerTitle>
          <DrawerDescription className={description ? "" : "sr-only"}>{description ?? "Choose an option"}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-2 pb-4 safe-bottom max-h-[70vh]">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
