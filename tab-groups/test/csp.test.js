import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// MV3's default CSP (script-src 'self') blocks inline event handlers such as
// onclick="..." or onerror="...", whether in .html files or in HTML strings
// built by scripts. Keep them out of the extension.
const root = path.join(import.meta.dirname, '..');
const sourceFiles = fs.readdirSync(root).filter(f => /\.(html|js)$/.test(f));
const inlineHandler = /<[^>]*\son[a-z]+\s*=\s*["']/gi;

test('extension pages and scripts contain no inline event handlers', () => {
  assert.ok(sourceFiles.includes('manager.js'), 'expected to scan manager.js');
  const offenders = [];
  for (const file of sourceFiles) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.match(inlineHandler)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
