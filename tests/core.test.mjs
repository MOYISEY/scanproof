import test from 'node:test';
import assert from 'node:assert/strict';
import {LIMITS,validateBatch,imageInfo,analyzePixels,movePage,removePage,restorePage,review,addTasks,makePdf,validateDraft} from '../src/core.mjs';
const page=(id,hash=id,taskIds=[])=>({id,hash,taskIds,name:`${id}.jpg`,size:100,analysis:{blank:false}});
test('batch limits and invalid formats reject without mutating current pages',()=>{
  const pages=[page('one')],before=structuredClone(pages);
  assert.match(validateBatch([],pages),/Не выбраны/);
  for(const name of ['scan.heic','scan.pdf','scan.svg','scan.jpg.exe'])assert.match(validateBatch([{name,size:50}],pages),/формат/);
  assert.match(validateBatch([{name:'huge.png',size:LIMITS.fileBytes+1}],pages),/10 МБ/);
  assert.match(validateBatch([{name:'empty.jpg',size:0}],pages),/пустой/);
  assert.match(validateBatch(Array.from({length:20},()=>({name:'s.JPG',size:1})),pages),/20 страниц/);
  assert.match(validateBatch(Array.from({length:6},()=>({name:'s.png',size:9*1024*1024})),[]),/50 МБ/);
  assert.equal(validateBatch([{name:'s.WebP',size:LIMITS.fileBytes}],[]),null);assert.deepEqual(pages,before);
});
test('image header detects dimensions before decode, rejects spoofed and animated images',()=>{
  const b=new Uint8Array(33),v=new DataView(b.buffer);b.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);b.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,1000);v.setUint32(20,2000);
  assert.deepEqual(imageInfo(b),{width:1000,height:2000,type:'image/png'});
  v.setUint32(16,50000);assert.throws(()=>imageInfo(b),/24 мегапикселей/);
  assert.throws(()=>imageInfo(new TextEncoder().encode('<svg>not an image</svg>')),/Не удалось/);
  const animated=new Uint8Array(46);v.setUint32(16,1000);animated.set(b);new DataView(animated.buffer).setUint32(33,0);animated.set(new TextEncoder().encode('acTL'),37);assert.throws(()=>imageInfo(animated),/Анимированные/);
});
test('blank heuristic identifies near-white page, leaves inked/dark pages for human review',()=>{
  const a=new Uint8ClampedArray(10000*4).fill(255);assert.equal(analyzePixels(a).blank,true);
  for(let i=0;i<1000;i++){a[i*4]=a[i*4+1]=a[i*4+2]=30;}assert.equal(analyzePixels(a).blank,false);
  a.fill(0);for(let i=3;i<a.length;i+=4)a[i]=255;assert.equal(analyzePixels(a).blank,false);
});
test('stable task IDs survive reorder/rotate and delete/undo restores coverage',()=>{
  const a=page('a','h',['task']),b=page('b');let pages=[a,b];pages=movePage(pages,'a',1);
  assert.deepEqual(pages.map(p=>p.id),['b','a']);assert.deepEqual(pages[1].taskIds,['task']);
  pages[1]={...pages[1],rotation:90};assert.equal(review(pages,[{id:'task'}]).unassigned.length,0);
  const result=removePage(pages,'a');assert.equal(review(result.pages,[{id:'task'}]).unassigned.length,1);
  assert.deepEqual(restorePage(result.pages,result.removed),pages);
  assert.equal(movePage(pages,'missing',0),pages);assert.equal(movePage(pages,'a',-1),pages);
});
test('duplicates are exact hashes; repeat import is visible, not silently discarded',()=>{
  const result=review([page('a','same'),page('b','same'),page('c','different')],[]);
  assert.equal(result.duplicates.length,1);assert.equal(result.duplicates[0].original.id,'a');assert.equal(result.duplicates[0].page.id,'b');
});
test('task entry trims blank lines, prevents duplicate labels and rejects empty input',()=>{
  let id=0;const tasks=addTasks([],'  First\n\nSecond\nfirst ',()=>String(++id));assert.equal(tasks.length,2);assert.equal(tasks[0].label,'First');
  assert.throws(()=>addTasks(tasks,' \n ',()=>''),/хотя бы/);assert.throws(()=>addTasks(tasks,'x'.repeat(161),()=>''),/160/);
});
test('PDF page order, dimensions, image streams, lengths and xref byte offsets are valid',()=>{
  const bytes=makePdf([{width:100,height:200,jpeg:new Uint8Array([255,216,10,255,217])},{width:200,height:100,jpeg:new Uint8Array([255,216,20,255,217])}]);
  const text=Buffer.from(bytes).toString('latin1');assert.match(text,/\/Count 2/);assert.match(text,/Kids \[3 0 R 6 0 R\]/);assert.match(text,/MediaBox \[0 0 595.28 841.89\]/);assert.match(text,/MediaBox \[0 0 841.89 595.28\]/);
  const xref=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(xref,xref+4),'xref');
  const lines=text.slice(xref).split('\n'),count=Number(lines[1].split(' ')[1]);
  for(let i=1;i<count;i++){const offset=Number(lines[i+2].slice(0,10));assert.equal(text.slice(offset,offset+`${i} 0 obj`.length),`${i} 0 obj`);}
  assert.throws(()=>makePdf([]),/хотя бы/);
});
test('restoring a deleted page enforces the total byte limit in the pure function',()=>{
  const pages=Array.from({length:5},(_,i)=>({...page(String(i)),size:10*1024*1024}));
  assert.equal(restorePage(pages,{index:0,page:{...page('removed'),size:10*1024*1024}}),pages);
});
test('draft validation rejects corrupt schema, HTML IDs, byte limits and broken references',()=>{
  const id='00000000-0000-4000-8000-000000000001',task='00000000-0000-4000-8000-000000000002';
  const blob=new Blob(['synthetic'],{type:'image/jpeg'}),preview=new Blob(['preview'],{type:'image/jpeg'});
  const valid={version:1,pages:[{...page(id,'a'.repeat(64),[task]),blob,preview,size:blob.size,width:100,height:200,rotation:0,analysis:{blank:false,darkRatio:.1,deviation:23}}],tasks:[{id:task,label:'Task'}],selected:id};
  assert.equal(validateDraft(valid).pages[0].id,id);
  for(const bad of [null,{}, {...valid,version:2},{...valid,pages:[{}]},{...valid,tasks:[{}]},{...valid,pages:[valid.pages[0],valid.pages[0]]}])assert.throws(()=>validateDraft(bad),/черновик/);
  for(const extra of [{id:'x"><img src=x onerror=alert(1)>'},{width:'100'},{rotation:91},{blob:'data:image/jpeg,aaa'},{size:0},{hash:'invalid'},{taskIds:['missing']},{analysis:{blank:false,darkRatio:NaN,deviation:0}},{preview:new Blob([],{type:'image/jpeg'})}])assert.throws(()=>validateDraft({...valid,pages:[{...valid.pages[0],...extra}]}),/черновик/);
});
