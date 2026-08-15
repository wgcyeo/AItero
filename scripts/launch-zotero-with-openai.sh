#!/bin/sh
set -eu

ZOTERO_BIN="/Applications/Zotero.app/Contents/MacOS/zotero"

if ! command -v brew >/dev/null 2>&1 || ! brew list --cask zotero >/dev/null 2>&1; then
  echo "Homebrew cask 'zotero' is not installed. This launcher will not install another copy." >&2
  exit 3
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY must be set and non-empty." >&2
  exit 2
fi

if [ ! -x "$ZOTERO_BIN" ]; then
  echo "Homebrew-managed Zotero executable not found or not executable: $ZOTERO_BIN" >&2
  exit 3
fi

ZOTERO_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "/Applications/Zotero.app/Contents/Info.plist" 2>/dev/null || true)
case "$ZOTERO_VERSION" in
  9.0|9.0.*) ;;
  *)
    echo "AItero 0.2.1 requires Homebrew Zotero 9.0.x; found '${ZOTERO_VERSION:-unknown}'." >&2
    exit 3
    ;;
esac

if pgrep -x "zotero" >/dev/null 2>&1 || pgrep -f '/Zotero\.app/Contents/MacOS/(zotero|plugin-container)' >/dev/null 2>&1; then
  echo "Zotero is already running; quit it normally before using this launcher." >&2
  exit 4
fi

exec "$ZOTERO_BIN" "$@"
