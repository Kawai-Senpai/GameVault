import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  description?: string;
  showBack?: boolean;
  backPath?: string;
  rightContent?: React.ReactNode;
  className?: string;
}

export default function Header({
  title,
  description,
  showBack = false,
  backPath,
  rightContent,
  className,
}: HeaderProps) {
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 h-12 border-b border-border shrink-0",
        className
      )}
    >
      {showBack && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => (backPath ? navigate(backPath) : navigate(-1))}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <h1 className="text-sm font-semibold truncate">{title}</h1>
        {description && (
          <p className="text-[10px] text-muted-foreground truncate">
            {description}
          </p>
        )}
      </div>
      {rightContent && (
        <div className="flex items-center gap-1.5 shrink-0">{rightContent}</div>
      )}
    </div>
  );
}
