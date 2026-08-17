#!/bin/sh
# Builds the public tree for the open-source repository.
#
# The private repository keeps its history. The public one began with a single
# commit of the state at the time — the ordinary way to open a closed project,
# and the only one that does not require auditing every file that ever existed
# in 129 commits, since one missed line in an old commit is not something you
# can take back.
#
# Every release after that is an ordinary commit ON TOP of the public history.
# Not a fresh `git init` and a force push: that is how the second publication
# went out, and rewriting a public history breaks every clone and every fork —
# which is the entire point of publishing this way.
#
#   sh deploy/publish-oss.sh [target-dir]
#
# It never pushes and never touches the private repository. It rebuilds the
# tree inside the public clone, prints what it left out and what changed, and
# stops with the changes staged.
set -eu

TARGET="${1:-../chanlyst-public}"
REMOTE="https://github.com/chanlyst/chanlyst.git"

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
docs/launch-copy.md
video
.openai/hosting.json
public/a88066d1b4bcb7d09fc6981d264c74a5.txt
tests/guides.test.mjs"

# tests/guides.test.mjs parses docs/seo/keywords.json at the top of the module,
# so with that directory stripped the file cannot load at all and every test in
# it fails. It goes with the data it tests. The other two suites that touched
# internal files skip those individual cases instead, because the rest of what
# they cover applies to a self-hoster too.
#
# This mattered: a fresh clone of the published repository failed `npm test`
# three times, under a README promising the suite runs with no network and no
# keys. Nobody had run it.

echo "==> exporting tracked files to $TARGET"
# Everything except .git: the clone's history is what makes the next push an
# ordinary commit rather than a rewrite. Deleted files disappear from the tree
# and `git add -A` in the clone notices, so removals still travel.
if [ -d "$TARGET" ]; then
  find "$TARGET" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
else
  mkdir -p "$TARGET"
fi
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

if [ "$FOUND" = 0 ]; then
  echo "    clean"
else
  echo
  echo "STOPPING: fix the findings above, then run this again."
  exit 1
fi

echo
echo "==> tree ready: $TARGET"
# Excluding .git, which is the clone's own machinery and not part of what is
# published. Counting it turned 380 files into 904 the first time this ran.
echo "    files: $(find "$TARGET" -mindepth 1 -maxdepth 1 ! -name .git -exec find {} -type f \; | wc -l | tr -d ' ')"
echo

# The first publication started the public history with one commit. Every
# release after it is an ordinary commit ON TOP of that history — never a fresh
# `git init` and a force push, which is how the second publication went out.
# Rewriting a public history breaks every clone and every fork, and the whole
# point of the model this follows is that people clone it.
if [ ! -d "$TARGET/.git" ]; then
  echo "Not a clone of the public repository yet. Once, by hand:"
  echo "    git clone $REMOTE $TARGET.git && mv $TARGET.git/.git $TARGET/.git"
  echo "then run this again and it will commit on top."
  exit 0
fi

cd "$TARGET"
git add -A
if git diff --cached --quiet; then
  echo "==> nothing changed since the last publication"
  exit 0
fi
echo "==> what this release changes"
git diff --cached --stat | tail -12
echo
echo "Next, by hand, so nobody publishes by accident:"
echo "    cd $TARGET"
echo "    git commit -m '<what changed and why>'"
echo "    git push origin main"
echo
echo "    (gh supplies the credentials over HTTPS; no SSH key needed.)"
