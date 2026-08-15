#!/bin/sh
# Container entrypoint: check what is missing, say so plainly, migrate, start.
#
# The point of the checks is that a missing key should produce one clear line
# on startup, not a blank dashboard an hour later. Only one of them is fatal.
set -eu

fail=0

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "OPENROUTER_API_KEY is not set."
  echo "  This is the one key Chanlyst cannot run without: it analyses the"
  echo "  product, judges each channel and writes the outreach."
  echo "  Get one at https://openrouter.ai and put it in your .env"
  fail=1
fi

if [ -z "${OWNER_PASSWORD_HASH:-}" ]; then
  echo "OWNER_PASSWORD_HASH is not set — there would be no way to sign in."
  echo "  Generate one:  node scripts/hash-password.mjs 'your password'"
  fail=1
fi

[ "$fail" = 0 ] || exit 1

if [ -z "${SERPER_API_KEY:-}" ]; then
  echo "note: SERPER_API_KEY is not set."
  echo "  Chanlyst still works — the model searches the web itself — but a"
  echo "  broad run cost \$1.17 that way against \$0.05 with Serper, measured"
  echo "  on this codebase. Telegram channels, contact-page lookup and the"
  echo "  competitor gap need it. 2,500 free queries at https://serper.dev"
fi

if [ -z "${GOOGLE_AUTH_CLIENT_ID:-}" ]; then
  echo "note: no Google OAuth — messages are drafted and copied, not sent."
fi

# The database is a file the Workers runtime owns; migrations run against it
# directly. Doing it here means a fresh volume becomes a working install
# without anyone reading a migration guide.
DB=$(find .wrangler/state -path "*d1*" -name "*.sqlite" ! -name "metadata.sqlite" 2>/dev/null | head -1)
if [ -n "$DB" ]; then
  echo "==> applying migrations"
  node deploy/apply-migrations.mjs "$DB" ./drizzle || true
else
  echo "==> first start: the database is created on the first request"
fi

echo "==> Chanlyst on http://localhost:${PORT:-3000}"
exec npx wrangler dev --local --port "${PORT:-3000}" --ip 0.0.0.0
