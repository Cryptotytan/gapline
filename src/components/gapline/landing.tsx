import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BOOKS, VENUES, formatRemain, formatUsd, marketClock } from "@/lib/gapline/model";
import type { ViewId } from "@/lib/gapline/store";
import { pathForView } from "@/lib/gapline/paths";
import { Mark } from "./ui";

const APPLE = BOOKS.find((book) => book.symbol === "AAPL") ?? BOOKS[0];
const ROWS = [
  { symbol: "AAPL", name: "Apple", move: "+0.18%", call: "Likely revert" },
  { symbol: "NVDA", name: "NVIDIA", move: "+0.96%", call: "With the tape" },
  { symbol: "TSLA", name: "Tesla", move: "+4.76%", call: "News" },
];

const FAQS = [
  {
    q: "What is Gapline?",
    a: "A desk for tokenized US stocks on BNB Chain. It shows the last 24 hours, the latest price, the amount you type, and the price a buy would actually pay.",
  },
  {
    q: "How do I buy?",
    a: "Connect a wallet you already have, or sign in with X. Buy asks that wallet to sign. Gapline never asks for a seed phrase.",
  },
  {
    q: "What if the wallet is short?",
    a: "Buy with Card stays above the button and opens the card checkout for the wallet you connected. The USDT lands there, and Buy signs the stock purchase in that same wallet.",
  },
  {
    q: "Why can a cheap gap still be refused?",
    a: "A wide gap on a thin book is an empty market, not a free share. Micron is the example: the screen explains the refusal, and the order is not sent.",
  },
  {
    q: "Is Ondo’s higher price an arbitrage?",
    a: "Usually it is the dividend inside the total-return token. Gapline does not treat that premium as a better share of the same stock.",
  },
];

const LINKS: { id: ViewId; label: string }[] = [
  { id: "desk", label: "Today" },
  { id: "route", label: "Buy" },
  { id: "baskets", label: "Baskets" },
  { id: "agent", label: "Rules" },
];

