import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { useDesk } from "@/lib/gapline/store";
import {
  MARKET,
  VENUES,
  advise,
  classify,
  formatMove,
  formatRemain,
  formatUsd,
  gapOf,
  listRoutes,
  marketClock,
  stockPrice,
  type Book,
} from "@/lib/gapline/model";
import { CallBadge, Kicker, Mark, Panel, btnGhost, btnPrimary } from "./ui";
import { getChartTape } from "@/lib/gapline/rwa";

type ChartPoint = { label: string; bps: number };
const chartMemory = new Map<string, ChartPoint[]>();

function storedChart(symbol: string) {
  const held = chartMemory.get(symbol);
  if (held && held.length >= 8) return held;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`gapline.chart.${symbol}`) ?? "null") as ChartPoint[] | null;
    if (parsed && parsed.length >= 8) {
      chartMemory.set(symbol, parsed);
      return parsed;
    }
  } catch {
    /* A bad cache is ignored. The last drawn line stays. */
  }
  return null;
}

function storeChart(symbol: string, path: ChartPoint[]) {
  if (path.length < 8) return;
  chartMemory.set(symbol, path);
  try {
    sessionStorage.setItem(`gapline.chart.${symbol}`, JSON.stringify(path));
  } catch {
    /* The in-memory copy is enough for this tab. */
  }
}

export function Desk() {
  const { state, dispatch } = useDesk();
  const [query, setQuery] = useState("");
  const selected = state.books.find((b) => b.symbol === state.symbol) ?? state.books[0];
  const rest = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = state.books;
    return list
      .filter((b) => !q || b.symbol.toLowerCase().includes(q) || b.name.toLowerCase().includes(q))
      .sort((a, c) => Math.abs(gapOf(c) ?? -1) - Math.abs(gapOf(a) ?? -1))
      .slice(0, q ? 40 : list.length);
  }, [query, state.books]);
  if (!selected) return <Panel className="p-4 text-sm text-muted">Stocks are still loading.</Panel>;

  return (
    <div className="flex flex-col gap-3 pb-24 lg:gap-4 lg:pb-0">
      <Clock />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-4">
        <div className="lg:hidden">
          <GapChart book={selected} compact />
        </div>
        <Panel>
          <div className="px-3 py-3 sm:px-4 sm:py-4">
            <Kicker>Last 24 hours</Kicker>
            <h2 className="font-display text-xl text-fg sm:text-2xl">Select Stock</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Apple, Tesla…"
              className="mt-3 h-11 w-full rounded-xl bg-raised px-3 text-base text-fg outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm"
            />
          </div>
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-h-[32rem]">
            {rest.map((b) => (
              <NameRow key={b.symbol} book={b} on={b.symbol === selected.symbol} onPick={() => dispatch({ type: "symbol", symbol: b.symbol })} />
            ))}
            {rest.length === 0 && <li className="px-2 py-4 text-sm text-muted">No match.</li>}
          </ul>
        </Panel>
        <div className="hidden lg:sticky lg:top-4 lg:block">
          <Decision book={selected} />
        </div>
      </div>
      <BuyDock book={selected} />
    </div>
  );
}

function Clock() {
  const { state } = useDesk();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const session = marketClock(new Date(now));
  const live = state.live?.ok && state.live.clock ? state.live : null;
  const open = live ? live.open : session.open;
  const target = live?.nextAt ?? session.at;
  const remain = formatRemain(target - now);
  return (
    <section className="rounded-2xl bg-surface px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_28px_rgba(0,0,0,0.18)] sm:px-6 sm:py-6 sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_40px_rgba(0,0,0,0.22)]">
      <p className="text-[11px] tracking-[0.16em] text-primary uppercase">New York</p>
      <p className="mt-1 font-display text-2xl leading-none text-fg sm:mt-2 sm:text-5xl" suppressHydrationWarning>
        The Market is <span className={open ? "text-primary" : "text-down"}>{open ? "Open" : "Closed"}</span>
      </p>
      <p className="mt-2 font-display text-lg tabular-nums text-primary sm:mt-4 sm:text-2xl" suppressHydrationWarning>
        {remain}
      </p>
      <p className="mt-1 text-xs text-muted">{open ? "until the close" : "until the open"}</p>
      <p className="mt-3 line-clamp-2 max-w-2xl text-sm text-pretty text-muted sm:mt-4 sm:line-clamp-none">
        {state.live?.detail ?? `Since ${MARKET.closedSince}. Bitcoin is up ${(MARKET.btcMoveBps / 100).toFixed(1)}%.`}
      </p>
    </section>
  );
}

