import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PREVIEW_CLIENT_SECRET } from "@/lib/auth/preview";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getSql } from "@/lib/db";

type Row = { id: string; address: `0x${string}`; keyCipher: string };
type Opened = { ok: true; address: `0x${string}`; key: `0x${string}`; seal: string } | { ok: false; error: string };

const COOKIE = "__Host-gapline.xwallet";

function passkeys() {
  const env =
    process.env.GAPLINE_WALLET_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    process.env.GROK_AUTH_CLIENT_SECRET?.trim();
  const keys: Buffer[] = [];
  if (env) keys.push(createHash("sha256").update(env).digest());
  keys.push(createHash("sha256").update(`gapline-vault:${PREVIEW_CLIENT_SECRET}`).digest());
  return keys;
}

function secret() {
  return passkeys()[0] ?? null;
}

function encrypt(key: string) {
  const pass = secret();
  if (!pass) throw new Error("Wallet storage is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", pass, iv);
  const body = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

function decrypt(payload: string) {
  const [iv, tag, body] = payload.split(".");
  if (!iv || !tag || !body) throw new Error("The saved wallet could not be opened.");
  let last = "The saved X wallet could not be opened.";
  for (const pass of passkeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", pass, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8") as `0x${string}`;
    } catch (error) {
      last = error instanceof Error ? error.message : last;
    }
  }
  throw new Error(last);
}

function vaultPath() {
  return `${process.cwd()}/data/x-vault.json`;
}

function readRows(): Row[] {
  try {
    const parsed = JSON.parse(readFileSync(vaultPath(), "utf8")) as Row[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRows(rows: Row[]) {
  mkdirSync(`${process.cwd()}/data`, { recursive: true });
  writeFileSync(vaultPath(), JSON.stringify(rows), { mode: 0o600 });
}

function accountId(id: string) {
  return id.startsWith("x:") ? id : `x:${id}`;
}

function sealFor(row: Row) {
  return `${encodeURIComponent(row.id)}~${row.keyCipher}`;
}

function rowFromSeal(id: string, seal: string | null | undefined): Row | null {
  if (!seal) return null;
  const split = seal.indexOf("~");
  if (split <= 0) return null;
  const owner = decodeURIComponent(seal.slice(0, split));
  const keyId = accountId(id);
  if (owner !== keyId && owner !== id) return null;
  const keyCipher = seal.slice(split + 1);
  if (!keyCipher.includes(".")) return null;
  try {
    const key = decrypt(keyCipher);
    return { id: keyId, address: privateKeyToAccount(key).address, keyCipher };
  } catch {
    return null;
  }
}

async function readDb(id: string): Promise<Row | null> {
  try {
    const db = await getSql();
    const rows = await db<{ address: string; key_cipher: string }>`select address, key_cipher from smart_wallet where email = ${id}`;
    const row = rows[0];
    if (!row?.address?.startsWith("0x") || !row.key_cipher) return null;
    return { id, address: row.address as `0x${string}`, keyCipher: row.key_cipher };
  } catch {
    return null;
  }
}

async function writeDb(row: Row) {
  const db = await getSql();
  await db`insert into smart_wallet (email, address, key_cipher) values (${row.id}, ${row.address}, ${row.keyCipher}) on conflict (email) do nothing`;
}

function readFileRow(id: string): Row | null {
  return readRows().find((row) => row.id === id) ?? null;
}

function writeFileRow(row: Row) {
  const rows = readRows().filter((item) => item.id !== row.id);
  rows.push(row);
  writeRows(rows);
}

async function readCookie(id: string): Promise<Row | null> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    const raw = getCookie(COOKIE);
    if (!raw) return null;
    const split = raw.indexOf("~");
    if (split <= 0) return null;
    const owner = decodeURIComponent(raw.slice(0, split));
    const keyCipher = raw.slice(split + 1);
    if (owner !== id || !keyCipher.includes(".")) return null;
    const key = decrypt(keyCipher);
    return { id, address: privateKeyToAccount(key).address, keyCipher };
  } catch {
    return null;
  }
}

async function writeCookie(row: Row) {
  const { setCookie } = await import("@tanstack/react-start/server");
  setCookie(COOKIE, `${encodeURIComponent(row.id)}~${row.keyCipher}`, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 400,
  });
}

async function remember(row: Row) {
  const saved: string[] = [];
  try {
    await writeDb(row);
    saved.push("db");
  } catch {
    /* The cookie and the file are the fallback. */
  }
  try {
    await writeCookie(row);
    saved.push("cookie");
  } catch {
    /* Outside a request, or the response already started. */
  }
  try {
    writeFileRow(row);
    saved.push("file");
  } catch {
    /* The live site cannot write this file. */
  }
  return saved;
}

async function firstOpenable(rows: Array<Row | null>): Promise<Row | null> {
  for (const row of rows) {
    if (!row) continue;
    try {
      const key = decrypt(row.keyCipher);
      if (privateKeyToAccount(key).address.toLowerCase() === row.address.toLowerCase()) return row;
    } catch {
      /* Try the next copy. A stale file must not block a saved seal. */
    }
  }
  return null;
}

export async function openVault(id: string, clientSeal?: string | null): Promise<Opened> {
  const keyId = accountId(id);
  if (!secret()) return { ok: false, error: "Wallet storage is not configured." };
  const existing = await firstOpenable([
    await readDb(keyId),
    await readCookie(keyId),
    readFileRow(keyId),
    rowFromSeal(id, clientSeal),
  ]);
  if (existing) {
    const key = decrypt(existing.keyCipher);
    const row = { ...existing, id: keyId };
    await remember(row);
    return { ok: true, address: existing.address, key, seal: sealFor(row) };
  }
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  const row = { id: keyId, address, keyCipher: encrypt(key) };
  await remember(row);
  return { ok: true, address, key, seal: sealFor(row) };
}

export function sealKey(key: string) {
  return encrypt(key);
}

export function openKey(payload: string) {
  return decrypt(payload);
}

export async function importVault(id: string, address: `0x${string}`, key: `0x${string}`) {
  if (privateKeyToAccount(key).address.toLowerCase() !== address.toLowerCase()) {
    throw new Error("That key does not match the address.");
  }
  const saved = await remember({ id: accountId(id), address, keyCipher: encrypt(key) });
  if (!saved.length) throw new Error("The X wallet could not be saved.");
}
