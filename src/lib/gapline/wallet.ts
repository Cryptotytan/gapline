import { smartActive, smartAddress, smartProvider, disconnectSmart, transferFromSmart } from "./smart-wallet";

const BSC = "0x38";
const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const ABSOLUTE_CAP = 500;
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const USDT = "0x55d398326f99059fF775485246999027B3197955";

const EXTRA: Record<string, string> = {};

const XSTOCK: Record<string, string> = {
  AAPL: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
  NVDA: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
  MSFT: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35",
  AMZN: "0x3557ba345b01efa20a1bddc61f573bfd87195081",
  META: "0x96702be57cd9777f835117a809c7124fe4ec989a",
  GOOGL: "0xe92f673ca36c5e2efd2de7628f815f84807e803f",
  TSLA: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0",
  AVGO: "0x38bac69cbbd28156796e4163b2b6dcb81e336565",
  TSM: "0x9e3bf4ecfc44eedd624f26656b6736a3f093b073",
  AMD: "0x3522513e5f146a2006e2901b05f16b2821485e19",
  MU: "0xf6a873bae4ba1b304e45df52a4b7d176e1c6a8c4",
  CRCL: "0xfebded1b0986a8ee107f5ab1a1c5a813491deceb",
  SPCX: "0x68fa48b1c2fe52b3d776e1953e0e782b5044ce28",
};

export function rememberStocks(rows: { symbol: string; address: string }[]) {
  for (const row of rows) EXTRA[row.symbol.toUpperCase()] = row.address;
}

export function stockToken(symbol: string) {
  return EXTRA[symbol.toUpperCase()] ?? XSTOCK[symbol.toUpperCase()];
}

export function contractFor(symbol: string) {
  if (symbol === "USDT") return USDT;
  if (symbol === "USDC") return USDC;
  if (symbol === "BNB") return null;
  return stockToken(symbol) ?? null;
}

type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

let pinned: Provider | null = null;
const discovered: Provider[] = [];

export function pinProvider(next: Provider | null) {
  pinned = next;
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const next = (event as CustomEvent).detail?.provider as Provider | undefined;
    if (next && !discovered.includes(next)) discovered.push(next);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

async function signer(from: string): Promise<Provider> {
  const own = smartAddress();
  if (own && from.toLowerCase() === own.toLowerCase()) {
    const smart = smartProvider();
    if (smart) return smart;
  }
  const eth = (window as unknown as { ethereum?: Provider }).ethereum;
  const list = [pinned, eth, ...discovered].filter((item): item is Provider => Boolean(item));
  for (const item of list) {
    try {
      const accounts = (await item.request({ method: "eth_accounts" })) as string[];
      if (accounts.some((account) => account.toLowerCase() === from.toLowerCase())) {
        pinned = item;
        return item;
      }
    } catch {
      /* Ask the next wallet. */
    }
  }
  const fallback = pinned ?? eth ?? discovered[0];
  if (!fallback) throw new Error("No wallet in this browser. Install MetaMask or Binance Wallet, then try again.");
  const accounts = (await fallback.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("The wallet did not share an address.");
  pinned = fallback;
  return fallback;
}

function provider(): Provider {
  const eth = (window as unknown as { ethereum?: Provider }).ethereum;
  if (pinned) return pinned;
  if (eth) return eth;
  const smart = smartProvider();
  if (smart) return smart;
  throw new Error("No wallet in this browser. Install MetaMask or Binance Wallet, then try again.");
}

function pad(hex: string) {
  return hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeBalance(address: string) {
  return `0x70a08231${pad(address)}`;
}

function encodeAllowance(owner: string, spender: string) {
  return `0xdd62ed3e${pad(owner)}${pad(spender)}`;
}

function encodeApprove(spender: string, amount: bigint) {
  return `0x095ea7b3${pad(spender)}${amount.toString(16).padStart(64, "0")}`;
}

async function call(to: string, data: string) {
  const raw = (await provider().request({ method: "eth_call", params: [{ to, data }, "latest"] })) as string;
  return BigInt(raw);
}

function fromUnit(amount: bigint) {
  return Number(amount) / 1e18;
}

function toUnit(usd: number) {
  const cents = Math.round(usd * 100);
  return BigInt(cents) * 10n ** 16n;
}

async function tokenBalance(token: string, address: string) {
  try {
    return BigInt(await rpcCall(token, encodeBalance(address)));
  } catch {
    return 0n;
  }
}

export async function readCash(address: string) {
  const [usdc, usdt] = await Promise.all([tokenBalance(USDC, address), tokenBalance(USDT, address)]);
  return fromUnit(usdc + usdt);
}

function explain(error: unknown, fallback: string) {
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code: number }).code) : 0;
  if (code === 4001) return "You closed the wallet. Nothing was sent.";
  if (code === 4902) return "This wallet does not have BNB Chain yet. Nothing was sent.";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
  if (/insufficient funds/i.test(message)) return "This wallet needs a little BNB for the network fee. Nothing was sent.";
  if (/user rejected|user denied/i.test(message)) return "You closed the wallet. Nothing was sent.";
  if (/chain/i.test(message) && /mismatch|wrong|switch/i.test(message)) return "Switch the wallet to BNB Chain. Nothing was sent.";
  if (message && !/rpc|json-rpc|unknown reason/i.test(message)) return message;
  return fallback;
}

