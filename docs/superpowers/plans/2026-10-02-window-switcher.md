# Window Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard-triggered window switcher to the existing `tab-groups` Chrome extension. It lists open windows by their Chrome-given names and lets the user filter by typing.

**Architecture:** The toolbar popup (opened by ⌘⇧K via `_execute_action`) becomes the switcher. Window data comes from `chrome.windows`. Names come from a macOS native-messaging host: a JXA script that asks Chrome via AppleScript and returns `{id: name}`. AppleScript window IDs equal extension window IDs (verified). The background service worker keeps a most-recently-used window list in `chrome.storage.session`. Ordering and filtering logic is kept in a pure ES module that is unit-tested with Node.

**Tech Stack:** Chrome MV3 (ES modules for popup and service worker), vanilla JS/HTML/CSS, JXA (`osascript -l JavaScript`), Node 23 `node:test`, bash.

**Spec:** `docs/superpowers/specs/2026-10-02-window-switcher-design.md`

## Global Constraints

- All new and changed files live under `tab-groups/`. One extension, not two.
- Do not modify `tab-groups/manager.html` or `tab-groups/manager.js`. `manager.js` has the user's uncommitted edits: never `git add` it, never `git add -A`/`git add .`. Stage files by explicit path only. Never stage `tab-groups/.chrome-debug-profile/` or `tab-groups/.vscode/`.
- Do **not** add a `key` field to `manifest.json`. It would change the extension ID and lose the manager's `groupWindowOrigins` data.
- Native host name: `com.mishkin.window_switcher`.
- Shortcut: `_execute_action` with `suggested_key.mac: "Command+Shift+K"`.
- Names wait: 500 ms (`NAMES_TIMEOUT_MS = 500`).
- Footer note text, exactly: `Window names unavailable — see README`.
- Footer link text, exactly: `Open Tab Groups Manager`.
- Empty-results text, exactly: `No matching windows`.
- Filtering: case-insensitive substring; prefix matches first; MRU order within each group; current window last and dimmed.
- macOS only. No external npm dependencies.
- Run unit tests from `tab-groups/` with `node --test test/*.test.js`. Don't use a bare `node --test`, because it would scan `.chrome-debug-profile/`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Odd window titles.** A window may have no name and an active tab with an empty title (loading page) or no `tabs` array. Expect the label to fall back to the tab URL, then `Untitled window`, and never a blank row. Pinned in Task 1 (`windowLabel` tests).
2. **Queries containing regex metacharacters or surrounding spaces** (`(`, `.`, `  irr `). Expect them treated literally and trimmed, with no exception. Pinned in Task 1 (`filterEntries` tests).
3. **Windows missing from the MRU list.** This happens after a service-worker restart, or for windows opened before install. Expect them listed after MRU-known windows, in Chrome's order, and never dropped. Pinned in Task 1 (`buildEntries` tests).
4. **Stale or partial names map.** The map may have IDs for closed windows, be missing new windows, or hold empty-string names. Expect stale IDs ignored and missing or empty names to fall back to titles. Pinned in Task 1.
5. **Arrow keys at list edges and Enter with zero results.** Expect the highlight to stay in bounds, and Enter to do nothing when the list is empty. Pinned in Task 1 (`moveHighlight` tests) and Task 3 (`switchTo` guard, manual check).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tab-groups/package.json` | create | Marks `.js` as ES modules for Node tests; `npm test` script |
| `tab-groups/switcher-core.js` | create | Pure functions: labels, ordering, filtering, highlight movement, MRU updates |
| `tab-groups/test/switcher-core.test.js` | create | Unit tests for the above |
| `tab-groups/background.js` | replace | MRU tracking in `chrome.storage.session` |
| `tab-groups/manifest.json` | modify | `nativeMessaging`, command, module service worker, title |
| `tab-groups/popup.html` | replace | Switcher UI markup and styles |
| `tab-groups/popup.js` | replace | Gather data, render, keyboard handling, switch |
| `tab-groups/native-host/window-names` | create | JXA native-messaging host |
| `tab-groups/native-host/com.mishkin.window_switcher.json` | create | Host manifest template |
| `tab-groups/native-host/install.sh` | create | Installs host manifest for a given extension ID |
| `tab-groups/native-host/uninstall.sh` | create | Removes host manifest |
| `tab-groups/test/host-client.mjs` | create | Manual tool: calls the host like Chrome does and prints the reply |
| `tab-groups/README.md` | replace | Documents manager and switcher plus setup |
| `README.md` | modify | One-line description of tab-groups |

---

### Task 1: Core switcher logic (pure module + tests)

**Files:**
- Create: `tab-groups/package.json`
- Create: `tab-groups/switcher-core.js`
- Test: `tab-groups/test/switcher-core.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (ES module exports from `switcher-core.js`):
  - `windowLabel(win: {id:number, tabs?:Array<{active:boolean,title?:string,url?:string}>}, names: Record<string,string>|null) → string`
  - `buildEntries(windows: Window[], names: Record<string,string>|null, mru: number[], currentId: number|null) → Array<{id:number, label:string, tabCount:number, isCurrent:boolean}>`
  - `filterEntries(entries: Entry[], query: string) → Entry[]`
  - `moveHighlight(index: number, delta: number, length: number) → number`
  - `updateMru(mru: number[], windowId: number) → number[]`
  - `removeFromMru(mru: number[], windowId: number) → number[]`

