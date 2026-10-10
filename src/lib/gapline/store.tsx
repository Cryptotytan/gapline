import { createContext, useContext, useEffect, useReducer, useState, type Dispatch, type ReactNode } from "react";
import {
  DEFAULT_LIMITS,
  EXPLAIN_FEE,
  BOOKS,
  BASKETS,
  MARKET,
  applyFill,
  book,
  dryRun,
  explainCopy,
  installLiveBooks,
  planQuotes,
  type Book,
  type Limits,
  type Position,
  type SimOrder,
  type CompiledRule,
} from "./model";
import type { LiveNote } from "./rwa";

export type ViewId = "desk" | "route" | "baskets" | "holdings" | "agent" | "explain" | "start" | "live";

export type Activity = { id: number; title: string; detail: string; wallet?: string };

export type CustomBasket = { id: string; name: string; symbols: string[] };

export type DeskState = {
  view: ViewId;
  symbol: string;
  sizeUsd: number;
  basketBudget: number;
  cash: number;
  positions: Position[];
  walletReady: boolean;
  address: string | null;
  unlinked: boolean;
  limits: Limits;
  activity: Activity[];
  seq: number;
  sim: SimOrder | null;
  batch: SimOrder[] | null;
  ruleText: string;
  rule: CompiledRule | null;
  saved: CompiledRule[];
  shock: boolean;
  paid: Record<string, string>;
  startStep: number;
  books: Book[];
  live: LiveNote | null;
  customBaskets: CustomBasket[];
  hiddenBaskets: string[];
};

type Action =
  | { type: "view"; view: ViewId }
  | { type: "symbol"; symbol: string }
  | { type: "size"; sizeUsd: number }
  | { type: "budget"; basketBudget: number }
  | { type: "cap"; maxSizeUsd: number }
  | { type: "wallet"; address: string; cash: number }
  | { type: "presence"; address: string | null; cash: number }
  | { type: "disconnect" }
  | { type: "chain-fill"; order: SimOrder; cash: number; hash: string }
  | { type: "step"; startStep: number }
  | { type: "sim"; sim: SimOrder | null }
  | { type: "batch"; batch: SimOrder[] | null }
  | { type: "execute-sim" }
  | { type: "execute-batch" }
  | { type: "rule-text"; ruleText: string }
  | { type: "rule"; rule: CompiledRule | null }
  | { type: "save-rule" }
  | { type: "drop-rule"; index: number }
  | { type: "run-saved" }
  | { type: "reset" }
  | { type: "hydrate"; patch: Persisted }
  | { type: "shock"; shock: boolean }
  | { type: "explain" }
  | { type: "note"; title: string; detail: string }
  | { type: "tape"; books: Book[]; marks: Record<string, string>; live: LiveNote }
  | { type: "save-basket"; name: string; symbols: string[] }
  | { type: "drop-basket"; id: string };

const initial: DeskState = {
  view: "desk",
  symbol: "AMD",
  sizeUsd: 10,
  basketBudget: 70,
  cash: 0,
  positions: [],
  walletReady: false,
  address: null,
  unlinked: false,
  limits: DEFAULT_LIMITS,
  activity: [
    {
      id: 0,
      title: "Wallet",
      detail: "Connect a wallet on BNB Chain. A buy is signed by you. Nothing is sent until you approve it.",
    },
  ],
  seq: 1,
  sim: null,
  batch: null,
  ruleText: "",
  rule: null,
  saved: [],
  shock: false,
  paid: {},
  startStep: 0,
  books: BOOKS,
  live: null,
  customBaskets: [],
  hiddenBaskets: [],
};

function note(state: DeskState, title: string, detail: string): DeskState {
  return {
    ...state,
    seq: state.seq + 1,
    activity: [{ id: state.seq, title, detail, wallet: state.address ?? "" }, ...state.activity].slice(0, 24),
  };
}

