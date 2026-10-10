import { DeskProvider, useDesk, type ViewId } from "@/lib/gapline/store";
import { formatUsd } from "@/lib/gapline/model";
import { peekAssets, readAssets, readCash, rememberStocks, sendAsset, shortAddress, silentAccount, watchAccounts, type HeldAsset } from "@/lib/gapline/wallet";
import { activateSavedWallet, describeSmartWallet, disconnectSmart, finishSmartWalletWithX, resumeSmartWallet, xWalletError } from "@/lib/gapline/smart-wallet";
import { disconnectLinked, isDismissed, markForName, pinSavedProvider, readActive, readLinked, rememberLinked, setActive, undismissWallet, type LinkedWallet } from "@/lib/gapline/wallet-book";
import { ConnectModal } from "./connect-modal";
import { WalletDrawer } from "./wallet-drawer";
import { applyCashPrints, appendCatalog, applyChainMarks, applyLiveSnapshot, getCashPrints, getCatalog, getChainMarks, getLiveSnapshot, getLiveTape, mergeTape, tapeSession } from "@/lib/gapline/rwa";
import { AgentView } from "./agent-view";
import { BasketsView } from "./baskets-view";
import { Desk } from "./desk";
import { ExplainView } from "./explain-view";
import { HoldingsView } from "./holdings-view";
import { LiveView } from "./live-view";
import { RouteView } from "./route-view";
import { StartView } from "./start-view";
import { Mark, XLogo, btnGhost } from "./ui";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { pathForView, viewFromPath } from "@/lib/gapline/paths";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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

function assetWorth(asset: HeldAsset, books: { symbol: string; venues: { xstocks: { price: number } }; reference: number | null }[]) {
  if (asset.usd != null && asset.usd > 0) return asset.usd;
  const book = books.find((item) => item.symbol === asset.symbol);
  const price = book?.venues.xstocks.price || book?.reference || 0;
  return price > 0 ? price * asset.amount : 0;
}