async function ensureBsc(from: string) {
  const eth = await signer(from);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code: number }).code) : 0;
    if (code !== 4902) throw new Error(explain(error, "The wallet did not switch to BNB Chain. Nothing was sent."));
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BSC,
            chainName: "BNB Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: ["https://bsc-dataseed.binance.org"],
            blockExplorerUrls: ["https://bscscan.com"],
          },
        ],
      });
    } catch (addError) {
      throw new Error(explain(addError, "BNB Chain could not be added to the wallet. Nothing was sent."));
    }
  }
}

export async function silentAccount() {
  const eth = (window as unknown as { ethereum?: Provider }).ethereum;
  if (!eth) return null;
  const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
  return accounts[0] ?? null;
}

export function watchAccounts(onChange: (address: string | null) => void) {
  let stopped = false;
  const apply = (address: string | null) => {
    if (stopped || smartAddress()) return;
    onChange(address);
  };
  const read = () => {
    silentAccount()
      .then((address) => apply(address))
      .catch(() => apply(null));
  };
  const onAccounts = (accounts: unknown) => {
    const list = Array.isArray(accounts) ? accounts : [];
    const first = typeof list[0] === "string" ? list[0] : null;
    apply(first);
  };
  const bind = () => {
    const eth = (window as unknown as { ethereum?: Provider & { on?: (event: string, cb: (accounts: unknown) => void) => void; removeListener?: (event: string, cb: (accounts: unknown) => void) => void } }).ethereum;
    if (!eth) return null;
    read();
    eth.on?.("accountsChanged", onAccounts);
    return eth;
  };
  let eth = bind();
  const timer = window.setInterval(() => {
    if (eth) return;
    eth = bind();
  }, 500);
  const onFocus = () => read();
  window.addEventListener("focus", onFocus);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    eth?.removeListener?.("accountsChanged", onAccounts);
  };
}

export async function connectWallet() {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet did not share an address.");
  try {
    await ensureBsc(address);
  } catch {
    /* Still connected. The chain can be switched on the next buy. */
  }
  const cash = await readCash(address).catch(() => 0);
  return { address, cash };
}

async function quote(tokenIn: string, tokenOut: string, amountIn: bigint) {
  const url = new URL("https://aggregator-api.kyberswap.com/bsc/api/v1/routes");
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("amountIn", amountIn.toString());
  const res = await fetch(url, { headers: { "x-client-id": "gapline" } });
  if (!res.ok) throw new Error("No pool could quote this order. Nothing was sent.");
  const body = (await res.json()) as {
    data?: { routeSummary?: { amountOut?: string; amountOutUsd?: string; amountInUsd?: string } };
  };
  const route = body.data?.routeSummary;
  if (!route?.amountOut) throw new Error("No pool could quote this order. Nothing was sent.");
  return route;
}

