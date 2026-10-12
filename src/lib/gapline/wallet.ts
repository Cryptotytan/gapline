import { encodeFunctionData, decodeFunctionResult, type Address, type Hex } from "viem";
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

function fromUnit(amount: bigint) {
  return Number(amount) / 1e18;
}

function toUnit(usd: number) {
  const cents = Math.round(usd * 100);
  return BigInt(cents) * 10n ** 16n;
}

async function readToken(token: string, address: string) {
  try {
    const raw = await rpcCall(token, encodeBalance(address));
    return BigInt(raw);
  } catch {
    return null;
  }
}

async function tokenBalance(token: string, address: string) {
  return (await readToken(token, address)) ?? 0n;
}

const cashMemory = new Map<string, { usdc: bigint; usdt: bigint }>();

export async function readCash(address: string) {
  const key = address.toLowerCase();
  const remembered = cashMemory.get(key);
  const [usdc, usdt] = await Promise.all([readToken(USDC, address), readToken(USDT, address)]);
  if (usdc == null && usdt == null && !remembered) throw new Error("The wallet balance did not come back.");
  const next = { usdc: usdc ?? remembered?.usdc ?? 0n, usdt: usdt ?? remembered?.usdt ?? 0n };
  cashMemory.set(key, next);
  return fromUnit(next.usdc + next.usdt);
}

function reasonFrom(message: string) {
  if (/insufficient funds|not enough funds|insufficient balance for transfer/i.test(message)) {
    return "There wasn't enough gas. This wallet needs more BNB for the network fee.";
  }
  if (/out of gas|gas required exceeds|intrinsic gas too low|exceeds block gas limit/i.test(message)) {
    return "There wasn't enough gas. Add a little BNB and try again.";
  }
  const following = message.match(/following reason:\s*([^\n]+)/i);
  if (following?.[1]) return following[1].trim();
  const reverted = message.match(/execution reverted:?\s*(.+)/i);
  if (reverted?.[1] && !/^0x/i.test(reverted[1].trim())) return reverted[1].trim();
  return "";
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
  if (/user rejected|user denied/i.test(message)) return "You closed the wallet. Nothing was sent.";
  if (/chain/i.test(message) && /mismatch|wrong|switch/i.test(message)) return "Switch the wallet to BNB Chain. Nothing was sent.";
  const reason = reasonFrom(message);
  if (reason) return reason;
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

async function kyberOffer(tokenIn: string, tokenOut: string, amountIn: bigint, slippage = 100): Promise<Offer | null> {
  const route = await quote(tokenIn, tokenOut, amountIn);
  const amountOut = BigInt(route.amountOut ?? "0");
  if (amountOut <= 0n) return null;
  return {
    name: "Kyber",
    amountOut,
    vendorUsd: Number(route.amountOutUsd ?? 0),
    tokenIn,
    build: async (sender) => {
      const tx = await build(route, sender, slippage);
      return { to: asRouter(tx.to), data: tx.data, amountOut: tx.amountOut };
    },
  };
}

async function sushiOffer(tokenIn: string, tokenOut: string, amountIn: bigint, slippage = 0.01): Promise<Offer | null> {
  const url = new URL("https://api.sushi.com/swap/v7/56");
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("amount", amountIn.toString());
  url.searchParams.set("maxSlippage", String(slippage));
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
      built.searchParams.set("maxSlippage", String(slippage));
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

async function paraOffer(tokenIn: string, tokenOut: string, amountIn: bigint, slippage = 100): Promise<Offer | null> {
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
          slippage,
        }),
      });
      if (!next.ok) throw new Error("ParaSwap could not build this swap. Nothing was sent.");
      const tx = (await next.json()) as { to?: string; data?: string };
      if (!tx.to || !tx.data) throw new Error("ParaSwap could not build this swap. Nothing was sent.");
      return { to: asRouter(tx.to), data: tx.data, amountOut };
    },
  };
}