- [ ] **Step 1: Create `tab-groups/package.json`**

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

- [ ] **Step 2: Write the failing tests in `tab-groups/test/switcher-core.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  windowLabel,
  buildEntries,
  filterEntries,
  moveHighlight,
  updateMru,
  removeFromMru,
} from '../switcher-core.js';

// Window with `tabCount` tabs; the first is active and has `title`.
function win(id, title, tabCount = 1) {
  return {
    id,
    tabs: Array.from({ length: tabCount }, (_, i) => ({
      active: i === 0,
      title: i === 0 ? title : 'other tab',
      url: 'https://example.com/' + i,
    })),
  };
}

const ids = entries => entries.map(e => e.id);

// windowLabel

test('windowLabel prefers the name from the names map', () => {
  assert.equal(windowLabel(win(1, 'Some Tab'), { 1: 'Irrigation' }), 'Irrigation');
});

test('windowLabel falls back to active tab title when no name', () => {
  assert.equal(windowLabel(win(1, 'Some Tab'), { 2: 'Other' }), 'Some Tab');
  assert.equal(windowLabel(win(1, 'Some Tab'), null), 'Some Tab');
});

test('windowLabel treats an empty-string name as missing', () => {
  assert.equal(windowLabel(win(1, 'Some Tab'), { 1: '' }), 'Some Tab');
});

test('windowLabel falls back to URL, then Untitled window', () => {
  const noTitle = { id: 1, tabs: [{ active: true, title: '', url: 'https://x.test/' }] };
  assert.equal(windowLabel(noTitle, null), 'https://x.test/');
  assert.equal(windowLabel({ id: 1 }, null), 'Untitled window');
  assert.equal(windowLabel({ id: 1, tabs: [] }, null), 'Untitled window');
});

// buildEntries

test('buildEntries orders by MRU, unknown windows after, current last', () => {
  const windows = [win(1, 'a'), win(2, 'b'), win(3, 'c'), win(4, 'd')];
  const entries = buildEntries(windows, null, [3, 1], 3);
  assert.deepEqual(ids(entries), [1, 2, 4, 3]);
});

test('buildEntries keeps windows missing from MRU in Chrome order', () => {
  const windows = [win(5, 'a'), win(6, 'b'), win(7, 'c')];
  assert.deepEqual(ids(buildEntries(windows, null, [], null)), [5, 6, 7]);
});

test('buildEntries ignores MRU and names IDs for closed windows', () => {
  const windows = [win(1, 'a'), win(2, 'b')];
  const entries = buildEntries(windows, { 99: 'Gone', 2: 'Named' }, [99, 2, 1], null);
  assert.deepEqual(ids(entries), [2, 1]);
  assert.equal(entries[0].label, 'Named');
});

test('buildEntries fills label, tabCount and isCurrent', () => {
  const entries = buildEntries([win(1, 'Tab', 3), win(2, 'X')], { 1: 'Main' }, [], 2);
  assert.deepEqual(entries, [
    { id: 1, label: 'Main', tabCount: 3, isCurrent: false },
    { id: 2, label: 'X', tabCount: 1, isCurrent: true },
  ]);
});

// filterEntries

const sample = [
  { id: 1, label: 'Spanish', tabCount: 1, isCurrent: false },
  { id: 2, label: 'Irrigation', tabCount: 1, isCurrent: false },
  { id: 3, label: 'PV Monitor (solar)', tabCount: 1, isCurrent: false },
  { id: 4, label: 'Irish music', tabCount: 1, isCurrent: true },
];

test('filterEntries with empty or blank query returns all, same order', () => {
  assert.deepEqual(ids(filterEntries(sample, '')), [1, 2, 3, 4]);
  assert.deepEqual(ids(filterEntries(sample, '   ')), [1, 2, 3, 4]);
});

test('filterEntries is case-insensitive substring', () => {
  assert.deepEqual(ids(filterEntries(sample, 'GAT')), [2]);
});

test('filterEntries puts prefix matches first, keeping order within groups', () => {
  // "i": prefix of Irrigation (2) and Irish (4); substring of Spanish (1) and Monitor (3)
  assert.deepEqual(ids(filterEntries(sample, 'i')), [2, 4, 1, 3]);
});

test('filterEntries trims the query', () => {
  assert.deepEqual(ids(filterEntries(sample, '  irr ')), [2]);
});

test('filterEntries treats regex metacharacters literally', () => {
  assert.deepEqual(ids(filterEntries(sample, '(solar')), [3]);
  assert.deepEqual(ids(filterEntries(sample, '.')), []);
});

test('filterEntries returns empty array when nothing matches', () => {
  assert.deepEqual(filterEntries(sample, 'zzz'), []);
});

// moveHighlight

test('moveHighlight moves and clamps at both ends', () => {
  assert.equal(moveHighlight(0, 1, 3), 1);
  assert.equal(moveHighlight(2, 1, 3), 2);
  assert.equal(moveHighlight(0, -1, 3), 0);
});

test('moveHighlight returns 0 for an empty list', () => {
  assert.equal(moveHighlight(0, 1, 0), 0);
  assert.equal(moveHighlight(0, -1, 0), 0);
});

// MRU

test('updateMru moves the window to the front without duplicates', () => {
  assert.deepEqual(updateMru([1, 2, 3], 3), [3, 1, 2]);
  assert.deepEqual(updateMru([1, 2], 9), [9, 1, 2]);
  assert.deepEqual(updateMru([], 4), [4]);
});

test('updateMru ignores WINDOW_ID_NONE (-1)', () => {
  assert.deepEqual(updateMru([1, 2], -1), [1, 2]);
});

test('removeFromMru removes the window', () => {
  assert.deepEqual(removeFromMru([1, 2, 3], 2), [1, 3]);
  assert.deepEqual(removeFromMru([1], 5), [1]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd tab-groups && node --test test/*.test.js`
