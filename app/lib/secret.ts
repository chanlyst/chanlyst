import { env } from "cloudflare:workers";

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function key() {
  const secret = (env as unknown as { INTEGRATION_ENCRYPTION_KEY?: string })
    .INTEGRATION_ENCRYPTION_KEY;
  if (!secret) throw new Error("integration_encryption_key_missing");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(value: string) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string) {
  if (!value) return "";
  const [iv, payload] = value.split(".");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await key(),
    base64ToBytes(payload),
  );
  return new TextDecoder().decode(decrypted);
}

export async function getIntegrationSecret(provider: string, workspaceId: string) {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) return "";
  const row = await database
    .prepare(
      `SELECT access_token as accessToken FROM workspace_integrations
       WHERE workspace_id=? AND provider=? AND status='connected'`,
    )
    .bind(workspaceId, provider)
    .first<{ accessToken?: string }>();
  return row?.accessToken ? decryptSecret(row.accessToken) : "";
}

export async function getIntegrationCredentials(
  provider: string,
  workspaceId: string,
) {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) return { accessToken: "", refreshToken: "" };
  const row = await database
    .prepare(
      `SELECT access_token as accessToken, refresh_token as refreshToken
       FROM workspace_integrations
       WHERE workspace_id=? AND provider=? AND status='connected'`,
    )
    .bind(workspaceId, provider)
    .first<{ accessToken?: string; refreshToken?: string }>();
  return {
    accessToken: row?.accessToken ? await decryptSecret(row.accessToken) : "",
    refreshToken: row?.refreshToken ? await decryptSecret(row.refreshToken) : "",
  };
}
