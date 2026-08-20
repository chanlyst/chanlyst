#!/bin/sh
# Chanlyst release: build, upload an immutable release, back up state,
# apply pending migrations, install systemd units, switch and restart.
#
# Run from the project root on the local machine:
#   sh deploy/release.sh              # full release
#   BASELINE=0015 sh deploy/release.sh  # first run with the new migration
#                                       # journal: mark 0000..0015 as applied
#   SKIP_TESTS=1 sh deploy/release.sh   # skip the local npm test gate
#
# Follows docs/OPERATIONS.md: backup before schema changes, immutable
# releases in /opt/chanlyst/releases/<commit>, current -> symlink switch.
# The Sites-repository publish (steps 12-13 of the runbook) stays manual.
set -eu

# Rollback targets to keep on disk besides the live one. Each release carries
# its own node_modules, so this is about a gigabyte apiece.
KEEP_RELEASES="${KEEP_RELEASES:-5}"

# The deploy target. No default in the repository: a public checkout must not
# carry somebody's production box, and a missing HOST should stop the script
# rather than send a release to whichever server was written here first.
#
# deploy/host.local is the operator's own copy — gitignored, sourced when it
# exists — so nobody has to retype the address on every release.
[ -f deploy/host.local ] && . ./deploy/host.local
HOST="${HOST:?set HOST=root@your-server, or put it in deploy/host.local}"
APP_ROOT=/opt/chanlyst
STATE_DIR=/var/lib/chanlyst
ENV_FILE=/etc/chanlyst/chanlyst.env
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/chanlyst}"

[ -z "$(git status --porcelain)" ] || {
  echo "working tree is dirty — commit first"; exit 1;
}
TAG=$(git rev-parse --short HEAD)
RELEASE="$APP_ROOT/releases/$TAG"
echo "==> releasing $TAG to $HOST"

if [ -z "${SKIP_TESTS:-}" ]; then
  echo "==> local gate: npm test"
  npm test
else
  echo "==> local gate skipped (SKIP_TESTS set); building only"
  npm run build
fi

# A release needs roughly 1 GB (its own node_modules). Finding that out
# halfway through `npm ci` leaves a half-installed release behind and a
# confusing failure: the deploy stops with no explanation on the box, while
# the service keeps serving the previous release. Check first, say so plainly.
echo "==> checking free disk space on the server"
ssh "$HOST" 'free_mb=$(df -Pm /opt | awk "NR==2 {print \$4}")
  echo "free: ${free_mb} MB"
  if [ "$free_mb" -lt 2048 ]; then
    echo "ABORT: need at least 2048 MB free for a release, have ${free_mb} MB."
    echo "Old releases are the usual cause:"
    du -sh /opt/chanlyst/releases 2>/dev/null
    echo "This deploy prunes to the newest few AFTER a successful switch;"
    echo "to reclaim space now, remove the oldest ones by hand."
    exit 1
  fi'

echo "==> uploading release"
ssh "$HOST" "mkdir -p '$RELEASE' '$STATE_DIR/backups'"
# node_modules без ведущего слэша: с ним правило привязано к корню передачи,
# и вложенные каталоги на сервер уезжали. video/node_modules — 577 МБ сборочных
# артефактов под macOS ARM, включая headless-браузер и кэш webpack: на Linux
# они бесполезны, а релиз из-за них весит 1,8 ГБ вместо 45 МБ и заливается
# сутки на медленном канале. Зависимости приложения ставит npm ci ниже.
rsync -a --delete \
  --exclude /.git --exclude node_modules --exclude .wrangler \
  --exclude /.next --exclude /outputs --exclude /work \
  --exclude /video/out \
  ./ "$HOST:$RELEASE/"
# A release can be launched from a mktemp-backed clean worktree whose root is
# deliberately 0700. rsync preserves that mode on the destination root, which
# prevents the unprivileged service account from entering its WorkingDirectory.
ssh "$HOST" "chmod 755 '$RELEASE'"
echo "==> installing dependencies on the server"
ssh "$HOST" "cd '$RELEASE' && npm ci --no-audit --no-fund"
# The systemd unit mount-namespaces these two writable dirs inside the
# release; they must exist and belong to the service user before start.
ssh "$HOST" "mkdir -p '$RELEASE/dist/server/.wrangler' '$RELEASE/node_modules/.mf' \
  && chown -R chanlyst:chanlyst '$RELEASE/dist/server/.wrangler' '$RELEASE/node_modules/.mf'"

echo "==> ensuring PUBLIC_BASE_URL in $ENV_FILE"
ssh "$HOST" "grep -q '^PUBLIC_BASE_URL=' '$ENV_FILE' \
  || echo 'PUBLIC_BASE_URL=https://chanlyst.com' >> '$ENV_FILE'"

echo "==> stopping service and timers"
ssh "$HOST" "systemctl stop chanlyst || true; \
  for t in chanlyst-agent chanlyst-outreach chanlyst-digest chanlyst-replies chanlyst-lifecycle chanlyst-watch chanlyst-pipeline; do \
    systemctl stop \$t.timer 2>/dev/null || true; done"

echo "==> backing up persistent state"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$STATE_DIR/backups/state-$TAG-$STAMP.tar.gz"
ssh "$HOST" "tar -C '$STATE_DIR' -czf '$BACKUP' state"

echo "==> applying pending migrations"
DB_REMOTE=$(ssh "$HOST" "find '$STATE_DIR/state/v3/d1/miniflare-D1DatabaseObject' \
  -name '*.sqlite' ! -name metadata.sqlite | head -1")
