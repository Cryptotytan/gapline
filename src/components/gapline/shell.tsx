import { DeskProvider, useDesk, type ViewId } from "@/lib/gapline/store";
import { formatUsd, nav } from "@/lib/gapline/model";
import { readAssets, readCash, rememberStocks, shortAddress, watchAccounts } from "@/lib/gapline/wallet";
import { activateSavedWallet, describeSmartWallet, disconnectSmart, finishSmartWalletWithX, resumeSmartWallet, xWalletError } from "@/lib/gapline/smart-wallet";
import { forgetLinked, markForName, pinSavedProvider, readLinked, rememberLinked, type LinkedWallet } from "@/lib/gapline/wallet-book";
import { ConnectModal } from "./connect-modal";
import { applyCashPrints, appendCatalog, applyLiveSnapshot, getCashPrints, getCatalog, getLiveSnapshot, getLiveTape, mergeTape, tapeSession } from "@/lib/gapline/rwa";
import { AgentView } from "./agent-view";
import { BasketsView } from "./baskets-view";
import { Desk } from "./desk";
import { ExplainView } from "./explain-view";
import { HoldingsView } from "./holdings-view";
import { LiveView } from "./live-view";
import { RouteView } from "./route-view";
import { StartView } from "./start-view";
import { Mark, XLogo, btnGhost } from "./ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

const NAV: { id: ViewId; label: string }[] = [
  { id: "desk", label: "Today" },
  { id: "route", label: "Buy" },
  { id: "baskets", label: "Baskets" },
  { id: "holdings", label: "Holdings" },
  { id: "agent", label: "Rules" },
  { id: "explain", label: "Why" },
];

export function GaplineApp({ initialView, initialSymbol }: { initialView?: ViewId; initialSymbol?: string }) {
  return (
    <DeskProvider initialView={initialView} initialSymbol={initialSymbol}>
      <Shell />
    </DeskProvider>
  );
}

