export type VenueId = "bstocks" | "ondo" | "xstocks";
export type BasketId = "mag7" | "ai" | "buffett" | "energy" | "banks" | "consumer" | "software";
export type CallId = "noise" | "revert" | "news" | "thin" | "unscored";
export type Side = "buy" | "sell";

export type VenueBook = {
  token: string;
  price: number;
  liquidityUsd: number;
};

export type Book = {
  symbol: string;
  name: string;
  baskets: BasketId[];
  reference: number | null;
  about: string;
  live?: boolean;
  spot?: boolean;
  address?: string;
  logo?: string;
  tape?: { label: string; bps: number }[];
  dayBps?: number | null;
  venues: Record<VenueId, VenueBook>;
};

export type Call = { id: CallId; label: string; detail: string };

export type Limits = { maxSizeUsd: number };

export type Position = {
  symbol: string;
  venue: VenueId;
  token: string;
  qty: number;
  costUsd: number;
};

export type Guard = { ok: boolean; blockers: string[]; notes: string[] };

export type RankedVenue = {
  venue: VenueId;
  token: string;
  price: number;
  liquidityUsd: number;
  feeBps: number;
  impactBps: number;
  effective: number;
  totalReturn: boolean;
};

export type Decision = "refuse" | "leave" | "buy" | "news";

export type Advice = {
  ranked: RankedVenue[];
  cheapest: RankedVenue;
  fair: RankedVenue;
  pick: VenueId;
  carryBps: number | null;
  carryNotArb: boolean;
  note: string;
  decision: Decision;
};

export type SimOrder = {
  key: string;
  symbol: string;
  venue: VenueId;
  token: string;
  side: Side;
  sizeUsd: number;
  qty: number;
  effective: number;
  impactBps: number;
  feeBps: number;
  guard: Guard;
};

export type CompiledRule =
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "gap";
      symbol: string;
      minAbsSpreadBps: number;
      requireClosed: boolean;
      side: "buy-discount" | "sell-premium";
      sizeUsd: number;
    }
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "btc-drop";
      dropPct: number;
      rotatePct: number;
    }
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "widest";
      sizeUsd: number;
    }
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "monday-basket";
      basket: BasketId;
      budget: number;
      maxDriftPct: number;
    }
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "stand-down";
    }
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "drift";
      basket: BasketId;
      maxDriftPct: number;
    }
  | {
      ok: true;
      source: string;
      summary: string;
      notes: string[];
      flattenAfterOpenMin: number | null;
      kind: "exit";
      symbol: string;
      mode: "take-profit" | "stop-loss";
      pct: number;
    }
  | { ok: false; source: string; summary: string; notes: string[] };

export type PlannedOrder = { symbol: string; side: Side; sizeUsd: number; venue?: VenueId };

export type DryRun = {
  fired: boolean;
  reason: string;
  orders: PlannedOrder[];
};

export const VENUES: Record<
  VenueId,
  { label: string; model: string; feeBps: number }
> = {
  bstocks: { label: "bStocks", model: "1:1 share", feeBps: 5 },
  ondo: { label: "Ondo", model: "total return", feeBps: 8 },
  xstocks: { label: "xStocks", model: "1:1 share", feeBps: 10 },
};

export const VENUE_ORDER: VenueId[] = ["bstocks", "ondo", "xstocks"];

export const MARKET = {
  status: "closed" as const,
  closedSince: "Fri 2 Oct 2026, 16:00 ET",
  nextOpen: "Mon 5 Oct 2026, 09:30 ET",
  asOf: "Sat 3 Oct 2026, 14:10 ET",
  btcMoveBps: 240,
  bnbMoveBps: 180,
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function etParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hh: Number(get("hour")),
    mm: Number(get("minute")),
    ss: Number(get("second")),
  };
}

function etLocalToUtc(y: number, m: number, d: number, hh: number, mm: number) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const asEt = (instant: number) => {
    const parts = etParts(new Date(instant));
    return Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss);
  };
  const first = wall - (asEt(wall) - wall);
  return wall - (asEt(first) - first);
}

export function marketClock(now = new Date()) {
  const parts = etParts(now);
  const minutes = parts.hh * 60 + parts.mm;
  const weekday = WEEKDAYS.includes(parts.weekday);
  const open = weekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  if (open) {
    return { open: true, at: etLocalToUtc(parts.y, parts.m, parts.d, 16, 0) };
  }
  if (weekday && minutes < 9 * 60 + 30) {
    return { open: false, at: etLocalToUtc(parts.y, parts.m, parts.d, 9, 30) };
  }
  let cursor = etLocalToUtc(parts.y, parts.m, parts.d, 12, 0);
  for (let i = 0; i < 7; i += 1) {
    cursor += 24 * 60 * 60 * 1000;
    const next = etParts(new Date(cursor));
    if (WEEKDAYS.includes(next.weekday)) return { open: false, at: etLocalToUtc(next.y, next.m, next.d, 9, 30) };
  }
  return { open: false, at: now.getTime() + 24 * 60 * 60 * 1000 };
}