function settle(state: DeskState, orders: SimOrder[], title: string): DeskState {
  const ready = orders.filter((o) => o.guard.ok);
  if (!ready.length) return note(state, "Blocked", orders[0]?.guard.blockers[0] ?? "Nothing to send.");
  let cash = state.cash;
  let positions = state.positions;
  for (const order of ready) {
    if (order.side === "buy") cash -= order.sizeUsd;
    else cash += order.sizeUsd;
    positions = applyFill(positions, order);
  }
  const detail = ready
    .map((o) => `${o.side} ${o.token} ${o.sizeUsd.toFixed(2)} @ ${o.effective.toFixed(2)}`)
    .join(" · ");
  return note({ ...state, cash, positions, sim: null, batch: null }, title, detail);
}

function reducer(state: DeskState, action: Action): DeskState {
  switch (action.type) {
    case "view":
      return { ...state, view: action.view };
    case "symbol":
      return { ...state, symbol: action.symbol, sim: null };
    case "size":
      return { ...state, sizeUsd: action.sizeUsd, sim: null };
    case "budget":
      return { ...state, basketBudget: action.basketBudget, batch: null };
    case "cap":
      return { ...state, limits: { maxSizeUsd: action.maxSizeUsd }, sim: null, batch: null };
    case "wallet":
      return note(
        { ...state, address: action.address, walletReady: true, unlinked: false, cash: action.cash },
        "Wallet connected",
        `${action.address.slice(0, 6)}…${action.address.slice(-4)} · ${action.cash.toFixed(2)} USDC/USDT.`,
      );
    case "presence":
      if (!action.address) {
        if (!state.address) return state;
        return { ...state, address: null, walletReady: false, cash: 0 };
      }
      if (state.address === action.address && state.walletReady) return { ...state, cash: action.cash };
      return { ...state, address: action.address, walletReady: true, unlinked: false, cash: action.cash };
    case "disconnect":
      return note(
        { ...state, address: null, walletReady: false, unlinked: true, cash: 0 },
        "Disconnected",
        "The wallet is disconnected. Connect again when you want to sign.",
      );
    case "chain-fill": {
      const positions = applyFill(state.positions, action.order);
      return note(
        { ...state, positions, cash: action.cash, sim: null },
        "Sent",
        `${action.order.side} ${action.order.token} · ${action.hash}`,
      );
    }
    case "step":
      return { ...state, startStep: action.startStep };
    case "sim":
      return action.sim
        ? note({ ...state, sim: action.sim, batch: null }, action.sim.guard.ok ? "Ready" : "Blocked", `${action.sim.side} ${action.sim.token} · ${action.sim.guard.ok ? "ready for your wallet" : action.sim.guard.blockers[0]}`)
        : { ...state, sim: null };
    case "batch": {
      if (!action.batch) return { ...state, batch: null };
      const bad = action.batch.filter((o) => !o.guard.ok);
      return note(
        { ...state, batch: action.batch, sim: null },
        bad.length ? "Batch blocked" : "Batch simulated",
        bad.length ? bad.map((o) => `${o.symbol}: ${o.guard.blockers[0]}`).join(" ") : `${action.batch.length} legs quoted. Nothing sent.`,
      );
    }
    case "execute-sim":
      if (state.address) return note(state, "Blocked", "This is your wallet. Use Buy now so you can sign.");
      if (!state.sim) return note(state, "Blocked", "Simulate the order first.");
      if (!state.sim.guard.ok) return note(state, "Blocked", state.sim.guard.blockers[0]);
      return settle(state, [state.sim], "Paper fill");
    case "execute-batch":
      if (!state.batch?.length) return note(state, "Blocked", "Simulate the batch first.");
      if (state.batch.some((o) => !o.guard.ok)) return note(state, "Blocked", "Every leg has to pass. Nothing was sent.");
      return settle(state, state.batch, "Paper batch");
    case "rule-text":
      return { ...state, ruleText: action.ruleText };
    case "rule":
      return { ...state, rule: action.rule, batch: null };
    case "save-rule": {
      if (!state.rule?.ok) return note(state, "Not saved", "A refusal is not a standing order.");
      if (state.saved.some((rule) => rule.source === state.rule?.source)) {
        return note(state, "Already saved", state.rule.summary);
      }
      return note({ ...state, saved: [...state.saved, state.rule] }, "Rule saved", state.rule.summary);
    }
    case "drop-rule":
      return { ...state, saved: state.saved.filter((_, index) => index !== action.index) };
    case "run-saved": {
      if (state.address) return note(state, "Rules held", "A saved rule does not sign your wallet. Nothing was sent.");
      let next = state;
      let fills = 0;
      const btc = state.shock ? -600 : MARKET.btcMoveBps;
      for (const rule of state.saved) {
        const run = dryRun(rule, next.positions, next.cash, btc);
        if (!run.fired || !run.orders.length) continue;
        const quoted = planQuotes({
          orders: run.orders,
          cash: next.cash,
          positions: next.positions,
          limits: next.limits,
          walletReady: next.walletReady,
        });
        const bad = quoted.orders.find((order) => !order.guard.ok);
        if (bad || quoted.orders.length !== run.orders.length) {
          next = note(next, "Rule held", bad?.guard.blockers[0] ?? "A leg was refused. Nothing from that rule was sent.");
          continue;
        }
        next = settle(next, quoted.orders, "Rule filled");
        fills += 1;
      }
      if (!fills && next === state) return note(state, "Rules checked", "Nothing was due. A refusal still sends nothing.");
      return next;
    }
    case "reset":
      return note(
        { ...initial, books: state.books, live: state.live, customBaskets: state.customBaskets ?? [], hiddenBaskets: state.hiddenBaskets ?? [], address: state.address, walletReady: state.walletReady, cash: state.cash, seq: state.seq + 1, activity: [] },
        "Cleared",
        "The record in this browser was cleared. Your wallet was not touched.",
      );
    case "hydrate":
      return { ...state, ...sanitize(action.patch) };
    case "shock":
      return { ...state, shock: action.shock, batch: null };
    case "explain": {
      const b = book(state.symbol);
      if (!b) return state;
      if (state.paid[state.symbol]) return state;
      if (!state.walletReady) return note(state, "Blocked", "Connect a wallet before paying for a note.");
      if (!state.address && state.cash < EXPLAIN_FEE) return note(state, "Blocked", "Not enough cash for the 0.10 note.");
      return note(
        { ...state, cash: state.address ? state.cash : state.cash - EXPLAIN_FEE, paid: { ...state.paid, [state.symbol]: explainCopy(b) } },
        "Note",
        state.address ? `Shown for ${b.symbol}. Your wallet was not charged.` : `0.10 USDT paper debit for ${b.symbol}.`,
      );
    }
    case "note":
      return note(state, action.title, action.detail);
    case "tape":
      installLiveBooks(action.books, action.marks);
      return { ...state, books: action.books, live: action.live, sim: null };
    case "save-basket": {
      const symbols = [...new Set(action.symbols.map((symbol) => symbol.toUpperCase()))].slice(0, 12);
      const name = action.name.trim().slice(0, 40);
      if (name.length < 2 || symbols.length < 2) return note(state, "Group not saved", "Name the group and pick at least two stocks.");
      const existing = state.customBaskets ?? [];
      const basket = { id: `c-${state.seq}`, name, symbols };
      return note({ ...state, customBaskets: [basket, ...existing] }, "Group saved", `${name}: ${symbols.join(", ")}.`);
    }
    case "drop-basket": {
      if ((Object.keys(BASKETS) as string[]).includes(action.id)) {
        const hidden = state.hiddenBaskets ?? [];
        return { ...state, hiddenBaskets: hidden.includes(action.id) ? hidden : [...hidden, action.id], batch: null };
      }
      return { ...state, customBaskets: (state.customBaskets ?? []).filter((basket) => basket.id !== action.id), batch: null };
    }
    default:
      return state;
  }
}

