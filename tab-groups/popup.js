import { buildEntries, filterEntries, keyAction } from './switcher-core.js';

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
  loaded: false,       // true once the list has been rendered with data
  pendingEnter: false, // Enter pressed before loading finished
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
  if (!state.loaded) return; // the first rebuild() applies the query
  state.visible = filterEntries(state.entries, searchEl.value);
  state.highlight = 0;
  render();
});

searchEl.addEventListener('keydown', event => {
  const { highlight, action } = keyAction(event.key, {
    loaded: state.loaded,
    highlight: state.highlight,
    length: state.visible.length,
  });
  if (action === null) return;
  event.preventDefault();
  state.highlight = highlight;
  switch (action) {
    case 'move':
      render();
      break;
    case 'switch':
      switchTo(state.visible[state.highlight]);
      break;
    case 'defer':
      state.pendingEnter = true;
      break;
    case 'close':
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
  state.loaded = true;

  // ⌘⇧K then Enter in quick succession: switch now that the list exists.
  if (state.pendingEnter) {
    switchTo(state.visible[state.highlight]);
    return;
  }

  if (early === TIMED_OUT) {
    state.names = await namesPromise;
    rebuild();
  }
  namesNoteEl.hidden = state.names !== null;
}

init();
searchEl.focus();