Expected: FAIL with `Cannot find module '.../tab-groups/switcher-core.js'`.

- [ ] **Step 4: Implement `tab-groups/switcher-core.js`**

```js
// Pure logic for the window switcher popup. No chrome.* APIs here so it
// can be unit-tested with Node.

const WINDOW_ID_NONE = -1;

export function windowLabel(win, names) {
  const name = names && names[String(win.id)];
  if (name) return name;
  const active = (win.tabs || []).find(tab => tab.active);
  return (active && (active.title || active.url)) || 'Untitled window';
}

export function buildEntries(windows, names, mru, currentId) {
  const rank = id => {
    const i = mru.indexOf(id);
    return i === -1 ? mru.length : i;
  };
  const entries = windows.map(win => ({
    id: win.id,
    label: windowLabel(win, names),
    tabCount: (win.tabs || []).length,
    isCurrent: win.id === currentId,
  }));
  // Array.prototype.sort is stable, so windows with equal rank keep Chrome's order.
  return entries.sort((a, b) =>
    (Number(a.isCurrent) - Number(b.isCurrent)) || (rank(a.id) - rank(b.id)));
}

export function filterEntries(entries, query) {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice();
  const prefix = [];
  const other = [];
  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    if (label.startsWith(q)) prefix.push(entry);
    else if (label.includes(q)) other.push(entry);
  }
  return [...prefix, ...other];
}

export function moveHighlight(index, delta, length) {
  if (length === 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}

export function updateMru(mru, windowId) {
  if (windowId === WINDOW_ID_NONE) return mru;
  return [windowId, ...mru.filter(id => id !== windowId)];
}

export function removeFromMru(mru, windowId) {
  return mru.filter(id => id !== windowId);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd tab-groups && node --test test/*.test.js`
