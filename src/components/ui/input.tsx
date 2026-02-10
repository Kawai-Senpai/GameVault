import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full rounded-lg border bg-transparent px-3 py-1.5 text-xs shadow-sm transition-colors",
        "file:border-0 file:bg-transparent file:text-xs file:font-medium",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:bg-input/30 dark:border-input",
        className
      )}
      {...props}
    />
  );
}

export { Input };
