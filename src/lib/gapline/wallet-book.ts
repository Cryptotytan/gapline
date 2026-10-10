import { disconnectSmart } from "./smart-wallet";
import { pinProvider, readCash } from "./wallet";

export type LinkedWallet = {
  address: string;
  name: string;
  kind: "external" | "email" | "x";
  image?: string;
};

export type InjectedWallet = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: EipProvider;
};

type EipProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isBinance?: boolean;
  isOkxWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
};

const KEY = "gapline.wallets.v1";
const ACTIVE = "gapline.active";
const DISMISSED = "gapline.dismissed";
const announced: InjectedWallet[] = [];
const providers = new Map<string, EipProvider>();

export const WALLET_CHOICES = [
  { id: "metamask", name: "MetaMask", rdns: "io.metamask", color: "#f6851b" },
  { id: "binance", name: "Binance Wallet", rdns: "com.binance.wallet", color: "#f3ba2f" },
  { id: "trust", name: "Trust Wallet", rdns: "com.trustwallet.app", color: "#0500ff" },
  { id: "okx", name: "OKX Wallet", rdns: "com.okx.wallet", color: "#bcff2f" },
  { id: "coinbase", name: "Coinbase Wallet", rdns: "com.coinbase.wallet", color: "#0052ff" },
  { id: "rabby", name: "Rabby", rdns: "io.rabby", color: "#8697ff" },
] as const;

export function markForName(name: string) {
  const key = name.toLowerCase();
  const hit = WALLET_CHOICES.find((item) => key.includes(item.id) || key.includes(item.name.toLowerCase().split(" ")[0]));
  return hit ? `/wallets/${hit.id}.svg` : "";
}

function readRaw(): LinkedWallet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as LinkedWallet[];
    return Array.isArray(parsed) ? parsed.filter((row) => typeof row?.address === "string") : [];
  } catch {
    return [];
  }
}

export function readActive() {
  try {
    return localStorage.getItem(ACTIVE);
  } catch {
    return null;
  }
}

export function setActive(address: string | null) {
  if (!address) localStorage.removeItem(ACTIVE);
  else localStorage.setItem(ACTIVE, address);
}

function dismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED) ?? "[]") as string[];
    return Array.isArray(parsed) ? parsed.map((item) => item.toLowerCase()) : [];
  } catch {
    return [];
  }
}

export function isDismissed(address: string) {
  return dismissed().includes(address.toLowerCase());
}

export function dismissWallet(address: string) {
  const next = dismissed().filter((item) => item !== address.toLowerCase());
  next.unshift(address.toLowerCase());
  localStorage.setItem(DISMISSED, JSON.stringify(next.slice(0, 16)));
}

export function undismissWallet(address: string) {
  localStorage.setItem(DISMISSED, JSON.stringify(dismissed().filter((item) => item !== address.toLowerCase())));
}

export function disconnectLinked(address: string) {
  dismissWallet(address);
  const wasActive = readActive()?.toLowerCase() === address.toLowerCase();
  forgetLinked(address);
  if (!wasActive) return { active: readActive(), changed: false };
  const fallback = readLinked()[0]?.address ?? null;
  setActive(fallback);
  return { active: fallback, changed: true };
}

export function readLinked() {
  return readRaw();
}

export function rememberLinked(wallet: LinkedWallet) {
  const rows = readRaw().filter((row) => row.address.toLowerCase() !== wallet.address.toLowerCase());
  rows.unshift(wallet);
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 8)));
  return readRaw();
}

export function forgetLinked(address: string) {
  const rows = readRaw().filter((row) => row.address.toLowerCase() !== address.toLowerCase());
  localStorage.setItem(KEY, JSON.stringify(rows));
  providers.delete(address.toLowerCase());
  return rows;
}

export function announcedWallets() {
  return announced.slice();
}

function rememberAnnounced(detail: { info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: EipProvider }) {
  const info = detail.info;
  if (!info?.uuid || !detail.provider) return;
  if (announced.some((item) => item.uuid === info.uuid)) return;
  announced.push({
    uuid: info.uuid,
    name: info.name || "Wallet",
    icon: info.icon || "",
    rdns: info.rdns || "",
    provider: detail.provider,
  });
  window.dispatchEvent(new Event("gapline:wallets"));
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    rememberAnnounced((event as CustomEvent).detail ?? {});
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function browserProvider(): EipProvider | null {
  return (window as unknown as { ethereum?: EipProvider }).ethereum ?? null;
}

function flagMatch(wallet: (typeof WALLET_CHOICES)[number], eth: EipProvider) {
  if (wallet.id === "rabby") return Boolean(eth.isRabby);
  if (wallet.id === "metamask") return Boolean(eth.isMetaMask && !eth.isRabby && !eth.isBraveWallet);
  if (wallet.id === "trust") return Boolean(eth.isTrust || eth.isTrustWallet);
  if (wallet.id === "binance") return Boolean(eth.isBinance);
  if (wallet.id === "okx") return Boolean(eth.isOkxWallet);
  if (wallet.id === "coinbase") return Boolean(eth.isCoinbaseWallet);
  return false;
}

export function providerForChoice(id: string) {
  const choice = WALLET_CHOICES.find((item) => item.id === id);
  if (!choice) return null;
  const found = announced.find((item) => item.rdns === choice.rdns || item.name.toLowerCase().includes(choice.name.toLowerCase().split(" ")[0].toLowerCase()));
  if (found) return found;
  const eth = browserProvider();
  if (eth && flagMatch(choice, eth)) return { uuid: choice.id, name: choice.name, icon: "", rdns: choice.rdns, provider: eth };
  return null;
}

export async function connectExternal(id: string) {
  const found = providerForChoice(id);
  const choice = WALLET_CHOICES.find((item) => item.id === id);
  if (!found || !choice) throw new Error(`${choice?.name ?? "That wallet"} is not installed in this browser.`);
  disconnectSmart();
  pinProvider(found.provider);
  const accounts = (await found.provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet did not share an address.");
  try {
    await found.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
  } catch {
    /* The next buy can switch the chain. */
  }
  providers.set(address.toLowerCase(), found.provider);
  const cash = await readCash(address).catch(() => 0);
  rememberLinked({ address, name: found.name || choice.name, kind: "external" });
  return { address, cash, name: found.name || choice.name };
}

export function pinSavedProvider(address: string) {
  const saved = providers.get(address.toLowerCase());
  pinProvider(saved ?? null);
}

export function openWalletPicker() {
  window.dispatchEvent(new Event("gapline:connect"));
}
