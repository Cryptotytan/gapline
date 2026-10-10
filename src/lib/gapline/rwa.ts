import { createServerFn } from "@tanstack/react-start";
import { BOOKS, setLiveBtc, type Book } from "./model";

export type RwaTokenLike = {
  binanceChainId?: string;
  platformId?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
  underlyingTicker?: string;
  underlyingName?: string;
  tokenPrice?: string;
  referencePrice?: string;
  volume24H?: string;
  statusInfo?: {
    openState?: boolean;
    reasonMsg?: string | null;
    nextOpenTime?: number | null;
    nextCloseTime?: number | null;
  };
};

export type LiveNote =
  | { ok: true; open: boolean; nextAt: number | null; detail: string; clock: boolean }
  | { ok: false; detail: string };

const LIVE_DETAIL = "Live BSC prints from Binance. The per-share price is converted from the token, not Friday’s official close.";
const XSTOCKS_DETAIL = "Connected to the xStocks RWA API. Binance refused this network, so bStocks and Ondo stay on Friday’s tape.";

export function tapeSession(tokens: RwaTokenLike[]): LiveNote {
  const info = tokens.find((token) => token.statusInfo)?.statusInfo;
  const fromBinance = tokens.some((token) => token.platformId === "ondo" || token.platformId === "bstock");
  const open = Boolean(info?.openState);
  return {
    ok: true,
    open,
    clock: fromBinance,
    nextAt: open ? (info?.nextCloseTime ?? null) : (info?.nextOpenTime ?? null),
    detail: fromBinance ? LIVE_DETAIL : XSTOCKS_DETAIL,
  };
}

export const getLiveTape = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchRwaTokens } = await import("./rwa.server");
  return fetchRwaTokens();
});

export const getCashPrints = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchCashPrints } = await import("./rwa.server");
  return fetchCashPrints();
});

export const getCatalog = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchCatalog } = await import("./rwa.server");
  return fetchCatalog();
});

export const getChainMarks = createServerFn({ method: "POST" })
  .validator((input: { addresses?: string[] }) => ({
    addresses: Array.isArray(input?.addresses) ? input.addresses.map((item) => String(item)).slice(0, 60) : [],
  }))
  .handler(async ({ data }) => {
    const { fetchMarks } = await import("./rwa.server");
    return fetchMarks(data.addresses);
  });

export function applyChainMarks(books: Book[], prices: Record<string, number>): Book[] {
  return books.map((book) => {
    const chain = book.address ? prices[book.address.toLowerCase()] : 0;
    if (!chain || chain <= 0) return book;
    const stock = book.venues.bstocks.price > 0 ? book.venues.bstocks.price : chain;
    const ondo = book.venues.ondo.price > 0 ? book.venues.ondo.price : chain;
    const spot = book.venues.xstocks.price > 0 ? book.venues.xstocks.price : chain;
    return {
      ...book,
      live: true,
      venues: {
        bstocks: { ...book.venues.bstocks, price: stock, liquidityUsd: book.venues.bstocks.liquidityUsd || 250_000 },
        ondo: { ...book.venues.ondo, price: ondo, liquidityUsd: book.venues.ondo.liquidityUsd || 250_000 },
        xstocks: { ...book.venues.xstocks, price: spot, liquidityUsd: book.venues.xstocks.liquidityUsd || 250_000 },
      },
    };
  });
}

export const getLiveSnapshot = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchLiveSnapshot } = await import("./rwa.server");
  return fetchLiveSnapshot();
});

