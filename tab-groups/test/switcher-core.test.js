import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  windowLabel,
  buildEntries,
  filterEntries,
  moveHighlight,
  updateMru,
  removeFromMru,
  keyAction,
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

// keyAction

test('keyAction defers Enter until the list has loaded', () => {
  assert.deepEqual(keyAction('Enter', { loaded: false, highlight: 0, length: 0 }),
    { highlight: 0, action: 'defer' });
});

test('keyAction switches on Enter when a row is highlighted', () => {
  assert.deepEqual(keyAction('Enter', { loaded: true, highlight: 1, length: 3 }),
    { highlight: 1, action: 'switch' });
});

test('keyAction ignores Enter when there are no results', () => {
  assert.deepEqual(keyAction('Enter', { loaded: true, highlight: 0, length: 0 }),
    { highlight: 0, action: null });
});

test('keyAction moves the highlight with arrows, clamped', () => {
  assert.deepEqual(keyAction('ArrowDown', { loaded: true, highlight: 0, length: 2 }),
    { highlight: 1, action: 'move' });
  assert.deepEqual(keyAction('ArrowDown', { loaded: true, highlight: 1, length: 2 }),
    { highlight: 1, action: 'move' });
  assert.deepEqual(keyAction('ArrowUp', { loaded: true, highlight: 0, length: 2 }),
    { highlight: 0, action: 'move' });
});

test('keyAction closes on Escape and ignores other keys', () => {
  assert.deepEqual(keyAction('Escape', { loaded: true, highlight: 0, length: 2 }),
    { highlight: 0, action: 'close' });
  assert.deepEqual(keyAction('a', { loaded: true, highlight: 1, length: 2 }),
    { highlight: 1, action: null });
});
