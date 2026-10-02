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

// Decides what a keypress in the search box does. `action` is one of
// 'move', 'switch', 'defer' (Enter before the list has loaded), 'close',
// or null (nothing to do).
export function keyAction(key, { loaded, highlight, length }) {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp':
      return { highlight: moveHighlight(highlight, key === 'ArrowDown' ? 1 : -1, length), action: 'move' };
    case 'Enter':
      if (!loaded) return { highlight, action: 'defer' };
      return { highlight, action: length > 0 ? 'switch' : null };
    case 'Escape':
      return { highlight, action: 'close' };
    default:
      return { highlight, action: null };
  }
}

// Focuses the chosen window, then closes the popup — even if focusing fails
// (e.g. the window was closed while the popup was open).
export async function switchWindow(entry, focus, close) {
  if (!entry) return;
  try {
    await focus(entry.id);
  } catch (err) {
    console.warn('Could not switch to window', entry.id, err);
  } finally {
    close();
  }
}

// Resolves to the promise's value, or to `fallback` if it takes longer than `ms`.
export function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function updateMru(mru, windowId) {
  if (windowId === WINDOW_ID_NONE) return mru;
  return [windowId, ...mru.filter(id => id !== windowId)];
}

export function removeFromMru(mru, windowId) {
  return mru.filter(id => id !== windowId);
}