export const getChartTape = createServerFn({ method: "POST" })
  .validator((input: { symbol?: string; address?: string }) => ({
    symbol: String(input?.symbol ?? "").slice(0, 12).toUpperCase(),
    address: String(input?.address ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!data.symbol) return [];
    const { fetchChartTape } = await import("./rwa.server");
    return fetchChartTape(data.symbol, data.address || undefined);
  });

export function applyLiveSnapshot(
  books: Book[],
  rows: { symbol: string; name: string; token: string; address: string; logo: string; cash: number; chain: number; tape: { label: string; bps: number }[] }[],
  btcMoveBps: number,
): Book[] {
  setLiveBtc(btcMoveBps);
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return books.map((book) => {
    const row = bySymbol.get(book.symbol);
    if (!row || row.cash <= 0 || row.chain <= 0) return book;
    return {
      ...book,
      name: row.name || book.name,
      reference: row.cash,
      live: true,
      address: row.address || book.address,
      logo: row.logo || book.logo,
      about: "The token mark is live. The reference is the last official stock print.",
      tape: keepTape(book.tape, row.tape),
      venues: {
        bstocks: {
          token: book.venues.bstocks.token,
          price: row.cash,
          liquidityUsd: book.venues.bstocks.liquidityUsd || 500_000,
        },
        ondo: {
          token: book.venues.ondo.token,
          price: row.cash,
          liquidityUsd: book.venues.ondo.liquidityUsd || 500_000,
        },
        xstocks: { token: row.token || book.venues.xstocks.token, price: row.chain, liquidityUsd: 1_000_000 },
      },
    };
  });
}

function tapeScore(tape?: { bps: number }[]) {
  if (!tape || tape.length < 3) return -1;
  const levels = new Set(tape.map((point) => Math.round(point.bps / 5)));
  if (levels.size < 3) return -1;
  return levels.size * 100 + tape.length;
}

function keepTape(current?: { label: string; bps: number }[], next?: { label: string; bps: number }[]) {
  const currentScore = tapeScore(current);
  const nextScore = tapeScore(next);
  if (nextScore < 0) return currentScore >= 0 ? current : next;
  if (currentScore < 0) return next;
  if (nextScore + 20 < currentScore) return current;
  return next;
}

export function appendCatalog(books: Book[], rows: { symbol: string; name: string; token: string; address: string; logo: string }[]): { books: Book[]; marks: Record<string, string> } {
  const marks: Record<string, string> = {};
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  const next = books.map((book) => {
    const row = bySymbol.get(book.symbol);
    if (!row) return book;
    if (row.logo) marks[book.symbol] = row.logo;
    return { ...book, address: row.address, logo: row.logo || book.logo };
  });
  const known = new Set(next.map((book) => book.symbol));
  for (const row of rows) {
    if (known.has(row.symbol)) continue;
    if (row.logo) marks[row.symbol] = row.logo;
    next.push({
      symbol: row.symbol,
      name: row.name,
      baskets: [],
      reference: null,
      about: "Listed on xStocks. Not scored as a weekend gap.",
      spot: true,
      address: row.address,
      logo: row.logo,
      venues: {
        bstocks: { token: row.token, price: 0, liquidityUsd: 0 },
        ondo: { token: row.token, price: 0, liquidityUsd: 0 },
        xstocks: { token: row.token, price: 0, liquidityUsd: 0 },
      },
    });
  }
  return { books: next, marks };
}

export function applyCashPrints(books: Book[], rows: { symbol: string; price: number; previous: number }[]): Book[] {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return books.map((book) => {
    const row = bySymbol.get(book.symbol);
    if (!row) return book;
    const base = book.venues.bstocks.price || row.price;
    const carry = base > 0 ? book.venues.ondo.price / base : 1;
    return {
      ...book,
      reference: row.previous,
      live: true,
      venues: {
        bstocks: { ...book.venues.bstocks, price: row.price },
        xstocks: { ...book.venues.xstocks, price: row.price },
        ondo: { ...book.venues.ondo, price: row.price * (Number.isFinite(carry) && carry > 0 ? carry : 1) },
      },
    };
  });
}

function num(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function mergeTape(tokens: RwaTokenLike[]): { books: Book[]; marks: Record<string, string> } {
  const groups = new Map<string, RwaTokenLike[]>();
  for (const token of tokens) {
    if (token.binanceChainId && token.binanceChainId !== "56") continue;
    const ticker = token.underlyingTicker?.toUpperCase();
    if (!ticker) continue;
    const key = ticker === "GOOG" ? "GOOGL" : ticker;
    const list = groups.get(key) ?? [];
    list.push(token);
    groups.set(key, list);
  }
  const marks: Record<string, string> = {};
  const books = BOOKS.map((book) => {
    const rows = groups.get(book.symbol);
    if (!rows?.length) return book;
    const ondo = rows.find((row) => row.platformId === "ondo");
    const bstock = rows.find((row) => row.platformId === "bstock");
    const xstock = rows.find((row) => row.platformId === "xstocks");
    const logo = bstock?.tokenLogoUrl || ondo?.tokenLogoUrl || xstock?.tokenLogoUrl;
    if (logo) marks[book.symbol] = logo;
    const bPrice = num(bstock?.tokenPrice);
    const oPrice = num(ondo?.tokenPrice);
    const xPrice = num(xstock?.tokenPrice);
    if (bPrice == null && oPrice == null && xPrice == null) return book;
    const reference = num((bstock ?? ondo)?.referencePrice) ?? book.reference;
    if (reference == null) return book;
    const depth = (row: RwaTokenLike | undefined, fallback: number) => num(row?.volume24H) ?? fallback;
    return {
      ...book,
      name: (bstock ?? ondo)?.underlyingName || book.name,
      reference,
      live: bPrice != null || oPrice != null,
      venues: {
        bstocks: {
          token: bstock?.tokenSymbol || book.venues.bstocks.token,
          price: bPrice ?? book.venues.bstocks.price,
          liquidityUsd: bPrice != null ? depth(bstock, book.venues.bstocks.liquidityUsd) : book.venues.bstocks.liquidityUsd,
        },
        ondo: {
          token: ondo?.tokenSymbol || book.venues.ondo.token,
          price: oPrice ?? book.venues.ondo.price,
          liquidityUsd: oPrice != null ? depth(ondo, book.venues.ondo.liquidityUsd) : book.venues.ondo.liquidityUsd,
        },
        xstocks: {
          token: xstock?.tokenSymbol || book.venues.xstocks.token,
          price: xPrice ?? book.venues.xstocks.price,
          liquidityUsd: xPrice != null ? depth(xstock, book.venues.xstocks.liquidityUsd) : book.venues.xstocks.liquidityUsd,
        },
      },
    } satisfies Book;
  });
  return { books, marks };
}
