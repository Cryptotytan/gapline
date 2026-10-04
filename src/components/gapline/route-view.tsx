import { useDesk } from "@/lib/gapline/store";
import { VENUES, advise, classify, formatQty, formatUsd, listRoutes, quoteOrder, type VenueId } from "@/lib/gapline/model";
import { CallBadge, Mark, Panel, btnPrimary, field } from "./ui";
import { GapChart } from "./desk";
import { cardCheckout } from "./card-pay";
import { buyStock, quoteFill, readCash, shortAddress, stockToken, thinPoolReason } from "@/lib/gapline/wallet";
import { openWalletPicker, pinSavedProvider } from "@/lib/gapline/wallet-book";
import { activateSavedWallet } from "@/lib/gapline/smart-wallet";
import { useEffect, useState } from "react";

export function RouteView() {
  const { state, dispatch } = useDesk();
  const b = state.books.find((x) => x.symbol === state.symbol) ?? state.books[0];
  const call = classify(b);
  const [venue, setVenue] = useState<VenueId>("xstocks");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [fill, setFill] = useState<{ paid: number; qty: number; receivedUsd: number; spentUsd: number; venue?: string; impact?: number } | null>(null);
  const [why, setWhy] = useState("");
  const [quoting, setQuoting] = useState(false);

  const asked = Number(draft);
  const quoteSize = Number.isFinite(asked) && asked > 0 ? Math.round(asked * 100) / 100 : 0;
  const advice = advise(b, quoteSize);

  useEffect(() => {
    if (!(quoteSize > 0)) {
      setFill(null);
      setQuoting(false);
      return;
    }
    let stop = false;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      quoteFill({
        symbol: b.symbol,
        sizeUsd: quoteSize,
        token: stockToken(b.symbol) || b.address || undefined,
        mark: b.venues.xstocks.price || b.reference || undefined,
      })
        .then((next) => {
          if (!stop) setFill(next);
        })
        .catch(() => {
          if (!stop) setFill(null);
        })
        .finally(() => {
          if (!stop) setQuoting(false);
        });
    }, 400);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [b.symbol, b.address, b.venues.xstocks.price, b.reference, quoteSize]);

  useEffect(() => {
    return () => {
      dispatch({ type: "size", sizeUsd: 10 });
    };
  }, [dispatch]);

  useEffect(() => {
    setWhy("");
  }, [state.symbol, quoteSize, venue]);

  useEffect(() => {
    setVenue(b.spot ? "xstocks" : advice.pick);
  }, [state.symbol, advice.pick, b.spot]);

  function setAmount(raw: string) {
    setPicked(null);
    setWhy("");
    setDraft(raw);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    const size = Math.round(n * 100) / 100;
    dispatch({ type: "size", sizeUsd: size });
    if (size > state.limits.maxSizeUsd) dispatch({ type: "cap", maxSizeUsd: size });
  }

  const simPreview = quoteOrder({
    symbol: b.symbol,
    side: "buy",
    sizeUsd: quoteSize,
    venue,
    cash: state.cash,
    positions: state.positions,
    limits: state.limits,
    walletReady: state.walletReady,
  });
  const q = query.trim().toLowerCase();
  const mark = b.venues.xstocks.price;
  const paid = fill?.paid ?? 0;
  const poolReason =
    fill && fill.spentUsd > 0 && fill.receivedUsd > 0 && (fill.impact ?? 1) > 0.15
      ? thinPoolReason(b.symbol, quoteSize, fill.receivedUsd, fill.venue)
      : "";
  const impactPct = fill && fill.impact != null ? `${Math.round(fill.impact * 1000) / 10}%` : "";
  const fillLine = quoting
    ? "Comparing every route for the lowest fee."
    : paid > 0 && fill?.venue && (fill.impact ?? 1) <= 0.15
      ? `${fill.venue} keeps the most of this buy. You get about ${formatUsd(fill.receivedUsd)} back. Price impact ${impactPct}.`
      : paid > 0 && mark > 0
        ? `On-chain mark ${formatUsd(mark)}. This buy would pay ${formatUsd(paid)}${fill?.venue ? ` via ${fill.venue}` : ""}.`
        : paid > 0
          ? `This buy would pay ${formatUsd(paid)}.`
          : quoteSize > 0
            ? "No pool quote for this amount."
            : "";
  const matches = state.books
    .filter((item) => !q || item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
    .slice(0, 40);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-4">
      <Panel className="p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <Mark symbol={b.symbol} name={b.name} />
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl text-fg sm:text-3xl">{b.name}</h2>
            <p className="text-xs text-muted">{b.symbol}</p>
          </div>
        </div>
        <p className="mt-2 line-clamp-3 text-sm text-pretty text-muted sm:line-clamp-none">{advice.note}</p>
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
                    className={`flex w-full items-center gap-2 px-2 py-2 text-left ${item.symbol === b.symbol ? "bg-surface" : "hover:bg-surface"}`}
                  >
                    <Mark symbol={item.symbol} name={item.name} />
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
        <div className="relative z-0 mt-4">
          <GapChart book={b} bare />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg">Amount</p>
            <p className="text-xs tabular-nums text-muted">{paid > 0 ? `${formatUsd(paid)} a share` : quoting ? "Checking the pool" : "No pool quote"}</p>
          </div>
          <div className="mt-2 flex items-center rounded-2xl bg-raised px-3 sm:px-4">
            <span className="font-display text-2xl text-muted sm:text-3xl">$</span>
            <input
              inputMode="decimal"
              value={draft}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => {
                const n = Number(draft);
                if (draft.trim() && (!Number.isFinite(n) || n <= 0)) setDraft("");
              }}
              className="h-12 w-full bg-transparent pl-1 font-display text-3xl tabular-nums text-fg outline-none sm:h-16 sm:text-4xl"
              aria-label="Amount in dollars"
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[5, 10, 25].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setPicked(n);
                  dispatch({ type: "size", sizeUsd: n });
                  setDraft(String(n));
                  if (n > state.limits.maxSizeUsd) dispatch({ type: "cap", maxSizeUsd: n });
                }}
                className={`h-10 rounded-full text-sm tabular-nums ${picked === n ? "bg-primary text-primary-fg" : "bg-raised text-fg"}`}
              >
                ${n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-pretty text-muted">{fillLine}</p>
        </div>
      </Panel>
      <Panel>
        <div className="px-5 pt-5 pb-2">
          <p className="text-[11px] tracking-[0.16em] text-primary uppercase">Route</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h3 className="font-display text-2xl text-fg">Where this buy goes</h3>
            <CallBadge id={call.id} label={call.label} />
          </div>
        </div>
        <ul className="flex flex-col gap-1 px-3 pb-2">
          {listRoutes(b, quoteSize).map((v) => (
            <li key={v.venue}>
              <button
                type="button"
                onClick={() => setVenue(v.venue)}
                className={`flex w-full flex-col gap-1 rounded-xl px-3 py-3 text-left sm:flex-row sm:items-center ${venue === v.venue ? "bg-raised" : "hover:bg-raised"}`}
              >
                <span className="sm:w-40">
                  <span className="block text-sm text-fg">
                    {VENUES[v.venue].label}
                    {v.venue === advice.pick ? " · recommended" : ""}
                  </span>
                  <span className="block text-xs text-muted">{v.token}</span>
                </span>
                <span className="text-sm tabular-nums text-fg">{v.effective > 0 ? `${formatUsd(v.effective)} effective` : "No price"}</span>
                <span className="text-xs tabular-nums text-muted sm:ml-auto">
                  fee {v.feeBps} bp · impact {v.impactBps} bp · depth {formatUsd(v.liquidityUsd, 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {simPreview && (
          <div className="mx-2 mb-3 rounded-2xl bg-bg p-3 sm:mx-3 sm:p-4">
            <div className="flex items-center gap-3">
              <Mark symbol={b.symbol} name={b.name} round />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] tracking-[0.16em] text-primary uppercase">Review</p>
                <p className="truncate font-display text-2xl text-fg">{b.name}</p>
              </div>
              <p className="font-display text-2xl tabular-nums text-fg">{formatUsd(quoteSize)}</p>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2">
              {[
                ["You pay", formatUsd(quoteSize)],
                ["Shares", fill && fill.qty > 0 ? formatQty(fill.qty) : simPreview.qty > 0 ? formatQty(simPreview.qty) : "Set by the pool"],
                ["You would pay", paid > 0 ? formatUsd(paid) : quoting ? "Checking" : "No quote"],
                ["On-chain mark", mark > 0 ? formatUsd(mark) : "No live mark"],
                ["Venue", fill?.venue ?? VENUES[simPreview.venue].label],
                ["Wallet", state.address ? shortAddress(state.address) : "Connect to sign"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-surface px-3 py-2">
                  <dt className="text-[11px] tracking-wide text-muted uppercase">{label}</dt>
                  <dd className="mt-1 text-sm tabular-nums text-fg">{value}</dd>
                </div>
              ))}
            </dl>
            {why && <p className="mt-3 text-sm text-pretty text-down">{why}</p>}
            <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-[#14120f] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#2a2118] text-primary">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <rect x="1.5" y="4" width="15" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M1.5 7.5h15" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </span>
                <p className="text-sm text-pretty text-fg">{state.cash + 0.001 < quoteSize ? "Don't have enough crypto yet?" : "Pay with a card instead"}</p>
              </div>
              <button
                type="button"
                className="h-10 w-full shrink-0 cursor-pointer rounded-xl bg-[#3a2a18] px-4 text-sm font-medium text-[#f3d2a4] shadow-[0_8px_24px_rgba(224,161,90,0.28)] hover:bg-[#4a3420] active:scale-[0.98] sm:w-auto"
                onClick={() => {
                  if (!state.address) {
                    openWalletPicker();
                    return;
                  }
                  cardCheckout(state.address, quoteSize);
                }}
              >
                Buy with Card
              </button>
            </div>
            <button
              type="button"
              className={`${btnPrimary} mt-4 w-full`}
              disabled={sending}
              onClick={() => {
                const order = { ...simPreview, sizeUsd: quoteSize };
                if (!state.address) {
                  openWalletPicker();
                  return;
                }
                if (state.cash + 0.001 < order.sizeUsd) {
                  const reason = `The wallet has ${formatUsd(state.cash)}. This buy needs ${formatUsd(order.sizeUsd)}. Use Buy with Card, or send USDT to this wallet.`;
                  setWhy(reason);
                  dispatch({ type: "note", title: "Not sent", detail: reason });
                  return;
                }
                const blocked = order.guard.blockers.find((line) => !line.includes("Wallet balance") && !line.includes("Connect a wallet"));
                if (blocked) {
                  setWhy(blocked);
                  dispatch({ type: "note", title: "Not sent", detail: blocked });
                  return;
                }
                if (poolReason) {
                  setWhy(poolReason);
                  dispatch({ type: "note", title: "Not sent", detail: poolReason });
                  return;
                }
                setSending(true);
                const run = async () => {
                  await activateSavedWallet(state.address as string);
                  pinSavedProvider(state.address as string);
                  const cashNow = await readCash(state.address as string).catch(() => state.cash);
                  dispatch({ type: "wallet", address: state.address as string, cash: cashNow });
                  if (cashNow + 0.001 < order.sizeUsd) {
                    const reason = `The wallet has ${formatUsd(cashNow)}. This buy needs ${formatUsd(order.sizeUsd)}. Use Buy with Card, or send USDT to this wallet.`;
                    setWhy(reason);
                    dispatch({ type: "note", title: "Not sent", detail: reason });
                    return;
                  }
                  const sent = await buyStock({
                    address: state.address as string,
                    symbol: b.symbol,
                    sizeUsd: order.sizeUsd,
                    token: stockToken(b.symbol) || b.address,
                    mark: b.venues.xstocks.price || b.reference || undefined,
                    maxUsd: Math.max(state.limits.maxSizeUsd, order.sizeUsd),
                  });
                  const cash = await readCash(state.address as string);
                  dispatch({
                    type: "chain-fill",
                    order: { ...order, venue: "xstocks", qty: sent.qty },
                    cash,
                    hash: sent.hash,
                  });
                  dispatch({ type: "view", view: "holdings" });
                };
                run()
                  .catch((error: unknown) => {
                    const reason = error instanceof Error ? error.message : "The wallet did not send. Nothing was confirmed.";
                    setWhy(reason);
                    dispatch({ type: "note", title: "Not sent", detail: reason });
                  })
                  .finally(() => setSending(false));
              }}
            >
              {sending ? "Waiting for wallet" : `Buy ${b.symbol}`}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
