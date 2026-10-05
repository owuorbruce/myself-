import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const executable = path.resolve(process.argv[2] || 'release/win-unpacked/Slate.exe');
const directory = process.env.SLATE_SMOKE_DIR || await mkdtemp(path.join(tmpdir(), 'slate-desktop-smoke-'));
await mkdir(directory, { recursive: true });
for (const mode of ['write', 'read']) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--slate-smoke=' + mode], {
      env: { ...process.env, SLATE_SMOKE_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { output = (output + chunk).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); reject(Error('Packaged desktop check timed out (' + mode + '): ' + output)); }, 45000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Desktop exited with code ' + code + ': ' + output)); });
  });
  const result = JSON.parse(await readFile(path.join(directory, mode + '.json'), 'utf8'));
  if (!result.ok) throw Error(result.details);
  console.log('Packaged Windows check passed (' + mode + '): ' + result.details);
}
console.log('Packaged Slate verified: app window, isolated renderer, helper, settings, save on close and persistence after restart.');