function NameRow({ book, on, onPick }: { book: Book; on: boolean; onPick: () => void }) {
  const call = classify(book);
  const gap = gapOf(book);
  const price = stockPrice(book);
  return (
    <li>
      <button type="button" onClick={onPick} className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${on ? "bg-raised" : "hover:bg-raised"}`}>
        <Mark symbol={book.symbol} name={book.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg">{book.name}</span>
          <span className="block text-xs text-muted">{book.symbol}</span>
        </span>
        <span className="text-right">
          <span className="block text-sm tabular-nums text-fg">{price > 0 ? formatUsd(price) : "…"}</span>
          <span className={`block text-xs tabular-nums ${gap != null && gap < 0 ? "text-down" : "text-primary"}`}>{formatMove(gap)}</span>
        </span>
        <span className="hidden sm:inline">
          <CallBadge id={call.id} label={call.label} />
        </span>
      </button>
    </li>
  );
}

function Decision({ book }: { book: Book }) {
  const { dispatch } = useDesk();
  const advice = advise(book, 10);
  const call = classify(book);
  const refused = advice.decision === "refuse";
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    setHeld(null);
  }, [book.symbol]);

  function refuse() {
    const detail = `${book.name}. ${advice.note} Nothing was sent.`;
    dispatch({ type: "note", title: "Refused", detail });
    setHeld("Still no. Nothing was sent.");
  }

  return (
    <Panel className="flex flex-col">
      <div className="px-4 py-4">
        <div className="flex items-center gap-2">
          <Mark symbol={book.symbol} name={book.name} />
          <div>
            <Kicker>{book.symbol}</Kicker>
            <h2 className="font-display text-2xl text-fg sm:text-3xl">{book.name}</h2>
          </div>
        </div>
      </div>
      <div className="px-1">
        <GapChart book={book} bare />
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-pretty text-fg">{advice.note}</p>
        <div className="mt-3">
          <CallBadge id={call.id} label={call.label} />
        </div>
      </div>
      <ul className="flex flex-col gap-1 px-3 pb-3">
        {listRoutes(book, 10).map((v) => (
            <li key={v.venue} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-3">
              <span>
                <span className="block text-sm text-fg">
                  {VENUES[v.venue].label}
                  {v.venue === "ondo" && advice.carryBps != null ? ` · ${Math.round(advice.carryBps)} bp vs 1:1` : ""}
                  {v.price > 0 && v.venue === advice.pick && advice.decision === "buy" ? " · buy this" : ""}
                </span>
                <span className="block text-xs text-muted">
                  {v.token} · {VENUES[v.venue].model}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm tabular-nums text-fg">{v.price > 0 ? formatUsd(v.price) : "No live price"}</span>
                <span className="block text-xs tabular-nums text-muted">{v.price > 0 ? (book.live ? "Live mark" : `${formatUsd(v.liquidityUsd, 0)} depth`) : "Not quoting"}</span>
              </span>
            </li>
          ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2 p-4">
        {advice.decision === "buy" && (
          <button type="button" className={btnPrimary} onClick={() => dispatch({ type: "view", view: "route" })}>
            Buy the 1:1 token
          </button>
        )}
        {advice.decision === "news" && (
          <button type="button" className={btnPrimary} onClick={() => dispatch({ type: "view", view: "route" })}>
            Buy a small amount
          </button>
        )}
        {advice.decision === "leave" && (
          <button type="button" className={btnPrimary} onClick={() => dispatch({ type: "note", title: "Left it", detail: advice.note })}>
            Buy nothing
          </button>
        )}
        {refused && (
          <>
            <button type="button" className={btnPrimary} onClick={refuse}>
              Gapline says no
            </button>
            <button type="button" className={btnGhost} onClick={() => dispatch({ type: "view", view: "route" })}>
              Buy it anyway
            </button>
          </>
        )}
        {held && <p className="text-sm text-down">{held}</p>}
        {advice.decision === "leave" && (
          <button type="button" className={btnGhost} onClick={() => dispatch({ type: "view", view: "route" })}>
            See the quote
          </button>
        )}
      </div>
    </Panel>
  );
}

export function GapChart({ book, bare = false, compact = false }: { book: Book; bare?: boolean; compact?: boolean }) {
  const [shown, setShown] = useState<{ symbol: string; path: ChartPoint[] } | null>(null);
  useLayoutEffect(() => {
    const known = storedChart(book.symbol) ?? (book.tape && book.tape.length >= 8 ? book.tape : null);
    if (known) {
      storeChart(book.symbol, known);
      setShown({ symbol: book.symbol, path: known });
    }
    let stop = false;
    getChartTape({ data: { symbol: book.symbol, address: book.address } })
      .then((tape) => {
        if (stop || !tape || tape.length < 8) return;
        const previous = storedChart(book.symbol);
        if (previous && tape.length + 4 < previous.length) return;
        storeChart(book.symbol, tape);
        setShown({ symbol: book.symbol, path: tape });
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [book.symbol, book.address]);
  const path = shown?.symbol === book.symbol && shown.path.length >= 8 ? shown.path : (storedChart(book.symbol) ?? []);
  const gap = gapOf(book);
  const gid = useId().replace(/:/g, "");
  const down = gap != null && gap < 0;
  const stroke = down ? "var(--color-down)" : "var(--color-primary)";
  const [cursor, setCursor] = useState<{ x: number; y: number; bps: number; label: string } | null>(null);
  if (path.length < 2) {
    const waiting = <div className={compact ? "h-[128px] w-full sm:h-[150px]" : "h-[180px] w-full sm:h-[220px]"} />;
    if (bare) return waiting;
    return (
      <Panel className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 px-1">
          <Mark symbol={book.symbol} name={book.name} />
          <p className="min-w-0 flex-1 truncate text-sm text-fg">{book.name}</p>
        </div>
        {waiting}
      </Panel>
    );
  }
  const w = 360;
  const h = 220;
  const padL = 58;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const values = path.map((point) => point.bps);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max(12, (rawMax - rawMin) * 0.35 || 12);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const xAt = (index: number) => padL + (index / Math.max(path.length - 1, 1)) * (w - padL - padR);
  const yAt = (value: number) => padT + (1 - (value - min) / span) * (h - padT - padB);
  const coords = path.map((point, index) => ({ x: xAt(index), y: yAt(point.bps), bps: point.bps, label: point.label }));
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const floor = h - padB;
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${floor.toFixed(1)} L${coords[0].x.toFixed(1)},${floor.toFixed(1)} Z`;
  const live = book.venues.xstocks.price || book.venues.bstocks.price;
  const last = path[path.length - 1]?.bps ?? 0;
  const open = live > 0 ? live / (1 + last / 10_000) : 0;
  const pointPrice = open > 0 && cursor ? open * (1 + cursor.bps / 10_000) : null;
  const axis = (bps: number) => {
    const pct = bps / 100;
    const digits = Math.abs(pct) >= 10 ? 0 : Math.abs(pct) >= 1 ? 1 : 2;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
  };
  const yTicks = [rawMax, (rawMax + rawMin) / 2, rawMin].filter((value, index, all) => all.findIndex((other) => Math.abs(yAt(other) - yAt(value)) < 16) === index);
  const labelAt = path.length <= 4 ? path.map((_, index) => index) : [0, Math.round((path.length - 1) / 2), path.length - 1];

  function shortTime(label: string) {
    const match = label.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!match) return label;
    const hour = match[1];
    const minute = match[2];
    const half = match[3][0].toLowerCase();
    return minute === "00" ? `${hour}${half}` : `${hour}:${minute}${half}`;
  }

  function follow(clientX: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect();
    const x = Math.min(coords[coords.length - 1].x, Math.max(coords[0].x, ((clientX - rect.left) / rect.width) * w));
    let index = 0;
    while (index < coords.length - 2 && coords[index + 1].x < x) index += 1;
    const left = coords[index];
    const right = coords[Math.min(index + 1, coords.length - 1)];
    const t = right.x === left.x ? 0 : (x - left.x) / (right.x - left.x);
    setCursor({
      x,
      y: left.y + (right.y - left.y) * t,
      bps: left.bps + (right.bps - left.bps) * t,
      label: t < 0.5 ? left.label : right.label,
    });
  }

  const chart = (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`${compact ? "h-[128px] sm:h-[150px]" : "h-[180px] sm:h-[220px]"} w-full touch-none`}
        role="img"
        aria-label={`${book.name} over the last 24 hours`}
        onPointerMove={(event) => follow(event.clientX, event.currentTarget)}
        onPointerDown={(event) => follow(event.clientX, event.currentTarget)}
        onPointerLeave={() => setCursor(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {min < 0 && max > 0 && <line x1={padL} x2={w - padR} y1={yAt(0)} y2={yAt(0)} stroke="var(--color-line)" strokeDasharray="3 4" />}
        {yTicks.map((value) => (
          <text key={value} x={4} y={yAt(value) + 4} fill="var(--color-muted)" fontSize="11">
            {axis(value)}
          </text>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="3.5" fill={stroke} />
        {labelAt.map((index) => (
          <text
            key={`${coords[index].label}-${index}`}
            x={coords[index].x}
            y={h - 8}
            textAnchor={index === 0 ? "start" : index === path.length - 1 ? "end" : "middle"}
            fill="var(--color-muted)"
            fontSize="11"
          >
            {shortTime(coords[index].label)}
          </text>
        ))}
        {cursor && (
          <g>
            <circle cx={cursor.x} cy={cursor.y} r="8" fill={stroke} opacity="0.18" />
            <circle cx={cursor.x} cy={cursor.y} r="4.5" fill="var(--color-bg)" stroke={stroke} strokeWidth="2.5" />
          </g>
        )}
      </svg>
      <p className="px-1 text-xs tabular-nums text-muted">
        {cursor
          ? `${cursor.label} · ${formatMove(cursor.bps)}${pointPrice != null ? ` · ${formatUsd(pointPrice)}` : ""}`
          : "Move across the line."}
      </p>
    </div>
  );
  if (bare) return chart;
  return (
    <Panel className="px-3 pt-3 pb-2">
      <div className="flex items-center gap-2 px-1">
        <Mark symbol={book.symbol} name={book.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fg">{book.name}</p>
          <p className="text-xs text-muted">Last 24 hours. Move across the line.</p>
        </div>
        <p className={`font-display text-2xl leading-none tabular-nums sm:text-3xl ${down ? "text-down" : "text-primary"}`}>{formatMove(cursor?.bps ?? gap)}</p>
      </div>
      {chart}
    </Panel>
  );
}

function BuyDock({ book }: { book: Book }) {
  const { dispatch } = useDesk();
  const advice = advise(book, 10);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    setHeld(false);
  }, [book.symbol]);
  const label =
    advice.decision === "buy" ? "Buy 1:1" : advice.decision === "news" ? "Small buy" : advice.decision === "leave" ? "Leave it" : "Buy it anyway";

  function go() {
    if (advice.decision === "buy" || advice.decision === "news" || advice.decision === "refuse") {
      dispatch({ type: "view", view: "route" });
      return;
    }
    if (advice.decision === "leave") {
      dispatch({ type: "note", title: "Left it", detail: advice.note });
      return;
    }
    dispatch({ type: "note", title: "Refused", detail: `${book.name}. ${advice.note} Nothing was sent.` });
    setHeld(true);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur-sm lg:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        {held && <p className="text-sm text-down">Still no. Nothing was sent.</p>}
        <div className="flex items-center gap-2">
          <Mark symbol={book.symbol} name={book.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-fg">{book.name}</span>
            <span className="block truncate text-xs text-muted">{formatMove(gapOf(book))} in 24h</span>
          </span>
          <button type="button" className={`${btnPrimary} shrink-0`} onClick={go}>
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}