export function formatRemain(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export const BASKETS: Record<
  BasketId,
  { id: BasketId; name: string; hint: string; symbols: string[] }
> = {
  mag7: {
    id: "mag7",
    name: "Magnificent 7",
    hint: "Equal weight. The RWA sector list, bought as seven spot legs.",
    symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"],
  },
  ai: {
    id: "ai",
    name: "AI chips",
    hint: "NVDA, Broadcom, TSMC, AMD, Micron. Micron's book is intentionally thin.",
    symbols: ["NVDA", "AVGO", "TSM", "AMD", "MU"],
  },
  buffett: {
    id: "buffett",
    name: "Buffett book",
    hint: "A liquid stand-in for the sector filter, not a copy of the 13F.",
    symbols: ["AAPL", "AMZN", "GOOGL"],
  },
  energy: {
    id: "energy",
    name: "Energy",
    hint: "Exxon, Chevron, and ConocoPhillips. Equal weight.",
    symbols: ["XOM", "CVX", "COP"],
  },
  banks: {
    id: "banks",
    name: "Banks",
    hint: "JPMorgan, Bank of America, and Goldman Sachs.",
    symbols: ["JPM", "BAC", "GS"],
  },
  consumer: {
    id: "consumer",
    name: "Consumer",
    hint: "Amazon, Walmart, Coca-Cola, McDonald's, and Starbucks.",
    symbols: ["AMZN", "WMT", "KO", "MCD", "SBUX"],
  },
  software: {
    id: "software",
    name: "Software",
    hint: "Microsoft, Alphabet, Meta, Salesforce, and Oracle.",
    symbols: ["MSFT", "GOOGL", "META", "CRM", "ORCL"],
  },
};

export const DEFENSIVES = ["AAPL", "MSFT", "GOOGL", "AMZN"];

function row(
  symbol: string,
  name: string,
  baskets: BasketId[],
  reference: number | null,
  about: string,
  b: [number, number],
  o: [number, number],
  x: [number, number],
): Book {
  return {
    symbol,
    name,
    baskets,
    reference,
    about,
    venues: {
      bstocks: { token: `${symbol}B`, price: b[0], liquidityUsd: b[1] },
      ondo: { token: `${symbol}on`, price: o[0], liquidityUsd: o[1] },
      xstocks: { token: `${symbol}x`, price: x[0], liquidityUsd: x[1] },
    },
  };
}

export const BOOKS: Book[] = [
  row("NVDA", "NVIDIA", ["mag7", "ai"], 178.4, "High beta to the weekend crypto bid. Gap is about what that bid explains.", [180.12, 1_400_000], [180.88, 860_000], [179.64, 510_000]),
  row("AAPL", "Apple", ["mag7", "buffett"], 248.2, "The latest print is tight across the three venues.", [248.48, 2_200_000], [249.3, 1_500_000], [248.7, 640_000]),
  row("MSFT", "Microsoft", ["mag7"], 508, "A few cents under the cash close. Inside the noise band.", [506.1, 980_000], [507.4, 640_000], [506.55, 300_000]),
  row("AMZN", "Amazon", ["mag7", "buffett"], 228.5, "The latest print is a little under the last session while BTC is up.", [226.44, 760_000], [227.2, 420_000], [226.7, 250_000]),
  row("META", "Meta", ["mag7"], 712, "A modest premium, in line with the weekend risk bid.", [718.4, 540_000], [720.1, 310_000], [717.2, 180_000]),
  row("GOOGL", "Alphabet", ["mag7", "buffett"], 196.4, "Flat over the last day. Nothing to do.", [196.15, 890_000], [196.95, 510_000], [196.4, 240_000]),
  row("TSLA", "Tesla", ["mag7"], 412, "The premium is several times the crypto move. Treat it as news, not a peg.", [431.6, 870_000], [433.2, 240_000], [428.9, 190_000]),
  row("AVGO", "Broadcom", ["ai"], 338.5, "Chip complex is bid with the tape. Depth is usable.", [343.1, 410_000], [344.4, 220_000], [342.2, 140_000]),
  row("TSM", "TSMC", ["ai"], 212.8, "Same chip bid, smaller book than NVIDIA.", [215.9, 380_000], [216.7, 160_000], [214.95, 120_000]),
  row("AMD", "AMD", ["ai"], 164.3, "Premium is wider than NVDA, and the xStocks book is thin.", [167.8, 120_000], [168.5, 70_000], [166.9, 55_000]),
  row("MU", "Micron", ["ai"], 146.2, "The gap looks large because almost nobody is quoting it.", [155.1, 46_000], [156, 22_000], [153.4, 31_000]),
  row("CRCL", "Circle", [], 182.5, "A listed name with a clean reference and a medium book.", [186.2, 300_000], [186.9, 140_000], [185.4, 90_000]),
  row("SPCX", "SpaceX", [], null, "No cash session. The number on screen is the latest token print.", [214, 150_000], [216, 80_000], [212, 60_000]),
  row("NFLX", "Netflix", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("JPM", "JPMorgan", ["banks"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("BAC", "Bank of America", ["banks"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("GS", "Goldman Sachs", ["banks"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("V", "Visa", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("MA", "Mastercard", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("WMT", "Walmart", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("COST", "Costco", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("KO", "Coca-Cola", ["consumer", "buffett"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("PEP", "PepsiCo", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("DIS", "Disney", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("NKE", "Nike", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("MCD", "McDonald's", ["consumer", "buffett"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("SBUX", "Starbucks", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("HD", "Home Depot", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("XOM", "Exxon Mobil", ["energy"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("CVX", "Chevron", ["energy"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("BA", "Boeing", [], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("CAT", "Caterpillar", [], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("ORCL", "Oracle", ["software"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("CRM", "Salesforce", ["software"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("INTC", "Intel", ["ai"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("QCOM", "Qualcomm", ["ai"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("IBM", "IBM", ["software"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("COIN", "Coinbase", [], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("PLTR", "Palantir", ["ai", "software"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("ADBE", "Adobe", ["software"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
  row("UBER", "Uber", ["consumer"], null, "A major name. The price is the latest print.", [0, 500_000], [0, 250_000], [0, 250_000]),
];

export const MAJOR_SYMBOLS = new Set(BOOKS.map((book) => book.symbol));

export const DEFAULT_LIMITS: Limits = { maxSizeUsd: 25 };
export const PAPER_CASH = 500;
export const EXPLAIN_FEE = 0.1;

const logos: Record<string, string> = {};
let liveBooks: Book[] | null = null;

export function installLiveBooks(next: Book[] | null, marks: Record<string, string> = {}) {
  liveBooks = next;
  for (const [symbol, url] of Object.entries(marks)) logos[symbol] = url;
}

export function allBooks(): Book[] {
  return liveBooks ?? BOOKS;
}

export function book(symbol: string): Book | undefined {
  return allBooks().find((item) => item.symbol === symbol);
}

const LOCAL_LOGO: Record<string, string> = {
  NVDA: "/marks/NVDA.svg",
  AAPL: "/marks/AAPL.svg",
  MSFT: "/marks/MSFT.svg",
  AMZN: "/marks/AMZN.svg",
  META: "/marks/META.svg",
  GOOGL: "/marks/GOOGL.svg",
  TSLA: "/marks/TSLA.svg",
  AVGO: "/marks/AVGO.svg",
  TSM: "/marks/TSM.svg",
  AMD: "/marks/AMD.svg",
  MU: "/marks/MU.svg",
  CRCL: "/marks/CRCL.jpg",
  SPCX: "/marks/SPCX.png",
};

let liveBtc = MARKET.btcMoveBps;

export function setLiveBtc(bps: number) {
  if (Number.isFinite(bps)) liveBtc = bps;
}

export function btcMove(): number {
  return liveBtc;
}

export function logoSources(symbol: string): string[] {
  const key = symbol.toUpperCase();
  const domain = DOMAINS[key];
  const list = [
    LOCAL_LOGO[key],
    book(key)?.logo,
    logos[key],
    `https://xstocks-metadata.backed.fi/logos/tokens/${key}x.png`,
    domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : "",
  ];
  return list.filter((src, index): src is string => Boolean(src) && list.indexOf(src) === index);
}

export function logoFor(symbol: string): string | undefined {
  return logoSources(symbol)[0];
}

export function formatUsd(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatBps(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)} bp`;
}

export function formatMove(bps: number | null): string {
  if (bps == null) return "—";
  const sign = bps > 0 ? "+" : "";
  return `${sign}${(bps / 100).toFixed(2)}%`;
}

export const DOMAINS: Record<string, string> = {
  NVDA: "nvidia.com",
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  AMZN: "amazon.com",
  META: "meta.com",
  GOOGL: "google.com",
  TSLA: "tesla.com",
  AVGO: "broadcom.com",
  TSM: "tsmc.com",
  AMD: "amd.com",
  MU: "micron.com",
  CRCL: "circle.com",
  SPCX: "spacex.com",
};

export function formatQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 });
}

export function gapBps(price: number, reference: number): number {
  return ((price - reference) / reference) * 10000;
}

export function stockPrice(b: Book): number {
  return b.venues.xstocks.price || b.venues.bstocks.price || b.venues.ondo.price || 0;
}

export function shownMove(b: Book): number | null {
  if (b.dayBps == null || !Number.isFinite(b.dayBps)) return null;
  return b.dayBps;
}

export function gapOf(b: Book): number | null {
  return shownMove(b);
}

export function classify(b: Book, btcMoveBps = btcMove()): Call {
  const move = shownMove(b);
  const liq = b.live ? b.venues.xstocks.liquidityUsd : b.venues.bstocks.liquidityUsd;
  if (!b.live && liq < 80_000) {
    return {
      id: "thin",
      label: "Skip",
      detail: "The price jumped, but almost nobody is trading it. A small buy would move the price more than the change.",
    };
  }
  if (move == null) {
    return {
      id: "noise",
      label: "Live",
      detail: "This is the latest print. The 24 hour change is still loading.",
    };
  }
  if (Math.abs(move) < 40) {
    return {
      id: "noise",
      label: "Quiet",
      detail: "The last 24 hours barely moved this price. Fees would cost more than the difference.",
    };
  }
  const expected = btcMoveBps * 0.35;
  const residual = move - expected;
  if (Math.abs(residual) > 180) {
    return {
      id: "news",
      label: "Unusual",
      detail: "This 24 hour move is larger than Bitcoin explains.",
    };
  }
  return {
    id: "revert",
    label: "May settle",
    detail: "This 24 hour move is in line with Bitcoin. The price on screen is the latest print.",
  };
}

export function impactBps(sizeUsd: number, liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 800;
  return Math.min(800, Math.round((sizeUsd / liquidityUsd) * 1_000_000));
}

export function effectivePrice(price: number, feeBps: number, impact: number, side: Side): number {
  const sign = side === "buy" ? 1 : -1;
  return price * (1 + (sign * (feeBps + impact)) / 10000);
}

export function rankVenues(b: Book, sizeUsd: number, side: Side): RankedVenue[] {
  const ranked = VENUE_ORDER.map((venue) => {
    const v = b.venues[venue];
    const feeBps = VENUES[venue].feeBps;
    const impact = impactBps(sizeUsd, v.liquidityUsd);
    return {
      venue,
      token: v.token,
      price: v.price,
      liquidityUsd: v.liquidityUsd,
      feeBps,
      impactBps: impact,
      effective: effectivePrice(v.price, feeBps, impact, side),
      totalReturn: venue === "ondo",
    };
  }).filter((venue) => venue.price > 0);
  ranked.sort((a, c) => (side === "buy" ? a.effective - c.effective : c.effective - a.effective));
  return ranked;
}

export function listRoutes(b: Book, sizeUsd: number): RankedVenue[] {
  const priced = new Map(rankVenues(b, sizeUsd, "buy").map((row) => [row.venue, row]));
  return VENUE_ORDER.map((venue) => {
    const row = priced.get(venue);
    if (row) return row;
    return {
      venue,
      token: b.venues[venue].token,
      price: 0,
      liquidityUsd: 0,
      feeBps: VENUES[venue].feeBps,
      impactBps: 0,
      effective: 0,
      totalReturn: venue === "ondo",
    };
  });
}

export function advise(b: Book, sizeUsd: number): Advice {
  const ranked = rankVenues(b, sizeUsd, "buy");
  if (!ranked.length) {
    const empty: RankedVenue = {
      venue: "xstocks",
      token: b.venues.xstocks.token,
      price: 0,
      liquidityUsd: 0,
      feeBps: VENUES.xstocks.feeBps,
      impactBps: 0,
      effective: 0,
      totalReturn: false,
    };
    return {
      ranked: [empty],
      cheapest: empty,
      fair: empty,
      pick: "xstocks",
      carryBps: null,
      carryNotArb: false,
      note: `${b.name} has no live price yet. Nothing is sent.`,
      decision: "refuse",
    };
  }
  const cheapest = ranked[0];
  const fair = ranked.filter((r) => r.venue !== "ondo").sort((a, c) => a.effective - c.effective)[0];
  const ondo = ranked.find((r) => r.venue === "ondo");
  const share = ranked.find((r) => r.venue === "bstocks");
  const carryBps = ondo && share ? gapBps(ondo.price, share.price) : null;
  const carryNotArb = carryBps != null && carryBps > 0 && carryBps < 120;
  const call = classify(b);
  const moveBps = shownMove(b);
  const move = moveBps == null ? null : formatMove(moveBps);
  const changed = move ? `${b.name} is ${move} over the last 24 hours` : `${b.name} is on the latest print`;
  let decision: Decision = "leave";
  let pick = fair.venue;
  let note = `${changed}. Buy nothing.`;

  if (call.id === "thin") {
    decision = "refuse";
    note = `${changed}. The book is only ${formatUsd(b.venues.bstocks.liquidityUsd, 0)} deep, so the move is the empty market, not a discount. Buy nothing.`;
  } else if (call.id === "news") {
    decision = "news";
    pick = fair.venue;
    const carryBit = carryNotArb ? ` Ondo is ${Math.round(carryBps ?? 0)} bp rich, and that part is the dividend, not an arb.` : "";
    note = `${changed}. Bitcoin does not explain a move that large. This may be news.${carryBit} A small buy of the 1:1 token is allowed.`;
  } else if (carryBps != null && carryBps >= 120) {
    decision = "leave";
    note = `Ondo is ${Math.round(carryBps)} bp rich to the 1:1 token. That is more than a normal dividend. Do not arb it. Buy nothing.`;
  } else if (carryBps != null && carryBps <= -20) {
    decision = "leave";
    note = `Ondo is ${Math.round(Math.abs(carryBps))} bp cheap to the 1:1 token. A total-return token should not trade at a discount. Buy nothing.`;
  } else if (call.id === "noise") {
    decision = "leave";
    const carryBit = carryNotArb ? `Ondo is ${Math.round(carryBps ?? 0)} bp rich to the 1:1 token. That is the dividend, not an arb. ` : "";
    note = `${carryBit}${changed}. Fees cost more than that. Buy nothing.`;
  } else if (carryNotArb) {
    decision = "buy";
    pick = fair.venue;
    note = `Ondo is ${Math.round(carryBps ?? 0)} bp rich to the 1:1 token. That is the dividend, not an arb. ${changed}, in line with Bitcoin. Buy ${VENUES[pick].label}, or buy nothing.`;
  } else {
    decision = "buy";
    pick = cheapest.venue === "ondo" ? fair.venue : cheapest.venue;
    note = `${changed}, in line with Bitcoin. Buy ${VENUES[pick].label}, or buy nothing.`;
  }

  return { ranked, cheapest, fair, pick, carryBps, carryNotArb, note, decision };
}

export function widest(n = 5): Book[] {
  return [...allBooks()].sort((a, c) => Math.abs(gapOf(c) ?? -1) - Math.abs(gapOf(a) ?? -1)).slice(0, n);
}

export function spreadPath(b: Book): { label: string; bps: number }[] {
  if (b.tape && b.tape.length >= 2) return b.tape;
  const end = Math.round(gapOf(b) ?? 0);
  return [
    { label: "24h ago", bps: 0 },
    { label: "Now", bps: end },
  ];
}

export function mark(p: Position): number {
  const b = book(p.symbol);
  if (!b) return 0;
  return p.qty * b.venues[p.venue].price;
}

export function positionValue(positions: Position[], symbol?: string): number {
  return positions
    .filter((p) => (symbol ? p.symbol === symbol : true))
    .reduce((s, p) => s + mark(p), 0);
}

export function nav(cash: number, positions: Position[]): number {
  return cash + positionValue(positions);
}

export function checkGuard(input: {
  sizeUsd: number;
  cash: number;
  limits: Limits;
  call: Call;
  side: Side;
  heldUsd: number;
  walletReady: boolean;
}): Guard {
  const blockers: string[] = [];
  const notes: string[] = [];
  if (!input.walletReady) blockers.push("Connect a wallet on BNB Chain before sending.");
  if (!(input.sizeUsd > 0)) blockers.push("Size must be greater than zero.");
  if (input.sizeUsd - input.limits.maxSizeUsd > 0.001) {
    blockers.push(`Order is ${formatUsd(input.sizeUsd)}, over the ${formatUsd(input.limits.maxSizeUsd, 0)} cap.`);
  }
  if (input.side === "buy" && input.walletReady && input.sizeUsd - input.cash > 0.001) {
    blockers.push(`Wallet balance is ${formatUsd(input.cash)}. This buy needs ${formatUsd(input.sizeUsd)}.`);
  }
  if (input.side === "sell" && input.sizeUsd - input.heldUsd > 0.05) {
    blockers.push(`Held value is ${formatUsd(input.heldUsd)}. Cannot sell ${formatUsd(input.sizeUsd)}.`);
  }
  if (input.call.id === "thin") blockers.push("The book is too thin. The gap is the empty market, not a price. Gapline will not send this.");
  if (input.call.id === "news") notes.push("This 24 hour move looks like news. A small buy is allowed.");
  if (input.call.id === "noise") notes.push("The last 24 hours barely moved the price. You would pay a fee to do nothing.");
  notes.push("You sign this in your wallet. It is a real BNB Chain transaction.");
  return { ok: blockers.length === 0, blockers, notes };
}

export function quoteOrder(input: {
  symbol: string;
  side: Side;
  sizeUsd: number;
  venue?: VenueId;
  cash: number;
  positions: Position[];
  limits: Limits;
  walletReady: boolean;
}): SimOrder | null {
  const b = book(input.symbol);
  if (!b) return null;
  const advice = advise(b, input.sizeUsd);
  const venue = input.venue ?? (input.side === "sell" ? heldVenue(input.positions, input.symbol) ?? advice.pick : advice.pick);
  const ranked = rankVenues(b, input.sizeUsd, input.side).find((r) => r.venue === venue);
  if (!ranked || ranked.price <= 0) {
    return {
      key: [input.symbol, venue, input.side, "none"].join(":"),
      symbol: input.symbol,
      venue,
      token: b.venues[venue].token,
      side: input.side,
      sizeUsd: input.sizeUsd,
      qty: 0,
      effective: 0,
      impactBps: 0,
      feeBps: VENUES[venue].feeBps,
      guard: { ok: false, blockers: [`${VENUES[venue].label} has no live price. Nothing is sent.`], notes: [] },
    };
  }
  const heldUsd = input.positions
    .filter((p) => p.symbol === input.symbol && p.venue === venue)
    .reduce((s, p) => s + mark(p), 0);
  const guard = checkGuard({
    sizeUsd: input.sizeUsd,
    cash: input.cash,
    limits: input.limits,
    call: classify(b),
    side: input.side,
    heldUsd: input.side === "sell" ? heldUsd : input.cash,
    walletReady: input.walletReady,
  });
  if (b.spot && b.reference == null) {
    guard.blockers = guard.blockers.filter((line) => !line.includes("too thin"));
    guard.ok = guard.blockers.length === 0;
    guard.notes.unshift("The pool sets the number of shares from the latest price.");
  } else if (!b.live && ranked.liquidityUsd < 80_000 && !guard.blockers.some((line) => line.includes("too thin"))) {
    guard.blockers.push(`${VENUES[venue].label} is only ${formatUsd(ranked.liquidityUsd, 0)} deep. Gapline will not send this order.`);
    guard.ok = false;
  }
  const qty = ranked.effective > 0 ? (input.side === "buy" ? input.sizeUsd / ranked.effective : Math.min(heldUsd, input.sizeUsd) / ranked.effective) : 0;
  const key = [input.symbol, venue, input.side, input.sizeUsd.toFixed(2), ranked.effective.toFixed(4)].join(":");
  return {
    key,
    symbol: input.symbol,
    venue,
    token: ranked.token,
    side: input.side,
    sizeUsd: input.side === "sell" ? Math.min(input.sizeUsd, heldUsd) : input.sizeUsd,
    qty,
    effective: ranked.effective,
    impactBps: ranked.impactBps,
    feeBps: ranked.feeBps,
    guard,
  };
}

export function heldVenue(positions: Position[], symbol: string): VenueId | null {
  const lots = positions.filter((p) => p.symbol === symbol && p.qty > 0);
  if (!lots.length) return null;
  lots.sort((a, c) => mark(c) - mark(a));
  return lots[0].venue;
}

export function applyFill(positions: Position[], order: SimOrder): Position[] {
  if (order.side === "buy") {
    const i = positions.findIndex((p) => p.symbol === order.symbol && p.venue === order.venue);
    if (i === -1) {
      return [...positions, { symbol: order.symbol, venue: order.venue, token: order.token, qty: order.qty, costUsd: order.sizeUsd }];
    }
    const prev = positions[i];
    const next = [...positions];
    next[i] = { ...prev, qty: prev.qty + order.qty, costUsd: prev.costUsd + order.sizeUsd };
    return next;
  }
  return positions
    .map((p) => {
      if (p.symbol !== order.symbol || p.venue !== order.venue) return p;
      const sold = Math.min(p.qty, order.qty);
      const left = p.qty - sold;
      return { ...p, qty: left, costUsd: p.qty > 0 ? p.costUsd * (left / p.qty) : 0 };
    })
    .filter((p) => p.qty > 1e-8);
}

export function weightsFor(symbols: string[], positions: Position[]): { symbol: string; value: number; weight: number; target: number }[] {
  const rows = symbols.map((symbol) => ({ symbol, value: positionValue(positions, symbol) }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows.map((r) => ({
    ...r,
    weight: total > 0 ? r.value / total : 0,
    target: symbols.length ? 1 / symbols.length : 0,
  }));
}

export function basketWeights(id: BasketId, positions: Position[]) {
  return weightsFor(BASKETS[id].symbols, positions);
}

export function driftFor(symbols: string[], positions: Position[]): number {
  const rows = weightsFor(symbols, positions);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total < 1 || !rows.length) return 0;
  return Math.max(...rows.map((r) => Math.abs(r.weight - r.target))) * 100;
}

export function maxDrift(id: BasketId, positions: Position[]): number {
  return driftFor(BASKETS[id].symbols, positions);
}

export function rebalanceFor(symbols: string[], positions: Position[]): PlannedOrder[] {
  const rows = weightsFor(symbols, positions);
  const navValue = rows.reduce((s, r) => s + r.value, 0);
  if (navValue < 1) return [];
  return rows.flatMap((r) => {
    const delta = r.target * navValue - r.value;
    if (Math.abs(delta) < 1) return [];
    return [{ symbol: r.symbol, side: delta > 0 ? "buy" : "sell", sizeUsd: Math.round(Math.abs(delta) * 100) / 100 } as PlannedOrder];
  });
}

export function rebalancePlan(id: BasketId, positions: Position[]): PlannedOrder[] {
  return rebalanceFor(BASKETS[id].symbols, positions);
}

export function buyPlanFor(symbols: string[], budget: number): PlannedOrder[] {
  const tradable = symbols.filter((symbol) => {
    const item = book(symbol);
    if (!item) return false;
    if (item.spot) return true;
    const call = classify(item).id;
    return call !== "thin" && call !== "unscored";
  });
  if (!tradable.length) return [];
  const each = Math.round((budget / tradable.length) * 100) / 100;
  return tradable.map((symbol) => ({ symbol, side: "buy" as const, sizeUsd: each }));
}

export function basketBuyPlan(id: BasketId, budget: number): PlannedOrder[] {
  return buyPlanFor(BASKETS[id].symbols, budget);
}

const TICKER_RE = /\b(NVDA|AAPL|MSFT|AMZN|META|GOOGL|TSLA|AVGO|TSM|AMD|MU|CRCL|SPCX)\b/i;
const NAME_TICKERS: [RegExp, string][] = [
  [/nvidia/i, "NVDA"],
  [/apple/i, "AAPL"],
  [/microsoft/i, "MSFT"],
  [/amazon/i, "AMZN"],
  [/meta/i, "META"],
  [/alphabet|google/i, "GOOGL"],
  [/tesla/i, "TSLA"],
  [/broadcom/i, "AVGO"],
  [/tsmc/i, "TSM"],
  [/\bamd\b/i, "AMD"],
  [/micron/i, "MU"],
  [/circle/i, "CRCL"],
  [/spacex|space x/i, "SPCX"],
];

function namedTicker(text: string): string | undefined {
  return text.match(TICKER_RE)?.[1]?.toUpperCase() ?? NAME_TICKERS.find(([pattern]) => pattern.test(text))?.[1];
}

function fail(source: string, summary: string, notes: string[] = []): CompiledRule {
  return { ok: false, source, summary, notes };
}

export function compileRule(source: string, maxSizeUsd: number): CompiledRule {
  const text = source.trim();
  if (!text) return fail(source, "Write a rule in one sentence.");
  const notes: string[] = [];
  const flatten = text.match(/flatten\D{0,40}(\d+)\s*minute/i);
  const flattenAfterOpenMin = flatten ? Number(flatten[1]) : null;
  const money = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  const dollars = money ? Number(money[1]) : null;

  if (/earnings/i.test(text)) {
    return fail(source, "No earnings date is on this tape. Not scheduled. Buy nothing.");
  }

  if (/bitcoin|btc|crypto/i.test(text) && /half|ratio|mix|diverge|weight/i.test(text)) {
    return fail(source, "Bitcoin is not a spot leg in this book. A stock and crypto mix is not scheduled. Buy nothing.");
  }

  if (/bitcoin|btc/i.test(text) && /buy nothing|do not buy|don't buy|buy no/i.test(text)) {
    return {
      ok: true,
      kind: "stand-down",
      source,
      flattenAfterOpenMin,
      notes,
      summary: "Refused. If Bitcoin is up and the stock is not, that is not a discount. Buy nothing.",
    };
  }

  if (/monday/i.test(text) && /basket|ai|chip/i.test(text)) {
    let budget = dollars ?? 25;
    if (budget > maxSizeUsd) {
      notes.push(`The Monday buy is clamped to the ${formatUsd(maxSizeUsd, 0)} cap.`);
      budget = maxSizeUsd;
    }
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const maxDriftPct = pct ? Number(pct[1]) : 5;
    const basket: BasketId = /mag/i.test(text) ? "mag7" : /buffett/i.test(text) ? "buffett" : "ai";
    return {
      ok: true,
      kind: "monday-basket",
      source,
      basket,
      budget,
      maxDriftPct,
      flattenAfterOpenMin,
      notes,
      summary: `Scheduled. Put ${formatUsd(budget, 0)} into ${BASKETS[basket].name} every Monday, and fix it if a name drifts past ${maxDriftPct}%. Nothing is sent before Monday.`,
    };
  }

  if (/widest/i.test(text) && /gap/i.test(text)) {
    let sizeUsd = dollars ?? 10;
    if (sizeUsd > maxSizeUsd) {
      notes.push(`Size ${formatUsd(sizeUsd, 0)} is clamped to the ${formatUsd(maxSizeUsd, 0)} cap.`);
      sizeUsd = maxSizeUsd;
    }
    return {
      ok: true,
      kind: "widest",
      source,
      sizeUsd,
      flattenAfterOpenMin,
      notes,
      summary: `Scheduled. Buy ${formatUsd(sizeUsd, 0)} of the widest liquid gap, and only while the cash market is closed.`,
    };
  }

  if (/rebalance/i.test(text)) {
    let basket: BasketId | null = null;
    if (/mag/i.test(text)) basket = "mag7";
    else if (/buffett/i.test(text)) basket = "buffett";
    else if (/ai|chip|semi/i.test(text)) basket = "ai";
    if (!basket) return fail(source, "Name the basket: AI chips, Mag 7, or Buffett.", notes);
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const maxDriftPct = pct ? Number(pct[1]) : 5;
    return {
      ok: true,
      kind: "drift",
      source,
      basket,
      maxDriftPct,
      flattenAfterOpenMin,
      notes,
      summary: `Rebalance ${BASKETS[basket].name} when a weight drifts more than ${maxDriftPct}%.`,
    };
  }

  if (/btc/i.test(text) && /drop|down|fall|sells off/i.test(text)) {
    const dropMatch = text.match(/btc\D{0,40}(\d+(?:\.\d+)?)\s*%/i);
    const dropPct = dropMatch ? Number(dropMatch[1]) : 5;
    const rot = text.match(/rotate\D{0,20}(\d+(?:\.\d+)?)\s*%/i);
    const rotatePct = rot ? Number(rot[1]) : 30;
    return {
      ok: true,
      kind: "btc-drop",
      source,
      dropPct,
      rotatePct,
      flattenAfterOpenMin,
      notes,
      summary: `If BTC is down ${dropPct}% over the last day, rotate ${rotatePct}% of the book into defensives.`,
    };
  }

  const ticker = namedTicker(text);
  if (/take profit|stop loss|stop-loss|take-profit|what i paid/i.test(text)) {
    if (!ticker) return fail(source, "Name the stock for the limit. Nothing was scheduled.");
    const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const pct = pctMatch ? Number(pctMatch[1]) : 5;
    const mode = /stop|falls|below/i.test(text) && !/above|take profit/i.test(text) ? "stop-loss" : "take-profit";
    const named = book(ticker);
    return {
      ok: true,
      kind: "exit",
      source,
      symbol: ticker,
      mode,
      pct,
      flattenAfterOpenMin,
      notes: pctMatch ? notes : [`No percent was written, so this uses ${pct}%.`],
      summary:
        mode === "take-profit"
          ? `Take profit. Sell ${named?.name ?? ticker} if it is ${pct}% above what you paid. You still sign the sell.`
          : `Stop loss. Sell ${named?.name ?? ticker} if it falls ${pct}% from what you paid. You still sign the sell.`,
    };
  }
  if (ticker && /buy|sell|gap|under|premium|reference|discount|free/i.test(text)) {
    const named = book(ticker);
    const call = named ? classify(named) : null;
    const livePrice = named ? named.venues.xstocks.price || named.venues.bstocks.price : 0;
    if (!named || !(livePrice > 0)) {
      return fail(source, `${named?.name ?? ticker} has no live price yet. Buy nothing.`);
    }
    if (call?.id === "thin") {
      return fail(
        source,
        `${named.name} looks cheap because almost nobody is quoting it. The gap is the empty market, not a discount. Refused. Nothing is sent.`,
        ["Buy it anyway still sends nothing."],
      );
    }
    const moneySize = text.match(/\$\s*(\d+(?:\.\d+)?)/);
    let sizeUsd = moneySize ? Number(moneySize[1]) : 10;
    if (sizeUsd > maxSizeUsd) {
      notes.push(`Size ${formatUsd(sizeUsd, 0)} is clamped to the ${formatUsd(maxSizeUsd, 0)} cap.`);
      sizeUsd = maxSizeUsd;
    }
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const minAbsSpreadBps = pct ? Math.round(Number(pct[1]) * 100) : 80;
    const requireClosed = /closed|weekend|after the bell|after hours/i.test(text);
    const side = /premium|above|rich/i.test(text) && !/under|discount|below|cheap/i.test(text) ? "sell-premium" : "buy-discount";
    return {
      ok: true,
      kind: "gap",
      source,
      symbol: ticker,
      minAbsSpreadBps,
      requireClosed,
      side,
      sizeUsd,
      flattenAfterOpenMin,
      notes,
      summary:
        side === "buy-discount"
          ? `Buy ${formatUsd(sizeUsd)} of ${ticker} when it trades ${formatBps(-minAbsSpreadBps)} or cheaper than the latest price${requireClosed ? ", and only while the cash market is closed" : ""}.`
          : `Sell ${formatUsd(sizeUsd)} of ${ticker} when it trades ${formatBps(minAbsSpreadBps)} or richer than the latest price${requireClosed ? ", and only while the cash market is closed" : ""}.`,
    };
  }

  return fail(
    source,
    "That sentence is not scheduled. Say which name, or use the widest liquid gap, a Monday basket, or buy nothing.",
    ["Free-form code is rejected."],
  );
}

export function dryRun(rule: CompiledRule, positions: Position[], cash: number, btcMoveBps: number): DryRun {
  if (!rule.ok) return { fired: false, reason: rule.summary, orders: [] };
  if (rule.kind === "gap") {
    const b = book(rule.symbol);
    if (!b || !(b.venues.xstocks.price > 0 || b.venues.bstocks.price > 0)) return { fired: false, reason: `${rule.symbol} has no live price.`, orders: [] };
    if (rule.requireClosed && MARKET.status !== "closed") return { fired: false, reason: "Cash market is open.", orders: [] };
    const call = classify(b, btcMoveBps);
    if (call.id === "thin") return { fired: false, reason: `${rule.symbol} is too thin. The rule refuses the book.`, orders: [] };
    const gap = gapOf(b) ?? 0;
    if (rule.side === "buy-discount" && gap > -rule.minAbsSpreadBps) {
      return {
        fired: false,
        reason: `${rule.symbol} is ${formatBps(gap)} over the last 24 hours, not ${formatBps(-rule.minAbsSpreadBps)} or cheaper.`,
        orders: [],
      };
    }
    if (rule.side === "sell-premium" && gap < rule.minAbsSpreadBps) {
      return {
        fired: false,
        reason: `${rule.symbol} is ${formatBps(gap)} over the last 24 hours, not ${formatBps(rule.minAbsSpreadBps)} or richer.`,
        orders: [],
      };
    }
    const side: Side = rule.side === "buy-discount" ? "buy" : "sell";
    if (side === "sell" && positionValue(positions, rule.symbol) < 1) {
      return { fired: false, reason: `Rule would sell ${rule.symbol}, but the paper book does not hold it.`, orders: [] };
    }
    return {
      fired: true,
      reason: `${rule.symbol} is ${formatBps(gap)} over the last 24 hours. ${call.detail}`,
      orders: [{ symbol: rule.symbol, side, sizeUsd: Math.min(rule.sizeUsd, side === "buy" ? cash : positionValue(positions, rule.symbol)) }],
    };
  }
  if (rule.kind === "btc-drop") {
    if (btcMoveBps > -rule.dropPct * 100) {
      return {
        fired: false,
        reason: `BTC is ${formatBps(btcMoveBps)} over the last day, not down ${rule.dropPct}%.`,
        orders: [],
      };
    }
    const bookNav = nav(cash, positions);
    const budget = Math.min(cash, (bookNav * rule.rotatePct) / 100);
    const names = DEFENSIVES.filter((symbol) => classify(book(symbol)!).id !== "thin");
    if (!names.length || budget < 1) return { fired: false, reason: "Nothing liquid to rotate into, or no paper cash.", orders: [] };
    const each = Math.round((budget / names.length) * 100) / 100;
    return {
      fired: true,
      reason: `BTC is ${formatBps(btcMoveBps)}. Rotating ${formatUsd(budget)} into ${names.join(", ")}.`,
      orders: names.map((symbol) => ({ symbol, side: "buy" as const, sizeUsd: each })),
    };
  }
  if (rule.kind === "widest") {
    if (MARKET.status !== "closed") return { fired: false, reason: "The cash market is open. This waits until the close. Nothing is sent.", orders: [] };
    const liquid = allBooks()
      .filter((item) => item.reference != null && classify(item).id !== "thin" && classify(item).id !== "unscored")
      .sort((a, c) => Math.abs(gapOf(c) ?? 0) - Math.abs(gapOf(a) ?? 0));
    const pick = liquid.find((item) => {
      const decision = advise(item, rule.sizeUsd).decision;
      return decision === "buy" || decision === "news";
    });
    if (!pick) {
      const quiet = liquid[0];
      return {
        fired: false,
        reason: quiet
          ? `${quiet.name} is the widest liquid name, and it is only ${formatMove(gapOf(quiet))} over the last 24 hours. Fees cost more than that. Nothing is sent.`
          : "Nothing liquid is available. Nothing is sent.",
        orders: [],
      };
    }
    const call = classify(pick);
    return {
      fired: true,
      reason: `${pick.name} moved the most of the liquid names, ${formatMove(gapOf(pick))} over the last 24 hours. ${call.detail}`,
      orders: [{ symbol: pick.symbol, side: "buy", sizeUsd: Math.min(rule.sizeUsd, cash) }],
    };
  }
  if (rule.kind === "exit") {
    const named = book(rule.symbol);
    if (!named) return { fired: false, reason: `${rule.symbol} is not on this desk.`, orders: [] };
    if (classify(named).id === "thin") {
      return { fired: false, reason: `${named.name} is too thin. The limit stays, and nothing is sent.`, orders: [] };
    }
    const held = positions.filter((position) => position.symbol === rule.symbol && position.qty > 0);
    const qty = held.reduce((sum, position) => sum + position.qty, 0);
    const cost = held.reduce((sum, position) => sum + position.costUsd, 0);
    if (qty <= 0 || cost <= 0) {
      return { fired: false, reason: `You do not hold ${named.name}. The limit waits. Nothing is sent.`, orders: [] };
    }
    const entry = cost / qty;
    const price = named.venues.xstocks.price;
    const move = ((price - entry) / entry) * 100;
    if (rule.mode === "take-profit" && move < rule.pct) {
      return {
        fired: false,
        reason: `${named.name} is ${move.toFixed(1)}% from what you paid, not ${rule.pct}% above. Nothing is sent.`,
        orders: [],
      };
    }
    if (rule.mode === "stop-loss" && move > -rule.pct) {
      return {
        fired: false,
        reason: `${named.name} is ${move.toFixed(1)}% from what you paid, not ${rule.pct}% below. Nothing is sent.`,
        orders: [],
      };
    }
    return {
      fired: true,
      reason: `${named.name} is ${move.toFixed(1)}% from what you paid. The ${rule.mode === "take-profit" ? "take profit" : "stop loss"} asks you to sign the sell.`,
      orders: [{ symbol: rule.symbol, side: "sell", sizeUsd: qty * price, venue: "xstocks" }],
    };
  }
  if (rule.kind === "monday-basket") {
    return {
      fired: false,
      reason: `Scheduled for Monday. Today is still the weekend, so the ${formatUsd(rule.budget, 0)} ${BASKETS[rule.basket].name} buy is not sent. A drift past ${rule.maxDriftPct}% is fixed on that same run.`,
      orders: [],
    };
  }
  if (rule.kind === "stand-down") {
    if (btcMoveBps <= 0) return { fired: false, reason: "Bitcoin is not up. This refusal is idle. Nothing is sent.", orders: [] };
    const laggards = allBooks().filter((item) => {
      const gap = gapOf(item);
      return gap != null && gap <= 0 && classify(item).id !== "thin" && classify(item).id !== "unscored";
    });
    const names = laggards.map((item) => item.symbol).join(", ");
    return {
      fired: false,
      reason: `Bitcoin is up ${formatBps(btcMoveBps)}. ${names || "No liquid name"} did not follow. Buy nothing.`,
      orders: [],
    };
  }
  const drift = maxDrift(rule.basket, positions);
  const plan = rebalancePlan(rule.basket, positions);
  if (!plan.length) return { fired: false, reason: `${BASKETS[rule.basket].name} has no position to rebalance.`, orders: [] };
  if (drift < rule.maxDriftPct) {
    return { fired: false, reason: `Max drift is ${drift.toFixed(1)}%, inside the ${rule.maxDriftPct}% band.`, orders: [] };
  }
  return { fired: true, reason: `Max drift is ${drift.toFixed(1)}%.`, orders: plan };
}

export function explainCopy(b: Book, now = new Date()): string {
  const call = classify(b);
  const advice = advise(b, 10);
  const gap = gapOf(b);
  const clock = marketClock(now);
  const session = clock.open
    ? `The cash market is open and closes in ${formatRemain(clock.at - now.getTime())}.`
    : `The cash market is closed and opens in ${formatRemain(clock.at - now.getTime())}.`;
  const prints = `Right now xStocks is ${formatUsd(b.venues.xstocks.price)}, bStocks is ${formatUsd(b.venues.bstocks.price)}, and Ondo is ${formatUsd(b.venues.ondo.price)}.`;
  const price = b.venues.xstocks.price || b.venues.bstocks.price;
  const gapLine =
    gap == null
      ? `${b.symbol} is on the latest print${price > 0 ? ` at ${formatUsd(price)}` : ""}. The 24 hour change is still loading.`
      : `${b.symbol} is ${formatBps(gap)} over the last 24 hours. The latest print is ${formatUsd(price)}.`;
  const carry =
    advice.carryBps == null
      ? ""
      : ` Ondo is ${formatBps(advice.carryBps)} versus bStocks. ${advice.carryNotArb ? "That premium is total-return carry, not a second price for the same share." : "The premium is wide enough to look past carry."}`;
  return `${gapLine} ${prints} Call: ${call.label}. ${call.detail}${carry} Bitcoin is ${formatBps(btcMove())} since the prior close. ${session}`;
}

export function planQuotes(input: {
  orders: PlannedOrder[];
  cash: number;
  positions: Position[];
  limits: Limits;
  walletReady: boolean;
}): { orders: SimOrder[]; cashAfter: number; positionsAfter: Position[] } {
  let cash = input.cash;
  let positions = input.positions;
  const orders: SimOrder[] = [];
  for (const order of input.orders) {
    const sim = quoteOrder({
      symbol: order.symbol,
      side: order.side,
      sizeUsd: order.sizeUsd,
      venue: order.venue,
      cash,
      positions,
      limits: input.limits,
      walletReady: input.walletReady,
    });
    if (!sim) continue;
    orders.push(sim);
    if (sim.guard.ok) {
      if (sim.side === "buy") cash -= sim.sizeUsd;
      else cash += sim.sizeUsd;
      positions = applyFill(positions, sim);
    }
  }
  return { orders, cashAfter: cash, positionsAfter: positions };
}