const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const amountsAbi = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;
const swapAbi = [
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

async function pancakeOffer(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Offer | null> {
  try {
    const quoted = encodeFunctionData({
      abi: amountsAbi,
      functionName: "getAmountsOut",
      args: [amountIn, [tokenIn as Address, tokenOut as Address]],
    });
    const result = await rpcCall(PANCAKE_ROUTER, quoted);
    const amounts = decodeFunctionResult({ abi: amountsAbi, functionName: "getAmountsOut", data: result as Hex });
    const amountOut = amounts[amounts.length - 1] ?? 0n;
    if (amountOut <= 0n) return null;
    return {
      name: "PancakeSwap",
      amountOut,
      vendorUsd: 0,
      tokenIn,
      build: async (sender) => ({
        to: PANCAKE_ROUTER,
        data: encodeFunctionData({
          abi: swapAbi,
          functionName: "swapExactTokensForTokens",
          args: [amountIn, (amountOut * 50n) / 100n, [tokenIn as Address, tokenOut as Address], sender as Address, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)],
        }),
        amountOut,
      }),
    };
  } catch {
    return null;
  }
}

async function offersFor(tokenIn: string, tokenOut: string, amountIn: bigint) {
  const found = await Promise.all([
    kyberOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    sushiOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    lifiOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    paraOffer(tokenIn, tokenOut, amountIn).catch(() => null),
    pancakeOffer(tokenIn, tokenOut, amountIn).catch(() => null),
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

async function build(routeSummary: unknown, sender: string, slippage = 100) {
  const res = await fetch("https://aggregator-api.kyberswap.com/bsc/api/v1/route/build", {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-id": "gapline" },
    body: JSON.stringify({ routeSummary, sender, recipient: sender, slippageTolerance: slippage }),
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
  const gas = await paddedGas(from, to, data);
  const eth = await signer(from);
  try {
    return (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data, value: "0x0", gas, gasLimit: gas }],
    })) as string;
  } catch (error) {
    throw new Error(explain(error, "The wallet did not send. Nothing was confirmed."));
  }
}

async function paddedGas(from: string, to: string, data: string) {
  try {
    const hex = await Promise.any(
      RPCS.map(async (rpc) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_estimateGas", params: [{ from, to, data, value: "0x0" }] }),
          signal: AbortSignal.timeout(4000),
        });
        const body = (await res.json()) as { result?: string; error?: { message?: string; data?: string } };
        if (!body.result) {
          const decoded = decodeRevert(body.error?.data);
          throw new Error(decoded || body.error?.message || "execution reverted");
        }
        return body.result;
      }),
    );
    return "0x" + ((BigInt(hex) * 3n) / 2n + 40_000n).toString(16);
  } catch (error) {
    const messages =
      error instanceof AggregateError
        ? error.errors.map((item) => (item instanceof Error ? item.message : String(item)))
        : [error instanceof Error ? error.message : ""];
    const text = messages.filter(Boolean).join(" ");
    throw new Error(reasonFrom(text) || text || "This swap would be rejected on BNB Chain. Nothing was sent.");
  }
}

function decodeRevert(data?: string) {
  if (!data || !data.startsWith("0x") || data.length < 10) return "";
  const hex = data.slice(2);
  if (hex.startsWith("08c379a0") && hex.length >= 8 + 128) {
    const length = Number(BigInt(`0x${hex.slice(8 + 64, 8 + 128)}`));
    if (length > 0 && hex.length >= 8 + 128 + length * 2) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = Number.parseInt(hex.slice(8 + 128 + i * 2, 8 + 128 + i * 2 + 2), 16);
      const text = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
      if (text) return text;
    }
  }
  if (hex.startsWith("4e487b71") && hex.length >= 8 + 64) {
    return `The contract panicked (${Number(BigInt(`0x${hex.slice(8, 8 + 64)}`))}).`;
  }
  return "";
}

