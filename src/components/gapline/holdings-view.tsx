import { useEffect, useState } from "react";
import { useDesk } from "@/lib/gapline/store";
import { formatUsd, quoteOrder } from "@/lib/gapline/model";
import { Mark, Panel, btnGhost, btnPrimary, field } from "./ui";
import { peekAssets, readAssets, readCash, sellStock, shortAddress, type HeldAsset } from "@/lib/gapline/wallet";
import { markForName, openWalletPicker, readLinked } from "@/lib/gapline/wallet-book";
import { describeSmartWallet } from "@/lib/gapline/smart-wallet";
import { XLogo } from "./ui";

function amountLabel(amount: number) {
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (amount >= 1) return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function AssetLogo({ asset }: { asset: HeldAsset }) {
  const [failed, setFailed] = useState(false);
  if (asset.side === "stock") return <Mark symbol={asset.symbol} name={asset.name} round />;
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised">
      {asset.logo && !failed ? (
        <img src={asset.logo} alt="" width={32} height={32} className="size-full object-contain p-1" onError={() => setFailed(true)} />
      ) : (
        <span className="text-xs font-medium text-fg">{asset.symbol.slice(0, 1)}</span>
      )}
    </span>
  );
}

type WalletSide = "crypto" | "stock";

let walletCache: { address: string; assets: HeldAsset[]; side: WalletSide } | null = null;

function sameHoldings(left: HeldAsset[], right: HeldAsset[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return item.symbol === other.symbol && item.side === other.side && item.amount === other.amount && item.usd === other.usd;
  });
}

export function HoldingsView() {
  const { state, dispatch } = useDesk();
  const cached = walletCache && walletCache.address === state.address ? walletCache : null;
  const [assets, setAssets] = useState<HeldAsset[]>(cached?.assets ?? []);
  const [loading, setLoading] = useState(false);
  const [side, setSide] = useState<WalletSide>(cached?.side ?? "crypto");
  function valueOf(asset: HeldAsset) {
    if (asset.usd != null) return asset.usd;
    const book = state.books.find((item) => item.symbol === asset.symbol);
    const price = book?.venues.xstocks.price ?? book?.reference ?? 0;
    return price * asset.amount;
  }
  const byValue = (left: HeldAsset, right: HeldAsset) => valueOf(right) - valueOf(left);
  const crypto = assets.filter((asset) => asset.side === "crypto").sort(byValue);
  const stocks = assets
    .filter((asset) => {
      if (asset.side !== "stock" || asset.amount <= 0.000001) return false;
      const book = state.books.find((item) => item.symbol === asset.symbol);
      const price = book?.venues.xstocks.price ?? book?.reference ?? 0;
      return asset.amount >= 0.0001 && price > 0 && price * asset.amount >= 0.5;
    })
    .sort(byValue);
  const showing = side === "crypto" ? crypto : stocks;

  function remember(next: HeldAsset[], nextSide = side) {
    if (!state.address) return;
    walletCache = { address: state.address, assets: next, side: nextSide };
  }

  useEffect(() => {
    if (!state.address) {
      walletCache = null;
      setAssets([]);
      return;
    }
    const known = peekAssets(state.address) ?? (walletCache?.address === state.address ? walletCache.assets : null);
    setAssets(known ?? []);
    let stop = false;
    setLoading(!known?.length);
    readAssets(state.address, (next) => {
      if (stop) return;
      setAssets(next);
      setLoading(false);
      walletCache = { address: state.address as string, assets: next, side: walletCache?.address === state.address ? walletCache.side : "crypto" };
    }).catch(() => {
      if (!stop && !known) setAssets([]);
    });
    return () => {
      stop = true;
    };
  }, [state.address]);

  const linked = state.address ? readLinked().find((wallet) => wallet.address.toLowerCase() === state.address?.toLowerCase()) : null;
  const described = state.address ? describeSmartWallet(state.address) : null;
  const walletName = linked?.name && linked.name !== "Saved wallet" ? linked.name : described?.name ?? (state.address ? "Wallet" : "");
  const walletMark = linked?.kind === "x" || described?.kind === "x" ? "x" : markForName(walletName);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-4">
      <Panel className="p-4 sm:p-5">
        <p className="text-[11px] tracking-[0.16em] text-primary uppercase">Wallet</p>
        {state.address ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-bg px-3 py-3">
            {walletMark === "x" && linked?.image ? (
              <img src={linked.image} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-full object-cover" />
            ) : walletMark === "x" ? (
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-bg">
                <XLogo className="size-4" />
              </span>
            ) : walletMark ? (
              <img src={walletMark} alt="" className="size-10 shrink-0 rounded-full bg-[#14120f] object-contain" />
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-fg">{state.address.slice(2, 4).toUpperCase()}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{shortAddress(state.address)}</span>
            </span>
          </div>
        ) : null}
        <p className="mt-4 text-[11px] tracking-[0.16em] text-muted uppercase">Ready to spend</p>
        <p className="mt-1 font-display text-3xl tabular-nums text-fg sm:text-4xl">{state.address ? formatUsd(state.cash >= 0.05 ? state.cash : 0) : "—"}</p>
        <p className="mt-1 text-xs text-muted">USDC and USDT on BNB Chain</p>
        {!state.address && <p className="mt-3 text-sm text-pretty text-muted">Connect a wallet to see crypto and stocks.</p>}
        <div className="mt-5 grid gap-2">
          {state.address ? (
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                if (!state.address) return;
                window.dispatchEvent(new CustomEvent("gapline:disconnect", { detail: state.address }));
              }}
            >
              Disconnect wallet
            </button>
          ) : (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => openWalletPicker()}
            >
              Connect wallet
            </button>
          )}
          <button type="button" className={btnPrimary} onClick={() => dispatch({ type: "view", view: "route" })}>
            Buy a stock
          </button>
        </div>
      </Panel>
      <AssetSide
        empty={side === "crypto" ? "No crypto in this wallet." : "No tokenized stocks in this wallet."}
        assets={showing}
        loading={loading && Boolean(state.address)}
        stocks={side === "stock"}
        side={side}
        onSide={(next) => {
          setSide(next);
          if (walletCache && walletCache.address === state.address) walletCache = { ...walletCache, side: next };
        }}
        onDone={() => {
          if (!state.address) return;
          readAssets(state.address, (next) => {
            if (!sameHoldings(assets, next)) {
              setAssets(next);
              remember(next);
            }
          }, true).catch(() => undefined);
        }}
      />
    </div>
  );
}