type Offer = {
  name: string;
  amountOut: bigint;
  vendorUsd: number;
  tokenIn: string;
  build: (sender: string) => Promise<{ to: string; data: string; amountOut: bigint }>;
};

function asRouter(to: string) {
  const address = to.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address) || address === "0x0000000000000000000000000000000000000000") {
    throw new Error("The route did not name a router. Nothing was sent.");
  }
  return to;
}

async function kyberOffer(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Offer | null> {
  const route = await quote(tokenIn, tokenOut, amountIn);
  const amountOut = BigInt(route.amountOut ?? "0");
  if (amountOut <= 0n) return null;
  return {
    name: "Kyber",
    amountOut,
    vendorUsd: Number(route.amountOutUsd ?? 0),
    tokenIn,
    build: async (sender) => {
      const tx = await build(route, sender);
      return { to: asRouter(tx.to), data: tx.data, amountOut: tx.amountOut };
    },
  };
}

async function sushiOffer(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Offer | null> {
  const url = new URL("https://api.sushi.com/swap/v7/56");
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("amount", amountIn.toString());
  url.searchParams.set("maxSlippage", "0.01");
  url.searchParams.set("sender", "0x1111111111111111111111111111111111111111");
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { assumedAmountOut?: string; tx?: { to?: string; data?: string } };
  const amountOut = BigInt(body.assumedAmountOut ?? "0");
  const to = body.tx?.to;
  const data = body.tx?.data;
  if (amountOut <= 0n || !to || !data) return null;
  return {
    name: "Sushi",
    amountOut,
    vendorUsd: 0,
    tokenIn,
    build: async (sender) => {
      const built = new URL("https://api.sushi.com/swap/v7/56");
      built.searchParams.set("tokenIn", tokenIn);
      built.searchParams.set("tokenOut", tokenOut);
      built.searchParams.set("amount", amountIn.toString());
      built.searchParams.set("maxSlippage", "0.01");
      built.searchParams.set("sender", sender);
      built.searchParams.set("recipient", sender);
      const next = await fetch(built, { headers: { accept: "application/json" } });
      if (!next.ok) throw new Error("Sushi could not build this swap. Nothing was sent.");
      const page = (await next.json()) as { tx?: { to?: string; data?: string }; assumedAmountOut?: string };
      if (!page.tx?.to || !page.tx.data) throw new Error("Sushi could not build this swap. Nothing was sent.");
      return { to: asRouter(page.tx.to), data: page.tx.data, amountOut: BigInt(page.assumedAmountOut ?? amountOut.toString()) };
    },
  };
}

async function lifiOffer(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Offer | null> {
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", "56");
  url.searchParams.set("toChain", "56");
  url.searchParams.set("fromToken", tokenIn);
  url.searchParams.set("toToken", tokenOut);
  url.searchParams.set("fromAmount", amountIn.toString());
  url.searchParams.set("fromAddress", "0x1111111111111111111111111111111111111111");
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    toolDetails?: { name?: string };
    estimate?: { toAmount?: string; toAmountUSD?: string };
    transactionRequest?: { to?: string; data?: string };
  };
  const amountOut = BigInt(body.estimate?.toAmount ?? "0");
  if (amountOut <= 0n || !body.transactionRequest?.to || !body.transactionRequest.data) return null;
  const tx = body.transactionRequest;
  return {
    name: body.toolDetails?.name ?? "LI.FI",
    amountOut,
    vendorUsd: Number(body.estimate?.toAmountUSD ?? 0),
    tokenIn,
    build: async (sender) => {
      const again = new URL(url);
      again.searchParams.set("fromAddress", sender);
      const next = await fetch(again, { headers: { accept: "application/json" } });
      if (!next.ok) throw new Error("LI.FI could not build this swap. Nothing was sent.");
      const page = (await next.json()) as { transactionRequest?: { to?: string; data?: string }; estimate?: { toAmount?: string } };
      if (!page.transactionRequest?.to || !page.transactionRequest.data) throw new Error("LI.FI could not build this swap. Nothing was sent.");
      return {
        to: asRouter(page.transactionRequest.to),
        data: page.transactionRequest.data,
        amountOut: BigInt(page.estimate?.toAmount ?? amountOut.toString()),
      };
    },
  };
}

async function paraOffer(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Offer | null> {
  const url = new URL("https://api.paraswap.io/prices");
  url.searchParams.set("srcToken", tokenIn);
  url.searchParams.set("destToken", tokenOut);
  url.searchParams.set("amount", amountIn.toString());
  url.searchParams.set("srcDecimals", "18");
  url.searchParams.set("destDecimals", "18");
  url.searchParams.set("side", "SELL");
  url.searchParams.set("network", "56");
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as { priceRoute?: { destAmount?: string; destUSD?: string } } | null;
  const route = body?.priceRoute;
  const amountOut = BigInt(route?.destAmount ?? "0");
  if (amountOut <= 0n || !route) return null;
  return {
    name: "ParaSwap",
    amountOut,
    vendorUsd: Number(route.destUSD ?? 0),
    tokenIn,
    build: async (sender) => {
      const next = await fetch("https://api.paraswap.io/transactions/56?ignoreChecks=true", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          srcToken: tokenIn,
          destToken: tokenOut,
          srcAmount: amountIn.toString(),
          priceRoute: route,
          userAddress: sender,
          slippage: 100,
        }),
      });
      if (!next.ok) throw new Error("ParaSwap could not build this swap. Nothing was sent.");
      const tx = (await next.json()) as { to?: string; data?: string };
      if (!tx.to || !tx.data) throw new Error("ParaSwap could not build this swap. Nothing was sent.");
      return { to: asRouter(tx.to), data: tx.data, amountOut };
    },
  };
}

