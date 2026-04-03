#!/bin/sh
set -e

# Write only the env vars needed by the sync script (not auth secrets).
# crond on Alpine doesn't inherit the environment, so we persist a minimal
# subset — auth/TLS vars are intentionally excluded to limit exposure.
printenv | grep -E '^(ELASTIC_|MYLAR_|COMICVINE_|COVERS_DIR)' > /etc/sync.env
chmod 600 /etc/sync.env

# Write crontab
# Hourly fast sync
# Nightly full sync with ComicVine enrichment at 03:00
cat > /etc/crontabs/root << 'EOF'
0 * * * * . /etc/sync.env && cd /app && node dist/sync/sync-mylar-to-elastic.mjs >> /var/log/sync.log 2>&1
0 3 * * * . /etc/sync.env && cd /app && SYNC_ENRICH_COMICVINE=true node dist/sync/sync-mylar-to-elastic.mjs >> /var/log/sync.log 2>&1
EOF

# Start crond in the background (-f would block, we want it backgrounded)
crond -l 2 -L /var/log/crond.log

echo "Cron scheduler started. Sync runs hourly (fast) and nightly at 03:00 (full)."

# Start the Astro server in the foreground (PID 1)
exec node ./dist/server/entry.mjs
