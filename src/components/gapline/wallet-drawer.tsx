import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/gapline/model";
import { useDesk } from "@/lib/gapline/store";
import { activateSavedWallet, exportSmartKey } from "@/lib/gapline/smart-wallet";
import { contractFor, peekAssets, readAssets, sendAsset, shortAddress, type HeldAsset } from "@/lib/gapline/wallet";
import { markForName, type LinkedWallet } from "@/lib/gapline/wallet-book";
import { XLogo } from "./ui";

type Sheet = "receive" | "export" | "send" | null;

function MarkFace({ wallet }: { wallet: LinkedWallet }) {
  const mark = wallet.kind === "x" ? "" : markForName(wallet.name);
  return (
    <span className={`grid size-8 min-h-8 min-w-8 shrink-0 place-items-center overflow-hidden rounded-full ${wallet.image ? "bg-[#14120f]" : wallet.kind === "x" ? "bg-fg text-bg" : "bg-[#14120f]"}`}>
      {wallet.image ? (
        <img src={wallet.image} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full object-cover" />
      ) : wallet.kind === "x" ? (
        <XLogo className="size-3.5" />
      ) : mark ? (
        <img src={mark} alt="" className="size-8 object-contain" />
      ) : (
        <span className="text-[11px] text-fg">{wallet.address.slice(2, 4).toUpperCase()}</span>
      )}
    </span>
  );
}

