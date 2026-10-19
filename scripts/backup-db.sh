#!/usr/bin/env bash
set -euo pipefail
backup_dir="${1:-/opt/clipper/backups}"
mkdir -p "$backup_dir"
out="$backup_dir/clipper-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker exec clipper-db pg_dump -U clipper clipper | gzip -9 > "$out"
chmod 600 "$out"
echo "$out"
