import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFile,readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const build=()=>{const r=spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
test('clean rebuild removes retired output and is byte reproducible',async()=>{
  build();const snapshot=new Map();
  for(const name of await readdir('dist/src'))snapshot.set(name,createHash('sha256').update(await readFile('dist/src/'+name)).digest('hex'));
  await writeFile('dist/src/retired-synthetic.mjs','// synthetic retired output');
  build();assert.equal(existsSync('dist/src/retired-synthetic.mjs'),false);
  assert.deepEqual((await readdir('dist/src')).sort(),[...snapshot.keys()].sort());
  for(const [name,hash]of snapshot)assert.equal(createHash('sha256').update(await readFile('dist/src/'+name)).digest('hex'),hash);
});
