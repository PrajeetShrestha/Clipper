#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
exec 9>/run/lock/clipper-deploy.lock
flock -n 9 || { echo 'A Clipper deployment is already running'; exit 1; }
expected="${SSH_ORIGINAL_COMMAND:-}"
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a commit SHA'; exit 1; }
cd /opt/clipper
test "$(git branch --show-current)" = main
git diff --quiet && git diff --cached --quiet || { echo 'Tracked local changes; refusing deploy'; exit 1; }
export GIT_SSH_COMMAND='ssh -i /root/.ssh/clipper_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes'
git fetch --quiet origin main
actual="$(git rev-parse origin/main)"
test "$actual" = "$expected" || { echo 'Commit is no longer main HEAD'; exit 1; }
git merge-base --is-ancestor HEAD origin/main || { echo 'Non-fast-forward update refused'; exit 1; }
if test "$(git rev-parse HEAD)" != "$actual"; then
  bash scripts/backup-db.sh >/dev/null
  git merge --ff-only origin/main
fi
npm ci --no-audit --no-fund
npm run typecheck
npm run build
./node_modules/.bin/prisma migrate deploy
install -m 0644 deploy/clipper-ai.service /etc/systemd/system/clipper-ai.service
install -m 0644 deploy/clipper-worker.service /etc/systemd/system/clipper-worker.service
systemctl daemon-reload
systemctl enable --now clipper-ai
systemctl restart clipper-ai clipper-worker clipper-web
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error http://127.0.0.1:3120/api/health >/dev/null; then
    echo "Clipper deployed: $actual"
    exit 0
  fi
  sleep 2
done
echo 'Clipper did not become healthy' >&2
journalctl -u clipper-web -u clipper-worker -n 30 --no-pager >&2
exit 1
