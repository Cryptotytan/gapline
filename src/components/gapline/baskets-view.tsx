import { useEffect, useState } from "react";
import { useDesk } from "@/lib/gapline/store";
import { BASKETS, book, buyPlanFor, classify, driftFor, formatUsd, planQuotes, rebalanceFor, weightsFor, type BasketId } from "@/lib/gapline/model";
import { buyStock, readCash, stockToken } from "@/lib/gapline/wallet";
import { openWalletPicker, pinSavedProvider } from "@/lib/gapline/wallet-book";
import { activateSavedWallet } from "@/lib/gapline/smart-wallet";
import { Kicker, Mark, Panel, btnGhost, btnPrimary, field } from "./ui";

function GroupRow({
  name,
  symbols,
  on,
  onOpen,
  onDelete,
}: {
  name: string;
  symbols: string[];
  on: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [ask, setAsk] = useState(false);
  return (
    <div className={`relative rounded-2xl ${on ? "bg-primary text-primary-fg" : "bg-raised text-fg"}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-2.5 pr-10 text-left">
        <span className="flex shrink-0 -space-x-2">
          {symbols.slice(0, 3).map((symbol) => (
            <span key={symbol} className="rounded-full ring-2 ring-bg">
              <Mark symbol={symbol} round />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className={`mt-0.5 block text-xs ${on ? "text-primary-fg/75" : "text-muted"}`}>
            {symbols.length} stocks · equal amounts
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setAsk(true)}
        className={`absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full ${on ? "text-primary-fg hover:bg-primary-fg/15" : "bg-bg text-muted hover:text-fg"}`}
        aria-label={`Delete ${name}`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {ask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setAsk(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-surface p-5 text-fg shadow-[0_24px_70px_rgba(0,0,0,0.45)]" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-group-title">
            <p id="delete-group-title" className="font-display text-2xl text-fg">
              Delete this group
            </p>
            <p className="mt-2 text-sm text-pretty text-muted">Remove {name}? This does not sell anything.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" className={`${btnPrimary} flex-1`} onClick={onDelete}>
                Confirm
              </button>
              <button type="button" className={`${btnGhost} flex-1`} onClick={() => setAsk(false)}>
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BasketsView() {
  const { state, dispatch } = useDesk();
  const [id, setId] = useState<string>("ai");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [amount, setAmount] = useState("");
  const [amountPick, setAmountPick] = useState<number | null>(null);
  const customBaskets = state.customBaskets ?? [];
  const hidden = new Set(state.hiddenBaskets ?? []);
  const builtIn = id in BASKETS && !hidden.has(id) ? BASKETS[id as BasketId] : null;
  const custom = customBaskets.find((basket) => basket.id === id);
  const basket = builtIn ?? (custom ? { name: custom.name, hint: "Your group. Each name gets an equal amount.", symbols: custom.symbols } : BASKETS.ai);
  const weights = weightsFor(basket.symbols, state.positions);
  const drift = driftFor(basket.symbols, state.positions);
  const held = weights.reduce((sum, row) => sum + row.value, 0);
  const skipped = basket.symbols.filter((symbol) => {
    const item = book(symbol);
    if (!item) return true;
    if (item.spot) return false;
    const call = classify(item).id;
    return call === "thin" || call === "unscored";
  });
  const q = query.trim().toLowerCase();
  const matches = q
    ? state.books.filter((item) => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const typedBudget = Number(amount);
  const basketBudget = Number.isFinite(typedBudget) && typedBudget > 0 ? typedBudget : 0;

  function simulateBuy() {
    if (!(basketBudget > 0)) return;
    const planned = buyPlanFor(basket.symbols, basketBudget);
    const quoted = planQuotes({
      orders: planned,
      cash: state.cash,
      positions: state.positions,
      limits: state.limits,
      walletReady: state.walletReady,
    });
    dispatch({ type: "batch", batch: quoted.orders });
  }

  function simulateRebalance() {
    const planned = rebalanceFor(basket.symbols, state.positions);
    if (!planned.length) {
      dispatch({ type: "note", title: "Nothing to rebalance", detail: "Buy the basket first. Drift is measured on what you hold." });
      return;
    }
    const quoted = planQuotes({
      orders: planned,
      cash: state.cash,
      positions: state.positions,
      limits: state.limits,
      walletReady: state.walletReady,
    });
    dispatch({ type: "batch", batch: quoted.orders });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-4">
      <Panel className="p-3 sm:p-5">
        <Kicker>Baskets</Kicker>
        <h2 className="mt-1 font-display text-2xl text-fg sm:text-3xl">Buy a group</h2>
        <div className="mt-4 rounded-2xl bg-bg p-3">
          <div className="flex items-center gap-3">
            <span className="flex shrink-0 -space-x-2">
              {basket.symbols.slice(0, 4).map((symbol) => (
                <Mark key={symbol} symbol={symbol} round />
              ))}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{basket.name}</p>
              <p className="mt-0.5 text-xs text-pretty text-muted">{basket.hint}</p>
            </div>
          </div>
        </div>
        <label className="mt-4 block text-sm">
          <span className="text-muted">Amount</span>
          <span className="relative mt-2 block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
            <input
              inputMode="decimal"
              value={amount}
              placeholder=""
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9.]/g, "");
                setAmountPick(null);
                setAmount(raw);
                const next = Number(raw);
                if (next > 0) dispatch({ type: "budget", basketBudget: next });
              }}
              className={`${field} appearance-none overflow-hidden pl-7 text-lg tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
              aria-label="Amount for this group"
            />
          </span>
        </label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {[25, 50, 100, 200].map((preset) => (
            <button
              key={preset}
              type="button"
              className={`h-10 rounded-full text-sm tabular-nums ${amountPick === preset ? "bg-primary text-primary-fg" : "bg-raised text-fg hover:bg-line"}`}
              onClick={() => {
                setAmountPick(preset);
                setAmount(String(preset));
                dispatch({ type: "budget", basketBudget: preset });
              }}
            >
              ${preset}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-pretty text-muted">
          Split equally. Each name still has to clear the {formatUsd(state.limits.maxSizeUsd, 0)} cap.
          {skipped.length > 0 ? ` ${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} left out. The book is empty or too thin.` : ""}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" className={btnPrimary} onClick={simulateBuy}>
            Preview this basket
          </button>
          <button type="button" className={btnGhost} disabled={held < 1} onClick={simulateRebalance}>
            Simulate rebalance
          </button>
        </div>
        <p className="mt-5 text-[11px] tracking-[0.16em] text-muted uppercase">Groups</p>
        <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto [scrollbar-width:none] sm:max-h-72 [&::-webkit-scrollbar]:hidden">
          {customBaskets.map((group) => (
            <GroupRow
              key={group.id}
              name={group.name}
              symbols={group.symbols}
              on={id === group.id}
              onOpen={() => {
                setId(group.id);
                setMaking(false);
                dispatch({ type: "batch", batch: null });
              }}
              onDelete={() => {
                dispatch({ type: "drop-basket", id: group.id });
                if (id === group.id) setId("ai");
              }}
            />
          ))}
          {(Object.keys(BASKETS) as BasketId[])
            .filter((key) => !hidden.has(key))
            .map((key) => (
              <GroupRow
                key={key}
                name={BASKETS[key].name}
                symbols={BASKETS[key].symbols}
                on={id === key}
                onOpen={() => {
                  setId(key);
                  setMaking(false);
                  dispatch({ type: "batch", batch: null });
                }}
                onDelete={() => {
                  dispatch({ type: "drop-basket", id: key });
                  if (id === key) setId(customBaskets[0]?.id ?? "mag7");
                }}
              />
            ))}
        </div>
        <button type="button" className={`${btnGhost} mt-3 w-full`} onClick={() => setMaking((open) => !open)}>
          {making ? "Close" : "Create a group"}
        </button>
        {making && (
          <div className="mt-3 rounded-2xl bg-bg p-3">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Group name" className={field} aria-label="Group name" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a stock to add"
              className={`${field} mt-2`}
              aria-label="Search a stock to add"
            />
            {matches.length > 0 && (
              <ul className="mt-2 overflow-hidden rounded-xl bg-raised">
                {matches.map((item) => (
                  <li key={item.symbol}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-surface"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setPicked((current) => (current.includes(item.symbol) ? current : [...current, item.symbol].slice(0, 12)));
                        setQuery("");
                        setFormError("");
                      }}
                    >
                      <Mark symbol={item.symbol} name={item.name} round />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.name}</span>
                      <span className="text-xs text-muted">{item.symbol}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {picked.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {picked.map((symbol) => (
                  <button key={symbol} type="button" className="inline-flex items-center gap-1 rounded-full bg-raised py-1 pr-2.5 pl-1 text-xs text-fg" onClick={() => setPicked((current) => current.filter((item) => item !== symbol))}>
                    <Mark symbol={symbol} round />
                    {symbol} ×
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`${btnPrimary} mt-3 w-full`}
              onClick={() => {
                if (name.trim().length < 2 || picked.length < 2) {
                  setFormError("Name the group and add at least two stocks.");
                  return;
                }
                dispatch({ type: "save-basket", name, symbols: picked });
                setId(`c-${state.seq}`);
                setName("");
                setPicked([]);
                setQuery("");
                setFormError("");
                setMaking(false);
              }}
            >
              Save group
            </button>
            {formError && <p className="mt-2 text-sm text-down">{formError}</p>}
          </div>
        )}
      </Panel>
      <Panel>
        <div className="px-5 pt-5 pb-3">
          <Kicker>Inside {basket.name}</Kicker>
          <p className="mt-2 text-sm text-pretty text-fg">
            {held < 1
              ? basketBudget > 0
                ? `${formatUsd(basketBudget, 0)} split across ${weights.length} names.`
                : "Enter an amount. It splits equally across these names."
              : `You hold ${formatUsd(held)}. Largest imbalance ${drift.toFixed(0)}%.`}
          </p>
        </div>
        <ul className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
          {weights.map((row) => {
            const item = book(row.symbol);
            const leg = basketBudget * row.target;
            const share = Math.round(row.target * 100);
            return (
              <li key={row.symbol} className="rounded-2xl bg-bg p-3">
                <div className="flex items-center gap-3">
                  <Mark symbol={row.symbol} name={item?.name} round />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{item?.name ?? row.symbol}</p>
                    <p className="text-xs text-muted">{row.symbol} · {share}%</p>
                  </div>
                  <p className="text-sm font-medium tabular-nums text-fg">{held < 1 ? (basketBudget > 0 ? formatUsd(leg) : "") : formatUsd(row.value)}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <Batch />
      </Panel>
    </div>
  );
}

export function Batch() {
  const { state, dispatch } = useDesk();
  const [sending, setSending] = useState(false);
  const [why, setWhy] = useState("");
  const signature = (state.batch ?? []).map((order) => `${order.symbol}:${order.sizeUsd}:${order.guard.ok}`).join("|");
  useEffect(() => {
    setWhy("");
  }, [signature, state.address]);
  if (!state.batch?.length) return <p className="px-5 pb-5 text-sm text-muted">Preview a buy to see each stock in this group.</p>;
  function fail(detail: string) {
    setWhy(detail);
    dispatch({ type: "note", title: "Not sent", detail });
  }
  return (
    <div className="px-3 pb-4">
      <ul className="space-y-2">
        {state.batch.map((order) => {
          const item = book(order.symbol);
          return (
            <li key={order.key} className="flex items-center gap-3 rounded-2xl bg-bg px-3 py-2">
              <Mark symbol={order.symbol} name={item?.name} round />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{item?.name ?? order.symbol}</p>
                <p className="text-xs text-muted">{order.side === "buy" ? "Buy" : "Sell"} · {formatUsd(order.sizeUsd)}</p>
              </div>
              {!order.guard.ok && <p className="max-w-36 text-right text-xs text-down">{order.guard.blockers[0]}</p>}
            </li>
          );
        })}
      </ul>
      {why && <p className="mt-3 px-2 text-sm text-pretty text-down">{why}</p>}
      <button
        type="button"
        className={`${btnPrimary} mt-4 w-full`}
        disabled={sending}
        onClick={() => {
          if (!state.address) {
            openWalletPicker();
            return;
          }
          const address = state.address;
          const orders = (state.batch ?? []).filter((order) => order.side === "buy" && order.sizeUsd > 0);
          const blocked = orders.find((order) => !order.guard.ok && !order.guard.blockers[0]?.includes("Wallet balance"));
          if (!orders.length) {
            fail("Enter an amount for this group first.");
            return;
          }
          if (blocked) {
            fail(blocked.guard.blockers[0] ?? "This group was not sent.");
            return;
          }
          const need = orders.reduce((sum, order) => sum + order.sizeUsd, 0);
          if (state.cash + 0.001 < need) {
            fail(`This group needs ${formatUsd(need)}. The wallet has ${formatUsd(state.cash)}.`);
            return;
          }
          setSending(true);
          const run = async () => {
            await activateSavedWallet(address);
            pinSavedProvider(address);
            const cashNow = await readCash(address).catch(() => state.cash);
            if (cashNow + 0.001 < need) {
              throw new Error(`This group needs ${formatUsd(need)}. The wallet has ${formatUsd(cashNow)}. Nothing else was sent.`);
            }
            for (const order of orders) {
              const item = book(order.symbol);
              try {
                await buyStock({
                  address,
                  symbol: order.symbol,
                  sizeUsd: order.sizeUsd,
                  token: stockToken(order.symbol) || item?.address,
                  mark: item?.venues.xstocks.price || item?.reference || undefined,
                  maxUsd: Math.max(state.limits.maxSizeUsd, order.sizeUsd),
                });
              } catch (error) {
                const reason = error instanceof Error ? error.message : "The wallet did not send.";
                throw new Error(`${order.symbol}: ${reason}`);
              }
            }
            const cash = await readCash(address);
            dispatch({ type: "wallet", address, cash });
            dispatch({ type: "view", view: "holdings" });
          };
          run()
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : "The wallet did not send.";
              setWhy(detail);
              dispatch({ type: "note", title: "Not sent", detail });
            })
            .finally(() => setSending(false));
        }}
      >
        {sending ? "Waiting for wallet" : "Buy this basket"}
      </button>
    </div>
  );
}