[ -n "$DB_REMOTE" ] || { echo "production DB file not found"; exit 1; }
BASELINE_ARG=""
[ -n "${BASELINE:-}" ] && BASELINE_ARG="--baseline $BASELINE"
ssh "$HOST" "cd '$RELEASE' && node deploy/apply-migrations.mjs \
  '$DB_REMOTE' ./drizzle $BASELINE_ARG"

echo "==> post-migration orphan check"
ssh "$HOST" "cd '$RELEASE' && node deploy/check-orphans.mjs '$DB_REMOTE'" | tail -3

# Guard against table rebuilds silently dropping columns that exist in the
# database but not in db/schema.ts (this bit us with migration 0020).
echo "==> post-migration column parity check vs backup"
ssh "$HOST" "rm -rf /tmp/release-column-check && mkdir -p /tmp/release-column-check \
  && tar -xzf '$BACKUP' -C /tmp/release-column-check \
  && OLD=\$(find /tmp/release-column-check -name '*.sqlite' ! -name metadata.sqlite | head -1) \
  && node '$RELEASE/deploy/diff-columns.mjs' \"\$OLD\" '$DB_REMOTE'; \
  rm -rf /tmp/release-column-check" | tee /dev/stderr | grep -q "MISSING" && {
    echo "COLUMN LOSS DETECTED — aborting before switching the release."; exit 1; } || true

echo "==> installing systemd units"
ssh "$HOST" "cp '$RELEASE'/deploy/chanlyst-agent.service \
  '$RELEASE'/deploy/chanlyst-agent.timer \
  '$RELEASE'/deploy/chanlyst-outreach.service \
  '$RELEASE'/deploy/chanlyst-outreach.timer \
  '$RELEASE'/deploy/chanlyst-digest.service \
  '$RELEASE'/deploy/chanlyst-digest.timer \
  '$RELEASE'/deploy/chanlyst-replies.service \
  '$RELEASE'/deploy/chanlyst-replies.timer \
  '$RELEASE'/deploy/chanlyst-lifecycle.service \
  '$RELEASE'/deploy/chanlyst-lifecycle.timer \
  '$RELEASE'/deploy/chanlyst-watch.service \
  '$RELEASE'/deploy/chanlyst-watch.timer \
  '$RELEASE'/deploy/chanlyst-pipeline.service \
  '$RELEASE'/deploy/chanlyst-pipeline.timer \
  /etc/systemd/system/ && systemctl daemon-reload"

echo "==> updating nginx config"
ssh "$HOST" "if [ -f '$NGINX_CONF' ]; then \
  cp '$RELEASE/deploy/chanlyst.production.nginx.conf' '$NGINX_CONF' \
  && nginx -t && systemctl reload nginx; \
  else echo 'WARN: $NGINX_CONF not found — update nginx manually'; fi"

echo "==> switching current release and starting"
ssh "$HOST" "ln -sfn '$RELEASE' '$APP_ROOT/current' && systemctl start chanlyst"
# Wrangler needs a while to boot; poll instead of a single is-active check
# (is-active returns non-zero while "activating", which would abort here).
echo "==> waiting for the app to answer (up to 120s)"
ssh "$HOST" 'for i in $(seq 1 24); do
  code=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/ 2>/dev/null || true)
  [ "$code" = "200" ] && { echo "local HTTP 200"; exit 0; }
  sleep 5
done
echo "app did not come up; recent logs:"; journalctl -u chanlyst -n 25 --no-pager; exit 1'
ssh "$HOST" "for t in chanlyst-agent chanlyst-outreach chanlyst-digest chanlyst-replies chanlyst-lifecycle chanlyst-watch chanlyst-pipeline; do \
  systemctl enable --now \$t.timer; done"

# Old releases exist for rollback, and 55 of them at ~1 GB each is what
# filled the disk and broke a deploy. Pruned only after the new release is
# live and answering, and never touching the one `current` points at.
echo "==> pruning old releases (keeping the newest $KEEP_RELEASES)"
ssh "$HOST" "APP_ROOT='$APP_ROOT' KEEP='$KEEP_RELEASES' sh -s" <<'PRUNE'
set -eu
cd "$APP_ROOT/releases"
current=$(basename "$(readlink -f "$APP_ROOT/current")")
# Without a readable current release there is no way to tell which directory
# must survive, and a wrong guess deletes the running one. Skip instead.
if [ -z "$current" ] || [ ! -d "$current" ]; then
  echo "  WARN: cannot resolve the live release, pruning skipped"
  exit 0
fi
ls -t | grep -vx "$current" | tail -n +"$KEEP" | while read -r old; do
  [ -n "$old" ] && [ -d "$old" ] || continue
  echo "  removing $old"
  rm -rf -- "$old"
done
echo "  kept $(ls | wc -l) releases, $(du -sh . | cut -f1) on disk"
PRUNE

echo "==> public check"
curl -fsS -o /dev/null -w "https://chanlyst.com -> %{http_code}\n" https://chanlyst.com || true

# Telling the engines the pages changed, now that the new release is the one
# they would fetch. Ran by hand before, which means it mostly did not run.
# Never fatal: a release that is live and answering is not a failed release
# because a third-party ping timed out.
echo "==> notifying IndexNow (Bing, Yandex, Seznam, Naver)"
node deploy/indexnow.mjs || echo "  WARN: IndexNow ping failed, the release is fine"
echo "==> done. Rollback: ssh $HOST 'ln -sfn $APP_ROOT/releases/<old> $APP_ROOT/current && systemctl restart chanlyst'"
echo "    Reminder: push the same commit to the Sites repository (runbook steps 12-13)."