function Shell() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (router) => router.location.pathname });
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
          const missing = books.filter((book) => book.address && !(book.venues.xstocks.price > 0)).map((book) => book.address as string);
          if (missing.length) {
            void getChainMarks({ data: { addresses: missing.slice(0, 60) } }).then((marks) => {
              if (stop || !marks.ok) return;
              const next = applyChainMarks(booksRef.current, marks.prices);
              booksRef.current = next;
              dispatch({ type: "tape", books: next, marks: merged.marks, live });
            });
          }
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
  const viewRef = useRef(state.view);
  viewRef.current = state.view;
  useEffect(() => {
    const next = pathForView(state.view);
    if (!next || next === window.location.pathname) return;
    void Promise.resolve(navigate({ to: next })).catch(() => {
      window.location.assign(next);
    });
  }, [navigate, state.view]);
  useEffect(() => {
    const fromPath = viewFromPath(pathname);
    if (!fromPath || fromPath === viewRef.current) return;
    dispatch({ type: "view", view: fromPath });
  }, [dispatch, pathname]);
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
      if (!created && fromX) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        if (stop) return;
        created = await finishSmartWalletWithX();
      }
      const chosen = created ?? (fromX ? null : readActive());
      if (!chosen || isDismissed(chosen)) {
        disconnectSmart();
        if (fromX) {
          dispatch({
            type: "note",
            title: "X did not connect",
            detail: xWalletError() || "X did not finish signing in. Try Continue with X again.",
          });
        }
        return;
      }
      const described = describeSmartWallet(chosen);
      const linkedRow = readLinked().find((wallet) => wallet.address.toLowerCase() === chosen.toLowerCase());
      const kind = described?.kind ?? linkedRow?.kind;
      if (kind === "x" || created) {
        const address = created ?? (await resumeSmartWallet());
        if (stop || !address || address.toLowerCase() !== chosen.toLowerCase() || isDismissed(address)) {
          if (!created) disconnectSmart();
          if (fromX || created) {
            dispatch({
              type: "note",
              title: "X did not connect",
              detail: xWalletError() || "X did not finish signing in. Try Continue with X again.",
            });
          }
          return;
        }
        undismissWallet(address);
        setActive(address);
        const cash = await readCash(address).catch(() => 0);
        if (stop) return;
        dispatch({ type: "wallet", address, cash });
        rememberLinked({
          address,
          name: described?.name ?? linkedRow?.name ?? "X wallet",
          kind: "x",
          ...(linkedRow?.image ? { image: linkedRow.image } : {}),
        });
        setLinked(readLinked());
        if (created || fromX) {
          const url = new URL(window.location.href);
          url.searchParams.delete("x");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          dispatch({
            type: "note",
            title: "Wallet ready",
            detail: `${shortAddress(address)} is a real BNB Chain wallet. Send USDT or USDC to it when you want to buy.`,
          });
        }
        return;
      }
      disconnectSmart();
      const seen = await silentAccount().catch(() => null);
      if (seen && seen.toLowerCase() === chosen.toLowerCase()) pinSavedProvider(chosen);
      const cash = await readCash(chosen).catch(() => 0);
      if (stop || isDismissed(chosen)) return;
      setActive(chosen);
      dispatch({ type: "wallet", address: chosen, cash });
      setLinked(readLinked());
    })();
    return () => {
      stop = true;
    };
  }, [dispatch]);
  useEffect(() => {
    return watchAccounts((address) => {
      const active = readActive();
      if (!active || !address || address.toLowerCase() !== active.toLowerCase()) return;
      if (dismissed.current || isDismissed(address)) return;
      readCash(address)
        .catch(() => 0)
        .then((cash) => {
          if (dismissed.current || readActive()?.toLowerCase() !== address.toLowerCase()) return;
          dispatch({ type: "presence", address, cash });
        });
    });
  }, [dispatch]);
  const [heldAssets, setHeldAssets] = useState<HeldAsset[]>([]);
  useEffect(() => {
    if (!state.address) {
      setHeldAssets([]);
      return;
    }
    const known = peekAssets(state.address);
    if (known) setHeldAssets(known);
    let stop = false;
    readAssets(state.address, (assets) => {
      if (!stop) setHeldAssets(assets);
    }).catch(() => {
      if (!stop) setHeldAssets([]);
    });
    return () => {
      stop = true;
    };
  }, [state.address]);
  const held = heldAssets
    .filter((asset) => asset.side === "stock" && asset.amount >= 0.0001 && assetWorth(asset, state.books) >= 0.5)
    .map((asset) => asset.symbol);
  const worth = heldAssets.reduce((sum, asset) => {
    const value = assetWorth(asset, state.books);
    return value >= 0.05 ? sum + value : sum;
  }, 0);
  const [picker, setPicker] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [linked, setLinked] = useState<LinkedWallet[]>([]);
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
  useEffect(() => {
    const picture = user?.profileImageUrl;
    if (!picture || !state.address) return;
    const described = describeSmartWallet(state.address);
    const row = readLinked().find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase());
    if (described?.kind !== "x" && row?.kind !== "x") return;
    if (row?.image === picture) return;
    rememberLinked({ address: state.address, name: described?.name ?? row?.name ?? "X wallet", kind: "x", image: picture });
    setLinked(readLinked());
  }, [user?.profileImageUrl, state.address]);
  function useWallet(address: string, cash: number, created = false) {
    undismissWallet(address);
    setActive(address);
    dismissed.current = false;
    setPicker(false);
    setDrawer(false);
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
    const result = disconnectLinked(wallet.address);
    setLinked(readLinked());
    if (!result.changed) return;
    if (!result.active) {
      dismissed.current = true;
      setDrawer(false);
      disconnectSmart();
      pinSavedProvider(wallet.address);
      dispatch({ type: "disconnect" });
      return;
    }
    const next = readLinked().find((item) => item.address.toLowerCase() === result.active?.toLowerCase());
    if (!next) return;
    if (next.kind !== "x") disconnectSmart();
    void activateSavedWallet(next.address).then(() => {
      if (next.kind !== "x") pinSavedProvider(next.address);
      readCash(next.address)
        .catch(() => 0)
        .then((cash) => {
          setLinked(readLinked());
          dispatch({ type: "wallet", address: next.address, cash });
        });
    });
  }
  useEffect(() => {
    const onDisconnect = (event: Event) => {
      const address = (event as CustomEvent<string>).detail;
      const wallet = readLinked().find((item) => item.address.toLowerCase() === String(address).toLowerCase());
      if (wallet) disconnectOne(wallet);
    };
    window.addEventListener("gapline:disconnect", onDisconnect);
    return () => window.removeEventListener("gapline:disconnect", onDisconnect);
  });
  const mine = state.activity.filter((item) => (item.wallet ?? "") === (state.address ?? ""));
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <a href="/" className="font-display text-xl leading-none text-fg sm:text-3xl">
            Gapline
          </a>
          <div className="relative flex items-center">
            <button
              type="button"
              aria-expanded={state.address ? drawer : picker}
              className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-1.5 pr-2.5 text-sm active:scale-[0.98] sm:h-11 sm:pr-3 ${
                state.address
                  ? "border-line bg-surface text-fg hover:border-primary"
                  : "border-primary/50 bg-surface text-fg hover:border-primary hover:bg-primary hover:text-primary-fg"
              }`}
              onClick={() => (state.address ? setDrawer((open) => !open) : setPicker(true))}
            >
              {state.address && (linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.kind === "x" || describeSmartWallet(state.address)?.kind === "x") ? (
                <span className="relative grid size-8 min-h-8 min-w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-fg text-bg">
                  {linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.image ? (
                    <img src={linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.image} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full object-cover" />
                  ) : (
                    <XLogo className="size-3.5" />
                  )}
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
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 opacity-70 transition ${drawer ? "rotate-180" : ""}`}>
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {state.address && (
        <WalletDrawer
          open={drawer}
          address={state.address}
          worth={worth}
          isX={linked.find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase())?.kind === "x" || describeSmartWallet(state.address)?.kind === "x"}
          linked={linked.length ? linked : [{ address: state.address, name: "Wallet", kind: "external" }]}
          onClose={() => setDrawer(false)}
          onBuy={() => {
            setDrawer(false);
            dispatch({ type: "view", view: "route" });
          }}
          onSwitch={(wallet) => {
            if (isDismissed(wallet.address)) return;
            undismissWallet(wallet.address);
            setActive(wallet.address);
            dismissed.current = false;
            const cached = peekAssets(wallet.address) ?? [];
            const seeded = cached
              .filter((asset) => asset.symbol === "USDT" || asset.symbol === "USDC")
              .reduce((sum, asset) => sum + (asset.usd ?? 0), 0);
            dispatch({ type: "presence", address: wallet.address, cash: seeded });
            void activateSavedWallet(wallet.address).then(() => {
              pinSavedProvider(wallet.address);
              readCash(wallet.address)
                .catch(() => 0)
                .then((cash) => {
                  setLinked(readLinked());
                  dispatch({ type: "presence", address: wallet.address, cash });
                });
            });
          }}
          onDisconnect={(wallet) => disconnectOne(wallet)}
          onAdd={() => {
            setDrawer(false);
            setPicker(true);
          }}
          onSent={(detail) => dispatch({ type: "note", title: "Sent", detail })}
        />
      )}
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
        {mine[0] && mine[0].id !== 0 && !(mine[0].title === "Wallet connected" && !state.address) && (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-pretty text-fg">
            <span className="text-primary">{mine[0].title}.</span> <span className="text-muted">{mine[0].detail}</span>
          </p>
        )}
        {state.view === "desk" && <Desk />}
        {state.view === "route" && <RouteView />}
        {state.view === "baskets" && <BasketsView />}
        {state.view === "holdings" && <HoldingsView key={state.address ?? "none"} />}
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
            {mine.slice(0, 5).map((item) => (
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