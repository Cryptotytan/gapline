import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const HOST = "https://web3.binance.com";

type Creds = { key: string; secret: string };

function creds(): Creds | null {
  const key = process.env.BINANCE_WEB3_KEY?.trim();
  const secret = process.env.BINANCE_WEB3_SECRET?.trim();
  if (key && secret) return { key, secret };
  try {
    const parsed = JSON.parse(readFileSync(`${process.cwd()}/.secrets/binance-web3.json`, "utf8")) as {
      key?: string;
      secret?: string;
    };
    if (parsed.key && parsed.secret) return { key: parsed.key, secret: parsed.secret };
  } catch {
    return null;
  }
  return null;
}

async function signedGet(path: string): Promise<{ ok: true; body: unknown } | { ok: false; detail: string }> {
  const keys = creds();
  if (!keys) return { ok: false, detail: "No RWA key is configured on the server." };
  const timestamp = new Date().toISOString();
  const requestPath = `/build${path}`;
  const sign = createHmac("sha256", keys.secret).update(timestamp + "GET" + requestPath, "utf8").digest("base64");
  let res: Response;
  try {
    res = await fetch(HOST + requestPath, {
      headers: {
        "X-OC-APIKEY": keys.key,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": sign,
        "X-OC-RECV-WINDOW": "60000",
      },
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    return { ok: false, detail: "The RWA host did not answer." };
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, detail: `RWA returned an unreadable response (${res.status}).` };
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "msg" in body ? String((body as { msg: unknown }).msg) : res.statusText;
    return { ok: false, detail: msg || `RWA refused the call (${res.status}).` };
  }
  return { ok: true, body };
}

export type RwaToken = {
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
    marketStatus?: string;
    reasonMsg?: string | null;
    nextOpenTime?: number | null;
    nextCloseTime?: number | null;
  };
};

export async function fetchRwaTokens(): Promise<{ ok: true; tokens: RwaToken[] } | { ok: false; detail: string }> {
  const result = await signedGet("/api/v1/dex/market/rwa/tokens?binanceChainId=56");
  if (result.ok) {
    const body = result.body as { code?: number; msg?: string; success?: boolean; data?: RwaToken[] };
    if (body.code === 0 && Array.isArray(body.data)) return { ok: true, tokens: body.data };
    const fallback = await fetchXStocks();
    if (fallback.ok) return fallback;
    return { ok: false, detail: body.msg || "RWA returned no token list." };
  }
  const fallback = await fetchXStocks();
  if (fallback.ok) return fallback;
  return result;
}

const NAMES = new Set(["NVDA", "AAPL", "TSLA", "AMZN", "META", "GOOGL", "MSFT", "AVGO", "TSM", "AMD", "MU", "CRCL", "SPCX"]);

type XAsset = {
  symbol?: string;
  name?: string;
  logo?: string;
  underlyingSymbol?: string;
  trading?: { openNow?: boolean; currentPeriod?: string; nextChangeAt?: string | null };
};

async function fetchXStocks(): Promise<{ ok: true; tokens: RwaToken[] } | { ok: false; detail: string }> {
  const pages = await Promise.all(
    Array.from({ length: 14 }, (_, page) =>
      fetch(`https://api.xstocks.fi/api/v2/public/assets?page=${page}`, {
        headers: { Accept: "application/json", "User-Agent": "Gapline" },
        signal: AbortSignal.timeout(8000),
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ nodes?: XAsset[] }>) : null))
        .catch(() => null),
    ),
  );
  const tokens: RwaToken[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const node of page?.nodes ?? []) {
      const ticker = node.underlyingSymbol?.toUpperCase();
      if (!ticker || !NAMES.has(ticker) || seen.has(ticker) || !node.symbol?.endsWith("x")) continue;
      seen.add(ticker);
      const next = node.trading?.nextChangeAt ? Date.parse(node.trading.nextChangeAt) : null;
      const open = Boolean(node.trading?.openNow);
      tokens.push({
        binanceChainId: "56",
        platformId: "xstocks",
        tokenSymbol: node.symbol,
        tokenLogoUrl: node.logo,
        underlyingTicker: ticker,
        underlyingName: node.name?.replace(/ xStock$/i, ""),
        statusInfo: {
          openState: open,
          marketStatus: node.trading?.currentPeriod,
          reasonMsg: open ? null : "xStocks session is closed",
          nextOpenTime: open ? null : next,
          nextCloseTime: open ? next : null,
        },
      });
    }
  }
  if (!tokens.length) return { ok: false, detail: "xStocks did not list these names." };
  return { ok: true, tokens };
}

