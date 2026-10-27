import test from 'node:test';
import assert from 'node:assert/strict';
import {controller} from './helpers/controller.mjs';

const choose=async(app,files)=>{app.element('#file-input').value='selected-synthetic-fixture';await app.element('#file-input').handlers.get('change')({target:{files}});await app.flush();};
const snapshot=app=>structuredClone(app.inspect().state);

test('every early import rejection resets the picker and preserves saved pages, UUID links and view',async()=>{
  const app=await controller();await app.importPages();await app.task('Synthetic mapped task');
  const task=app.inspect().state.tasks[0].id;await app.element('#assignments').handlers.get('change')({target:{dataset:{taskId:task},checked:true}});await app.flush();
  const before=snapshot(app),writes=app.storage.writes;
  for(const [files,reason]of [
    [[{name:'synthetic.heic',size:1}],/HEIC/],
    [[{name:'empty.png',size:0}],/пустой файл/],
    [[{name:'large.png',size:10*1024*1024+1}],/10 МБ/],
    [Array.from({length:19},()=>({name:'page.png',size:1})),/20 страниц/],
    [Array.from({length:6},()=>({name:'page.png',size:9*1024*1024})),/50 МБ/],
    [[{name:'x'.repeat(256),size:1}],/255/],
    [[],/Не выбраны/]
  ]){
    await choose(app,files);assert.equal(app.element('#file-input').value,'','A rejected selection must not suppress the next change event');assert.match(app.element('#notice').textContent,reason);assert.equal(app.element('#notice').hidden,false);
    assert.deepEqual(snapshot(app),before);assert.equal(app.storage.writes,writes,'Rejection must not write a partial draft');assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);
  }
});

test('repeated size rejection can be followed by a valid same-name import without losing current work',async()=>{
  const app=await controller();await app.importPages();const before=snapshot(app);
  for(let i=0;i<2;i++){await choose(app,[{name:'retry.png',size:10*1024*1024+1}]);assert.equal(app.element('#file-input').value,'');assert.deepEqual(snapshot(app),before);}
  await choose(app,[new File(['synthetic corrected bytes'],'retry.png',{type:'image/png'})]);assert.equal(app.element('#file-input').value,'');assert.equal(app.inspect().state.pages.length,3);
  assert.deepEqual(snapshot(app).pages.slice(0,2),before.pages);assert.equal(app.storage.saved.pages[2].name,'retry.png');assert.equal(app.inspect().unsavedContent,false);
});

test('closing the file chooser leaves saved content, view and dirty guard unchanged',async()=>{
  const app=await controller();await app.importPages();await app.task('Synthetic task');const before=snapshot(app),writes=app.storage.writes;
  for(let i=0;i<2;i++)app.element('#file-input').handlers.get('cancel')();
  assert.deepEqual(snapshot(app),before);assert.equal(app.storage.writes,writes);assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);assert.match(app.element('#notice').textContent,/Выбор файлов закрыт/);
});