function Shell() {
  const { state, dispatch } = useDesk();
  useEffect(() => {
    let stop = false;
    let settled = false;
    const booksRef = { current: state.books };
    booksRef.current = state.books;
    const load = () => {
      const snapshotPromise = getLiveSnapshot();
      snapshotPromise.then((snapshot) => {
        if (stop || settled || !snapshot.ok) return;
        const books = applyLiveSnapshot(booksRef.current, snapshot.rows, snapshot.btcMoveBps);
        booksRef.current = books;
        dispatch({
          type: "tape",
          books,
          marks: {},
          live: { ok: true, open: false, nextAt: null, clock: false, detail: snapshot.detail },
        });
      });
      Promise.all([getLiveTape(), getCashPrints(), getCatalog(), snapshotPromise])
        .then(([result, cash, catalog, snapshot]) => {
          if (stop) return;
          settled = true;
          const previous = booksRef.current;
          const base = result.ok ? mergeTape(result.tokens).books : previous;
          const kept = base.map((book) => {
            const older = previous.find((item) => item.symbol === book.symbol);
            return older?.tape && !book.tape ? { ...book, tape: older.tape } : book;
          });
          const priced = cash.ok ? applyCashPrints(kept, cash.rows) : kept;
          const merged = catalog.ok ? appendCatalog(priced, catalog.rows) : { books: priced, marks: {} };
          const books = snapshot.ok ? applyLiveSnapshot(merged.books, snapshot.rows, snapshot.btcMoveBps) : merged.books;
          if (catalog.ok) rememberStocks(catalog.rows);
          const session = result.ok ? tapeSession(result.tokens) : { ok: false as const, detail: "The price feed did not answer." };
          const live = snapshot.ok
            ? { ok: true as const, open: session.ok ? session.open : false, nextAt: session.ok ? session.nextAt : null, clock: false, detail: snapshot.detail }
            : cash.ok
              ? {
                  ok: true as const,
                  open: session.ok ? session.open : false,
                  nextAt: session.ok ? session.nextAt : null,
                  clock: session.ok ? session.clock : false,
                  detail: "Prices are the last market print. The on-chain mark did not come back.",
                }
              : { ok: false as const, detail: session.ok ? session.detail : "Prices did not come back." };
          dispatch({ type: "tape", books, marks: merged.marks, live });
          booksRef.current = books;
        })
        .catch(() => {
          if (stop) return;
          dispatch({
            type: "tape",
            books: state.books,
            marks: {},
            live: { ok: false, detail: "Prices did not come back." },
          });
        });
    };
    load();
    const timer = window.setInterval(load, 45_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [dispatch]);
  const dismissed = useRef(false);
  useEffect(() => {
    let stop = false;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const fromX = params.get("x") === "1";
      const oauthError = params.get("error");
      if (oauthError) {
        const detail =
          oauthError === "access_denied"
            ? "You closed the X login. Nothing was created."
            : oauthError === "state_mismatch"
              ? "That X login expired. Use Continue with X again."
              : "X did not finish signing in. Use Continue with X again.";
        dispatch({ type: "note", title: "X did not connect", detail });
      }
      let created = await finishSmartWalletWithX();
      if (stop) return;
      let address = created ?? (await resumeSmartWallet());
      if (!address && fromX) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        if (stop) return;
        created = await finishSmartWalletWithX();
        address = created ?? (await resumeSmartWallet());
      }
      if (stop || !address) {
        if (!stop && fromX) {
          dispatch({
            type: "note",
            title: "X did not connect",
            detail: xWalletError() || "X did not finish signing in. Try Continue with X again.",
          });
        }
        return;
      }
      if (!created && !fromX && addressRef.current && addressRef.current.toLowerCase() !== address.toLowerCase()) {
        disconnectSmart();
        return;
      }
      dismissed.current = false;
      const cash = await readCash(address).catch(() => 0);
      if (stop || dismissed.current) return;
      dispatch({ type: "wallet", address, cash });
      const described = describeSmartWallet(address);
      rememberLinked({
        address,
        name: described?.name ?? "X wallet",
        kind: described?.kind ?? "x",
      });
      setLinked(readLinked());
      if (created || fromX) {
        const url = new URL(window.location.href);
        if (url.searchParams.has("x")) {
          url.searchParams.delete("x");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        }
        dispatch({
          type: "note",
          title: "Wallet ready",
          detail: `${shortAddress(address)} is a real BNB Chain wallet. Send USDT or USDC to it when you want to buy.`,
        });
      }
    })();
    return () => {
      stop = true;
    };
  }, [dispatch]);
  const addressRef = useRef<string | null>(null);
  addressRef.current = state.address;
  useEffect(() => {
    return watchAccounts((address) => {
      if (dismissed.current || !address) return;
      const current = addressRef.current;
      if (current && current.toLowerCase() !== address.toLowerCase()) return;
      readCash(address)
        .catch(() => 0)
        .then((cash) => {
          if (dismissed.current) return;
          dispatch({ type: "presence", address, cash });
        });
    });
  }, [dispatch]);
  const [held, setHeld] = useState<string[]>([]);
  useEffect(() => {
    if (!state.address) {
      setHeld([]);
      return;
    }
    let stop = false;
    readAssets(state.address)
      .then((assets) => {
        if (stop) return;
        setHeld(
          assets
            .filter((asset) => {
              if (asset.side !== "stock" || asset.amount <= 0.000001) return false;
              const book = state.books.find((item) => item.symbol === asset.symbol);
              const price = book?.venues.xstocks.price ?? book?.reference ?? 0;
              return price <= 0 || price * asset.amount >= 0.01;
            })
            .map((asset) => asset.symbol),
        );
      })
      .catch(() => {
        if (!stop) setHeld([]);
      });
    return () => {
      stop = true;
    };
  }, [state.address, state.positions, state.books]);
  const worth = nav(state.cash, state.positions);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const walletBox = useRef<HTMLDivElement>(null);
  const [linked, setLinked] = useState<LinkedWallet[]>([]);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && walletBox.current?.contains(target)) return;
      setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  useEffect(() => {
    const rows = readLinked();
    for (const row of rows) {
      const described = describeSmartWallet(row.address);
      if (!described) continue;
      if (row.name === "Saved wallet" || row.name === "X" || (described.kind === "x" && row.name !== described.name)) {
        rememberLinked({ address: row.address, name: described.name, kind: described.kind });
      }
    }
    setLinked(readLinked());
    const open = () => setPicker(true);
    window.addEventListener("gapline:connect", open);
    return () => window.removeEventListener("gapline:connect", open);
  }, [state.address]);
  function useWallet(address: string, cash: number, created = false) {
    dismissed.current = false;
    setPicker(false);
    setMenu(false);
    setLinked(readLinked());
    dispatch({ type: "wallet", address, cash });
    if (created) {
      dispatch({
        type: "note",
        title: "Wallet ready",
        detail: `${shortAddress(address)} stays with this X login. Copy the address from the wallet menu.`,
      });
    }
  }
  function disconnectOne(wallet: LinkedWallet) {
    const next = forgetLinked(wallet.address);
    setLinked(next);
    if (state.address?.toLowerCase() !== wallet.address.toLowerCase()) return;
    const fallback = next[0];
    if (!fallback) {
      dismissed.current = true;
      setMenu(false);
      if (wallet.kind !== "external") disconnectSmart();
      pinSavedProvider(wallet.address);
      dispatch({ type: "disconnect" });
      return;
    }
    if (wallet.kind !== "external") disconnectSmart();
    void activateSavedWallet(fallback.address).then(() => {
      pinSavedProvider(fallback.address);
      readCash(fallback.address)
        .catch(() => 0)
        .then((cash) => dispatch({ type: "wallet", address: fallback.address, cash }));
    });
  }
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <Link to="/" className="font-display text-xl leading-none text-fg sm:text-3xl">
            Gapline
          </Link>
          <div ref={walletBox} className="relative flex items-center">
            <button
              type="button"
              aria-expanded={state.address ? menu : picker}
              className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-1.5 pr-2.5 text-sm active:scale-[0.98] sm:h-11 sm:pr-3 ${
                state.address
                  ? "border-line bg-surface text-fg hover:border-primary"
                  : "border-primary/50 bg-surface text-fg hover:border-primary hover:bg-primary hover:text-primary-fg"
              }`}
              onClick={() => (state.address ? setMenu((open) => !open) : setPicker(true))}
            >
              {state.address && (linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.kind === "x" || describeSmartWallet(state.address)?.kind === "x") ? (
                <span className="relative grid size-8 min-h-8 min-w-8 shrink-0 place-items-center rounded-full bg-fg text-bg">
                  <XLogo className="size-3.5" />
                  <span className="absolute right-0 bottom-0 size-2 rounded-full bg-[#8fb56a] ring-2 ring-surface" />
                </span>
              ) : state.address && markForName(linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.name ?? "") ? (
              <span className="relative grid size-8 min-h-8 min-w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#14120f]">
                <img src={markForName(linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.name ?? "")} alt="" className="size-8 object-contain" />
                <span className="absolute right-0 bottom-0 size-2 rounded-full bg-[#8fb56a] ring-2 ring-surface" />
              </span>
              ) : (
              <span className={`relative grid size-8 min-h-8 min-w-8 shrink-0 place-items-center rounded-full text-[11px] font-medium ${state.address ? "bg-primary text-primary-fg" : "bg-primary/15 text-primary"}`}>
                {state.address ? (
                  state.address.slice(2, 4).toUpperCase()
                ) : (
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="1.5" y="3.5" width="13" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="11.5" cy="9.3" r="0.9" fill="currentColor" />
                  </svg>
                )}
                {state.address && <span className="absolute right-0 bottom-0 size-2 rounded-full bg-[#8fb56a] ring-2 ring-surface" />}
              </span>
              )}
              <span className="max-w-[7.2rem] text-left sm:max-w-none">
                <span className="block truncate text-xs leading-none font-medium">{state.address ? shortAddress(state.address) : "Connect wallet"}</span>
                <span className="mt-1 block truncate text-[11px] leading-none text-current/70">{state.address ? formatUsd(worth) : "BNB Chain"}</span>
              </span>
              {linked.length > 1 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary">{linked.length}</span>}
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 opacity-70 transition ${(state.address ? menu : picker) ? "rotate-180" : ""}`}>
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            {menu && state.address && (
                <div className="absolute top-[3.25rem] right-0 z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <p className="text-sm text-fg">Wallets</p>
                    <p className="text-[11px] text-muted">{linked.length || 1} connected</p>
                  </div>
                  <ul className="max-h-80 space-y-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {(linked.length ? linked : [{ address: state.address, name: "Wallet", kind: "external" as const }]).map((wallet) => {
                      const active = wallet.address.toLowerCase() === state.address?.toLowerCase();
                      const mark = wallet.kind === "x" ? "" : markForName(wallet.name);
                      return (
                        <li key={wallet.address} className={`rounded-2xl p-2 ${active ? "bg-raised" : "hover:bg-raised/70"}`}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                              onClick={() => {
                                void activateSavedWallet(wallet.address).then(() => {
                                  pinSavedProvider(wallet.address);
                                  readCash(wallet.address)
                                    .catch(() => 0)
                                    .then((cash) => useWallet(wallet.address, cash));
                                });
                              }}
                            >
                              <span className={`relative grid size-9 min-h-9 min-w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-medium ${wallet.kind === "x" ? "bg-fg text-bg" : "bg-[#14120f] text-primary-fg"}`}>
                                {wallet.kind === "x" ? (
                                  <XLogo className="size-4" />
                                ) : mark ? (
                                  <img src={mark} alt="" className="size-9 min-h-9 min-w-9 object-contain" />
                                ) : (
                                  wallet.address.slice(2, 4).toUpperCase()
                                )}
                                {active && <span className="absolute right-0 bottom-0 size-2 rounded-full bg-[#8fb56a] ring-2 ring-raised" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-fg">{wallet.name}</span>
                                <span className="block text-[11px] text-muted">{shortAddress(wallet.address)}{active ? " · In use" : ""}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label="Copy address"
                              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-bg text-muted hover:text-fg"
                              onClick={() => {
                                void navigator.clipboard.writeText(wallet.address).then(() => {
                                  setCopied(wallet.address);
                                  window.setTimeout(() => setCopied(""), 1200);
                                });
                              }}
                            >
                              {copied === wallet.address ? (
                                <span className="text-[10px] text-primary">OK</span>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                                  <rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                                  <path d="M4 11H3.5A1.5 1.5 0 0 1 2 9.5v-6A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label="Disconnect"
                              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-bg text-muted hover:text-down"
                              onClick={() => disconnectOne(wallet)}
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                                <path d="M6 2.5h6.5A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5H6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                                <path d="M7 8H2M4 5.5 1.5 8 4 10.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-line p-2">
                    <button
                      type="button"
                      className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-fg hover:bg-primary/90 active:scale-[0.98]"
                      onClick={() => {
                        setMenu(false);
                        setPicker(true);
                      }}
                    >
                      Add a wallet
                    </button>
                  </div>
                </div>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-3 pt-3 sm:gap-3 sm:px-4 sm:pt-4">
        <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((item) => {
            const on = state.view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => dispatch({ type: "view", view: item.id })}
                className={`h-8 shrink-0 rounded-full px-3 text-xs sm:h-9 sm:px-4 sm:text-sm ${on ? "bg-primary text-primary-fg" : "bg-surface text-muted hover:text-fg"}`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        {held.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {held.map((symbol) => (
              <li key={symbol} className="shrink-0">
                <button
                  type="button"
                  className="flex h-10 items-center gap-2 rounded-full bg-surface pr-3 pl-1 text-sm text-fg"
                  onClick={() => {
                    dispatch({ type: "symbol", symbol });
                    dispatch({ type: "view", view: "desk" });
                  }}
                >
                  <Mark symbol={symbol} />
                  {symbol}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picker && (
        <ConnectModal
          onClose={() => setPicker(false)}
          onConnected={(address, cash, created) => useWallet(address, cash, created)}
          onError={(message) => dispatch({ type: "note", title: "Wallet", detail: message })}
        />
      )}
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-5 sm:px-4 sm:py-5">
        {state.activity[0] && state.activity[0].id !== 0 && !(state.activity[0].title === "Wallet connected" && !state.address) && (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-pretty text-fg">
            <span className="text-primary">{state.activity[0].title}.</span> <span className="text-muted">{state.activity[0].detail}</span>
          </p>
        )}
        {state.view === "desk" && <Desk />}
        {state.view === "route" && <RouteView />}
        {state.view === "baskets" && <BasketsView />}
        {state.view === "holdings" && <HoldingsView />}
        {state.view === "agent" && <AgentView />}
        {state.view === "explain" && <ExplainView />}
        {state.view === "start" && <StartView />}
        {state.view === "live" && <LiveView />}
        <details className={`rounded-2xl bg-surface ${state.view === "desk" ? "mb-32 lg:mb-0" : ""}`}>
          <summary className="cursor-pointer px-4 py-3 text-sm text-fg sm:px-5 sm:py-4">Safety limit and activity</summary>
          <div className="flex flex-col gap-3 px-5 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">Largest order: {formatUsd(state.limits.maxSizeUsd, 0)}. A buy is signed in your wallet.</p>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => dispatch({ type: "cap", maxSizeUsd: Math.max(5, state.limits.maxSizeUsd - 5) })}>
                Lower
              </button>
              <button type="button" className={btnGhost} onClick={() => dispatch({ type: "cap", maxSizeUsd: Math.min(500, state.limits.maxSizeUsd + 25) })}>
                Raise
              </button>
            </div>
          </div>
          <ul className="flex flex-col gap-2 px-5 pb-5">
            {state.activity.slice(0, 5).map((item) => (
              <li key={item.id} className="rounded-xl bg-raised px-3 py-3">
                <p className="text-sm text-fg">{item.title}</p>
                <p className="text-xs text-pretty text-muted">{item.detail}</p>
              </li>
            ))}
          </ul>
        </details>
      </main>
    </div>
  );
}