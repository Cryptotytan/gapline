import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { authClient, authEnabled, signIn } from "@/lib/auth/client";
import { authMiddleware } from "@/lib/auth/middleware";

const PUBLIC = "gapline.smart.public";
const LEGACY = "gapline.smart.v1";
const ACTIVE = "gapline.smart.active";
const PENDING = "gapline.smart.pending";
const SEAL = "gapline.xvault";
const RPC = "https://bsc-dataseed.binance.org";

type PublicRow = { kind: "x" | "email"; name: string; address: Address };
type LegacyRow = { kind?: string; id?: string; address?: Address; key?: Hex };

type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

let account: ReturnType<typeof privateKeyToAccount> | null = null;
let signingKey: Hex | null = null;

const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });

function markPending() {
  sessionStorage.setItem(PENDING, "1");
  localStorage.setItem(PENDING, "1");
}

function xReturn() {
  return new URLSearchParams(window.location.search).get("x") === "1";
}

function pendingX() {
  return sessionStorage.getItem(PENDING) === "1" || localStorage.getItem(PENDING) === "1" || xReturn();
}

function clearPending() {
  sessionStorage.removeItem(PENDING);
  localStorage.removeItem(PENDING);
}

function readSeal() {
  try {
    return localStorage.getItem(SEAL);
  } catch {
    return null;
  }
}

function writeSeal(seal: string) {
  localStorage.setItem(SEAL, seal);
}

async function waitForXSession(tries = 10) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const session = await authClient.getSession().catch(() => null);
    const id = session?.data?.user?.id;
    if (id && id !== "dev-user") return id;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return null;
}