async function offersFor(tokenIn: string, tokenOut: string, amountIn: bigint) {
  const found = await Promise.all([
    kyberOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    sushiOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    lifiOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    paraOffer(tokenIn, tokenOut, amountIn).catch(() => null),
  ]);
  return found.filter((offer): offer is Offer => offer != null);
}

function offerWorth(offer: Offer, mark: number, spent: number) {
  const qty = fromUnit(offer.amountOut);
  const marked = mark > 0 ? qty * mark : 0;
  const quoted = offer.vendorUsd > 0 ? offer.vendorUsd : 0;
  const fair = [marked, quoted].filter((value) => value > 0 && value <= spent * 1.2);
  const value = fair.length ? Math.max(...fair) : Math.max(marked, quoted);
  const impact = spent > 0 && value > 0 ? Math.max(0, (spent - value) / spent) : 1;
  return { value, impact };
}

async function bestOffer(tokenOut: string, amountIn: bigint, spentUsd: number, mark = 0, tokenIn?: string) {
  const tokens = tokenIn ? [tokenIn] : [USDT, USDC];
  const lists = await Promise.all(tokens.map((token) => offersFor(token, tokenOut, amountIn)));
  const offers = lists.flat();
  offers.sort((left, right) => offerWorth(right, mark, spentUsd).value - offerWorth(left, mark, spentUsd).value);
  return offers[0] ?? null;
}

export async function quoteFill(input: { symbol: string; sizeUsd: number; token?: string; mark?: number }) {
  const tokenOut = input.token ?? stockToken(input.symbol);
  if (!tokenOut || !(input.sizeUsd > 0)) return null;
  const mark = input.mark ?? 0;
  const offer = await bestOffer(tokenOut, toUnit(input.sizeUsd), input.sizeUsd, mark);
  if (!offer) return null;
  const qty = fromUnit(offer.amountOut);
  if (!(qty > 0)) return null;
  const worth = offerWorth(offer, mark, input.sizeUsd);
  return { paid: input.sizeUsd / qty, qty, receivedUsd: worth.value, spentUsd: input.sizeUsd, venue: offer.name, impact: worth.impact };
}

