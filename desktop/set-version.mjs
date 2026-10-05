import { readFile, writeFile } from 'node:fs/promises';
const run = process.env.GITHUB_RUN_NUMBER;
if (!/^[1-9][0-9]{0,4}$/.test(run || '') || Number(run) > 65535) throw Error('A valid Windows release run number is required.');
const filename = new URL('./package.json', import.meta.url);
const metadata = JSON.parse(await readFile(filename, 'utf8'));
metadata.version = '1.1.' + run;
await writeFile(filename, JSON.stringify(metadata, null, 2) + '\n');
console.log('Building Slate ' + metadata.version);
