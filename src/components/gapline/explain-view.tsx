import { useDesk } from "@/lib/gapline/store";
import { EXPLAIN_FEE, formatUsd } from "@/lib/gapline/model";
import { Kicker, Mark, Panel, btnPrimary, field } from "./ui";

export function ExplainView() {
  const { state, dispatch } = useDesk();
  const b = state.books.find((x) => x.symbol === state.symbol) ?? state.books[0];
  const paid = state.paid[b.symbol];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Panel className="p-5">
        <Kicker>Why</Kicker>
        <h2 className="mt-1 font-display text-2xl text-fg sm:text-3xl">Why did it move?</h2>
        <p className="mt-2 text-sm text-pretty text-muted">
          A specialist note for one ticker. It does not charge your wallet.
        </p>
        <label className="mt-4 flex flex-col gap-2 text-sm">
          <span className="text-muted">Ticker</span>
          <select
            className={field}
            value={b.symbol}
            onChange={(e) => dispatch({ type: "symbol", symbol: e.target.value })}
          >
            {state.books
              .filter((book) => book.reference != null)
              .map((book) => (
              <option key={book.symbol} value={book.symbol}>
                {book.symbol} · {book.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`${btnPrimary} mt-4`} disabled={Boolean(paid)} onClick={() => dispatch({ type: "explain" })}>
          {paid ? "Already paid" : `Buy note · ${formatUsd(EXPLAIN_FEE)}`}
        </button>
      </Panel>
      <Panel className="p-5">
        <div className="flex items-center gap-3">
          <Mark symbol={b.symbol} name={b.name} />
          <div>
            <Kicker>{b.symbol}</Kicker>
            <p className="font-display text-2xl text-fg">{b.name}</p>
          </div>
        </div>
        {paid ? (
          <p className="mt-5 rounded-xl bg-raised p-4 text-sm leading-relaxed text-pretty text-fg">{paid}</p>
        ) : (
          <p className="mt-5 rounded-xl bg-raised p-4 text-sm leading-relaxed text-pretty text-muted">
            The note stays hidden until you pay. It covers the on-chain print, the frozen reference, whether Ondo’s premium is carry, and what BTC did while the cash market was shut.
          </p>
        )}
        <p className="mt-6 text-xs text-muted">Receipts land in the log. This is not a model call and it does not leave the page.</p>
      </Panel>
    </div>
  );
}
