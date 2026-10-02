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
