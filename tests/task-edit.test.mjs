import test from 'node:test';
import assert from 'node:assert/strict';
import {renameTask,review} from '../src/core.mjs';
const tasks=[{id:'q1',label:'Algebra'},{id:'q2',label:'Geometry areaa'},{id:'q3',label:'Graph'}];
const pages=Array.from({length:6},(_,i)=>({id:`p${i+1}`,hash:`h${i+1}`,taskIds:[`q${Math.floor(i/2)+1}`],rotation:i===3?180:0,analysis:{blank:false}}));
test('rename changes only label; stable UUID and every page link keep full coverage',()=>{
  const beforePages=structuredClone(pages),beforeTasks=structuredClone(tasks);
  const next=renameTask(tasks,'q2','  Geometry area  ');
  assert.deepEqual(next,[tasks[0],{id:'q2',label:'Geometry area'},tasks[2]]);
  assert.equal(next[0],tasks[0]);assert.equal(next[2],tasks[2]);
  assert.deepEqual(tasks,beforeTasks);assert.deepEqual(pages,beforePages);
  assert.deepEqual(pages.filter(p=>p.taskIds.includes(next[1].id)).map(p=>p.id),['p3','p4']);
  assert.equal(review(pages,next).unassigned.length,0);
});
test('empty, overlong, multiline and duplicate labels do not mutate tasks',()=>{
  for(const input of ['', ' \t ',null,'x'.repeat(161),'One\nTwo','Algebra',' algebra ','GRAPH']){
    const before=structuredClone(tasks);assert.throws(()=>renameTask(tasks,'q2',input));assert.deepEqual(tasks,before);
  }
  assert.throws(()=>renameTask(tasks,'missing','New'),/больше не существует/);
});
test('unchanged labels are a no-op; repeated renames preserve the same IDs',()=>{
  assert.equal(renameTask(tasks,'q2',' Geometry areaa '),tasks);
  let next=tasks;
  for(const label of ['Geometry area','Geometry: proof','Geometry areaa']){
    next=renameTask(next,'q2',label);assert.deepEqual(next.map(t=>t.id),['q1','q2','q3']);assert.equal(review(pages,next).unassigned.length,0);
  }
});
test('the existing 160-character limit also applies to a renamed label',()=>{
  const label='З'.repeat(160);assert.equal(renameTask(tasks,'q2',label)[1].label,label);
  assert.throws(()=>renameTask(tasks,'q2',label+'З'),/160/);
});
