# Tab Groups Manager

A Chrome extension with two features:

- **Window switcher** — press **⌘⇧K** (or click the toolbar icon) to get a
  list of your Chrome windows by name. Type part of a name to filter, use
  ↑/↓ to choose, and press Enter (or click) to switch. Esc closes.
  Windows are listed most recently used first; the current window is last.
- **Tab Groups Manager** — view and manage all your tab groups in one
  place. Open it with the "Open Tab Groups Manager" link at the bottom of
  the switcher.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and choose this `tab-groups` folder.
2. (Optional) Change the shortcut at `chrome://extensions/shortcuts`.

### Showing window names (macOS)

Chrome doesn't let extensions read the names you give windows with
**Window → Name Window…**, so the switcher gets them from a small helper
program that asks Chrome through AppleScript. Without it, the switcher
still works but shows each window's current tab title.

1. Copy the extension's ID from its card at `chrome://extensions`.
2. Run:

   ```bash
   native-host/install.sh <extension-id>
   ```

3. Open the switcher. macOS asks for permission to control Google Chrome
   the first time — allow it. The prompt closes the switcher, so press
   ⌘⇧K again; names appear from then on. (To change it later: System
   Settings → Privacy & Security → Automation.)

If you move this folder, the extension's ID changes: reload it and rerun
`install.sh` with the new ID. To remove the helper, run
`native-host/uninstall.sh`.

## Development

Run the unit tests (Node 22+):

```bash
npm test
```

Check the helper directly (Chrome must be running):

```bash
node test/host-client.mjs native-host/window-names
```
