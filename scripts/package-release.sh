#!/bin/sh
# Package the cockpit as a release .app using ONLY macOS-native tooling
# (cargo, sips, iconutil, codesign) - no tauri-cli, no npm.
#
#   ./scripts/package-release.sh
#
# Output: dist/soma-cockpit.app (cockpit host + bundled soma runtime, icns
# icon, ad-hoc signed). For distribution beyond this machine: replace the
# ad-hoc signature with a Developer ID identity and notarize.
set -eu

C="$(cd "$(dirname "$0")/.." && pwd)"
APP="$C/dist/soma-cockpit.app"
SRC_ICON="$C/src-tauri/icons/icon.png"

# The soma runtime to embed. The cockpit host invokes this for every mutation
# (wrap/anchor and all policy-gated commands). Override with SOMA_RELEASE_BIN;
# the default expects a sibling soma checkout next to this repo.
SOMA_RELEASE_BIN="${SOMA_RELEASE_BIN:-$C/../soma/target/release/soma}"
if [ ! -x "$SOMA_RELEASE_BIN" ]; then
  echo "error: soma release binary not found/executable at $SOMA_RELEASE_BIN" >&2
  echo "       build it first: cargo build --release --manifest-path ../soma/Cargo.toml" >&2
  echo "       or set SOMA_RELEASE_BIN to point at your soma release binary." >&2
  exit 1
fi

echo "==> release build"
cargo build --release --manifest-path "$C/src-tauri/Cargo.toml"

echo "==> icns from $SRC_ICON"
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC_ICON" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$SRC_ICON" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
mkdir -p "$APP/Contents/Resources" "$APP/Contents/MacOS"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> bundle"
cat > "$APP/Contents/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>soma-cockpit</string>
  <key>CFBundleIdentifier</key><string>com.hyt.soma-cockpit</string>
  <key>CFBundleName</key><string>soma-cockpit</string>
  <key>CFBundleDisplayName</key><string>soma cockpit</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PL
cp "$C/src-tauri/target/release/soma-cockpit" "$APP/Contents/MacOS/soma-cockpit"

echo "==> embed soma runtime ($("$SOMA_RELEASE_BIN" version 2>/dev/null || echo '?'))"
cp "$SOMA_RELEASE_BIN" "$APP/Contents/MacOS/soma"
chmod +x "$APP/Contents/MacOS/soma"

echo "==> sign (ad-hoc)"
codesign --force --deep -s - "$APP"

SIZE="$(du -sh "$APP" | awk '{print $1}')"
echo "done: $APP ($SIZE)"