export function thinPoolReason(symbol: string, sizeUsd: number, receivedUsd: number, venue?: string) {
  const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const where = venue ? ` ${venue} was the least expensive of the routes.` : "";
  return `A ${money(sizeUsd)} buy of ${symbol} would only come back as about ${money(receivedUsd)}.${where} Every route was priced. None of them returns the worth of this amount, so nothing was sent.`;
}

async function build(routeSummary: unknown, sender: string) {
  const res = await fetch("https://aggregator-api.kyberswap.com/bsc/api/v1/route/build", {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-id": "gapline" },
    body: JSON.stringify({ routeSummary, sender, recipient: sender, slippageTolerance: 100 }),
  });
  if (!res.ok) throw new Error("The swap could not be built. Nothing was sent.");
  const body = (await res.json()) as {
    data?: { data?: string; routerAddress?: string; amountOut?: string };
  };
  const tx = body.data;
  if (!tx?.data || !tx.routerAddress || !tx.amountOut) throw new Error("The swap could not be built. Nothing was sent.");
  if (tx.routerAddress.toLowerCase() !== KYBER_ROUTER) throw new Error("The swap was not built by the known Kyber router. Nothing was sent.");
  return { data: tx.data, to: KYBER_ROUTER, amountOut: BigInt(tx.amountOut) };
}

async function send(from: string, to: string, data: string) {
  const eth = await signer(from);
  try {
    return (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data, value: "0x0" }],
    })) as string;
  } catch (error) {
    throw new Error(explain(error, "The wallet did not send. Nothing was confirmed."));
  }
}

