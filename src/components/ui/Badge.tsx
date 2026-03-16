import React from "react";

type BadgeColor = "emerald" | "zinc" | "amber" | "red" | "blue";

interface BadgeProps {
  children: React.ReactNode;
  color?: BadgeColor;
  className?: string;
}

const colors: Record<BadgeColor, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  zinc: "bg-zinc-800 text-zinc-400 border-white/5",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-red-500/10 text-red-400 border-red-500/20",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export function Badge({ children, color = "zinc", className = "" }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold
        uppercase tracking-wider border
        ${colors[color]} ${className}
      `}
    >
      {children}
    </span>
  );
}
