import {mkdir,copyFile,readdir,rm,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),out=resolve(root,'dist');
if(dirname(out)!==root||out!==join(root,'dist'))throw Error('Unsafe build output path');
try{if((await lstat(out)).isSymbolicLink())throw Error('Refusing a symlink as build output');}catch(e){if(e.code!=='ENOENT')throw e;}
// Fixed, verified project output directory only. Prevent removed source assets surviving rebuilds.
await rm(out,{recursive:true,force:true});
await mkdir(join(out,'src'),{recursive:true});
for(const name of ['index.html','icon.svg'])await copyFile(join(root,name),join(out,name));
for(const name of await readdir(join(root,'src')))if(/\.(mjs|css)$/.test(name))await copyFile(join(root,'src',name),join(out,'src',name));
console.log('Built static app in dist/; no remote dependencies.');