export function WalletDrawer({
  open,
  address,
  worth,
  isX,
  linked,
  onClose,
  onBuy,
  onSwitch,
  onDisconnect,
  onAdd,
  onSent,
}: {
  open: boolean;
  address: string;
  worth: number;
  isX: boolean;
  linked: LinkedWallet[];
  onClose: () => void;
  onBuy: () => void;
  onSwitch: (wallet: LinkedWallet) => void;
  onDisconnect: (wallet: LinkedWallet) => void;
  onAdd: () => void;
  onSent: (detail: string) => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [assets, setAssets] = useState<HeldAsset[]>([]);
  const [copied, setCopied] = useState("");
  const [exportKey, setExportKey] = useState("");
  const [exportNote, setExportNote] = useState("");
  const [picked, setPicked] = useState<HeldAsset | null>(null);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const { state } = useDesk();
  const current = linked.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase()) ?? {
    address,
    name: isX ? "X wallet" : "Wallet",
    kind: isX ? ("x" as const) : ("external" as const),
  };

  useEffect(() => {
    if (!open) return;
    let stop = false;
    setSheet(null);
    const known = peekAssets(address);
    if (known) setAssets(known);
    readAssets(address, (rows) => {
      if (!stop) setAssets(rows);
    }).catch(() => {
      if (!stop && !known) setAssets([]);
    });
    return () => {
      stop = true;
    };
  }, [open, address]);

  useEffect(() => {
    if (!open) return;
    const onAssets = (event: Event) => {
      const detail = (event as CustomEvent<{ address: string; assets: HeldAsset[] }>).detail;
      if (!detail || detail.address !== address.toLowerCase()) return;
      setAssets(detail.assets);
    };
    window.addEventListener("gapline:assets", onAssets);
    return () => window.removeEventListener("gapline:assets", onAssets);
  }, [open, address]);

  function closeSheet() {
    setSheet(null);
    setExportKey("");
    setExportNote("");
  }

  function copy(value: string, id: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied(""), 1200);
    });
  }

  async function openExport() {
    setSheet("export");
    setExportKey("");
    setExportNote("Opening the wallet…");
    let key = exportSmartKey(address);
    if (!key) {
      await activateSavedWallet(address);
      key = exportSmartKey(address);
    }
    if (!key) {
      setExportNote("This X wallet is not open in this browser. Sign in with X again, then export.");
      return;
    }
    setExportKey(key);
    setExportNote("");
  }

  function dollars(asset: HeldAsset, size = asset.amount) {
    if (size === asset.amount && asset.usd != null && asset.usd > 0) return asset.usd;
    const mark = asset.amount > 0 && asset.usd != null && asset.usd > 0 ? asset.usd / asset.amount : 0;
    if (mark > 0) return mark * size;
    const book = state.books.find((item) => item.symbol === asset.symbol);
    const price = book?.venues.xstocks.price || book?.reference || 0;
    return price > 0 ? price * size : 0;
  }

  async function send() {
    if (!picked) {
      setSendError("Select a token.");
      return;
    }
    const size = Number(amount);
    if (!(size > 0)) {
      setSendError("Enter an amount.");
      return;
    }
    if (size > picked.amount + 1e-9) {
      setSendError("That amount is more than this wallet holds. Nothing was sent.");
      return;
    }
    const token = picked.symbol === "BNB" ? null : picked.token || contractFor(picked.symbol);
    if (picked.symbol !== "BNB" && !token) {
      setSendError("This token has no contract on BNB Chain. Nothing was sent.");
      return;
    }
    setSending(true);
    setSendError("");
    try {
      const hash = await sendAsset({ from: address, token, to, amount: size });
      onSent(`${size} ${picked.symbol} is on its way. ${hash.slice(0, 10)}…`);
      setSheet(null);
      setAmount("");
      setTo("");
      const next = await readAssets(address, undefined, true).catch(() => assets);
      setAssets(next);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "The send did not go through. Nothing was confirmed.");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const shown = assets.filter((asset) => (asset.side === "stock" ? asset.amount > 0.00000001 : (asset.usd ?? asset.amount) >= 0.05));
  const actions = [
    { id: "receive" as const, label: "Receive" },
    { id: "send" as const, label: "Send" },
    ...(isX ? [{ id: "export" as const, label: "Export" }] : []),
    { id: "buy" as const, label: "Buy" },
  ];

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close wallet" className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[24rem] flex-col border-l border-line bg-[#121410] shadow-[0_0_80px_rgba(0,0,0,0.55)]" style={{ animation: "gapline-drawer .28s ease" }}>
        <div className="flex items-center gap-3 px-4 pt-4">
          <MarkFace wallet={current} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{shortAddress(address)}</p>
          </div>
          <button type="button" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-surface text-muted hover:text-fg" aria-label="Copy address" onClick={() => copy(address, "head")}>
            {copied === "head" ? <span className="text-[10px] text-primary">OK</span> : <CopyIcon />}
          </button>
          <button type="button" aria-label="Close" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-surface text-lg text-muted hover:text-fg" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="px-4 pt-5">
          <p className="text-[11px] tracking-[0.16em] text-muted uppercase">Balance</p>
          <p className="mt-1 font-display text-4xl text-fg">{formatUsd(worth)}</p>
        </div>
        <div className={`mt-5 grid gap-2 px-4 ${actions.length > 3 ? "grid-cols-4" : "grid-cols-3"}`}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl bg-surface px-2 py-3 text-[11px] text-muted hover:text-fg"
              onClick={() => {
                if (action.id === "buy") {
                  onBuy();
                  return;
                }
                if (action.id === "export") {
                  void openExport();
                  return;
                }
                if (action.id === "send") {
                  setPicked(shown[0] ?? null);
                  setAmount("");
                  setTo("");
                  setSendError("");
                  setSheet("send");
                  return;
                }
                setSheet("receive");
              }}
            >
              <span className="grid size-11 place-items-center rounded-full bg-[#1c2018] text-fg">
                {action.id === "receive" ? <ReceiveIcon /> : action.id === "export" ? <ExportIcon /> : action.id === "send" ? <SendIcon /> : <BuyIcon />}
              </span>
              {action.label}
            </button>
          ))}
        </div>
        {linked.length > 1 && (
          <div className="mt-4 px-4">
            <p className="mb-2 text-[11px] tracking-[0.16em] text-muted uppercase">Wallets</p>
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {linked.map((wallet) => {
                const on = wallet.address.toLowerCase() === address.toLowerCase();
                return (
                  <button key={wallet.address} type="button" className={`flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-2 pr-3 text-xs ${on ? "border-primary bg-primary text-primary-fg" : "border-line bg-surface text-muted hover:text-fg"}`} onClick={() => onSwitch(wallet)}>
                    <MarkFace wallet={wallet} />
                    <span className="max-w-28 truncate">{shortAddress(wallet.address)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-5 flex items-center justify-between px-4">
          <p className="text-[11px] tracking-[0.16em] text-muted uppercase">Tokens</p>
          <p className="text-[11px] text-muted">{shown.length ? `${shown.length}` : ""}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shown.length ? (
            <ul className="space-y-1">
              {shown.map((asset) => (
                <li key={asset.symbol} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-surface">
                  {asset.logo ? <img src={asset.logo} alt="" className="size-9 shrink-0 rounded-full bg-[#14120f] object-contain" /> : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-xs">{asset.symbol.slice(0, 1)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-fg">{asset.symbol}</span>
                    <span className="block truncate text-[11px] text-muted">{asset.name}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm tabular-nums text-fg">{formatUsd(dollars(asset))}</span>
                    <span className="block text-[11px] tabular-nums text-muted">{asset.amount.toLocaleString("en-US", { maximumFractionDigits: asset.amount < 0.0001 ? 8 : 4 })} {asset.symbol}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pt-10 text-center text-sm text-muted">No tokens yet.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <button type="button" className="h-11 cursor-pointer rounded-full bg-surface text-sm text-muted hover:text-down" onClick={() => onDisconnect(current)}>
            Disconnect
          </button>
          <button type="button" className="h-11 cursor-pointer rounded-full bg-primary text-sm font-medium text-primary-fg" onClick={onAdd}>
            Add a wallet
          </button>
        </div>
      </aside>
      {sheet && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={closeSheet}>
          <div className="w-full max-w-sm rounded-3xl border border-line bg-[#161914] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-2xl text-fg">{sheet === "receive" ? "Receive" : sheet === "export" ? "Export wallet" : "Send"}</h2>
              <button type="button" aria-label="Close" className="grid size-8 cursor-pointer place-items-center rounded-full bg-surface text-lg text-muted" onClick={closeSheet}>
                ×
              </button>
            </div>
            {sheet === "receive" && (
              <>
                <p className="mt-2 text-sm text-pretty text-muted">Send BNB, USDT, or USDC on BNB Chain to this address.</p>
                <div className="mt-4 flex items-center gap-2 rounded-2xl bg-surface px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{shortAddress(address)}</span>
                  <button type="button" className="h-8 shrink-0 cursor-pointer rounded-full bg-primary px-3 text-xs text-primary-fg" onClick={() => copy(address, "receive")}>
                    {copied === "receive" ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            )}
            {sheet === "export" && (
              <>
                <p className="mt-2 text-sm text-pretty text-muted">Copy the private key for this X wallet. It stays hidden.</p>
                <p className="mt-3 rounded-2xl bg-[#3a3424] px-3 py-2 text-sm text-pretty text-[#f0d7a4]">Never share this key. Anyone with it can move the funds.</p>
                {exportNote ? <p className="mt-3 text-sm text-muted">{exportNote}</p> : null}
                <div className="mt-3 flex h-12 items-center rounded-2xl bg-surface px-3">
                  <span className="tracking-[0.35em] text-muted" aria-hidden="true">•••• •••• •••• ••••</span>
                  <span className="sr-only">Private key hidden</span>
                </div>
                <button
                  type="button"
                  disabled={!exportKey}
                  className="mt-3 h-11 w-full cursor-pointer rounded-full bg-primary text-sm font-medium text-primary-fg disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => exportKey && copy(exportKey, "key")}
                >
                  {copied === "key" ? "Key copied" : "Copy key"}
                </button>
              </>
            )}
            {sheet === "send" && (
              <>
                <p className="mt-2 text-sm text-pretty text-muted">Send a token from this wallet to another address on BNB Chain.</p>
                {shown.length === 0 ? (
                  <p className="mt-6 py-8 text-center text-sm text-muted">No tokens to send.</p>
                ) : (
                  <>
                    <p className="mt-3 text-[11px] tracking-[0.14em] text-muted uppercase">Token</p>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {shown.map((asset) => (
                        <li key={asset.symbol}>
                          <button type="button" className={`flex h-12 w-full cursor-pointer items-center gap-2 rounded-2xl px-2 text-left text-sm ${picked?.symbol === asset.symbol ? "bg-primary text-primary-fg" : "bg-surface text-fg"}`} onClick={() => setPicked(asset)}>
                            {asset.logo ? <img src={asset.logo} alt="" className="size-7 rounded-full object-contain" /> : null}
                            <span className="min-w-0 flex-1">
                              <span className="block">{asset.symbol}</span>
                              <span className={`block text-[11px] ${picked?.symbol === asset.symbol ? "text-primary-fg/80" : "text-muted"}`}>{formatUsd(dollars(asset))}</span>
                            </span>
                            <span className="tabular-nums">{asset.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="mt-3 block text-[11px] tracking-[0.14em] text-muted uppercase">
                      Amount
                      <input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} className="mt-1 h-11 w-full rounded-2xl bg-surface px-3 text-sm text-fg outline-none" placeholder="0" />
                    </label>
                    {picked ? (
                      <p className="mt-2 text-sm tabular-nums text-fg">
                        {Number(amount) > 0 ? `Sending ${formatUsd(dollars(picked, Number(amount)))}` : `You hold ${formatUsd(dollars(picked))}`}
                      </p>
                    ) : null}
                    <label className="mt-3 block text-[11px] tracking-[0.14em] text-muted uppercase">
                      To
                      <input value={to} onChange={(event) => setTo(event.target.value.trim())} className="mt-1 h-11 w-full rounded-2xl bg-surface px-3 text-sm text-fg outline-none" placeholder="0x…" />
                    </label>
                    {sendError ? <p className="mt-3 text-sm text-pretty text-down">{sendError}</p> : null}
                    <button type="button" disabled={sending} className="mt-4 h-11 w-full cursor-pointer rounded-full bg-primary text-sm font-medium text-primary-fg disabled:opacity-40" onClick={() => void send()}>
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 11H3.5A1.5 1.5 0 0 1 2 9.5v-6A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function ReceiveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v8M5 8l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function ExportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5.2v3.2l2 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13.5v-8M5 8l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 2.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function BuyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10l-1 7.5H4.2L3 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 4.2a2 2 0 0 1 4 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
