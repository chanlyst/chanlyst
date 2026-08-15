// Produces the OWNER_PASSWORD_HASH value for self-hosted sign-in.
//
// Without this a self-hoster cannot get in at all: owner sign-in is the only
// path that needs no third-party OAuth, and it compares against a PBKDF2 hash
// that nothing in the project could produce. The format is the one
// verifyOwnerPassword() parses — pbkdf2$<iterations>$<salt>$<hash>, salt and
// hash base64, SHA-256, 256 bits.
//
//   node scripts/hash-password.mjs 'your password'
//
// The password is taken as an argument rather than read from a prompt so this
// works in a Dockerfile and in CI. That does put it in your shell history;
// prefix the command with a space if your shell is set to skip those.

const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/hash-password.mjs 'your password'");
  process.exit(1);
}

/** OWASP's floor for PBKDF2-SHA256 at the time of writing. */
const ITERATIONS = 600_000;

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const bits = new Uint8Array(
  await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt },
    key,
    256,
  ),
);

const base64 = (bytes) => Buffer.from(bytes).toString("base64");
console.log(`pbkdf2$${ITERATIONS}$${base64(salt)}$${base64(bits)}`);