export type CatalogRow = { symbol: string; name: string; token: string; address: string; logo: string };

let catalogCache: { at: number; rows: CatalogRow[] } | null = null;

export async function fetchCatalog(): Promise<{ ok: true; rows: CatalogRow[] } | { ok: false; detail: string }> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return { ok: true, rows: catalogCache.rows };
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const res = await fetch(`https://api.xstocks.fi/api/v2/public/assets?page=${page}`, {
      headers: { Accept: "application/json", "User-Agent": "Gapline" },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res?.ok) break;
    const body = (await res.json()) as {
      nodes?: { name?: string; symbol?: string; underlyingSymbol?: string; logo?: string; deployments?: { network?: string; address?: string }[] }[];
      page?: { hasNextPage?: boolean };
    };
    for (const node of body.nodes ?? []) {
      const symbol = node.underlyingSymbol?.toUpperCase();
      const deployment = node.deployments?.find((item) => item.network === "BinanceSmartChain" && item.address);
      if (!symbol || !deployment?.address || !node.symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      rows.push({
        symbol,
        name: (node.name ?? symbol).replace(/ xStock$/i, ""),
        token: node.symbol,
        address: deployment.address,
        logo: node.logo ?? "",
      });
    }
    if (!body.page?.hasNextPage) break;
  }
  if (rows.length < 20) return { ok: false, detail: "The xStocks list did not come back." };
  catalogCache = { at: Date.now(), rows };
  return { ok: true, rows };
}

const CASH = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "TSM", "AMD", "MU", "CRCL"];

let cashCache: { at: number; rows: { symbol: string; price: number; previous: number }[] } | null = null;

export async function fetchCashPrints(): Promise<
  { ok: true; rows: { symbol: string; price: number; previous: number }[] } | { ok: false; detail: string }
> {
  if (cashCache && Date.now() - cashCache.at < 60_000) return { ok: true, rows: cashCache.rows };
  const pages = await Promise.all(
    CASH.map((symbol) =>
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
        headers: { Accept: "application/json", "User-Agent": "Gapline" },
        signal: AbortSignal.timeout(8000),
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ),
  );
  const rows: { symbol: string; price: number; previous: number }[] = [];
  pages.forEach((page, index) => {
    const meta = (page as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }[] } } | null)?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const previous = meta?.chartPreviousClose;
    if (!price || !previous || price <= 0 || previous <= 0) return;
    rows.push({ symbol: CASH[index], price, previous });
  });
  if (rows.length < 8) return { ok: false, detail: "The live market print did not come back." };
  cashCache = { at: Date.now(), rows };
  return { ok: true, rows };
}

const SCORED = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "TSM", "AMD", "MU", "CRCL"];

export type LiveRow = {
  symbol: string;
  name: string;
  token: string;
  address: string;
  logo: string;
  cash: number;
  chain: number;
  tape: { label: string; bps: number }[];
};

export type LiveSnapshot = { ok: true; rows: LiveRow[]; btcMoveBps: number; detail: string } | { ok: false; detail: string };

let snapshotCache: { at: number; snapshot: LiveSnapshot } | null = null;
let snapshotInflight: Promise<LiveSnapshot> | null = null;
let assetCache: { at: number; rows: { symbol: string; asset: { name: string; token: string; address: string; logo: string } | null }[] } | null = null;

function tapeLabel(unix: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" }).format(new Date(unix * 1000));
}

