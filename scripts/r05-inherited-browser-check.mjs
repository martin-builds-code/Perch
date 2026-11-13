// Run inherited assertions unchanged, keeping their new evidence under R05.
// Candidate :5173 has R05 disabled; baseline :5175 is accepted R04. :5179 is
// exercised separately by r05-browser-check.mjs with the adaptive feature on.
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  symlink,
  rm,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'),
  temp = await mkdtemp(join(tmpdir(), 'perch-r05-browser-'));
try {
  await mkdir(join(temp, 'scripts'));
  await symlink(join(root, 'tests'), join(temp, 'tests'));
  for (const name of [
    'stage3a-browser-check.mjs',
    'r03-browser-check.mjs',
    'r04-browser-check.mjs',
  ]) {
    const source = await readFile(join(root, 'scripts', name), 'utf8');
    const redirected = source
      .replaceAll(
        'docs/stage3a',
        'docs/route-r05/browser/inherited-stage3a',
      )
      .replaceAll(
        'docs/stage3-readability',
        'docs/route-r05/browser/inherited-readability',
      )
      .replaceAll('docs/route-r03', 'docs/route-r05/browser/inherited-r03')
      .replaceAll(
        'docs/route-r04/browser',
        'docs/route-r05/browser/inherited-r04',
      );
    await mkdir(join(root, 'docs/route-r05/browser/inherited-r03'), {
      recursive: true,
    });
    const file = join(temp, 'scripts', name);
    await writeFile(file, redirected);
    execFileSync(
      process.execPath,
      ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), file],
      { cwd: root, env: process.env, stdio: 'inherit', timeout: 180000 },
    );
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
