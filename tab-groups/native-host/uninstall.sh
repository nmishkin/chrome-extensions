#!/bin/bash
# Removes the window switcher's native messaging host manifest.
set -euo pipefail

MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mishkin.window_switcher.json"

rm -f "$MANIFEST"
echo "Removed $MANIFEST"
