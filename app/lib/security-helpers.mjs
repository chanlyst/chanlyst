// Pure security helpers shared by API routes and unit tests.
// Kept as an .mjs module so tests/security-helpers.test.mjs can import it
// directly with `node --test` while TypeScript routes import it via allowJs.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Strip CR, LF and other control characters from a MIME header value.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeHeaderValue(value) {
  return String(value ?? "").replace(CONTROL_CHARS, " ").trim();
}

/**
 * Validate a single e-mail address.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEmail(value) {
  const email = String(value ?? "").trim();
  return email.length >= 5 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

/**
 * Encode a header value as RFC 2047 UTF-8 base64 when it contains non-ASCII.
 * @param {unknown} value
 * @returns {string}
 */
export function encodeMimeSubject(value) {
  const clean = sanitizeHeaderValue(value);
  if (/^[ -~]*$/.test(clean)) return clean;
  const bytes = new TextEncoder().encode(clean);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/**
 * @param {string} label
 * @returns {number | null}
 */
function numericLabelValue(label) {
  if (/^0x[0-9a-f]+$/i.test(label)) return Number.parseInt(label, 16);
  if (/^0\d+$/.test(label)) return Number.parseInt(label, 8);
  if (/^\d+$/.test(label)) return Number.parseInt(label, 10);
  return null;
}

/**
 * @param {number[]} parts
 * @returns {boolean}
 */
function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Parse a URL and reject anything that could reach private or link-local
 * infrastructure: non-HTTP protocols, IPv6 literals, cloud metadata hosts and
 * decimal/octal/hex IPv4 spellings of private ranges.
 * @param {unknown} value
 * @returns {URL | null}
 */
export function safePublicUrl(value) {
  try {
    const raw = String(value ?? "").trim();
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname.startsWith("[") || hostname.includes(":")) return null;
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal")) {
      return null;
    }
    if (/^\d+$/.test(hostname) || /^0x/i.test(hostname)) return null;
    const labels = hostname.split(".").filter(Boolean);
    const numeric = labels.map(numericLabelValue);
    if (numeric.every((part) => part !== null)) {
      const parts = /** @type {number[]} */ (numeric);
      if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) {
        return null;
      }
      if (isPrivateIpv4(parts)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Constant-time secret comparison: hashing both sides first makes the
 * byte-by-byte comparison independent of input length and content.
 * @param {unknown} left
 * @param {unknown} right
 * @returns {Promise<boolean>}
 */
export async function timingSafeEqualStrings(left, right) {
  const encoder = new TextEncoder();
  const [digestLeft, digestRight] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left ?? ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right ?? ""))),
  ]);
  const bytesLeft = new Uint8Array(digestLeft);
  const bytesRight = new Uint8Array(digestRight);
  let difference = 0;
  for (let index = 0; index < bytesLeft.length; index += 1) {
    difference |= bytesLeft[index] ^ bytesRight[index];
  }
  return difference === 0;
}

/**
 * Extract the client IP from trusted headers. The first x-forwarded-for entry
 * is attacker-controlled; only the last one is appended by our own proxy.
 * @param {Headers} headers
 * @returns {string}
 */
export function clientIpFromHeaders(headers) {
  const forwarded = (headers.get("x-forwarded-for") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    forwarded[forwarded.length - 1] ||
    "unknown"
  );
}
