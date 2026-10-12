import { useEffect, useState, type ReactNode } from "react";
import { logoSources, type CallId } from "@/lib/gapline/model";

export const btn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";

export const btnPrimary = `${btn} bg-primary text-primary-fg hover:bg-primary/90`;
export const btnGhost = `${btn} bg-raised text-fg hover:bg-line`;
export const field =
  "h-11 w-full rounded-xl bg-raised px-3 text-base text-fg outline-none ring-1 ring-transparent focus-visible:ring-primary sm:text-sm";

export function XLogo({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_40px_rgba(0,0,0,0.22)] ${className}`}>
      {children}
    </section>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-[11px] tracking-[0.16em] text-primary uppercase">{children}</p>;
}

const tone: Record<CallId, string> = {
  news: "bg-down/15 text-down",
  revert: "bg-primary/15 text-primary",
  thin: "bg-raised text-muted",
  noise: "bg-raised text-muted",
  unscored: "bg-raised text-muted",
};

export function CallBadge({ id, label }: { id: CallId; label: string }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ${tone[id]}`}>{label}</span>;
}

export function Mark({ symbol, name, round = false }: { symbol: string; name?: string; round?: boolean }) {
  const sources = logoSources(symbol);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [symbol]);
  const src = sources[index];
  const frame = round
    ? "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised"
    : "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised";
  return (
    <span className={frame}>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          width={32}
          height={32}
          className="size-full object-contain p-1"
          onError={() => setIndex((current) => current + 1)}
        />
      ) : (
        <span className="text-xs font-medium text-fg">{(name ?? symbol).slice(0, 1)}</span>
      )}
    </span>
  );
}