function ClockFrame({ onEnter }: { onEnter: (view: ViewId, symbol?: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const session = marketClock(new Date(now));
  const remain = formatRemain(session.at - now);
  return (
    <button type="button" onClick={() => onEnter("desk")} className="rounded-2xl bg-surface p-4 text-left sm:rounded-3xl sm:p-5">
      <p className="text-[11px] tracking-[0.16em] text-primary uppercase">01</p>
      <p className="mt-2 font-display text-2xl leading-none text-fg sm:mt-3 sm:text-3xl" suppressHydrationWarning>
        The Market is <span className={session.open ? "text-primary" : "text-down"}>{session.open ? "Open" : "Closed"}</span>
      </p>
      <p className="mt-3 font-display text-2xl tabular-nums text-primary" suppressHydrationWarning>
        {remain}
      </p>
      <p className="mt-4 text-sm text-muted">The cash market stops. The on-chain print does not.</p>
    </button>
  );
}

export function Landing() {
  const [open, setOpen] = useState(0);
  const navigate = useNavigate();
  function onEnter(view: ViewId, symbol?: string) {
    navigate({ to: pathForView(view) ?? "/today", search: symbol ? { symbol } : {} });
  }

  if (typeof document !== "undefined") document.documentElement.classList.add("gapline-home");

  useEffect(() => {
    document.documentElement.classList.add("gapline-home");
    return () => document.documentElement.classList.remove("gapline-home");
  }, []);

  return (
    <div className="relative min-h-dvh max-w-[100vw] overflow-x-clip bg-bg text-fg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(700px_280px_at_50%_0%,rgba(224,161,90,0.16),transparent_70%)]" aria-hidden />

      <header className="sticky top-0 z-30 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-4">
          <Link to="/" className="font-display text-xl leading-none text-fg sm:text-2xl">
            Gapline
          </Link>
          <nav className="hidden gap-1 sm:flex">
            {LINKS.map((item) => (
              <button key={item.id} type="button" onClick={() => onEnter(item.id)} className="h-9 shrink-0 rounded-full px-3 text-sm text-muted hover:bg-surface hover:text-fg">
                {item.label}
              </button>
            ))}
          </nav>
          <button type="button" onClick={() => onEnter("desk")} className="h-10 shrink-0 rounded-full bg-primary px-3 text-sm font-medium text-primary-fg sm:px-4">
            Open the desk
          </button>
        </div>
      </header>

      <main id="top" className="relative">
        <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-8 pb-6 text-center sm:pt-24 sm:pb-8">
          <p className="rounded-full bg-surface px-3 py-1 text-xs tracking-wide text-muted">Weekend desk · spot only</p>
          <h1 className="mt-4 max-w-full font-sans text-[1.7rem] leading-[0.95] font-medium tracking-tight text-fg min-[380px]:text-[2rem] sm:mt-6 sm:text-7xl">
            THE BELL RINGS.
            <br />
            THE GAP STAYS OPEN.
          </h1>
          <p className="mt-4 max-w-xl text-sm text-pretty text-muted sm:mt-5 sm:text-lg">
            Tokenized stocks keep trading after Wall Street closes. The buy is signed in the wallet you connected. A card covers whatever that balance cannot.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:mt-8">
            <button type="button" onClick={() => onEnter("desk")} className="h-12 rounded-full bg-primary px-6 text-sm font-medium text-primary-fg">
              Open the desk
            </button>
            <a href="#how" className="inline-flex h-12 items-center rounded-full bg-surface px-6 text-sm text-fg">
              How it works
            </a>
          </div>
        </section>

        <section className="pb-6">
          <p className="mb-3 text-center text-[11px] tracking-[0.16em] text-primary uppercase">Stocks</p>
          <div className="relative w-full max-w-full overflow-hidden">
            <div className="pointer-events-none flex w-max animate-[gapline-marquee_40s_linear_infinite] hover:[animation-play-state:paused] motion-reduce:animate-none">
              {[0, 1].map((copy) => (
                <ul key={copy} className="flex gap-2 pr-2">
                  {BOOKS.map((book) => (
                    <li key={`${copy}-${book.symbol}`} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => onEnter("route", book.symbol)}
                        className="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-surface pr-4 pl-1.5 text-sm text-fg"
                      >
                        <Mark symbol={book.symbol} name={book.name} round />
                        {book.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
          <h2 className="text-center font-display text-2xl text-fg sm:text-4xl">What the desk does</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted">Each card is the real screen. Open it.</p>
          <div className="mt-5 grid gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-4">
            <button type="button" onClick={() => onEnter("desk")} className="rounded-2xl bg-surface p-2.5 text-left sm:rounded-3xl sm:p-3">
              <div className="rounded-2xl bg-bg p-2">
                {ROWS.map((row) => (
                  <div key={row.symbol} className="flex items-center gap-3 px-2 py-2">
                    <Mark symbol={row.symbol} name={row.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{row.name}</span>
                      <span className="block text-xs text-muted">{row.symbol}</span>
                    </span>
                    <span className="text-sm tabular-nums text-primary">{row.move}</span>
                    <span className="hidden rounded-full bg-raised px-2 py-1 text-[11px] text-muted sm:inline">{row.call}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 px-2 text-[11px] tracking-[0.16em] text-primary uppercase">After the bell</p>
              <h3 className="mt-1 px-2 font-display text-xl text-fg sm:text-2xl">The gap, in one list</h3>
            </button>

            <button type="button" onClick={() => onEnter("route", "AAPL")} className="rounded-2xl bg-surface p-2.5 text-left sm:rounded-3xl sm:p-3">
              <div className="rounded-2xl bg-bg p-3">
                <div className="mb-3 flex items-center gap-2">
                  <Mark symbol="AAPL" name="Apple" />
                  <span className="text-sm text-fg">Apple · $10</span>
                </div>
                {(["bstocks", "ondo", "xstocks"] as const).map((venue) => (
                  <div key={venue} className={`mb-1 flex items-center justify-between rounded-xl px-3 py-2 text-sm ${venue === "bstocks" ? "bg-raised" : ""}`}>
                    <span className="text-fg">
                      {VENUES[venue].label}
                      {venue === "bstocks" ? " · buy this" : ""}
                    </span>
                    <span className="tabular-nums text-muted">{formatUsd(APPLE.venues[venue].price)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 px-2 text-[11px] tracking-[0.16em] text-primary uppercase">The buy</p>
              <h3 className="mt-1 px-2 font-display text-xl text-fg sm:text-2xl">Your wallet, or a card</h3>
            </button>

            <button type="button" onClick={() => onEnter("desk", "MU")} className="rounded-2xl bg-surface p-2.5 text-left sm:rounded-3xl sm:p-3">
              <div className="rounded-2xl bg-bg p-4">
                <div className="flex items-center gap-3">
                  <Mark symbol="MU" name="Micron" />
                  <div>
                    <p className="text-xs text-muted">MU · +4.10%</p>
                    <p className="font-display text-2xl text-fg">Gapline says no</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-pretty text-muted">The gap looks free. The book is too thin. Nothing is sent.</p>
              </div>
              <p className="mt-4 px-2 text-[11px] tracking-[0.16em] text-primary uppercase">The refusal</p>
              <h3 className="mt-1 px-2 font-display text-xl text-fg sm:text-2xl">An empty book stays empty</h3>
            </button>

            <button type="button" onClick={() => onEnter("agent")} className="rounded-2xl bg-surface p-2.5 text-left sm:rounded-3xl sm:p-3">
              <div className="rounded-2xl bg-bg p-4">
                <p className="text-sm text-pretty text-fg">Buy $10 of the widest liquid gap while the market is closed.</p>
                <p className="mt-3 text-xs tracking-[0.16em] text-primary uppercase">Scheduled</p>
                <p className="mt-1 text-sm text-muted">One sentence. It runs, or it is refused. It does not open another page.</p>
              </div>
              <p className="mt-4 px-2 text-[11px] tracking-[0.16em] text-primary uppercase">One agent</p>
              <h3 className="mt-1 px-2 font-display text-xl text-fg sm:text-2xl">A sentence, or a no</h3>
            </button>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
          <h2 className="text-center font-display text-2xl text-fg sm:text-4xl">How it works</h2>
          <div className="mt-5 grid gap-3 lg:grid-cols-3 sm:mt-8 sm:gap-4">
            <ClockFrame onEnter={onEnter} />
            <button type="button" onClick={() => onEnter("desk", "AAPL")} className="rounded-2xl bg-surface p-4 text-left sm:rounded-3xl sm:p-5">
              <p className="text-[11px] tracking-[0.16em] text-primary uppercase">02</p>
              <div className="mt-3 flex items-center gap-3">
                <Mark symbol="AAPL" name="Apple" />
                <div>
                  <p className="font-display text-2xl text-fg sm:text-3xl">Apple</p>
                  <p className="text-sm text-muted">Last 24 hours</p>
                </div>
              </div>
              <p className="mt-4 inline-flex rounded-full bg-primary/15 px-2.5 py-1 text-xs text-primary">Likely revert</p>
              <p className="mt-4 text-sm text-muted">News, a likely revert, a thin book, or noise. The call sits on the row.</p>
            </button>
            <button type="button" onClick={() => onEnter("desk", "MU")} className="rounded-2xl bg-surface p-4 text-left sm:rounded-3xl sm:p-5">
              <p className="text-[11px] tracking-[0.16em] text-primary uppercase">03</p>
              <div className="mt-3 flex items-center gap-3">
                <Mark symbol="MU" name="Micron" />
                <p className="font-display text-2xl text-fg sm:text-3xl">Refused</p>
              </div>
              <p className="mt-4 text-sm text-pretty text-muted">You buy the name that clears, or Gapline says no. A refusal never becomes a trade.</p>
            </button>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
          <h2 className="text-center font-display text-2xl text-fg sm:text-4xl">FAQ</h2>
          <div className="mt-8 flex flex-col gap-2">
            {FAQS.map((item, index) => {
              const on = open === index;
              return (
                <div key={item.q} className="rounded-2xl bg-surface px-5">
                  <button type="button" className="flex w-full items-center justify-between gap-4 py-4 text-left" onClick={() => setOpen(on ? -1 : index)}>
                    <span className="text-sm text-fg">{item.q}</span>
                    <span className="text-muted">{on ? "–" : "+"}</span>
                  </button>
                  {on && <p className="pb-4 text-sm leading-relaxed text-pretty text-muted">{item.a}</p>}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto max-w-5xl px-4 py-10">
          <p className="font-display text-3xl text-fg">Gapline</p>
          <p className="mt-2 text-sm text-muted">The close is not the end of the tape.</p>
        </div>
      </footer>
    </div>
  );
}
