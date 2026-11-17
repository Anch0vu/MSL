#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-https://cup.rut-miit.su}"
CURL=(curl --noproxy '*' -fsS --max-time 20)
if [[ "$BASE" == "https://cup.rut-miit.su" ]]; then CURL+=(--resolve cup.rut-miit.su:443:127.0.0.1); fi
html="$("${CURL[@]}" "$BASE/")"
grep -q "Moscow Student's League" <<<"$html"
for path in / /index.html /sw.js /manifest.webmanifest; do
  cache_control="$("${CURL[@]}" -I "$BASE$path" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print tolower($2)}' | head -1)"
  [[ "$cache_control" == *no-store* ]]
done
sw="$("${CURL[@]}" "$BASE/sw.js")"
grep -q "cup-msl-v1-20261117" <<<"$sw"
api="$("${CURL[@]}" "$BASE/api/?r=db")"
grep -q '"teams"' <<<"$api"
grep -q '"tournaments"' <<<"$api"
"${CURL[@]}" -o /dev/null "$BASE/manifest.webmanifest"
ctype="$("${CURL[@]}" -I "$BASE/brand/msl-current.jpg" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' | head -1)"
[[ "$ctype" == image/jpeg* ]]
assets=$(grep -oE '/assets/[^" ]+' <<<"$html" | sort -u)
[[ -n "$assets" ]]
while IFS= read -r asset; do "${CURL[@]}" -o /dev/null "$BASE$asset"; done <<<"$assets"
echo "smoke: ok ($BASE)"
