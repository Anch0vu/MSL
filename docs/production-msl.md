# Moscow Student's League production

## Layout
- Git source: `/opt/cup-src` (branch `main`)
- Redesign worktree: `/opt/cup-worktrees/msl-redesign` (branch `feat/msl-redesign`)
- Live document root: `/var/www/cup`
- Runtime data: `/var/www/cup-data`
- Full pre-change backup: `/var/backups/msl-20261117T062324Z`

## Verify
```bash
cd /opt/cup-worktrees/msl-redesign
npm test
npm run build
bash scripts/smoke-msl.sh
```

## Deploy
```bash
bash /opt/cup-worktrees/msl-redesign/scripts/deploy-msl.sh
bash /opt/cup-worktrees/msl-redesign/scripts/smoke-msl.sh
```

## Roll back
Read the exact previous directory from `/var/www/.cup-last-rollback`, then:
```bash
prev="$(cat /var/www/.cup-last-rollback)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mv /var/www/cup "/var/www/.cup-bad-$stamp"
mv "$prev" /var/www/cup
```
Do not delete the bad deployment until the cause is known.
