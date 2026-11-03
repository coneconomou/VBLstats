#!/bin/bash
# Creates "VBL Stats.app" in ~/Applications (shows in Launchpad/Spotlight) and on the Desktop as an alias.
# Usage: npm run install-app   (runs this with the current Node's path). Re-run if the project folder moves.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(dirname "$HERE")"
NODE="${1:-$(command -v node)}"
APP="$HOME/Applications/VBL Stats.app"

[ -n "$NODE" ] || { echo "Node.js not found. Install it from https://nodejs.org and try again."; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$HERE/mac-launcher.sh" "$APP/Contents/MacOS/VBL Stats"
chmod +x "$APP/Contents/MacOS/VBL Stats"
# %q quoting so paths with spaces or odd characters survive being sourced.
printf 'PROJECT=%q\nNODE=%q\n' "$PROJECT" "$NODE" > "$APP/Contents/Resources/config.sh"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>VBL Stats</string>
  <key>CFBundleDisplayName</key><string>VBL Stats</string>
  <key>CFBundleIdentifier</key><string>local.vblstats.launcher</string>
  <key>CFBundleExecutable</key><string>VBL Stats</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <!-- The launcher is a script with no window of its own; the browser window is the app. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# Basketball icon from app/icon.png (256px). Not fatal if it fails: the app just gets a generic icon.
build_icon() {
  local iconset="$1/icon.iconset" s
  mkdir -p "$iconset"
  for s in 16 32 64 128 256; do
    sips -z $s $s "$HERE/icon.png" --out "$iconset/icon_${s}x${s}.png" >/dev/null || return 1
    sips -z $((s * 2)) $((s * 2)) "$HERE/icon.png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null || return 1
  done
  iconutil -c icns "$iconset" -o "$APP/Contents/Resources/icon.icns"
}
TMP="$(mktemp -d)"
build_icon "$TMP" || echo "(Couldn't build the icon; the app will use a default one.)"
rm -rf "$TMP"

# Files unzipped from a download carry macOS's quarantine flag, and cp copies it onto the app,
# which makes Gatekeeper refuse to open it. This app was built on this Mac, so clear it.
xattr -cr "$APP" 2>/dev/null || true

# Desktop alias, so there's something to double-click straight away.
ln -sfn "$APP" "$HOME/Desktop/VBL Stats"
touch "$APP" # nudge Finder to pick up the icon

echo "Created $APP"
echo "Created Desktop shortcut: ~/Desktop/VBL Stats"
echo "Double-click it to open VBL Stats (Chrome or Edge gives the best app window). Quit with Cmd+Q."