async function rpc(method: string, params: unknown[]) {
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(4000),
      });
      const body = (await res.json()) as { result?: unknown; error?: { message?: string; data?: string } };
      if (body.result !== undefined || body.error) return body;
    } catch {
      /* Try the next public node. */
    }
  }
  return null;
}

async function failureReason(hash: string, receipt: { gasUsed?: string; blockNumber?: string }) {
  const txBody = await rpc("eth_getTransactionByHash", [hash]);
  const tx = txBody?.result as { from?: string; to?: string; input?: string; gas?: string; value?: string } | null;
  if (receipt.gasUsed && tx?.gas) {
    try {
      const used = BigInt(receipt.gasUsed);
      const limit = BigInt(tx.gas);
      if (limit > 0n && used * 100n >= limit * 99n) return "There wasn't enough gas. Add a little BNB and try again.";
    } catch {
      /* The gas fields were not numbers. Fall through to the revert text. */
    }
  }
  if (tx?.from && tx.to && tx.input && receipt.blockNumber) {
    const block = BigInt(receipt.blockNumber);
    const parent = block > 0n ? `0x${(block - 1n).toString(16)}` : "latest";
    const call = await rpc("eth_call", [{ from: tx.from, to: tx.to, data: tx.input, value: tx.value ?? "0x0" }, parent]);
    const decoded = decodeRevert(call?.error?.data);
    if (decoded) return decoded;
    const fromNode = reasonFrom(call?.error?.message ?? "");
    if (fromNode) return fromNode;
    if (call?.error?.message) return call.error.message;
  }
  return "The transaction was rejected on BNB Chain. The node did not say why.";
}

