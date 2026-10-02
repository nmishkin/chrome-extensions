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
