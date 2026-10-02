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