async function wait(hash: string) {
  for (let i = 0; i < 30; i += 1) {
    let receipt: { status?: string } | null = null;
    for (const rpc of RPCS) {
      try {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const body = (await res.json()) as { result?: { status?: string } | null };
        if (body.result) {
          receipt = body.result;
          break;
        }
      } catch {
        /* Try the next public node. */
      }
    }
    if (receipt?.status) {
      if (receipt.status === "0x0") throw new Error("The transaction failed on BNB Chain. Nothing was added.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("The transaction is still pending. Check the wallet before trying again.");
}

async function ensureAllowance(token: string, owner: string, spender: string, amount: bigint) {
  const allowed = await call(token, encodeAllowance(owner, spender));
  if (allowed >= amount) return;
  const hash = await send(owner, token, encodeApprove(spender, amount));
  await wait(hash);
}

async function spendable(address: string, sizeUsd: number) {
  const need = toUnit(sizeUsd);
  const usdc = await tokenBalance(USDC, address);
  if (usdc >= need) return { token: USDC, amount: need };
  const usdt = await tokenBalance(USDT, address);
  if (usdt >= need) return { token: USDT, amount: need };
  throw new Error("Not enough USDC or USDT in this wallet. Nothing was sent.");
}

export async function buyStock(input: { address: string; symbol: string; sizeUsd: number; token?: string; mark?: number; maxUsd?: number }) {
  if (!(input.sizeUsd > 0)) throw new Error("Type an amount first. Nothing was sent.");
  const tokenOut = input.token ?? stockToken(input.symbol);
  if (!tokenOut) throw new Error("This name has no xStock on BNB Chain. Nothing was sent.");
  const cap = Math.min(ABSOLUTE_CAP, input.maxUsd && input.maxUsd > 0 ? input.maxUsd : ABSOLUTE_CAP);
  if (input.sizeUsd - cap > 0.001) throw new Error(`This buy is over the $${cap.toFixed(0)} cap. Nothing was sent.`);
  await ensureBsc(input.address);
  const spend = await spendable(input.address, input.sizeUsd);
  const mark = input.mark ?? 0;
  const offer = await bestOffer(tokenOut, spend.amount, input.sizeUsd, mark, spend.token);
  if (!offer) throw new Error("No pool could quote this order. Nothing was sent.");
  const worth = offerWorth(offer, mark, input.sizeUsd);
  if (input.sizeUsd > 0 && worth.value > 0 && worth.impact > 0.15) {
    throw new Error(thinPoolReason(input.symbol, input.sizeUsd, worth.value, offer.name));
  }
  const tx = await offer.build(input.address);
  if (tx.amountOut <= 0n) throw new Error("The pool returned no shares. Nothing was sent.");
  await ensureAllowance(spend.token, input.address, tx.to, spend.amount);
  const hash = await send(input.address, tx.to, tx.data);
  await wait(hash);
  return { hash, qty: fromUnit(tx.amountOut) };
}

export async function sellStock(input: { address: string; symbol: string; qty: number }) {
  if (!(input.qty > 0)) throw new Error("Type the amount you want to sell. Nothing was sent.");
  const tokenIn = stockToken(input.symbol);
  if (!tokenIn) throw new Error("This name has no xStock on BNB Chain. Nothing was sent.");
  await ensureBsc(input.address);
  const micros = Math.round(input.qty * 1e6);
  const amount = BigInt(micros) * 10n ** 12n;
  const route = await quote(tokenIn, USDC, amount);
  const tx = await build(route, input.address);
  await ensureAllowance(tokenIn, input.address, tx.to, amount);
  const hash = await send(input.address, tx.to, tx.data);
  await wait(hash);
  return { hash };
}

const WATCH: { symbol: string; name: string; address: string; logo: string; usd?: "stable" }[] = [
  { symbol: "USDT", name: "USDT", address: USDT, logo: "/marks/USDT.png", usd: "stable" },
  { symbol: "USDC", name: "USDC", address: USDC, logo: "/marks/USDC.png", usd: "stable" },
];

const STOCKS: { symbol: string; name: string; address: string; logo: string }[] = [
  { symbol: "AAPL", name: "Apple", address: XSTOCK.AAPL, logo: "/marks/AAPL.svg" },
  { symbol: "NVDA", name: "NVIDIA", address: XSTOCK.NVDA, logo: "/marks/NVDA.svg" },
  { symbol: "MSFT", name: "Microsoft", address: XSTOCK.MSFT, logo: "/marks/MSFT.svg" },
  { symbol: "AMZN", name: "Amazon", address: XSTOCK.AMZN, logo: "/marks/AMZN.svg" },
  { symbol: "META", name: "Meta", address: XSTOCK.META, logo: "/marks/META.svg" },
  { symbol: "GOOGL", name: "Alphabet", address: XSTOCK.GOOGL, logo: "/marks/GOOGL.svg" },
  { symbol: "TSLA", name: "Tesla", address: XSTOCK.TSLA, logo: "/marks/TSLA.svg" },
  { symbol: "AVGO", name: "Broadcom", address: XSTOCK.AVGO, logo: "/marks/AVGO.svg" },
  { symbol: "TSM", name: "TSMC", address: XSTOCK.TSM, logo: "/marks/TSM.svg" },
  { symbol: "AMD", name: "AMD", address: XSTOCK.AMD, logo: "/marks/AMD.svg" },
  { symbol: "MU", name: "Micron", address: XSTOCK.MU, logo: "/marks/MU.svg" },
  { symbol: "CRCL", name: "Circle", address: XSTOCK.CRCL, logo: "/marks/CRCL.jpg" },
  { symbol: "SPCX", name: "SpaceX", address: XSTOCK.SPCX, logo: "/marks/SPCX.png" },
];

const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const RPCS = ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com", "https://bsc-dataseed1.defibit.io", "https://1rpc.io/bnb"];

function word(value: bigint | number) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodeBalances(tokens: string[], owner: string) {
  const tuples = tokens.map((token) => {
    const call = (`70a08231${pad(owner)}`).padEnd(96, "0");
    return `${pad(token)}${word(64)}${word(36)}${call}`;
  });
  let head = word(tokens.length);
  let body = "";
  let cursor = tokens.length * 32;
  for (const tuple of tuples) {
    head += word(cursor);
    body += tuple;
    cursor += tuple.length / 2;
  }
  return `0xbce38bd7${word(0)}${word(64)}${head}${body}`;
}

function decodeBalances(result: string, count: number) {
  const words = result.slice(2).match(/.{64}/g) ?? [];
  const balances = Array.from({ length: count }, () => 0n);
  if (words.length < count + 4) return balances;
  for (let index = 0; index < count; index += 1) {
    const offset = Number(BigInt(`0x${words[2 + index]}`));
    const start = 2 + offset / 32;
    if (!words[start] || BigInt(`0x${words[start]}`) !== 1n) continue;
    const lenIndex = start + Number(BigInt(`0x${words[start + 1]}`)) / 32;
    if (words[lenIndex + 1]) balances[index] = BigInt(`0x${words[lenIndex + 1]}`);
  }
  return balances;
}

async function rpcCall(to: string, data: string) {
  try {
    return await Promise.any(
      RPCS.map(async (rpc) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
          signal: AbortSignal.timeout(1600),
        });
        const body = (await res.json()) as { result?: string };
        if (body.result && body.result !== "0x") return body.result;
        throw new Error("empty");
      }),
    );
  } catch {
    try {
      return (await provider().request({ method: "eth_call", params: [{ to, data }, "latest"] })) as string;
    } catch {
      throw new Error("empty");
    }
  }
}

