import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openKey, sealKey } from "./wallet-vault.server";
import { getSql } from "@/lib/db";

const FILE = `${process.cwd()}/data/smart-wallets.json`;
const PEPPER = "gapline-email-code-v1";

type Row = { email: string; address: string; key: `0x${string}` };
type CodeRow = { email: string; codeHash: string; expiresAt: number; attempts: number };
type FileShape = { wallets: { email: string; address: string; keyCipher: string }[]; codes: CodeRow[] };

function loadFile(): FileShape {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as FileShape;
    return { wallets: parsed.wallets ?? [], codes: parsed.codes ?? [] };
  } catch {
    return { wallets: [], codes: [] };
  }
}

function saveFile(data: FileShape) {
  try {
    mkdirSync(`${process.cwd()}/data`, { recursive: true });
    writeFileSync(FILE, JSON.stringify(data), { mode: 0o600 });
  } catch {
    /* The database copy is the one that survives a deploy. */
  }
}

function encrypt(key: string) {
  return sealKey(key);
}

function decrypt(payload: string) {
  return openKey(payload);
}

function hashCode(email: string, code: string) {
  return createHash("sha256").update(`${PEPPER}:${email}:${code}`).digest("hex");
}

function same(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sql() {
  try {
    return await getSql();
  } catch {
    return null;
  }
}

async function readWallet(email: string): Promise<Row | null> {
  const db = await sql();
  if (db) {
    try {
      const rows = await db<{ address: string; key_cipher: string }>`select address, key_cipher from smart_wallet where email = ${email}`;
      const row = rows[0];
      if (row) return { email, address: row.address, key: decrypt(row.key_cipher) };
    } catch {
      /* Fall through to the file copy. */
    }
  }
  const found = loadFile().wallets.find((row) => row.email === email);
  if (!found) return null;
  return { email, address: found.address, key: decrypt(found.keyCipher) };
}

async function writeWallet(row: Row) {
  const keyCipher = encrypt(row.key);
  const db = await sql();
  if (db) {
    try {
      await db`insert into smart_wallet (email, address, key_cipher) values (${row.email}, ${row.address}, ${keyCipher}) on conflict (email) do nothing`;
    } catch {
      /* The file copy still keeps it. */
    }
  }
  const data = loadFile();
  if (!data.wallets.some((item) => item.email === row.email)) {
    data.wallets.push({ email: row.email, address: row.address, keyCipher });
    saveFile(data);
  }
}

async function readCode(email: string) {
  const db = await sql();
  if (db) {
    try {
      const rows = await db<{ code_hash: string; expires_at: string | Date; attempts: number }>`select code_hash, expires_at, attempts from email_code where email = ${email}`;
      const row = rows[0];
      if (row) {
        return {
          email,
          codeHash: row.code_hash,
          expiresAt: new Date(row.expires_at).getTime(),
          attempts: Number(row.attempts),
        } satisfies CodeRow;
      }
    } catch {
      /* Fall through to the file copy. */
    }
  }
  return loadFile().codes.find((row) => row.email === email) ?? null;
}

async function writeCode(row: CodeRow) {
  const db = await sql();
  if (db) {
    try {
      await db`insert into email_code (email, code_hash, expires_at, attempts) values (${row.email}, ${row.codeHash}, ${new Date(row.expiresAt).toISOString()}, ${row.attempts}) on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = excluded.attempts`;
    } catch {
      /* The file copy still keeps it. */
    }
  }
  const data = loadFile();
  data.codes = data.codes.filter((item) => item.email !== row.email && item.expiresAt > Date.now());
  data.codes.push(row);
  saveFile(data);
}

function mailConfigured() {
  if (process.env.RESEND_API_KEY?.trim()) return true;
  try {
    const saved = JSON.parse(readFileSync(`${process.cwd()}/.secrets/email.json`, "utf8")) as { apiKey?: string };
    return Boolean(saved.apiKey?.trim());
  } catch {
    return false;
  }
}

async function sendMail(email: string, code: string) {
  let apiKey = process.env.RESEND_API_KEY?.trim();
  let from = process.env.EMAIL_FROM?.trim() || "Gapline <onboarding@resend.dev>";
  if (!apiKey) {
    try {
      const saved = JSON.parse(readFileSync(`${process.cwd()}/.secrets/email.json`, "utf8")) as { apiKey?: string; from?: string };
      apiKey = saved.apiKey?.trim();
      if (saved.from?.trim()) from = saved.from.trim();
    } catch {
      apiKey = undefined;
    }
  }
  if (!apiKey) return { ok: false as const, error: "A code could not be sent. Email delivery is not set up yet." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Gapline code",
      text: `Your Gapline code is ${code}. It expires in 10 minutes. If you did not ask for a wallet, ignore this email.`,
    }),
  });
  if (!res.ok) return { ok: false as const, error: "The code could not be sent to that email. Try again." };
  return { ok: true as const };
}

export async function sendCode(email: string) {
  if (!mailConfigured()) return { ok: false as const, error: "A code could not be sent. Email delivery is not set up yet." };
  const existing = await readCode(email);
  if (existing && existing.expiresAt - Date.now() > 9 * 60 * 1000) {
    return { ok: false as const, error: "A code was just sent. Wait a minute before asking for another." };
  }
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const mailed = await sendMail(email, code);
  if (!mailed.ok) return mailed;
  await writeCode({ email, codeHash: hashCode(email, code), expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
  return { ok: true as const };
}

export async function confirmCode(email: string, code: string) {
  const pending = await readCode(email);
  if (!pending || pending.expiresAt < Date.now()) return { ok: false as const, error: "That code expired. Ask for a new one." };
  if (pending.attempts >= 5) return { ok: false as const, error: "Too many tries. Ask for a new code." };
  if (!same(pending.codeHash, hashCode(email, code.trim()))) {
    await writeCode({ ...pending, attempts: pending.attempts + 1 });
    return { ok: false as const, error: "That code is wrong." };
  }
  const current = await readWallet(email);
  if (current) return { ok: true as const, address: current.address };
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  await writeWallet({ email, address, key });
  const saved = await readWallet(email);
  if (!saved) return { ok: false as const, error: "The wallet could not be saved." };
  return { ok: true as const, address: saved.address };
}
