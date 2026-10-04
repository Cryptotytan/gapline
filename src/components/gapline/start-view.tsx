import { useDesk } from "@/lib/gapline/store";
import { classify, formatUsd, quoteOrder } from "@/lib/gapline/model";
import { CallBadge, Kicker, Mark, Panel, btnPrimary } from "./ui";
import { buyStock, readCash, shortAddress } from "@/lib/gapline/wallet";
import { openWalletPicker } from "@/lib/gapline/wallet-book";

const FIRST = ["AAPL", "NVDA", "AMZN"];

export function StartView() {
  const { state, dispatch } = useDesk();
  const choices = state.books.filter((b) => FIRST.includes(b.symbol));
  const selected = choices.find((b) => b.symbol === state.symbol) ?? choices[0];
  const sim = quoteOrder({
    symbol: selected.symbol,
    side: "buy",
    sizeUsd: 5,
    cash: state.cash,
    positions: state.positions,
    limits: state.limits,
    walletReady: state.walletReady,
  });

  return (
    <Panel className="mx-auto max-w-xl p-5 sm:p-6">
      <Kicker>First buy</Kicker>
      <h2 className="mt-1 font-display text-2xl text-fg sm:text-3xl">Connect a wallet, then one share token.</h2>
      <ol className="mt-5 space-y-3">
        <li className="rounded-xl bg-raised p-4">
          <p className="text-sm text-fg">1. Connect the wallet</p>
          <p className="mt-1 text-sm text-muted">
            {state.address
              ? `${shortAddress(state.address)} on BNB Chain. Gapline never asks for a seed phrase.`
              : "MetaMask or Binance Wallet. The site never asks for a seed phrase."}
          </p>
          {!state.address && (
            <button
              type="button"
              className={`${btnPrimary} mt-3`}
              onClick={() => openWalletPicker()}
            >
              Connect wallet
            </button>
          )}
        </li>
        <li className="rounded-xl bg-raised p-4">
          <p className="text-sm text-fg">2. Pick the first name</p>
          <div className="mt-3 grid gap-2">
            {choices.map((b) => {
              const call = classify(b);
              return (
                <button
                  key={b.symbol}
                  type="button"
                  disabled={!state.walletReady}
                  onClick={() => dispatch({ type: "symbol", symbol: b.symbol })}
                  className={`flex h-14 items-center gap-2 rounded-xl px-2 text-sm disabled:opacity-40 ${selected.symbol === b.symbol ? "bg-primary text-primary-fg" : "bg-surface text-fg"}`}
                >
                  <Mark symbol={b.symbol} name={b.name} />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {b.name}
                  </span>
                  <CallBadge id={call.id} label={call.label} />
                </button>
              );
            })}
          </div>
        </li>
        <li className="rounded-xl bg-raised p-4">
          <p className="text-sm text-fg">3. Buy {formatUsd(5, 0)} through the same pipe</p>
          {sim && (
            <p className="mt-2 text-sm text-muted">
              {sim.token} effective {formatUsd(sim.effective)} · impact {sim.impactBps} bp.
              {sim.guard.blockers[0] ? ` ${sim.guard.blockers[0]}` : ""}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className={btnPrimary}
              disabled={!sim?.guard.ok}
              onClick={() => {
                if (!sim) return;
                dispatch({ type: "sim", sim });
              }}
            >
              Review {formatUsd(5, 0)}
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!state.sim || state.sim.key !== sim?.key || !state.sim.guard.ok}
              onClick={() => {
                if (!sim || !state.address) return;
                const order = sim;
                buyStock({
                  address: state.address,
                  symbol: selected.symbol,
                  sizeUsd: order.sizeUsd,
                  maxUsd: state.limits.maxSizeUsd,
                  mark: selected.venues.xstocks.price || selected.reference || undefined,
                })
                  .then(async (sent) => {
                    const cash = await readCash(state.address as string);
                    dispatch({ type: "chain-fill", order: { ...order, venue: "xstocks", qty: sent.qty }, cash, hash: sent.hash });
                    dispatch({ type: "view", view: "desk" });
                  })
                  .catch((error: unknown) =>
                    dispatch({
                      type: "note",
                      title: "Not sent",
                      detail: error instanceof Error ? error.message : "The wallet did not send.",
                    }),
                  );
              }}
            >
              Sign and open the desk
            </button>
          </div>
        </li>
      </ol>
    </Panel>
  );
}
