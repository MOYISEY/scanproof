import test from 'node:test';
import assert from 'node:assert/strict';
import {controller,deferred,turn} from './helpers/controller.mjs';

test('unavailable IDB: fresh session is clean; committed tasks-only edit requests unload warning',async()=>{
  const app=await controller({openFails:true});
  assert.equal(app.unload().defaultPrevented,false,'No edit means no unsaved-content warning');
  await app.task('UNSAVED_SYNTHETIC_TASK');
  assert.equal(app.inspect().dbReady,false);assert.equal(app.inspect().state.pages.length,0);assert.equal(app.inspect().state.tasks.length,1);assert.equal(app.inspect().unsavedContent,true);
  const event=app.unload();assert.equal(event.defaultPrevented,true,'Dirty tasks without photos must request beforeunload cancellation');assert.equal(event.returnValue,'','Legacy returnValue must also request the browser warning');
  assert.equal(app.storage.writes,0);const reload=await controller({openFails:true});assert.equal(reload.inspect().state.tasks.length,0,'The warning request is not a persistence mechanism');
});

test('successful tasks-only content save clears dirty state and permits normal unload',async()=>{
  const app=await controller();await app.task('SAVED_SYNTHETIC_TASK');
  assert.equal(app.storage.saved.tasks[0].label,'SAVED_SYNTHETIC_TASK');assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);
});

test('quota failure keeps dirty state independently of human-readable status; content retry clears it',async()=>{
  const app=await controller({writeFails:true});await app.task('QUOTA_SYNTHETIC_TASK');
  app.element('#save-status').textContent='Status copy is not the source of dirty state';
  assert.equal(app.inspect().unsavedContent,true);assert.equal(app.storage.saved,undefined);assert.equal(app.unload().defaultPrevented,true);
  app.storage.writeFails=false;await app.task('RETRY_SYNTHETIC_TASK');assert.equal(app.storage.saved.tasks.length,2);assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);
});

test('quarantined draft plus tasks-only edits requests warning; explicit clear resets dirty state',async()=>{
  const corrupt={version:2,pages:[],tasks:[],selected:null},app=await controller({saved:corrupt});
  assert.equal(app.inspect().recoveryMode,true);assert.equal(app.unload().defaultPrevented,false);
  await app.task('RECOVERY_SYNTHETIC_TASK');assert.equal(app.storage.saved,corrupt);assert.equal(app.storage.writes,0);assert.equal(app.unload().defaultPrevented,true);
  await app.clear();assert.equal(app.storage.saved,undefined);assert.equal(app.inspect().state.tasks.length,0);assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);
});

test('explicit clear in memory-only mode resets task dirty state without claiming a disk save',async()=>{
  const app=await controller({openFails:true});await app.task('DISCARD_SYNTHETIC_TASK');await app.clear();
  assert.equal(app.inspect().state.tasks.length,0);assert.equal(app.inspect().unsavedContent,false);assert.equal(app.inspect().dbReady,false);assert.equal(app.storage.writes,0);assert.equal(app.unload().defaultPrevented,false);
});

test('older content save cannot clear dirty state for a newer queued task revision',async()=>{
  const app=await controller(),first=deferred(),second=deferred();let writes=0;
  app.storage.contentGate=()=>++writes===1?first.promise:second.promise;
  await app.task('FIRST_SYNTHETIC_TASK',{wait:false});await app.task('SECOND_SYNTHETIC_TASK',{wait:false});
  first.resolve();await turn();assert.equal(app.storage.saved.tasks.length,1);assert.equal(app.inspect().unsavedContent,true);assert.equal(app.unload().defaultPrevented,true);
  second.resolve();await app.flush();assert.equal(app.storage.saved.tasks.length,2);assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);
});

test('a pending selection-only write cannot clear a later content edit',async()=>{
  const app=await controller();await app.importPages();const view=deferred(),content=deferred();
  app.storage.selectionGate=()=>view.promise;await app.select(app.inspect().state.pages[1].id);await turn();assert.equal(app.storage.selectionWrites,1);
  app.storage.contentGate=()=>content.promise;await app.task('AFTER_SELECTION_SYNTHETIC_TASK',{wait:false});
  view.resolve();await turn();assert.equal(app.inspect().unsavedContent,true);assert.equal(app.storage.saved.tasks.length,0);assert.equal(app.unload().defaultPrevented,true);
  content.resolve();await app.flush();assert.equal(app.storage.saved.tasks.length,1);assert.equal(app.inspect().unsavedContent,false);assert.equal(app.unload().defaultPrevented,false);
});