function readPublic(): PublicRow[] {
  try {
    const raw = localStorage.getItem(PUBLIC);
    const parsed = raw ? (JSON.parse(raw) as PublicRow[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberPublic(row: PublicRow) {
  const rows = readPublic().filter((item) => item.address.toLowerCase() !== row.address.toLowerCase());
  rows.unshift(row);
  localStorage.setItem(PUBLIC, JSON.stringify(rows.slice(0, 8)));
}

function hold(key: Hex, kind: PublicRow["kind"], name: string) {
  signingKey = key;
  account = privateKeyToAccount(key);
  localStorage.setItem(ACTIVE, account.address);
  rememberPublic({ kind, name, address: account.address });
  return account.address;
}

export function describeSmartWallet(address: string): { kind: "email" | "x"; name: string } | null {
  const found = readPublic().find((row) => row.address.toLowerCase() === address.toLowerCase());
  if (!found) return null;
  return { kind: found.kind, name: found.name };
}

export function smartAddress() {
  return account?.address ?? null;
}

export function smartActive() {
  return account != null;
}

export function disconnectSmart() {
  account = null;
  signingKey = null;
  localStorage.removeItem(ACTIVE);
}

export const unlockXWallet = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((seal: string | null) => (typeof seal === "string" ? seal : null))
  .handler(async ({ data, context }) => {
    if (!context.userId || context.userId === "dev-user") return { ok: false as const, error: "Sign in with X first." };
    const { openVault } = await import("./wallet-vault.server");
    return openVault(context.userId, data);
  });

export const importLegacyKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((row: { id?: string; address?: string; key?: string }) => row)
  .handler(async ({ data, context }) => {
    if (!context.userId || context.userId === "dev-user" || data.id !== context.userId) return { ok: false as const };
    if (!data.address?.startsWith("0x") || !data.key?.startsWith("0x")) return { ok: false as const };
    const { importVault } = await import("./wallet-vault.server");
    await importVault(context.userId, data.address as Address, data.key as Hex);
    return { ok: true as const };
  });

export async function migrateLegacyKeys() {
  try {
    const raw = localStorage.getItem(LEGACY);
    if (!raw) return;
    const rows = JSON.parse(raw) as LegacyRow[];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row.kind === "x" && row.id && row.address && row.key) {
          await importLegacyKey({ data: { id: row.id, address: row.address, key: row.key } }).catch(() => undefined);
        }
      }
    }
  } catch {
    /* The old copy is removed either way. */
  }
  localStorage.removeItem(LEGACY);
}

async function unlockSaved() {
  const result = await unlockXWallet({ data: readSeal() });
  if (result.ok && result.seal) writeSeal(result.seal);
  return result;
}

export async function resumeSmartWallet() {
  await migrateLegacyKeys();
  try {
    const result = await unlockSaved();
    if (!result.ok) return null;
    return hold(result.key, "x", "X wallet");
  } catch {
    return null;
  }
}

export async function activateSavedWallet(address: string) {
  if (account && account.address.toLowerCase() === address.toLowerCase()) return true;
  const known = readPublic().find((row) => row.address.toLowerCase() === address.toLowerCase());
  if (known?.kind === "x") {
    const result = await unlockSaved().catch(() => null);
    if (result?.ok && result.address.toLowerCase() === address.toLowerCase()) {
      hold(result.key, "x", "X wallet");
      return true;
    }
  }
  disconnectSmart();
  return false;
}

export function exportSmartKey(address?: string) {
  if (!account || !signingKey) return null;
  if (address && account.address.toLowerCase() !== address.toLowerCase()) return null;
  return signingKey;
}

const erc20Transfer = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export async function transferFromSmart(input: { token: string | null; to: string; amount: number }) {
  if (!account) throw new Error("Open the X wallet before sending.");
  const to = input.to.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("Enter the address you want to send to.");
  if (!(input.amount > 0)) throw new Error("Enter an amount.");
  const units = parseUnits(input.amount.toFixed(8).replace(/\.?0+$/, ""), 18);
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
  try {
    if (!input.token) return await wallet.sendTransaction({ to: to as Address, value: units });
    const data = encodeFunctionData({ abi: erc20Transfer, functionName: "transfer", args: [to as Address, units] });
    return await wallet.sendTransaction({ to: input.token as Address, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/insufficient funds/i.test(message)) throw new Error("This wallet needs a little BNB for the network fee. Nothing was sent.");
    throw new Error("The send did not go through. Nothing was confirmed.");
  }
}

export const sendWalletCode = createServerFn({ method: "POST" })
  .validator((email: string) => {
    const id = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) throw new Error("Enter an email address.");
    return id;
  })
  .handler(async ({ data }) => {
    const { sendCode } = await import("./wallet-mail.server");
    return sendCode(data);
  });

export const confirmWalletCode = createServerFn({ method: "POST" })
  .validator((input: { email: string; code: string }) => {
    const email = input?.email?.trim().toLowerCase() ?? "";
    const code = input?.code?.trim() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter an email address.");
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code.");
    return { email, code };
  })
  .handler(async ({ data }) => {
    const { confirmCode } = await import("./wallet-mail.server");
    return confirmCode(data.email, data.code);
  });

export function createSmartWalletWithEmail() {
  throw new Error("Email sign-in was removed. Continue with X, or connect a wallet you already have.");
}

let lastXError = "";

export function xWalletError() {
  return lastXError;
}

function explainX(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (!message || /unauthorized/i.test(message)) return "X did not finish signing in. Try again.";
  return message;
}

export async function createSmartWalletWithX() {
  if (!authEnabled) throw new Error("X sign-in is not available right now. Connect a wallet you already have.");
  markPending();
  const page = window.location.pathname;
  const back = new URL(page === "/" || page === "/desk" ? "/today" : page, window.location.origin);
  back.searchParams.set("x", "1");
  const preview = window.location.hostname.endsWith(".grok-sandbox.com");
  try {
    await signIn("grok-x", { callbackURL: `${back.pathname}${back.search}`, errorCallbackURL: "/today" });
  } catch (error) {
    clearPending();
    throw new Error(explainX(error));
  }
  if (!preview) {
    await new Promise((resolve) => window.setTimeout(resolve, 15000));
    throw new Error("X did not open. Allow this page to continue to X, then come back here.");
  }
  const address = await finishSmartWalletWithX();
  if (!address) throw new Error(lastXError || "X did not finish signing in. Nothing was created.");
  return address;
}

export async function finishSmartWalletWithX() {
  lastXError = "";
  if (!pendingX()) return null;
  const id = await waitForXSession(xReturn() ? 20 : 8);
  if (!id) {
    lastXError = "X did not finish signing in. Try again.";
    if (!xReturn()) clearPending();
    return null;
  }
  let result = await unlockSaved().catch((error: unknown) => ({ ok: false as const, error: explainX(error) }));
  if (!result?.ok) {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    result = await unlockSaved().catch((error: unknown) => ({ ok: false as const, error: explainX(error) }));
  }
  if (!result?.ok) {
    lastXError = "error" in result && result.error ? result.error : "The X wallet could not be opened.";
    return null;
  }
  clearPending();
  return hold(result.key, "x", "X wallet");
}

export function smartProvider(): Provider | null {
  if (!account) return null;
  const signer = account;
  const wallet = createWalletClient({ account: signer, chain: bsc, transport: http(RPC) });
  return {
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [signer.address];
      if (method === "eth_chainId") return "0x38";
      if (method === "wallet_switchEthereumChain" || method === "wallet_revokePermissions") return null;
      if (method === "eth_call") {
        const tx = (params?.[0] ?? {}) as { to?: Address; data?: Hex };
        const data = await publicClient.call({ to: tx.to, data: tx.data });
        return data.data ?? "0x";
      }
      if (method === "eth_getBalance") {
        const balance = await publicClient.getBalance({ address: signer.address });
        return `0x${balance.toString(16)}`;
      }
      if (method === "eth_getTransactionReceipt") {
        const hash = params?.[0] as Hex;
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash });
          return { status: receipt.status === "success" ? "0x1" : "0x0" };
        } catch {
          return null;
        }
      }
      if (method === "eth_sendTransaction") {
        const tx = (params?.[0] ?? {}) as { to?: Address; data?: Hex };
        if (!tx.to || !tx.data) throw new Error("The wallet did not send. Nothing was confirmed.");
        try {
          return await wallet.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/insufficient funds/i.test(message)) {
            throw new Error("This wallet needs a little BNB for the network fee. Nothing was sent.");
          }
          throw new Error("The wallet did not send. Nothing was confirmed.");
        }
      }
      throw new Error("The wallet did not send. Nothing was confirmed.");
    },
  };
}