async function intradayTapes(rows: { address: string; cash: number }[]): Promise<Map<string, { label: string; bps: number }[]>> {
  const now = Math.floor(Date.now() / 1000);
  const step = 3 * 60 * 60;
  const stamps = Array.from({ length: 16 }, (_, index) => now - (15 - index) * step);
  const coins = rows.map((row) => `bsc:${row.address}`).join(",");
  const pages = await Promise.all(
    stamps.map(async (ts) => {
      const res = await fetch(`https://coins.llama.fi/prices/historical/${ts}/${coins}`, {
        headers: { Accept: "application/json", "User-Agent": "Gapline" },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!res?.ok) return { ts, coins: {} as Record<string, { price?: number }> };
      const body = (await res.json()) as { coins?: Record<string, { price?: number }> };
      return { ts, coins: body.coins ?? {} };
    }),
  );
  const out = new Map<string, { label: string; bps: number }[]>();
  for (const row of rows) {
    const wanted = `bsc:${row.address.toLowerCase()}`;
    const key = pages.flatMap((page) => Object.keys(page.coins)).find((item) => item.toLowerCase() === wanted) ?? wanted;
    const tape = pages.flatMap(({ ts, coins: book }) => {
      const price = book[key]?.price;
      if (!price || price <= 0 || row.cash <= 0 || Math.abs(price - row.cash) / row.cash > 0.25) return [];
      return [{ label: tapeLabel(ts), bps: Math.round(((price - row.cash) / row.cash) * 10000) }];
    });
    if (tape.length >= 2) out.set(row.address.toLowerCase(), tape);
  }
  return out;
}

async function yahooPrint(symbol: string): Promise<{ price: number; previous: number } | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
    headers: { Accept: "application/json", "User-Agent": "Gapline" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const page = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }[] } };
  const meta = page.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const previous = meta?.chartPreviousClose;
  if (!price || !previous || price <= 0 || previous <= 0) return null;
  return { price, previous };
}

async function xStockAsset(symbol: string): Promise<{ name: string; token: string; address: string; logo: string } | null> {
  const res = await fetch(`https://api.xstocks.fi/api/v2/public/assets/${symbol}x`, {
    headers: { Accept: "application/json", "User-Agent": "Gapline" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as {
    name?: string;
    symbol?: string;
    logo?: string;
    deployments?: { network?: string; address?: string }[];
  };
  const address = body.deployments?.find((item) => item.network === "BinanceSmartChain")?.address;
  if (!address || !body.symbol) return null;
  return { name: (body.name ?? symbol).replace(/ xStock$/i, ""), token: body.symbol, address, logo: body.logo ?? "" };
}

async function chainPrices(addresses: string[]): Promise<Record<string, number>> {
  const coins = addresses.map((address) => `bsc:${address}`).join(",");
  const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`, {
    headers: { Accept: "application/json", "User-Agent": "Gapline" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return {};
  const body = (await res.json()) as { coins?: Record<string, { price?: number }> };
  const prices: Record<string, number> = {};
  for (const [key, value] of Object.entries(body.coins ?? {})) {
    const address = key.split(":")[1];
    if (address && value.price && value.price > 0) prices[address.toLowerCase()] = value.price;
  }
  return prices;
}

const rememberedTapes = new Map<string, { label: string; bps: number }[]>();

function tapeWorth(tape: { bps: number }[]) {
  const levels = new Set(tape.map((point) => Math.round(point.bps / 5)));
  return levels.size < 3 ? -1 : levels.size * 100 + tape.length;
}

function keepServerTape(address: string, tape: { label: string; bps: number }[]) {
  const key = address.toLowerCase();
  const previous = rememberedTapes.get(key);
  if (!previous || tapeWorth(tape) >= tapeWorth(previous)) rememberedTapes.set(key, tape);
  return rememberedTapes.get(key) ?? tape;
}

async function chainTape(address: string, cash: number): Promise<{ label: string; bps: number }[]> {
  const res = await fetch(`https://coins.llama.fi/chart/bsc:${address}?span=48&period=30m`, {
    headers: { Accept: "application/json", "User-Agent": "Gapline" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok || cash <= 0) return keepServerTape(address, []);
  const body = (await res.json()) as { coins?: Record<string, { prices?: { timestamp: number; price: number }[] }> };
  const points = (Object.values(body.coins ?? {})[0]?.prices ?? []).filter((point) => point.price > 0);
  if (points.length < 4) return keepServerTape(address, []);
  const step = Math.max(1, Math.ceil(points.length / 24));
  const sampled = points.filter((point, index) => index % step === 0 || index === points.length - 1);
  const open = sampled[0].price;
  const tape = sampled.map((point) => ({ label: tapeLabel(point.timestamp), bps: Math.round(((point.price - open) / open) * 10000) }));
  return keepServerTape(address, tape);
}

export async function fetchMarks(addresses: string[]) {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))].filter((address) => address.startsWith("0x")).slice(0, 60);
  if (!unique.length) return { ok: true as const, prices: {} as Record<string, number> };
  const prices = await chainPrices(unique);
  return { ok: true as const, prices };
}