function AssetSide({
  empty,
  assets,
  loading,
  stocks = false,
  side,
  onSide,
  onDone,
}: {
  empty: string;
  assets: HeldAsset[];
  loading: boolean;
  stocks?: boolean;
  side: "crypto" | "stock";
  onSide: (side: "crypto" | "stock") => void;
  onDone: () => void;
}) {
  return (
    <Panel className="p-3">
      <div className="flex justify-start px-1 pt-1">
        <div className="flex rounded-full bg-raised p-1">
          <button
            type="button"
            className={`h-8 rounded-full px-4 text-sm ${side === "crypto" ? "bg-primary text-primary-fg" : "text-muted"}`}
            onClick={() => onSide("crypto")}
          >
            Crypto
          </button>
          <button
            type="button"
            className={`h-8 rounded-full px-4 text-sm ${side === "stock" ? "bg-primary text-primary-fg" : "text-muted"}`}
            onClick={() => onSide("stock")}
          >
            Stocks
          </button>
        </div>
      </div>
      {loading ? (
        <p className="px-2 py-6 text-sm text-muted">Reading the wallet…</p>
      ) : assets.length === 0 ? (
        <p className="px-2 py-6 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {assets.map((asset) => (
            <li key={`${asset.side}-${asset.symbol}`} className="rounded-xl bg-bg px-3 py-2.5">
              {stocks ? <StockRow asset={asset} onDone={onDone} /> : <CryptoRow asset={asset} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CryptoRow({ asset }: { asset: HeldAsset }) {
  return (
    <div className="flex items-center gap-2">
      <AssetLogo asset={asset} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">{asset.symbol}</span>
        <span className="block text-xs text-muted">{amountLabel(asset.amount)}</span>
      </span>
      <span className="text-sm tabular-nums text-fg">{asset.usd == null ? "—" : formatUsd(asset.usd)}</span>
    </div>
  );
}

function StockRow({ asset, onDone }: { asset: HeldAsset; onDone: () => void }) {
  const { state, dispatch } = useDesk();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const book = state.books.find((item) => item.symbol === asset.symbol);
  const price = book?.venues.xstocks.price ?? book?.reference ?? 0;
  const value = price * asset.amount;
  const dollars = Number(draft);
  const qty = price > 0 && dollars > 0 ? Math.min(asset.amount, dollars / price) : 0;
  const sim = quoteOrder({
    symbol: asset.symbol,
    side: "sell",
    sizeUsd: dollars > 0 ? Math.min(dollars, value || dollars) : 1,
    venue: "xstocks",
    cash: state.cash,
    positions: [{ symbol: asset.symbol, venue: "xstocks", token: `${asset.symbol}x`, qty: asset.amount, costUsd: value }],
    limits: state.limits,
    walletReady: true,
  });

  return (
    <div>
      <div className="flex items-center gap-2">
        <AssetLogo asset={asset} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg">{book?.name ?? asset.name}</span>
          <span className="block text-xs tabular-nums text-muted">{price > 0 ? formatUsd(price) : "—"}</span>
        </span>
        <span className="text-right">
          <span className="block text-sm tabular-nums text-fg">{amountLabel(asset.amount)}</span>
          <span className="block text-xs tabular-nums text-muted">{value > 0 ? formatUsd(value) : "—"}</span>
        </span>
      </div>
      <div className="mt-2">
        {!open ? (
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setDraft(value > 0 ? String(Math.round(value * 100) / 100) : "");
              setOpen(true);
            }}
          >
            Sell
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-fg">
              Amount to sell
              <span className="mt-2 flex items-center rounded-xl bg-bg px-3">
                <span className="text-muted">$</span>
                <input
                  inputMode="decimal"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ""))}
                  className={`${field} border-0 bg-transparent`}
                  aria-label={`Amount of ${asset.symbol} to sell`}
                />
              </span>
            </label>
            <p className="text-xs text-muted">You hold {formatUsd(value)}.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  if (!state.address) return;
                  if (!(dollars > 0) || qty <= 0) {
                    dispatch({ type: "note", title: "Not sent", detail: "Type the amount you want to sell." });
                    return;
                  }
                  if (price > 0 && dollars - value > 0.01) {
                    dispatch({ type: "note", title: "Not sent", detail: `You hold ${formatUsd(value)}. Nothing was sent.` });
                    return;
                  }
                  sellStock({ address: state.address, symbol: asset.symbol, qty })
                    .then(async (sent) => {
                      const cash = await readCash(state.address as string);
                      if (sim) dispatch({ type: "chain-fill", order: { ...sim, qty, venue: "xstocks" }, cash, hash: sent.hash });
                      dispatch({ type: "note", title: "Sent", detail: sent.hash });
                      setOpen(false);
                      onDone();
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
                Sell {asset.symbol}
              </button>
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