export type HeldAsset = { symbol: string; name: string; amount: number; side: "crypto" | "stock"; logo?: string; usd: number | null };

const assetCache = new Map<string, { at: number; assets: HeldAsset[] }>();
const assetFlight = new Map<string, Promise<HeldAsset[]>>();
const assetListeners = new Map<string, Set<(assets: HeldAsset[]) => void>>();
const ASSET_TTL = 20_000;

function savedAssets() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const parsed = JSON.parse(sessionStorage.getItem("gapline.assets.v1") ?? "{}") as Record<string, HeldAsset[]>;
    for (const [key, assets] of Object.entries(parsed)) {
      if (Array.isArray(assets) && !assetCache.has(key)) assetCache.set(key, { at: 0, assets });
    }
  } catch {
    /* A private window can block storage. The chain read still runs. */
  }
}

function storeAssets(key: string, assets: HeldAsset[], done = true) {
  const previous = assetCache.get(key);
  const next = done
    ? assets
    : [...assets, ...(previous?.assets.filter((asset) => asset.side === "stock" && !assets.some((item) => item.symbol === asset.symbol)) ?? [])];
  assetCache.set(key, { at: done ? Date.now() : (previous?.at ?? 0), assets: next });
  assetListeners.get(key)?.forEach((listener) => listener(next));
  if (!done || typeof sessionStorage === "undefined") return;
  try {
    const parsed = JSON.parse(sessionStorage.getItem("gapline.assets.v1") ?? "{}") as Record<string, HeldAsset[]>;
    parsed[key] = assets;
    const entries = Object.entries(parsed).slice(-6);
    sessionStorage.setItem("gapline.assets.v1", JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* The in-memory copy is enough for this visit. */
  }
}

export function peekAssets(address: string) {
  savedAssets();
  return assetCache.get(address.toLowerCase())?.assets ?? null;
}

async function nativeBalance(address: string) {
  try {
    return await Promise.any(
      RPCS.map(async (rpc) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
          signal: AbortSignal.timeout(1600),
        });
        const body = (await res.json()) as { result?: string };
        if (body.result) return BigInt(body.result);
        throw new Error("empty");
      }),
    );
  } catch {
    try {
      const raw = (await provider().request({ method: "eth_getBalance", params: [address, "latest"] })) as string;
      return raw ? BigInt(raw) : 0n;
    } catch {
      return 0n;
    }
  }
}

function pushHeld(held: HeldAsset[], asset: HeldAsset) {
  const index = held.findIndex((item) => item.symbol === asset.symbol && item.side === asset.side);
  if (index >= 0) held[index] = asset;
  else held.push(asset);
}