Expected: all tests pass, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add tab-groups/package.json tab-groups/switcher-core.js tab-groups/test/switcher-core.test.js
git commit -m "Add window switcher core logic with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Manifest and MRU-tracking background worker

**Files:**
- Modify: `tab-groups/manifest.json`
- Replace: `tab-groups/background.js`

**Interfaces:**
- Consumes: `updateMru`, `removeFromMru` from `./switcher-core.js` (Task 1).
- Produces: `chrome.storage.session` key `mru` holding `number[]` of window IDs, most recent first. Task 3 reads it.

- [ ] **Step 1: Replace `tab-groups/manifest.json` with**

```json
{
  "manifest_version": 3,
  "name": "Tab Groups Manager",
  "version": "1.1",
  "description": "View and manage all your tab groups in one place, and switch between windows by name",
  "permissions": [
    "tabs",
    "tabGroups",
    "storage",
    "nativeMessaging"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Switch window"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "mac": "Command+Shift+K"
      },
      "description": "Open the window switcher"
    }
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

(No `key` field — see Global Constraints.)

- [ ] **Step 2: Replace `tab-groups/background.js` with**

```js
// Background service worker: tracks most-recently-focused windows so the
// switcher popup can list them in MRU order.
import { updateMru, removeFromMru } from './switcher-core.js';

// Serialize read-modify-write updates so rapid focus changes don't race.
let pending = Promise.resolve();

function changeMru(transform) {
  pending = pending.then(async () => {
    const { mru = [] } = await chrome.storage.session.get('mru');
    await chrome.storage.session.set({ mru: transform(mru) });
  }).catch(err => console.error('MRU update failed', err));
}

chrome.windows.onFocusChanged.addListener(
  windowId => changeMru(mru => updateMru(mru, windowId)),
  { windowTypes: ['normal'] }
);

chrome.windows.onRemoved.addListener(
  windowId => changeMru(mru => removeFromMru(mru, windowId)),
  { windowTypes: ['normal'] }
);
```

- [ ] **Step 3: Verify in Chrome**

1. `chrome://extensions` → Tab Groups Manager → reload (↻). Confirm there are no errors on the card, and that the extension ID is **unchanged** from before the reload (write it down; Task 4 needs it).
2. Click a few different Chrome windows.
3. Click "service worker" on the card. In its console run: `(await chrome.storage.session.get('mru')).mru`
   Expected: an array of window IDs with the window you clicked last first.
