#!/bin/sh
# Builds the public tree for the open-source repository.
#
# The private repository keeps its history; the public one starts from a single
# commit of the current state. That is the ordinary way to open an existing
# closed project, and it is the only one that does not require auditing every
# file that ever existed in 129 commits — one missed line in an old commit is
# not something you can take back.
#
# It is a script rather than a one-off because publishing is not a one-off:
# the model this follows treats every release as an event, so this will run
# again every time there is something to announce.
#
#   sh deploy/publish-oss.sh [target-dir]
#
# It never pushes and never touches the private repository. It writes a tree,
# prints what it left out, and stops.
set -eu

TARGET="${1:-../chanlyst-public}"

# Internal notes and internal tools: plan margins, product decisions, the
# roadmap, the operations runbook, and the one-off measurement scripts that
# still carry the absolute paths of the machine they were run on. Useful to us,
# and a gift to a competitor. scripts/hash-password.mjs stays — the README
# tells a self-hoster to run it before their first sign-in.
#
# Two more that are not secret but are ours: the hosting project id of the
# original deployment, and the file a search engine fetches to prove chanlyst.com
# belongs to us. Neither does anything on somebody else's server.
# OPERATIONS.md is the runbook for OUR server — the release procedure, the
# local checkout path, the owner's address. A self-hoster needs none of it and
# the README covers what they do need.
INTERNAL_DOCS="docs/OPERATIONS.md
docs/PRODUCT_AUDIT_2026-08-12.md
docs/PROJECT_STATUS.md
docs/ROADMAP.md
docs/PRAVKI-2026-08-01.md
docs/SEO-CORE.md
docs/TELEGRAM-SOURCE-2026-08-13.md
docs/seo
design-qa.md
scripts/measure-discovery.mjs
scripts/measure-enrichment.mjs
scripts/gumroad-subscribe.sh
.openai/hosting.json
public/a88066d1b4bcb7d09fc6981d264c74a5.txt"

echo "==> exporting tracked files to $TARGET"
rm -rf "$TARGET"
mkdir -p "$TARGET"
# Tracked files only: anything gitignored — .dev.vars, deploy/host.local, the
# build output — is excluded by construction rather than by a list I maintain.
git archive HEAD | tar -x -C "$TARGET"

echo "==> removing internal notes"
for path in $INTERNAL_DOCS; do
  if [ -e "$TARGET/$path" ]; then
    rm -rf "$TARGET/$path"
    echo "    $path"
  fi
done

echo "==> checking the result for things that must never ship"
FOUND=0

# A server address, excluding the ranges RFC 5737 reserves for documentation:
# 192.0.2.x, 198.51.100.x and 203.0.113.x exist precisely so an example can
# show a real shape without naming a real machine, and the README needs that.
#
# Written as two plain greps rather than one clever pipeline. The clever
# version silently matched nothing, which is the worst possible state for a
# check like this: it reported "clean" over a planted address AND a planted
# private key.
HOSTS=$(grep -rInE "root@[0-9]{1,3}(\.[0-9]{1,3}){3}" "$TARGET" 2>/dev/null \
  | grep -vE "root@(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)" || true)
if [ -n "$HOSTS" ]; then
  echo "$HOSTS" | sed "s|^|    |"
  echo "    ^ a server address — fix before publishing"
  FOUND=1
fi

KEYS=$(grep -rIln "BEGIN [A-Z ]*PRIVATE KEY" "$TARGET" 2>/dev/null || true)
if [ -n "$KEYS" ]; then
  echo "$KEYS" | sed "s|^|    |"
  echo "    ^ a private key — fix before publishing"
  FOUND=1
fi

for name in OPENROUTER_API_KEY SERPER_API_KEY GOOGLE_AUTH_CLIENT_SECRET; do
  # The name may appear — it is a documented variable. A value after it may not.
  VALUES=$(grep -rIn -- "$name=[^[:space:]\"]" "$TARGET" 2>/dev/null \
    | grep -v "example" | grep -v "\.md:" || true)
  if [ -n "$VALUES" ]; then
    echo "$VALUES" | sed "s|^|    |"
    echo "    ^ $name looks populated — fix before publishing"
    FOUND=1
  fi
done

[ "$FOUND" = 0 ] && echo "    clean"

echo
echo "==> tree ready: $TARGET"
echo "    files: $(find "$TARGET" -type f | wc -l | tr -d ' ')"
echo
echo "Next, by hand, so nobody publishes by accident:"
echo "    cd $TARGET"
echo "    git init -b main && git add -A"
echo "    git commit -m 'Chanlyst'"
echo "    git remote add origin https://github.com/chanlyst/chanlyst.git"
echo "    git push -u origin main"
echo
# HTTPS rather than SSH: gh is signed in over HTTPS on this machine and hands
# git the credentials, so nothing has to be set up first. The SSH line that
# used to print here assumed a key GitHub had never been given.
echo "    (gh supplies the credentials over HTTPS; no SSH key needed.)"
