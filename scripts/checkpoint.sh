#!/bin/sh
# Spremi vrh lanca pisma i sidri ga u Bitcoin preko OpenTimestampsa.
# Uporaba: scripts/checkpoint.sh https://instanca/<pismo> [mapa]
# Treba: curl, ots (pip install opentimestamps-client)
set -eu
URL="${1:?URL pisma}"
DIR="${2:-checkpoints}"
mkdir -p "$DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
for f in log.json signatures.json letter.json; do curl -fsS "$URL/$f" -o "$DIR/$TS-$f"; done
node "$(dirname "$0")/verify-log.mjs" "$URL"
cat "$DIR/$TS-log.json" "$DIR/$TS-signatures.json" "$DIR/$TS-letter.json" > "$DIR/$TS.bundle"
ots stamp "$DIR/$TS.bundle"
# Postojeće pečate nadogradi kad Bitcoin potvrdi (nekoliko sati kasnije).
for p in "$DIR"/*.ots; do ots upgrade "$p" 2>/dev/null || true; done
echo "pečat: $DIR/$TS.bundle.ots"