const STORAGE_KEY = "gapline.v2";

export type Persisted = {
  cash?: number;
  positions?: Position[];
  sizeUsd?: number;
  basketBudget?: number;
  limits?: Limits;
  activity?: Activity[];
  seq?: number;
  ruleText?: string;
  saved?: CompiledRule[];
  paid?: Record<string, string>;
  unlinked?: boolean;
  customBaskets?: CustomBasket[];
  hiddenBaskets?: string[];
};

function sanitize(patch: Persisted): Partial<DeskState> {
  const next: Partial<DeskState> = {};
  if (typeof patch.cash === "number" && Number.isFinite(patch.cash)) next.cash = patch.cash;
  if (typeof patch.sizeUsd === "number" && patch.sizeUsd > 0) next.sizeUsd = patch.sizeUsd;
  if (typeof patch.basketBudget === "number" && patch.basketBudget > 0) next.basketBudget = patch.basketBudget;
  if (patch.limits && typeof patch.limits.maxSizeUsd === "number") next.limits = { maxSizeUsd: patch.limits.maxSizeUsd };
  if (typeof patch.ruleText === "string" && patch.ruleText !== "Buy $10 of the widest liquid gap while the market is closed.") {
    next.ruleText = patch.ruleText;
  }
  if (typeof patch.seq === "number") next.seq = patch.seq;
  if (Array.isArray(patch.positions)) {
    next.positions = patch.positions.filter((position) => position && position.qty > 0 && typeof position.symbol === "string");
  }
  if (Array.isArray(patch.activity)) next.activity = patch.activity.slice(0, 24);
  if (Array.isArray(patch.saved)) next.saved = patch.saved.filter((rule) => rule && rule.ok);
  if (patch.paid && typeof patch.paid === "object") next.paid = patch.paid;
  if (patch.unlinked === true) next.unlinked = true;
  if (Array.isArray(patch.customBaskets)) {
    next.customBaskets = patch.customBaskets
      .filter((basket) => basket && typeof basket.id === "string" && typeof basket.name === "string" && Array.isArray(basket.symbols))
      .map((basket) => ({
        id: basket.id,
        name: basket.name.slice(0, 40),
        symbols: basket.symbols.filter((symbol) => typeof symbol === "string").slice(0, 12),
      }))
      .filter((basket) => basket.symbols.length >= 2);
  }
  if (Array.isArray(patch.hiddenBaskets)) {
    next.hiddenBaskets = patch.hiddenBaskets.filter((id) => typeof id === "string");
  }
  return next;
}

