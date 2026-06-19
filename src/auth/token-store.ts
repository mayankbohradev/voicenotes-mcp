/**
 * Secure persistence for the OAuth token set and the dynamically-registered
 * client credentials.
 *
 * Storage priority (PRD requirement — NEVER plaintext):
 *   1. OS keychain via keytar (macOS Keychain / libsecret / Credential Vault)
 *   2. Fallback: AES-256-GCM encrypted file at ~/.voicenotes-mcp/, with the key
 *      derived (scrypt) from machine+user identifiers so the blob is bound to
 *      this account and tamper-evident.
 *
 * keytar is imported dynamically: if its native binding failed to install, we
 * degrade to the encrypted file instead of crashing the whole server at import.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { hostname, userInfo } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";

const SERVICE = "voicenotes-mcp";
const ACCOUNT_TOKEN = "token";
const ACCOUNT_CLIENT = "client";

const DIR = join(homedir(), ".voicenotes-mcp");
const TOKEN_FILE = join(DIR, "token.enc");
const CLIENT_FILE = join(DIR, "client.enc");

/** The OAuth token set we persist between runs. */
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  /** Absolute epoch-ms expiry (computed from expires_in at save time). */
  expires_at?: number;
  scope?: string;
}

/** Credentials issued by Dynamic Client Registration. */
export interface ClientRegistration {
  client_id: string;
  /** Present only if the AS issued a confidential client (we request "none"). */
  client_secret?: string;
}

// ---- keytar (optional native dependency) ---------------------------------

type Keytar = typeof import("keytar");
let keytarPromise: Promise<Keytar | null> | undefined;

async function getKeytar(): Promise<Keytar | null> {
  if (!keytarPromise) {
    keytarPromise = import("keytar")
      .then((m) => (m.default ?? m) as Keytar)
      .catch(() => {
        // Native binding unavailable — silently fall back to encrypted file.
        return null;
      });
  }
  return keytarPromise;
}

// ---- encrypted-file fallback ---------------------------------------------

/** Derive a machine+user-bound 32-byte key. NOT a substitute for keytar — a
 *  defense-in-depth measure so the fallback file is never plaintext. */
function fileKey(): Buffer {
  const material = `${SERVICE}:${hostname()}:${userInfo().username}`;
  // Fixed salt is acceptable here: the secret is the machine/user binding, and
  // this only protects the *fallback* path when the OS keychain is unavailable.
  return scryptSync(material, "voicenotes-mcp.salt.v1", 32);
}

function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fileKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [12B iv][16B tag][ciphertext]
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", fileKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function writeEncrypted(file: string, value: string): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, encrypt(value), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
}

function readEncrypted(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    return decrypt(readFileSync(file));
  } catch {
    // Tampered, corrupt, or copied from another machine — treat as absent.
    return null;
  }
}

// ---- public API ----------------------------------------------------------

async function save(account: string, file: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE, account, json);
    return;
  }
  writeEncrypted(file, json);
}

async function load<T>(account: string, file: string): Promise<T | null> {
  const keytar = await getKeytar();
  if (keytar) {
    const raw = await keytar.getPassword(SERVICE, account);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  const raw = readEncrypted(file);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function remove(account: string, file: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE, account).catch(() => undefined);
  }
  if (existsSync(file)) rmSync(file, { force: true });
}

export const tokenStore = {
  saveToken: (t: TokenSet) => save(ACCOUNT_TOKEN, TOKEN_FILE, t),
  getToken: () => load<TokenSet>(ACCOUNT_TOKEN, TOKEN_FILE),
  clearToken: () => remove(ACCOUNT_TOKEN, TOKEN_FILE),

  saveClient: (c: ClientRegistration) => save(ACCOUNT_CLIENT, CLIENT_FILE, c),
  getClient: () => load<ClientRegistration>(ACCOUNT_CLIENT, CLIENT_FILE),
  clearClient: () => remove(ACCOUNT_CLIENT, CLIENT_FILE),
};