async function wait(hash: string) {
  for (let i = 0; i < 30; i += 1) {
    let receipt: { status?: string; gasUsed?: string; blockNumber?: string } | null = null;
    for (const url of RPCS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const body = (await res.json()) as { result?: { status?: string; gasUsed?: string; blockNumber?: string } | null };
        if (body.result) {
          receipt = body.result;
          break;
        }
      } catch {
        /* Try the next public node. */
      }
    }
    if (receipt?.status) {
      if (receipt.status === "0x0" || receipt.status === "0x00") throw new Error(await failureReason(hash, receipt));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("The transaction is still pending. Check the wallet before trying again.");
}

async function ensureAllowance(token: string, owner: string, spender: string, amount: bigint) {
  let allowed = 0n;
  try {
    allowed = BigInt(await rpcCall(token, encodeAllowance(owner, spender)));
  } catch {
    allowed = 0n;
  }
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

export async function sellStock(input: { address: string; symbol: string; qty: number; all?: boolean; token?: string }) {
  if (!(input.qty > 0)) throw new Error("Type how much you want to sell. Nothing was sent.");
  const tokenIn = input.token ?? stockToken(input.symbol);
  if (!tokenIn) throw new Error("This name has no xStock on BNB Chain. Nothing was sent.");
  await ensureBsc(input.address);
  const raw = await readToken(tokenIn, input.address);
  if (raw == null) throw new Error("The share balance did not come back. Nothing was sent.");
  if (raw <= 0n) throw new Error("This wallet does not hold that stock. Nothing was sent.");
  const requested = BigInt(Math.round(input.qty * 1e6)) * 10n ** 12n;
  const amount = input.all || requested <= 0n || requested > raw ? raw : requested;
  if (amount <= 0n) throw new Error("Type how much you want to sell. Nothing was sent.");
  const steps = [amount];
  let smaller = amount;
  for (let step = 0; step < 3; step += 1) {
    smaller /= 2n;
    if (smaller <= 0n || smaller * 20n < amount) break;
    steps.push(smaller);
  }
  let reason = "The pool rejected the sale. It cannot take this many shares, so nothing was sent.";
  for (const tryAmount of steps) {
    const found = await Promise.all([
      kyberOffer(tokenIn, USDC, tryAmount, 5000).catch(() => null),
      kyberOffer(tokenIn, USDT, tryAmount, 5000).catch(() => null),
      sushiOffer(tokenIn, USDC, tryAmount, 0.5).catch(() => null),
      sushiOffer(tokenIn, USDT, tryAmount, 0.5).catch(() => null),
      lifiOffer(tokenIn, USDC, tryAmount).catch(() => null),
      lifiOffer(tokenIn, USDT, tryAmount).catch(() => null),
      paraOffer(tokenIn, USDC, tryAmount, 5000).catch(() => null),
      paraOffer(tokenIn, USDT, tryAmount, 5000).catch(() => null),
      pancakeOffer(tokenIn, USDC, tryAmount).catch(() => null),
      pancakeOffer(tokenIn, USDT, tryAmount).catch(() => null),
    ]);
    const offers = found.filter((offer): offer is Offer => offer != null);
    offers.sort((left, right) => (left.amountOut === right.amountOut ? right.vendorUsd - left.vendorUsd : left.amountOut > right.amountOut ? -1 : 1));
    for (const offer of offers) {
      let hash = "";
      try {
        const tx = await offer.build(input.address);
        if (tx.amountOut <= 0n) continue;
        await ensureAllowance(tokenIn, input.address, tx.to, tryAmount);
        hash = await send(input.address, tx.to, tx.data);
        await wait(hash);
        return { hash, usdc: fromUnit(tx.amountOut), venue: offer.name, partial: tryAmount * 100n < amount * 90n };
      } catch (error) {
        reason = error instanceof Error ? error.message : reason;
        if (hash || /closed the wallet|did not switch|could not be added|needs a little BNB/i.test(reason)) throw new Error(reason);
      }
    }
  }
  throw new Error(reason);
}

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

const balanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const tryAggregateAbi = [
  {
    type: "function",
    name: "tryAggregate",
    stateMutability: "payable",
    inputs: [
      { name: "requireSuccess", type: "bool" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

function encodeBalances(tokens: string[], owner: string) {
  return encodeFunctionData({
    abi: tryAggregateAbi,
    functionName: "tryAggregate",
    args: [
      false,
      tokens.map((token) => ({
        target: token as Address,
        callData: encodeFunctionData({ abi: balanceAbi, functionName: "balanceOf", args: [owner as Address] }),
      })),
    ],
  });
}

function decodeBalances(result: string, count: number) {
  const empty = Array.from({ length: count }, () => 0n);
  if (!result || result === "0x" || result.length < 10) return empty;
  try {
    const rows = decodeFunctionResult({ abi: tryAggregateAbi, functionName: "tryAggregate", data: result as Hex });
    return empty.map((_, index) => {
      const row = rows[index];
      if (!row?.success || !row.returnData || row.returnData === "0x") return 0n;
      return BigInt(row.returnData);
    });
  } catch {
    return empty;
  }
}

async function rpcCall(to: string, data: string) {
  try {
    return await Promise.any(
      RPCS.map(async (rpc) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
          signal: AbortSignal.timeout(2500),
        });
        const body = (await res.json()) as { result?: string };
        if (body.result && body.result !== "0x") return body.result;
        throw new Error("empty");
      }),
    );
  } catch {
    try {
      const wallet = provider().request({ method: "eth_call", params: [{ to, data }, "latest"] }) as Promise<string>;
      return await Promise.race([
        wallet,
        new Promise<string>((_, reject) => {
          window.setTimeout(() => reject(new Error("timeout")), 2500);
        }),
      ]);
    } catch {
      throw new Error("empty");
    }
  }
}

export type HeldAsset = { symbol: string; name: string; amount: number; side: "crypto" | "stock"; logo?: string; usd: number | null; token?: string };

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

export function invalidateAssets(address?: string) {
  if (!address) {
    for (const [key, row] of assetCache) assetCache.set(key, { ...row, at: 0 });
    return;
  }
  const key = address.toLowerCase();
  const row = assetCache.get(key);
  if (row) assetCache.set(key, { ...row, at: 0 });
}

export function peekAssets(address: string) {
  savedAssets();
  return assetCache.get(address.toLowerCase())?.assets ?? null;
}

async function nativeBalance(address: string): Promise<bigint | null> {
  try {
    return await Promise.any(
      RPCS.map(async (rpc) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
          signal: AbortSignal.timeout(2500),
        });
        const body = (await res.json()) as { result?: string };
        if (body.result) return BigInt(body.result);
        throw new Error("empty");
      }),
    );
  } catch {
    return null;
  }
}

