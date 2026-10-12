import { useEffect, useState } from "react";
import { useDesk } from "@/lib/gapline/store";
import { explainCopy, formatRemain, formatUsd, marketClock } from "@/lib/gapline/model";
import { Kicker, Mark, Panel, field } from "./ui";

export function ExplainView() {
  const { state, dispatch } = useDesk();
  const b = state.books.find((x) => x.symbol === state.symbol) ?? state.books[0];
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const clock = marketClock(new Date(now));
  const note = b ? explainCopy(b, new Date(now)) : "";
  const stamp = new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const q = query.trim().toLowerCase();
  const matches = state.books
    .filter((item) => !q || item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
    .slice(0, 40);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Panel className="p-5">
        <Kicker>Why</Kicker>
        <h2 className="mt-1 font-display text-2xl text-fg sm:text-3xl">Why did it move?</h2>
        <p className="mt-2 text-sm text-pretty text-muted">This note is rebuilt from the latest print. It does not keep the last one.</p>
        <div className="relative z-30 mt-4">
          <label className="block text-sm text-fg">
            Stock
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setSearchOpen(false), 180);
              }}
              placeholder="Search any stock"
              className={`${field} mt-2`}
              aria-label="Search for a stock"
              aria-expanded={searchOpen}
            />
          </label>
          {searchOpen && (
            <ul className="absolute top-full z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-raised py-1 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {matches.map((item) => (
                <li key={item.symbol}>
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      dispatch({ type: "symbol", symbol: item.symbol });
                      setQuery("");
                      setSearchOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-2 py-2 text-left ${item.symbol === b?.symbol ? "bg-surface" : "hover:bg-surface"}`}
                  >
                    <Mark symbol={item.symbol} name={item.name} round />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{item.name}</span>
                      <span className="block text-xs text-muted">{item.symbol}</span>
                    </span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-3 text-sm text-muted">No match.</li>}
              {matches.length === 40 && <li className="px-3 py-2 text-xs text-muted">Keep typing to narrow the list.</li>}
            </ul>
          )}
        </div>
        {b && (
          <div className="mt-3 flex items-center gap-2">
            <Mark symbol={b.symbol} name={b.name} round />
            <p className="min-w-0 truncate text-sm text-fg">
              {b.name} <span className="text-muted">{b.symbol}</span>
            </p>
          </div>
        )}
        <p className="mt-4 text-sm text-fg">
          The market is <span className={clock.open ? "text-primary" : "text-down"}>{clock.open ? "open" : "closed"}</span>
          <span className="text-muted"> · {formatRemain(clock.at - now)}</span>
        </p>
      </Panel>
      <Panel className="p-5">
        <div className="flex items-center gap-3">
          <Mark symbol={b?.symbol ?? ""} name={b?.name ?? ""} round />
          <div>
            <Kicker>{b?.symbol}</Kicker>
            <p className="font-display text-2xl text-fg">{b?.name}</p>
          </div>
        </div>
        {b ? (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Price label="xStocks" value={b.venues.xstocks.price} />
            <Price label="bStocks" value={b.venues.bstocks.price} />
            <Price label="Ondo" value={b.venues.ondo.price} />
          </div>
        ) : null}
        <p className="mt-4 rounded-xl bg-raised p-4 text-sm leading-relaxed text-pretty text-fg">{note || "Waiting for the live print."}</p>
        <p className="mt-4 text-xs text-muted">Live · updated {stamp}. Prices refresh with the feed.</p>
      </Panel>
    </div>
  );
}

function Price({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-raised px-3 py-2">
      <p className="text-[11px] tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className="mt-1 text-sm tabular-nums text-fg">{value > 0 ? formatUsd(value) : "—"}</p>
    </div>
  );
}