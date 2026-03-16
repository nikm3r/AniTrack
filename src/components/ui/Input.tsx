import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

export function Input({
  label,
  hint,
  error,
  mono = false,
  className = "",
  ...props
}: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-0.5">
          {label}
        </label>
      )}
      <input
        {...props}
        className={`
          w-full bg-black/40 border rounded-xl px-4 py-3 text-sm text-zinc-100
          outline-none transition-all duration-150 no-drag
          placeholder:text-zinc-600
          focus:border-emerald-500/70 focus:bg-black/60
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? "border-red-500/50" : "border-white/10 hover:border-white/15"}
          ${mono ? "font-mono text-xs" : ""}
          ${className}
        `}
      />
      {hint && !error && (
        <p className="text-[10px] text-zinc-600 pl-0.5">{hint}</p>
      )}
      {error && (
        <p className="text-[10px] text-red-400 pl-0.5">{error}</p>
      )}
    </div>
  );
}
