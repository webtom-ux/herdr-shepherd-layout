#!/bin/sh
# Renders shepherd/preview.png from made-up data: a separate Herdr instance (its own
# HERDR_APP_HOME) runs the Shepherd mod with demo-head.js in place of the herdr data calls,
# so no real space, agent, path or name can show up. The screen must be unlocked, since a
# locked Mac draws no windows. Usage: tools/preview/make-preview.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
src="$repo/shepherd"
home=$(mktemp -d /tmp/shepherd-preview.XXXXXX)
trap 'kill "${pid:-}" 2>/dev/null || true; rm -rf "$home"' EXIT

mkdir -p "$home/layouts" "$home/mods/shepherd"
cp "$src/layouts/shepherd.json" "$src/layouts/shepherd.svg" "$home/layouts/"
cp "$src/mods/shepherd/mod.json" "$src/mods/shepherd/shepherd.svg" "$src/mods/shepherd/settings.svg" "$home/mods/shepherd/"
printf '{ "layout:shepherd": { "escape": "shepherd.escape", "cmd-enter": "shepherd.type" } }\n' > "$home/keys.json"
printf '{ "zoom": 1, "sounds": { "enabled": false }, "appearance": "dark" }\n' > "$home/settings.json"
printf '{ "state": "normal", "bounds": [80.0, 55.0, 1280.0, 820.0] }\n' > "$home/window.json"
# The mod without its herdr import, with the demo data put in before its first constant.
grep -v '^import {.*} from "herdr";$' "$src/mods/shepherd/main.js" |
  awk -v head="$here/demo-head.js" '/^const C = /&&!d{while((getline l<head)>0)print l; d=1} {print}' > "$home/mods/shepherd/main.js"

export HERDR_APP_HOME="$home"
herdr-app check "$home/mods/shepherd"
herdr-app >/dev/null 2>&1 &
pid=$!
i=0; until herdr-app status >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && { echo "Herdr did not start" >&2; exit 1; }; sleep 0.5; done
herdr-app do layout.switch --name shepherd >/dev/null
sleep 2; herdr-app do overlay.close >/dev/null 2>&1 || true
sleep 6
herdr-app shot "$src/preview.png"
# Without the grey system title bar (28 pt, 56 px on a Retina screen).
swift "$here/crop-top.swift" "$src/preview.png" 56
echo "wrote $src/preview.png"
