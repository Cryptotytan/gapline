import { useDesk } from "@/lib/gapline/store";
import { MARKET, classify, compileRule, dryRun, gapOf, planQuotes } from "@/lib/gapline/model";
import { askAgent } from "@/lib/gapline/agent";
import { buyStock, connectWallet, readCash, sellStock } from "@/lib/gapline/wallet";
import { Kicker, Panel, btnGhost, btnPrimary } from "./ui";
import { useState } from "react";

const SAMPLES = [
  "Buy $10 of the widest liquid gap while the market is closed.",
  "Put $25 into the AI basket every Monday and fix it if a name drifts past 5%.",
  "If Bitcoin is up and the stock is not, buy nothing.",
  "Sell the name the day before earnings and buy it back after.",
  "Keep half the book in stocks and half in Bitcoin, and fix it when they diverge.",
  "Buy $10 of Micron. The gap looks free.",
  "Sell Apple if it is 5% above what I paid.",
  "Sell Apple if it falls 3% from what I paid.",
];

export function AgentView() {
  const { state, dispatch } = useDesk();
  const btc = state.shock ? -600 : MARKET.btcMoveBps;
  const rule = state.rule;
  const run = rule ? dryRun(rule, state.positions, state.cash, btc) : null;
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [agentLine, setAgentLine] = useState<string | null>(null);

  function apply(source: string, explanation?: string) {
    const next = compileRule(source, state.limits.maxSizeUsd);
    if (explanation) next.notes = [explanation, ...next.notes];
    dispatch({ type: "rule", rule: next });
  }

  function compile() {
    const sentence = state.ruleText.trim();
    if (!sentence) {
      apply(state.ruleText);
      return;
    }
    const tape = state.books
      .map((book) => {
        const gap = gapOf(book);
        return `${book.symbol} ${book.name} ${classify(book).id} ${gap == null ? "no-friday" : `${Math.round(gap)}bp`}`;
      })
      .join("\n");
    setReading(true);
    setAgentLine(null);
    askAgent({ data: { sentence, tape } })
      .then((result) => {
        if (!result.ok) {
          setAgentLine(result.error);
          apply(sentence);
          return;
        }
        setAgentLine(result.explanation);
        apply(result.rewrite, result.explanation);
      })
      .catch(() => {
        setAgentLine("The agent could not read that. The sentence was checked without it.");
        apply(sentence);
      })
      .finally(() => setReading(false));
  }

  function simulate() {
    if (!rule) {
      dispatch({ type: "note", title: "Rule", detail: state.ruleText.trim() ? "Ask the agent to read the sentence first." : "Type a command first." });
      return;
    }
    if (!rule.ok || !run?.fired || !run.orders.length) {
      dispatch({ type: "note", title: "Rule held", detail: !rule.ok ? rule.summary : (run?.reason ?? "Nothing is due. Nothing was sent.") });
      return;
    }
    const quoted = planQuotes({
      orders: run.orders,
      cash: state.cash || Number.MAX_SAFE_INTEGER,
      positions: state.positions,
      limits: state.limits,
      walletReady: true,
    });
    const blocked = quoted.orders.find((order) => !order.guard.ok && !order.guard.blockers[0]?.startsWith("Wallet balance"));
    if (!quoted.orders.length || blocked) {
      dispatch({ type: "note", title: "Rule held", detail: blocked?.guard.blockers[0] ?? "Nothing was sent." });
      return;
    }
    setRunning(true);
    const send = async () => {
      const wallet = state.address ? { address: state.address, cash: state.cash } : await connectWallet();
      dispatch({ type: "wallet", address: wallet.address, cash: wallet.cash });
      for (const order of quoted.orders) {
        if (order.side === "sell") {
          const qty = order.sizeUsd / (state.books.find((book) => book.symbol === order.symbol)?.venues.xstocks.price || order.sizeUsd);
          const sent = await sellStock({ address: wallet.address, symbol: order.symbol, qty });
          const cash = await readCash(wallet.address);
          dispatch({ type: "chain-fill", order, cash, hash: sent.hash });
          continue;
        }
        const book = state.books.find((item) => item.symbol === order.symbol);
        const sent = await buyStock({
          address: wallet.address,
          symbol: order.symbol,
          sizeUsd: order.sizeUsd,
          maxUsd: state.limits.maxSizeUsd,
          mark: book?.venues.xstocks.price || book?.reference || undefined,
        });
        const cash = await readCash(wallet.address);
        dispatch({ type: "chain-fill", order: { ...order, venue: "xstocks", qty: sent.qty }, cash, hash: sent.hash });
      }
      dispatch({ type: "view", view: "holdings" });
    };
    send()
      .catch((error: unknown) =>
        dispatch({
          type: "note",
          title: "Not sent",
          detail: error instanceof Error ? error.message : "The wallet did not send.",
        }),
      )
      .finally(() => setRunning(false));
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
      <Panel className="p-3 sm:p-5">
        <Kicker>Rules</Kicker>
        <h2 className="mt-1 font-display text-2xl text-fg sm:text-3xl">Say what to do</h2>
        <p className="mt-2 text-sm text-pretty text-muted">
          The agent reads a normal sentence, then the same checks still refuse a thin book. It does not sign your wallet.
        </p>
        <textarea
          value={state.ruleText}
          onChange={(e) => dispatch({ type: "rule-text", ruleText: e.target.value })}
          rows={4}
          placeholder="Type a command, or say what to buy."
          className="mt-4 w-full rounded-xl bg-raised p-3 text-sm text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-primary"
        />
        <div className="mt-3 flex flex-col gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              className="rounded-xl bg-raised px-3 py-3 text-left text-sm text-muted hover:text-fg"
              onClick={() => dispatch({ type: "rule-text", ruleText: sample })}
            >
              {sample}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={btnPrimary} disabled={reading} onClick={compile}>
            {reading ? "Reading" : "Ask the agent"}
          </button>
          <button type="button" className={btnGhost} disabled={!rule?.ok} onClick={() => dispatch({ type: "save-rule" })}>
            Save rule
          </button>
          <button type="button" className={btnGhost} onClick={() => dispatch({ type: "shock", shock: !state.shock })}>
            {state.shock ? "Using a −6% BTC shock" : "Shock BTC −6%"}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          The desk tape still has BTC {(MARKET.btcMoveBps / 100).toFixed(1)}% since Friday. The shock only changes this dry-run.
        </p>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel className="p-5">
          <Kicker>{rule && !rule.ok ? "Refused" : run?.fired ? "Would send" : "Scheduled"}</Kicker>
          {!rule && <p className="mt-2 text-sm text-muted">Ask the agent to schedule a sentence, or to refuse it.</p>}
          {agentLine && !rule?.notes.includes(agentLine) && <p className="mt-2 text-sm text-pretty text-muted">{agentLine}</p>}
          {rule && (
            <>
              <p className={`mt-2 text-sm text-pretty ${rule.ok ? "text-fg" : "text-down"}`}>{rule.summary}</p>
              {rule.notes.map((n) => (
                <p key={n} className="mt-2 text-sm text-down">
                  {n}
                </p>
              ))}
              {rule.ok && rule.flattenAfterOpenMin != null && (
                <p className="mt-2 text-sm text-muted">
                  Flatten {rule.flattenAfterOpenMin} minutes after the next open is noted. Monday has not arrived on this tape.
                </p>
              )}
            </>
          )}
          {run && rule?.ok && <p className={`mt-4 text-sm text-pretty ${run.fired ? "text-primary" : "text-fg"}`}>{run.reason}</p>}
          <button type="button" className={`${btnPrimary} mt-3`} disabled={running} onClick={simulate}>
            {running ? "Waiting for wallet" : "Run the rule"}
          </button>
        </Panel>
        <Panel>
          <div className="px-5 py-5">
            <Kicker>Saved</Kicker>
            {state.saved.length === 0 ? (
              <p className="mt-2 text-sm text-muted">A saved rule can be run later. A refusal cannot.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {state.saved.map((item, index) => (
                  <li key={`${item.source}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-pretty text-fg">{item.summary}</span>
                    <button type="button" className="shrink-0 text-muted" onClick={() => dispatch({ type: "drop-rule", index })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className={`${btnPrimary} mt-3`} disabled={state.saved.length === 0} onClick={() => dispatch({ type: "run-saved" })}>
              Run saved rules
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