export function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < 60_000 && snapshotCache.snapshot.ok) return Promise.resolve(snapshotCache.snapshot);
  if (snapshotInflight) return snapshotInflight;
  snapshotInflight = loadLiveSnapshot().finally(() => {
    snapshotInflight = null;
  });
  return snapshotInflight;
}

async function loadLiveSnapshot(): Promise<LiveSnapshot> {
  const assets =
    assetCache && Date.now() - assetCache.at < 30 * 60_000
      ? assetCache.rows
      : await Promise.all(SCORED.map((symbol) => xStockAsset(symbol).then((asset) => ({ symbol, asset }))));
  if (!assetCache || Date.now() - assetCache.at >= 30 * 60_000) assetCache = { at: Date.now(), rows: assets };
  const [prints, btc] = await Promise.all([
    Promise.all(SCORED.map((symbol) => yahooPrint(symbol).then((print) => ({ symbol, print })))),
    yahooPrint("BTC-USD"),
  ]);
  const ready = assets.filter((item) => item.asset);
  const printBy = new Map(prints.map((item) => [item.symbol, item.print]));
  const quoted = ready
    .map((item) => {
      const asset = item.asset!;
      const print = printBy.get(item.symbol);
      if (!print) return null;
      return { symbol: item.symbol, asset, print };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
  const [prices, charts] = await Promise.all([
    chainPrices(quoted.map((item) => item.asset.address)),
    Promise.all(quoted.map((item) => chainTape(item.asset.address, item.print.price))),
  ]);
  const drafted = quoted
    .map((item, index) => {
      const chain = prices[item.asset.address.toLowerCase()];
      if (!chain) return null;
      return { ...item, chain, tape: charts[index] ?? [] };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
  const missing = drafted.filter((item) => item.tape.length < 3);
  const filled = missing.length ? await intradayTapes(missing.map((item) => ({ address: item.asset.address, cash: item.print.price }))) : new Map<string, { label: string; bps: number }[]>();
  const rows: LiveRow[] = drafted.map((item) => ({
    symbol: item.symbol,
    name: item.asset.name,
    token: item.asset.token,
    address: item.asset.address,
    logo: item.asset.logo,
    cash: item.print.price,
    chain: item.chain,
    tape: item.tape.length >= 3 ? item.tape : filled.get(item.asset.address.toLowerCase()) ?? item.tape,
  }));
  if (rows.length < 8) return { ok: false, detail: "The live prices did not come back." };
  const btcMoveBps = btc ? Math.round(((btc.price - btc.previous) / btc.previous) * 10000) : 0;
  const snapshot: LiveSnapshot = {
    ok: true,
    rows,
    btcMoveBps,
    detail: `Live. Token marks and the last stock prints just updated. Bitcoin is ${btcMoveBps >= 0 ? "up" : "down"} ${Math.abs(btcMoveBps / 100).toFixed(1)}% since the prior close.`,
  };
  snapshotCache = { at: Date.now(), snapshot };
  return snapshot;
}

void fetchLiveSnapshot().catch(() => undefined);

const chartCache = new Map<string, { at: number; tape: { label: string; bps: number }[] }>();

async function yahooChart(symbol: string): Promise<{ label: string; bps: number }[]> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=15m&range=5d`, {
    headers: { Accept: "application/json", "User-Agent": "Gapline" },
    signal: AbortSignal.timeout(2500),
  }).catch(() => null);
  if (!res?.ok) return [];
  const page = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const result = page.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points = stamps.flatMap((stamp, index) => {
    const price = closes[index];
    return price && price > 0 ? [{ stamp, price }] : [];
  });
  if (points.length < 8) return [];
  const open = points[0].price;
  const step = Math.max(1, Math.ceil(points.length / 48));
  return points
    .filter((point, index) => index % step === 0 || index === points.length - 1)
    .map((point) => ({ label: tapeLabel(point.stamp), bps: Math.round(((point.price - open) / open) * 10000) }));
}

export async function fetchChartTape(symbol: string, address?: string): Promise<{ label: string; bps: number }[]> {
  const key = symbol.toUpperCase();
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < 60_000 && hit.tape.length >= 8) return hit.tape;
  const yahoo = await yahooChart(key);
  const tape = yahoo.length >= 8 ? yahoo : address ? await chainTape(address, 1) : [];
  if (tape.length >= 8) chartCache.set(key, { at: Date.now(), tape });
  return tape.length >= 8 ? tape : (hit?.tape ?? tape);
}
