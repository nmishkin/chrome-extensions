#!/bin/bash
# Installs the native messaging host that lets the window switcher show
# Chrome's window names. Usage: ./install.sh <extension-id>
# The extension ID is shown on the extension's card at chrome://extensions.
# Rerun if the extension folder moves (the unpacked extension's ID changes).
set -euo pipefail

HOST_NAME="com.mishkin.window_switcher"

if [[ $# -ne 1 || ! "$1" =~ ^[a-p]{32}$ ]]; then
  echo "usage: $0 <extension-id>   (32 letters a-p, from chrome://extensions)" >&2
  exit 1
fi
EXTENSION_ID="$1"

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$DIR/window-names"
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

chmod +x "$HOST_PATH"
mkdir -p "$TARGET_DIR"
# Fill in the template via JSON so any characters in the path are escaped
# correctly (sed would mangle &, |, \ and ").
osascript -l JavaScript - "$DIR/$HOST_NAME.json" "$HOST_PATH" "$EXTENSION_ID" \
  > "$TARGET_DIR/$HOST_NAME.json" <<'EOF'
ObjC.import('Foundation');
function run([templatePath, hostPath, extensionId]) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(
    templatePath, $.NSUTF8StringEncoding, null).js;
  const manifest = JSON.parse(text);
  manifest.path = hostPath;
  manifest.allowed_origins = [`chrome-extension://${extensionId}/`];
  return JSON.stringify(manifest, null, 2);
}
EOF

echo "Installed $TARGET_DIR/$HOST_NAME.json"
echo "  host:      $HOST_PATH"
echo "  extension: $EXTENSION_ID"