4. Open `chrome://extensions/shortcuts`. Confirm "Open the window switcher" exists for Tab Groups Manager. If ⌘⇧K isn't assigned (Chrome may not apply suggested keys when updating an already-installed extension), set it there.
5. Open the manager (current popup button still works) and confirm previously saved group data is still present.

- [ ] **Step 4: Run unit tests (unchanged, still green)**

Run: `cd tab-groups && node --test test/*.test.js`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add tab-groups/manifest.json tab-groups/background.js
git commit -m "Track most-recently-used windows; add switcher shortcut

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Switcher popup

**Files:**
- Replace: `tab-groups/popup.html`
- Replace: `tab-groups/popup.js`

**Interfaces:**
- Consumes: `buildEntries`, `filterEntries`, `moveHighlight` from `./switcher-core.js` (Task 1). `chrome.storage.session` key `mru` (Task 2). Native host `com.mishkin.window_switcher` replying `{names: {"<id>": "<name>"}}` or `{error: "<msg>"}` (Task 4; until then the call fails and the popup shows titles plus the footer note).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace `tab-groups/popup.html` with**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      width: 360px;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
    }

    #search {
      box-sizing: border-box;
      width: 100%;
      padding: 10px 12px;
      border: none;
      border-bottom: 1px solid #ddd;
      font-size: 14px;
      outline: none;
    }

    #list {
      list-style: none;
      margin: 0;
      padding: 4px 0;
      max-height: 400px;
      overflow-y: auto;
    }

    #list li {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
    }

    #list li .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #list li .count {
      flex-shrink: 0;
      color: #888;
    }

    #list li.current {
      color: #999;
    }

    #list li.highlighted {
      background: #4285f4;
      color: white;
    }

    #list li.highlighted .count {
      color: #e0e0e0;
    }

    #list li.empty {
      color: #888;
      cursor: default;
    }

    footer {
      display: flex;
      gap: 8px;
      padding: 6px 12px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #888;
    }

    footer a {
      margin-left: auto;
      color: #4285f4;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <input id="search" type="text" placeholder="Switch to window…" autocomplete="off" spellcheck="false" autofocus>
  <ul id="list"></ul>
  <footer>
    <span id="names-note" hidden>Window names unavailable — see README</span>
    <a id="open-manager" href="#">Open Tab Groups Manager</a>
  </footer>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `tab-groups/popup.js` with**

```js
import { buildEntries, filterEntries, moveHighlight } from './switcher-core.js';

const NATIVE_HOST = 'com.mishkin.window_switcher';
const NAMES_TIMEOUT_MS = 500;
const TIMED_OUT = Symbol('timed out');

const searchEl = document.getElementById('search');
const listEl = document.getElementById('list');
const namesNoteEl = document.getElementById('names-note');

const state = {
  windows: [],
  mru: [],
  currentId: null,
  names: null,
  entries: [],
  visible: [],
  highlight: 0,
};

// Resolves to the {id: name} map, or null if the host is missing or fails.
function fetchNames() {
  return new Promise(resolve => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: 'names' }, reply => {
      if (chrome.runtime.lastError || !reply || reply.error || !reply.names) {
        console.warn('Window names unavailable:',
          chrome.runtime.lastError?.message || reply?.error || 'no reply');
        resolve(null);
      } else {
        resolve(reply.names);
      }
    });
  });
}

function rebuild() {
  // Keep the highlight on the same window across rebuilds (e.g. late names).
  const highlightedId = state.visible[state.highlight]?.id;
  state.entries = buildEntries(state.windows, state.names, state.mru, state.currentId);
  state.visible = filterEntries(state.entries, searchEl.value);
  const kept = state.visible.findIndex(e => e.id === highlightedId);
  state.highlight = kept === -1 ? 0 : kept;
  render();
}

function render() {
  listEl.replaceChildren();
  if (state.visible.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No matching windows';
    listEl.append(li);
    return;
  }
  state.visible.forEach((entry, i) => {
    const li = document.createElement('li');
    if (entry.isCurrent) li.classList.add('current');
    if (i === state.highlight) li.classList.add('highlighted');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.label;
    label.title = entry.label;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `(${entry.tabCount})`;

    li.append(label, count);
    li.addEventListener('click', () => switchTo(entry));
    listEl.append(li);
  });
  listEl.children[state.highlight]?.scrollIntoView({ block: 'nearest' });
}

async function switchTo(entry) {
  if (!entry) return;
  await chrome.windows.update(entry.id, { focused: true });
  window.close();
}

searchEl.addEventListener('input', () => {
  state.visible = filterEntries(state.entries, searchEl.value);
  state.highlight = 0;
  render();
});

searchEl.addEventListener('keydown', event => {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault();
      state.highlight = moveHighlight(
        state.highlight, event.key === 'ArrowDown' ? 1 : -1, state.visible.length);
      render();
      break;
    case 'Enter':
      event.preventDefault();
      switchTo(state.visible[state.highlight]);
      break;
    case 'Escape':
      window.close();
      break;
  }
});

document.getElementById('open-manager').addEventListener('click', event => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  window.close();
});

async function init() {
  const namesPromise = fetchNames();
  const [windows, stored, current] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.storage.session.get('mru'),
    chrome.windows.getCurrent(),
  ]);
  state.windows = windows;
  state.mru = stored.mru || [];
  state.currentId = current.id;

  // Usually names arrive in ~250 ms; waiting avoids titles flickering into names.
  const early = await Promise.race([
    namesPromise,
    new Promise(resolve => setTimeout(() => resolve(TIMED_OUT), NAMES_TIMEOUT_MS)),
  ]);
  if (early !== TIMED_OUT) state.names = early;
  rebuild();

  if (early === TIMED_OUT) {
    state.names = await namesPromise;
    rebuild();
  }
  namesNoteEl.hidden = state.names !== null;
}

init();
searchEl.focus();
```

- [ ] **Step 3: Run unit tests (unchanged, still green)**

Run: `cd tab-groups && node --test test/*.test.js`
Expected: `# fail 0`.

- [ ] **Step 4: Verify in Chrome (host not installed yet)**

1. Reload the extension at `chrome://extensions`.
2. Press ⌘⇧K. The popup opens with the cursor in the search box. After about 0.5 s it lists every normal window by its active tab title, with tab counts, and the footer shows `Window names unavailable — see README`.
3. The window you were in before this one is first; the current window is last and greyed.
4. Type part of a title. The list filters as you type, and the first row is highlighted.
5. ↑/↓ move the highlight and stop at the ends.
6. Type `zzzz`. The list shows `No matching windows`, and pressing Enter does nothing (no error in the popup's console: right-click popup → Inspect).
7. Clear the search, press Enter on a row: that window comes to the front and the popup closes.
8. Click a row: same.
9. Esc closes the popup.
10. Click `Open Tab Groups Manager`: the manager opens in a new tab with its data intact.

- [ ] **Step 5: Commit**

```bash
git add tab-groups/popup.html tab-groups/popup.js
git commit -m "Replace popup with window switcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Native host for window names, installer, and docs

**Files:**
- Create: `tab-groups/native-host/window-names`
- Create: `tab-groups/native-host/com.mishkin.window_switcher.json`
- Create: `tab-groups/native-host/install.sh`
- Create: `tab-groups/native-host/uninstall.sh`
- Create: `tab-groups/test/host-client.mjs`
- Replace: `tab-groups/README.md`
- Modify: `README.md` (top-level, line describing tab-groups)

**Interfaces:**
- Consumes: the extension ID (from `chrome://extensions`, noted in Task 2).
- Produces: native host `com.mishkin.window_switcher`. Request: any JSON message (the popup sends `{cmd: "names"}`; its content is ignored). Reply: `{names: {"<windowId>": "<name>"}}`, where name is Chrome's AppleScript window `name` (the given name, or the active tab title if unnamed), or `{error: "<message>"}`.

- [ ] **Step 1: Write the manual test client `tab-groups/test/host-client.mjs`**

```js
// Manual check: runs the native host the way Chrome does (length-prefixed
// JSON over stdin/stdout) and prints the reply. Requires Chrome running.
// Usage (from tab-groups/): node test/host-client.mjs native-host/window-names
import { spawn } from 'node:child_process';

const hostPath = process.argv[2];
if (!hostPath) {
  console.error('usage: node test/host-client.mjs <host-executable>');
  process.exit(2);
}

const host = spawn(hostPath, ['chrome-extension://test/']);
const body = Buffer.from(JSON.stringify({ cmd: 'names' }));
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length);
host.stdin.end(Buffer.concat([header, body]));

const chunks = [];
host.stdout.on('data', chunk => chunks.push(chunk));
host.stderr.on('data', chunk => process.stderr.write(chunk));
host.on('close', code => {
  const out = Buffer.concat(chunks);
  if (out.length < 4) {
    console.error(`exit ${code}: no reply`);
    process.exit(1);
  }
  const declared = out.readUInt32LE(0);
  const actual = out.length - 4;
  console.log(`exit ${code}, declared length ${declared}, actual ${actual}`);
  console.log(JSON.stringify(JSON.parse(out.subarray(4).toString('utf8')), null, 2));
  process.exit(declared === actual ? 0 : 1);
});
```

- [ ] **Step 2: Run it to verify it fails (host doesn't exist yet)**

Run: `cd tab-groups && node test/host-client.mjs native-host/window-names`
Expected: FAIL with `spawn native-host/window-names ENOENT`.

- [ ] **Step 3: Create the host `tab-groups/native-host/window-names`**

(This code was prototyped and verified on 2026-10-02: correct framing, multi-byte names, ~250 ms warm.)

```js
#!/usr/bin/osascript -l JavaScript
// Native messaging host for the Tab Groups extension's window switcher.
// Replies with {names: {"<windowId>": "<name>"}} using Chrome's AppleScript
// window name (the user-given name, or the active tab title if unnamed).
// Read-only: never changes any window.
ObjC.import('Foundation');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// JXA has no convenient raw-byte access to NSData, so the 4-byte length
// prefix goes through base64.
function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

function base64ToBytes(str) {
  const clean = str.replace(/=+$/, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    bytes.push((n >> 16) & 255);
    if (i + 2 < clean.length) bytes.push((n >> 8) & 255);
    if (i + 3 < clean.length) bytes.push(n & 255);
  }
  return bytes;
}

function readMessageLength(handle) {
  const header = handle.readDataOfLength(4);
  if (header.length < 4) return -1;
  const b = base64ToBytes(header.base64EncodedStringWithOptions(0).js);
  return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
}

function writeMessage(handle, obj) {
  const body = $(JSON.stringify(obj)).dataUsingEncoding($.NSUTF8StringEncoding);
  const n = body.length;
  const header = $.NSData.alloc.initWithBase64EncodedStringOptions(
    bytesToBase64([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]), 0);
  handle.writeData(header);
  handle.writeData(body);
}

function getWindowNames() {
  const chrome = Application('Google Chrome');
  const ids = chrome.windows.id();
  const names = chrome.windows.name();
  const map = {};
  ids.forEach((id, i) => { map[String(id)] = names[i]; });
  return map;
}

function run(argv) {
  const stdin = $.NSFileHandle.fileHandleWithStandardInput;
  const stdout = $.NSFileHandle.fileHandleWithStandardOutput;

  // Read and discard the request; there is only one command.
  const length = readMessageLength(stdin);
  if (length > 0) stdin.readDataOfLength(length);

  let reply;
  try {
    reply = { names: getWindowNames() };
  } catch (e) {
    reply = { error: String(e) };
  }
  writeMessage(stdout, reply);
  // Return nothing so osascript doesn't print a result to stdout.
}
```

Then: `chmod +x tab-groups/native-host/window-names`

- [ ] **Step 4: Run the client to verify the host works**

Run: `cd tab-groups && node test/host-client.mjs native-host/window-names`
Expected: `exit 0, declared length N, actual N` (equal), followed by JSON `{"names": {...}}` listing the open windows by name, with user-named windows (e.g. "Main", "Irrigation") under their names. Exit status 0.
If it prints `{"error": "... not allowed ..."}`, approve the macOS Automation prompt (or System Settings → Privacy & Security → Automation) and rerun.

- [ ] **Step 5: Create the host manifest template `tab-groups/native-host/com.mishkin.window_switcher.json`**

```json
{
  "name": "com.mishkin.window_switcher",
  "description": "Reads Chrome window names for the Tab Groups extension's window switcher",
  "path": "HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID/"
  ]
}
```

- [ ] **Step 6: Create `tab-groups/native-host/install.sh`**

```bash
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
sed -e "s|HOST_PATH|$HOST_PATH|" -e "s|EXTENSION_ID|$EXTENSION_ID|" \
  "$DIR/$HOST_NAME.json" > "$TARGET_DIR/$HOST_NAME.json"

echo "Installed $TARGET_DIR/$HOST_NAME.json"
echo "  host:      $HOST_PATH"
echo "  extension: $EXTENSION_ID"
```

- [ ] **Step 7: Create `tab-groups/native-host/uninstall.sh`**

```bash
#!/bin/bash
# Removes the window switcher's native messaging host manifest.
set -euo pipefail

MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mishkin.window_switcher.json"

rm -f "$MANIFEST"
echo "Removed $MANIFEST"
```

Then: `chmod +x tab-groups/native-host/install.sh tab-groups/native-host/uninstall.sh`

- [ ] **Step 8: Verify the installer's argument check**

Run: `tab-groups/native-host/install.sh not-an-id; echo "status $?"`
Expected: the usage message and `status 1`, with nothing written.

- [ ] **Step 9: Install and verify end to end in Chrome**

1. Run: `tab-groups/native-host/install.sh <extension-id-from-Task-2>`
   Expected: the `Installed ...` lines. Then `cat "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mishkin.window_switcher.json"` shows the real absolute host path and `chrome-extension://<id>/`.
2. Press ⌘⇧K. Named windows show their Chrome names (e.g. "Main", "Irrigation"); unnamed ones show the tab title. There's no footer note. Approve the macOS Automation prompt if it appears, then reopen.
3. Type `irr` → "Irrigation" is first; Enter switches to it.
4. Rename a window in Chrome (Window menu → Name Window…), reopen the popup: it shows the new name.
5. Run `tab-groups/native-host/uninstall.sh`, reopen the popup: titles are shown and the footer note appears. Reinstall with `install.sh <id>`.

- [ ] **Step 10: Replace `tab-groups/README.md` with**

````markdown
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
   the first time — allow it. (To change it later: System Settings →
   Privacy & Security → Automation.)

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
````

- [ ] **Step 11: Update the top-level `README.md`**

Replace the line:
```
- **[tab-groups](tab-groups/README.md)** — An extension for managing browser tab groups via a popup and manager UI.
```
with:
```
- **[tab-groups](tab-groups/README.md)** — Manage tab groups, and switch between Chrome windows by name with a keyboard shortcut.
```

- [ ] **Step 12: Run unit tests**

Run: `cd tab-groups && npm test`
Expected: `# fail 0`.

- [ ] **Step 13: Commit**

```bash
git add tab-groups/native-host/window-names tab-groups/native-host/com.mishkin.window_switcher.json \
  tab-groups/native-host/install.sh tab-groups/native-host/uninstall.sh \
  tab-groups/test/host-client.mjs tab-groups/README.md README.md
git commit -m "Add native host for Chrome window names, installer, and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Confirm with `git status` that `tab-groups/manager.js` is still modified and unstaged.
