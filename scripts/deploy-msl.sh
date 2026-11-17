#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SRC="${1:-$SCRIPT_DIR/../dist}"
LIVE="/var/www/cup"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NEXT="/var/www/.cup-next-$STAMP"
PREV="/var/www/.cup-prev-$STAMP"
[[ -s "$SRC/index.html" ]] || { echo "missing build: $SRC/index.html" >&2; exit 2; }
[[ -d "$LIVE/api" ]] || { echo "missing live API" >&2; exit 2; }
mkdir -p "$NEXT"
cp -a "$SRC/." "$NEXT/"
for keep in api data obs; do
  [[ -e "$LIVE/$keep" ]] && cp -a "$LIVE/$keep" "$NEXT/$keep"
done
chown -R www-data:www-data "$NEXT"
chmod -R u=rwX,g=rX,o=rX "$NEXT"
mv "$LIVE" "$PREV"
if ! mv "$NEXT" "$LIVE"; then
  mv "$PREV" "$LIVE"
  exit 1
fi
echo "$PREV" > /var/www/.cup-last-rollback
echo "deployed=$LIVE"
echo "rollback=$PREV"