function pushHeld(held: HeldAsset[], asset: HeldAsset) {
  const index = held.findIndex((item) => item.symbol === asset.symbol && item.side === asset.side);
  if (index >= 0) held[index] = asset;
  else held.push(asset);
}

const MAJORS: { symbol: string; name: string; address: string; logo: string; peg?: "usd"; px?: "BNB" | "BTC" | "ETH" | "CAKE" }[] = [
  { symbol: "USDT", name: "USDT", address: USDT, logo: "/marks/USDT.png", peg: "usd" },
  { symbol: "USDC", name: "USDC", address: USDC, logo: "/marks/USDC.png", peg: "usd" },
  { symbol: "FDUSD", name: "FDUSD", address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", logo: "/marks/FDUSD.jpg", peg: "usd" },
  { symbol: "WBNB", name: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", logo: "/marks/WBNB.png", px: "BNB" },
  { symbol: "BTCB", name: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", logo: "/marks/BTCB.png", px: "BTC" },
  { symbol: "ETH", name: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", logo: "/marks/ETH.png", px: "ETH" },
  { symbol: "CAKE", name: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", logo: "/marks/CAKE.png", px: "CAKE" },
];

type Px = { BNB: number; BTC: number; ETH: number; CAKE: number };
let priceBook: Px | null = null;
const lastCrypto = new Map<string, HeldAsset[]>();

async function loadPrices(): Promise<Px | null> {
  const take = async (book: Px) => {
    if (!(book.BNB > 0)) throw new Error("empty");
    priceBook = {
      BNB: book.BNB,
      BTC: book.BTC > 0 ? book.BTC : (priceBook?.BTC ?? 0),
      ETH: book.ETH > 0 ? book.ETH : (priceBook?.ETH ?? 0),
      CAKE: book.CAKE > 0 ? book.CAKE : (priceBook?.CAKE ?? 0),
    };
    return priceBook;
  };
  try {
    return await Promise.any([
      fetch("https://coins.llama.fi/prices/current/coingecko:binancecoin,coingecko:bitcoin,coingecko:ethereum,coingecko:pancakeswap-token", {
        signal: AbortSignal.timeout(2500),
      }).then(async (res) => {
        if (!res.ok) throw new Error("empty");
        const body = (await res.json()) as { coins?: Record<string, { price?: number }> };
        const coin = (id: string) => Number(body.coins?.[`coingecko:${id}`]?.price ?? 0);
        return take({ BNB: coin("binancecoin"), BTC: coin("bitcoin"), ETH: coin("ethereum"), CAKE: coin("pancakeswap-token") });
      }),
      fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(["BNBUSDT", "BTCUSDT", "ETHUSDT", "CAKEUSDT"]))}`, {
        signal: AbortSignal.timeout(2500),
      }).then(async (res) => {
        if (!res.ok) throw new Error("empty");
        const rows = (await res.json()) as { symbol?: string; price?: string }[];
        const px = (symbol: string) => Number(rows.find((row) => row.symbol === symbol)?.price ?? 0);
        return take({ BNB: px("BNBUSDT"), BTC: px("BTCUSDT"), ETH: px("ETHUSDT"), CAKE: px("CAKEUSDT") });
      }),
    ]);
  } catch {
    return priceBook;
  }
}

function priced(amount: number, px: number, previous: number | null | undefined) {
  if (px > 0) return amount * px;
  return previous ?? null;
}

export async function refreshCrypto(address: string) {
  const key = address.toLowerCase();
  const previous = lastCrypto.get(key) ?? assetCache.get(key)?.assets.filter((asset) => asset.side === "crypto") ?? [];
  const [native, marks, ...balances] = await Promise.all([nativeBalance(address), loadPrices(), ...MAJORS.map((token) => readToken(token.address, address))]);
  const next: HeldAsset[] = [];
  const bnbAmount = native == null ? (previous.find((asset) => asset.symbol === "BNB")?.amount ?? null) : fromUnit(native);
  if (bnbAmount != null && bnbAmount > 0.0001) {
    const old = previous.find((asset) => asset.symbol === "BNB");
    next.push({
      symbol: "BNB",
      name: "BNB",
      amount: bnbAmount,
      side: "crypto",
      logo: "/marks/BNB.png",
      usd: priced(bnbAmount, marks?.BNB ?? 0, old?.usd),
    });
  }
  MAJORS.forEach((token, index) => {
    const raw = balances[index] ?? null;
    const amount = raw == null ? (previous.find((asset) => asset.symbol === token.symbol)?.amount ?? null) : fromUnit(raw);
    if (amount == null || amount <= 0.00000001) return;
    const old = previous.find((asset) => asset.symbol === token.symbol);
    const mark = token.peg === "usd" ? 1 : token.px ? (marks?.[token.px] ?? 0) : 0;
    next.push({
      symbol: token.symbol,
      name: token.name,
      amount,
      side: "crypto",
      logo: token.logo,
      usd: priced(amount, mark, old?.usd),
    });
  });
  if (!next.length && previous.length) return previous;
  lastCrypto.set(key, next);
  const stocks = assetCache.get(key)?.assets.filter((asset) => asset.side === "stock") ?? [];
  storeAssets(key, [...next, ...stocks]);
  return next;
}

async function loadAssets(address: string) {
  const key = address.toLowerCase();
  const seen = new Set<string>();
  const stocks = Object.entries({ ...XSTOCK, ...EXTRA })
    .map(([symbol, token]) => {
      const known = STOCKS.find((item) => item.symbol === symbol);
      return { symbol, name: known?.name ?? symbol, address: token, logo: known?.logo };
    })
    .filter((token) => {
      const id = token.address.toLowerCase();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const crypto = await refreshCrypto(address);
  const held: HeldAsset[] = crypto.slice();
  const previousStocks = assetCache.get(key)?.assets.filter((asset) => asset.side === "stock") ?? [];
  const chunks: (typeof stocks)[] = [];
  for (let index = 0; index < stocks.length; index += 40) chunks.push(stocks.slice(index, index + 40));
  const parts = await Promise.all(chunks.map((chunk) => rpcCall(MULTICALL, encodeBalances(chunk.map((token) => token.address), address)).catch(() => "0x")));
  chunks.forEach((chunk, chunkIndex) => {
    const raw = parts[chunkIndex] ?? "0x";
    if (raw === "0x") {
      for (const token of chunk) {
        const old = previousStocks.find((asset) => asset.symbol === token.symbol);
        if (old) pushHeld(held, old);
      }
      return;
    }
    const balances = decodeBalances(raw, chunk.length);
    chunk.forEach((token, index) => {
      const amount = fromUnit(balances[index] ?? 0n);
      if (amount <= 0.00000001) return;
      pushHeld(held, { symbol: token.symbol, name: token.name, amount, side: "stock", logo: token.logo, usd: null, token: token.address });
    });
  });
  storeAssets(key, held.slice());
  return held;
}

export async function readAssets(address: string, onPartial?: (assets: HeldAsset[]) => void, fresh = false): Promise<HeldAsset[]> {
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
  if (pending && !fresh) return pending;
  if (pending && fresh) {
    return pending.catch(() => [] as HeldAsset[]).then(() => readAssets(address, onPartial, false));
  }
  const job = loadAssets(address).finally(() => {
    assetFlight.delete(key);
    assetListeners.delete(key);
  });
  assetFlight.set(key, job);
  return job;
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
