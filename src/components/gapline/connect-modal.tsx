import { useEffect, useState } from "react";
import { XLogo } from "./ui";
import { WALLET_CHOICES, announcedWallets, connectExternal, rememberLinked } from "@/lib/gapline/wallet-book";
import { createSmartWalletWithX } from "@/lib/gapline/smart-wallet";
import { readCash } from "@/lib/gapline/wallet";

function Glyph({ src }: { src: string }) {
  return <img src={src} alt="" className="size-8 min-h-8 min-w-8 shrink-0 rounded-full bg-[#14120f] object-contain" />;
}

export function ConnectModal({
  onClose,
  onConnected,
  onError,
}: {
  onClose: () => void;
  onConnected: (address: string, cash: number, created?: boolean) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [icons, setIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    const paint = () => {
      const next: Record<string, string> = {};
      for (const item of announcedWallets()) {
        const choice = WALLET_CHOICES.find((wallet) => wallet.rdns === item.rdns);
        if (choice && item.icon) next[choice.id] = item.icon;
      }
      setIcons(next);
    };
    paint();
    window.addEventListener("gapline:wallets", paint);
    return () => window.removeEventListener("gapline:wallets", paint);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-sm text-fg">Connect a wallet</p>
          <button type="button" aria-label="Close" className="grid size-9 cursor-pointer place-items-center rounded-full bg-surface text-lg text-muted hover:text-fg" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="grid max-h-[min(40rem,calc(100vh-6rem))] gap-3 overflow-y-auto sm:grid-cols-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <section className="rounded-3xl border border-line bg-surface p-4 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-2">
              {WALLET_CHOICES.slice(0, 4).map((wallet) => (
                <Glyph key={wallet.id} src={icons[wallet.id] || `/wallets/${wallet.id}.svg`} />
              ))}
            </div>
            <p className="mt-4 text-[11px] tracking-[0.16em] text-primary uppercase">Browser</p>
            <h2 className="mt-1 font-display text-2xl leading-none text-fg sm:text-3xl">External wallets</h2>
            <p className="mt-2 text-sm text-pretty text-muted">Use a wallet already on this device.</p>
            <ul className="mt-4 space-y-1.5">
              {WALLET_CHOICES.map((wallet) => (
                <li key={wallet.id}>
                  <button
                    type="button"
                    className="group flex h-12 w-full cursor-pointer items-center gap-3 rounded-2xl bg-raised px-3 text-left hover:bg-[#2c3127] active:scale-[0.99] sm:h-14"
                    onClick={() => {
                      connectExternal(wallet.id)
                        .then((walletResult) => onConnected(walletResult.address, walletResult.cash))
                        .catch((error: unknown) => onError(error instanceof Error ? error.message : "The wallet did not connect."));
                    }}
                  >
                    <Glyph src={icons[wallet.id] || `/wallets/${wallet.id}.svg`} />
                    <span className="min-w-0 flex-1 text-sm font-medium text-fg">{wallet.name}</span>
                    <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted group-hover:bg-primary group-hover:text-primary-fg">Connect</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col rounded-3xl border border-line bg-surface p-4 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-2">
              <span className="grid size-8 min-h-8 min-w-8 shrink-0 place-items-center rounded-full bg-fg text-bg">
                <XLogo className="size-4" />
              </span>
            </div>
            <p className="mt-4 text-[11px] tracking-[0.16em] text-primary uppercase">No wallet yet</p>
            <h2 className="mt-1 font-display text-2xl leading-none text-fg sm:text-3xl">X</h2>
            <p className="mt-2 text-sm text-pretty text-muted">The address stays with this X login.</p>
            <button
              type="button"
              disabled={busy}
              className="mt-4 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-fg hover:bg-primary/90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              onClick={() => {
                if (busy) return;
                setBusy(true);
                createSmartWalletWithX()
                  .then((address) => {
                    if (!address) return;
                    rememberLinked({ address, name: "X wallet", kind: "x" });
                    return readCash(address).catch(() => 0).then((cash) => onConnected(address, cash, true));
                  })
                  .catch((error: unknown) => {
                    setBusy(false);
                    onError(error instanceof Error ? error.message : "X did not sign in.");
                  });
              }}
            >
              <XLogo className="size-3.5" />
              {busy ? "Opening X" : "Continue with X"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