async function loadAssets(address: string) {
  const key = address.toLowerCase();
  const stocks = Object.entries({ ...XSTOCK, ...EXTRA }).map(([symbol, token]) => {
    const known = STOCKS.find((item) => item.symbol === symbol);
    return { symbol, name: known?.name ?? symbol, address: token, logo: known?.logo, usd: undefined as "stable" | undefined, stock: true };
  });
  const stables = WATCH.map((token) => ({ ...token, stock: false }));
  const held: HeldAsset[] = [];
  const bnbPromise = bnbUsd();
  const [native, usdt, usdc] = await Promise.all([nativeBalance(address), tokenBalance(USDT, address), tokenBalance(USDC, address)]);
  if (fromUnit(native) > 0.0001) {
    const amount = fromUnit(native);
    pushHeld(held, { symbol: "BNB", name: "BNB", amount, side: "crypto", logo: "/marks/BNB.png", usd: null });
  }
  for (const [token, amount] of [
    [stables[0], usdt],
    [stables[1], usdc],
  ] as const) {
    const size = fromUnit(amount);
    if (size <= 0.00000001 || !token) continue;
    pushHeld(held, { symbol: token.symbol, name: token.name, amount: size, side: "crypto", logo: token.logo, usd: size });
  }
  storeAssets(key, held.slice(), false);
  const bnb = await bnbPromise;
  if (bnb) {
    const row = held.find((asset) => asset.symbol === "BNB");
    if (row) row.usd = row.amount * bnb;
    storeAssets(key, held.slice(), false);
  }
  const chunks: (typeof stocks)[] = [];
  for (let index = 0; index < stocks.length; index += 80) chunks.push(stocks.slice(index, index + 80));
  const parts = await Promise.all(chunks.map((chunk) => rpcCall(MULTICALL, encodeBalances(chunk.map((token) => token.address), address)).catch(() => "0x")));
  chunks.forEach((chunk, chunkIndex) => {
    const balances = decodeBalances(parts[chunkIndex] ?? "0x", chunk.length);
    chunk.forEach((token, index) => {
      const amount = fromUnit(balances[index] ?? 0n);
      if (amount <= 0.00000001) return;
      pushHeld(held, { symbol: token.symbol, name: token.name, amount, side: "stock", logo: token.logo, usd: null });
    });
  });
  storeAssets(key, held.slice());
  return held;
}

export async function readAssets(address: string, onPartial?: (assets: HeldAsset[]) => void, fresh = false) {
  const key = address.toLowerCase();
  savedAssets();
  const hit = assetCache.get(key);
  if (hit) onPartial?.(hit.assets);
  if (hit && !fresh && Date.now() - hit.at < ASSET_TTL) return hit.assets;
  if (onPartial) {
    const set = assetListeners.get(key) ?? new Set();
    set.add(onPartial);
    assetListeners.set(key, set);
  }
  const pending = assetFlight.get(key);
  if (pending) return pending;
  const job = loadAssets(address).finally(() => {
    assetFlight.delete(key);
    assetListeners.delete(key);
  });
  assetFlight.set(key, job);
  return job;
}

async function bnbUsd() {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT", { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return null;
    const body = (await res.json()) as { price?: string };
    const price = Number(body.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function sendAsset(input: { from: string; token: string | null; to: string; amount: number }) {
  const to = input.to.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("Enter the address you want to send to.");
  if (!(input.amount > 0)) throw new Error("Enter an amount.");
  if (smartAddress()?.toLowerCase() === input.from.toLowerCase()) {
    return transferFromSmart({ token: input.token, to, amount: input.amount });
  }
  await ensureBsc(input.from);
  const units = BigInt(Math.round(input.amount * 1e8)) * 10n ** 10n;
  if (units <= 0n) throw new Error("Enter an amount.");
  if (!input.token) {
    const eth = await signer(input.from);
    try {
      return (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: input.from, to, value: `0x${units.toString(16)}` }],
      })) as string;
    } catch (error) {
      throw new Error(explain(error, "The wallet did not send. Nothing was confirmed."));
    }
  }
  const data = `0xa9059cbb${pad(to)}${units.toString(16).padStart(64, "0")}`;
  return send(input.from, input.token, data);
}

export async function disconnectWallet() {
  const wasSmart = smartActive();
  disconnectSmart();
  if (wasSmart) return;
  const eth = (window as unknown as { ethereum?: Provider }).ethereum;
  if (!eth) return;
  try {
    await eth.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* The wallet may not support revoke. Gapline still forgets the address. */
  }
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
