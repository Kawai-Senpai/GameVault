import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-15 w-full rounded-lg border bg-transparent px-3 py-2 text-xs shadow-sm transition-colors",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:bg-input/30 dark:border-input",
        "resize-none",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
