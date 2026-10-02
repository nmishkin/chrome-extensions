# Window Switcher — Design

Date: 2026-10-02
Status: Draft, awaiting review

## Goal

Press a keyboard shortcut, see a list of open Chrome windows by name, and
switch to one by picking it or by typing part of its name.

"Name" means the name set with Chrome's own **Name window…** command. Windows
without one are shown by their active tab's title — the same label Chrome
itself uses.

## Key constraint and how it's resolved

The `chrome.windows` extension API does not expose window names. A spike on
2026-10-02 confirmed:

- AppleScript can read them: each Chrome window has `given name` (the
  user-set name, empty if unset) and `name` (the given name, or the active
  tab's title if unset). `name` is exactly the label we want.
- AppleScript window `id` equals the extension API's `windows.Window.id`
  (checked by comparing the two lists by hand). Windows can therefore be paired
  exactly by ID; no heuristics are needed.
- Window bounds are useless for matching (most windows are maximized and
  share bounds).

So the extension uses a **native messaging host** that runs AppleScript to
fetch names. macOS only.

## User experience

- Default shortcut **⌘⇧K** (changeable at `chrome://extensions/shortcuts`)
  opens the extension's toolbar popup.
- Popup: a search box (focused) above a list of windows. Each row shows the
  window's name and its tab count.
- Order: most recently focused first, so Enter immediately switches back to
  the previous window. The current window is listed last and dimmed.
- Typing filters the list: case-insensitive substring match on the name.
  Names that *start with* the query sort ahead of other matches (MRU order
  within each group).
- The first visible row is always highlighted. ↑/↓ move the highlight.
  Enter or click switches to the highlighted window and closes the popup.
  Esc closes the popup.
- Empty filter result shows "No matching windows".
- Footer link "Open Tab Groups Manager" opens `manager.html` in a new tab
  (what the old popup's only button did).
- Clicking the toolbar icon opens the same popup.

## Components

The switcher is added to the existing **`tab-groups/`** extension rather
than shipped as a new one. Its popup is currently a single button that opens
the manager, and its background worker is empty, so the switcher takes over
both. `manager.html` / `manager.js` are unchanged.

### `manifest.json` (modified)
- Add permission `nativeMessaging` (already has `tabs`, `tabGroups`,
  `storage`).
- `action.default_popup` stays `popup.html`; update `default_title`.
- Add `commands._execute_action` with
  `suggested_key.mac: "Command+Shift+K"`.
- **No fixed `key`.** Adding one would change the extension's existing ID,
  and Chrome would drop the manager's `groupWindowOrigins` data in
  `chrome.storage.local`. An unpacked extension's ID is derived from its
  folder path, so it is already stable while the folder stays put. The
  installer takes the ID as an argument instead (see `native-host/`).

### `background.js` (replaced)
- Listens to `chrome.windows.onFocusChanged` and `onRemoved`. Keeps a
  most-recently-used list of window IDs in `chrome.storage.session` (ignores
  `WINDOW_ID_NONE`).
- Nothing else.

### `popup.html` / `popup.js` (replaced)
Does three things:
1. **Gather.** In parallel:
   - `chrome.windows.getAll({populate: true, windowTypes: ['normal']})`
   - the MRU list from `chrome.storage.session`
   - `chrome.runtime.sendNativeMessage('com.mishkin.window_switcher', {cmd: 'names'})`
2. **Render immediately.** Use the window data (active-tab title as the
   label) as soon as it arrives. When the names arrive, swap them in. If
   they don't arrive within 500 ms, or the call errors, keep the titles and
   show a footer note: "Window names unavailable — see README".
3. **Switch.** `chrome.windows.update(id, {focused: true})`, then
   `window.close()`.

### `switcher-core.js` (pure functions, no `chrome.*`)
- `buildEntries(windows, names, mru, currentId)` → ordered
  `[{id, label, tabCount, isCurrent}]`.
- `filterEntries(entries, query)` → filtered and ranked list.
- Shared by the popup and the unit tests.

### `native-host/` (new, inside `tab-groups/`)
- `window-names` — the host executable. It's a JXA script
  (`#!/usr/bin/osascript -l JavaScript`), so there's nothing extra to
  install. It reads and discards Chrome's length-prefixed request from
  stdin, asks Chrome for `{id, name}` of every window, and writes one
  length-prefixed JSON reply: `{names: {"<id>": "<name>", ...}}`. On error it
  replies `{error: "<message>"}`. Read-only: it never changes any window.
- `com.mishkin.window_switcher.json` — the host manifest template (`path`
  and `allowed_origins` filled in by the installer).
- `install.sh <extension-id>` — fills in the template with the host's
  absolute path and `chrome-extension://<extension-id>/`, copies it to
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`,
  and makes the host executable. The ID is copied from
  `chrome://extensions`. Rerun it if the extension folder moves, because
  the ID changes. `uninstall.sh` removes the manifest.
- The first use triggers a macOS Automation permission prompt
  (osascript controlling Google Chrome). The README covers this.

### `README.md` (tab-groups, currently just a title)
Describe both features: the manager and the window switcher. Window
switcher setup: copy the extension ID from `chrome://extensions`, run
`native-host/install.sh <id>`, approve the Automation prompt, and optionally
change the shortcut. Update the top-level README's one-line description of
tab-groups.

## Error handling

| Situation | Behavior |
|---|---|
| Host not installed / not allowed | Titles shown, footer note |
| Automation permission denied | Host returns `{error}`; titles shown, footer note |
| Host slower than 500 ms | Titles shown, then names swapped in when they arrive |
| Window ID in names but not in API list (or vice versa) | Ignored / falls back to title |
| Only one window open | List shows it (dimmed, current); harmless |

## Testing

- **Unit (Node, `node --test`):** `switcher-core.js` covers MRU ordering,
  current window last, title fallback, case-insensitive substring match,
  prefix-first ranking, and empty query returning everything.
- **Host on its own:** a small script feeds a length-prefixed message to
  `window-names` and decodes the reply. Run it by hand against real Chrome.
- **Manual:** load unpacked. Check that the shortcut opens the popup, that
  named and unnamed windows are labelled correctly, that filtering and
  arrow keys and Enter work, and that the extension falls back to titles
  when the host is removed. Also check that the footer link opens the
  manager and that the manager's saved data survives the update (same
  extension ID).

## Out of scope

- Naming or renaming windows (keep using Chrome's Name window…).
- Switching to individual tabs.
- Non-macOS platforms; non-Chrome browsers (Brave/Edge/Canary).
- Incognito windows: included only if the user enables the extension in
  incognito; no special handling.

## Open risks

- JXA's stdin/stdout handling of binary data (the length prefixes) needs
  checking early. If it's awkward, fall back to a small shell wrapper or
  `python3`.
- The Automation prompt may name "osascript" or "Google Chrome" as the
  requesting app depending on how macOS attributes it. This only affects
  the README wording.