function persist(state: DeskState) {
  const body: Persisted = {
    cash: state.cash,
    positions: state.positions,
    sizeUsd: state.sizeUsd,
    basketBudget: state.basketBudget,
    limits: state.limits,
    activity: state.activity,
    seq: state.seq,
    ruleText: state.ruleText,
    saved: state.saved,
    paid: state.paid,
    unlinked: state.unlinked,
    customBaskets: state.customBaskets,
    hiddenBaskets: state.hiddenBaskets,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(body));
}

const DeskContext = createContext<{ state: DeskState; dispatch: Dispatch<Action> } | null>(null);

export function DeskProvider({
  children,
  initialView = "desk",
  initialSymbol,
}: {
  children: ReactNode;
  initialView?: ViewId;
  initialSymbol?: string;
}) {
  const [state, dispatch] = useReducer(reducer, { view: initialView, symbol: initialSymbol }, (seed) => ({
    ...initial,
    view: seed.view,
    symbol: seed.symbol ?? initial.symbol,
  }));
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "hydrate", patch: JSON.parse(raw) as Persisted });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setBooted(true);
  }, []);
  useEffect(() => {
    if (!booted) return;
    persist(state);
  }, [booted, state]);
  return <DeskContext.Provider value={{ state, dispatch }}>{children}</DeskContext.Provider>;
}

export function useDesk() {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("Desk missing");
  return ctx;
}
