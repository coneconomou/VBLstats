#!/bin/bash
# macOS version of launch.ps1. install-mac.sh copies this into "VBL Stats.app" as its executable.
# Starts serve.js (unless already running), opens Chrome/Edge in --app mode with its own profile,
# and stops the server when that browser is quit. Falls back to the default browser (server then
# keeps running in the background until logout).

# PROJECT and NODE are written by install-mac.sh. Apps opened from Finder don't get the Terminal's
# PATH, so node has to be referenced by its full path.
source "$(dirname "$0")/../Resources/config.sh"

PROFILE_DIR="$HOME/Library/Application Support/VBLStats/browser"

fail() {
  osascript -e "display alert \"VBL Stats\" message \"$1\" as critical" >/dev/null 2>&1
  echo "$1" >&2
  exit 1
}

# True only if *our* server answers (serve.js /__vblstats), not just any program on the port.
is_ours() { [ "$(curl -s --max-time 2 "http://127.0.0.1:$1/__vblstats")" = "vblstats" ]; }
# Free = nothing accepts a connection there (bash's built-in /dev/tcp, no extra tools needed).
is_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT
trap 'exit 1' TERM INT HUP # so logout/Ctrl+C still runs cleanup

[ -x "$NODE" ] || fail "Can't find Node.js at $NODE. Reinstall Node, then run 'npm run install-app' again."

PORT=""
for p in $(seq 5199 5209); do
  if is_ours "$p"; then PORT=$p; break; fi # already running (app opened twice): reuse it
  is_free "$p" || continue                   # some other program has it: skip
  PORT=$p "$NODE" "$PROJECT/serve.js" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    is_ours "$p" && { PORT=$p; break; }
    kill -0 "$SERVER_PID" 2>/dev/null || break # server died
    sleep 0.2
  done
  [ -n "$PORT" ] || fail "The VBL Stats server didn't start. Try running 'npm start' in Terminal to see why."
  break
done
[ -n "$PORT" ] || fail "Ports 5199-5209 are all in use by other programs."
URL="http://localhost:$PORT/"

BROWSER="${VBLSTATS_BROWSER:-}" # optional override, e.g. to use Brave
if [ -z "$BROWSER" ]; then
  for b in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
           "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$b" ] && { BROWSER=$b; break; }
  done
fi

if [ -z "$BROWSER" ]; then
  open "$URL" # Safari etc: we can't tell when it's closed, so leave the server running
  SERVER_PID=""
  exit 0
fi

# Its own profile makes this a separate browser instance we can wait on. On a Mac, closing the
# window doesn't quit it: Cmd+Q does, and that's when the server stops.
"$BROWSER" --app="$URL" --user-data-dir="$PROFILE_DIR" --window-size=1400,900 \
  --no-first-run --no-default-browser-check --disable-sync >/dev/null 2>&1
