import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "error" | "secondary";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variantClasses = {
    default: "bg-violet-600/20 text-violet-300 border-violet-500/30",
    success: "bg-green-600/20 text-green-300 border-green-500/30",
    warning: "bg-yellow-600/20 text-yellow-300 border-yellow-500/30",
    error: "bg-red-600/20 text-red-300 border-red-500/30",
    secondary: "bg-white/10 text-white/70 border-white/20",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
