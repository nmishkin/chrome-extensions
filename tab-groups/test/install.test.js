import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const nativeHostDir = path.join(import.meta.dirname, '..', 'native-host');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

// Copies native-host/ into a folder named `dirName` and runs install.sh
// from there with HOME pointed at a temp dir. Returns the installed manifest.
function installFrom(dirName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-'));
  const hostDir = path.join(tmp, dirName, 'native-host');
  fs.cpSync(nativeHostDir, hostDir, { recursive: true });
  const home = path.join(tmp, 'home');
  const result = spawnSync(path.join(hostDir, 'install.sh'), [extensionId], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const manifestPath = path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mishkin.window_switcher.json');
  return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), hostDir };
}

test('install.sh writes a manifest with the host path and extension origin', () => {
  const { manifest, hostDir } = installFrom('plain');
  assert.equal(manifest.name, 'com.mishkin.window_switcher');
  assert.equal(manifest.path, path.join(hostDir, 'window-names'));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
});

test('install.sh handles paths containing & | \\ and "', () => {
  const { manifest, hostDir } = installFrom('R&D | "odd" \\ dir');
  assert.equal(manifest.path, path.join(hostDir, 'window-names'));
});
