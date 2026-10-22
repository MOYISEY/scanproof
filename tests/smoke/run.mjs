import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {launchBrowser} from './browser.mjs';
import {createFixtures} from './fixtures.mjs';
import {assertPdfImages,inspectPdf} from './pdf.mjs';

const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),artifactRoot=join(root,'artifacts','smoke');
await mkdir(artifactRoot,{recursive:true});const output=await mkdtemp(join(artifactRoot,'run-'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const production=['index.html','icon.svg','src/app.mjs','src/core.mjs','src/images.mjs','src/storage.mjs','src/styles.css'];
const initialHashes=Object.fromEntries(await Promise.all(production.map(async path=>[path,sha(await readFile(join(root,path)))])));
const report={status:'running',startedAt:new Date().toISOString(),node:process.version,platform:process.platform,steps:[],profiles:[],errors:[],coverageGaps:['Chromium only; mobile is emulation, not a physical device','File input uses CDP setFileInputFiles; native OS picker is not exercised','PDF checker verifies xref, page order, JPEG hashes/dimensions and A4 orientation; it is not a full raster PDF renderer','No PDF/HEIC import or OCR is claimed by the product']};
let browser,server,page,currentStep='setup',currentProfile='setup',cleanupError;
async function check(name,fn){
  currentStep=name;const started=Date.now();
  try{const details=await fn();report.steps.push({profile:currentProfile,name,status:'passed',durationMs:Date.now()-started,...(details?{details}:{})});console.log(`PASS [${currentProfile}] ${name}`);}
  catch(error){report.steps.push({profile:currentProfile,name,status:'failed',durationMs:Date.now()-started,error:error.message});throw new Error(`[${currentProfile}] ${name}: ${error.message}`,{cause:error});}
}
const text=selector=>page.evaluate(s=>document.querySelector(s)?.textContent.trim(),selector);
const active=()=>page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,action:document.activeElement.dataset.action,task:document.activeElement.dataset.taskId,page:document.activeElement.dataset.id}));
const saved=()=>page.waitFor('latest draft/view write to finish',()=>document.querySelector('#save-status')?.textContent==='Сохранён в этом браузере');
const idle=()=>page.waitFor('import/rotation to finish',()=>document.querySelector('#import-progress')?.hidden&&!document.querySelector('#import-button')?.disabled);
const state=()=>page.evaluate(async()=>{const storage=await import('./src/storage.mjs'),draft=await storage.readDraft();return draft?{tasks:draft.tasks,pages:draft.pages.map(p=>({id:p.id,name:p.name,rotation:p.rotation,hash:p.hash,taskIds:p.taskIds})),storedSelected:draft.selected,lastViewed:(await storage.readSelection())??draft.selected}:null;});
const card=(id,action)=>`#page-list [data-action="${action}"][data-id="${id}"]`;
const edit=id=>`.task-card[data-task-id="${id}"] [data-action="edit-task"]`;
async function select(id){await page.click(card(id,'select'));await saved();assert.equal(await page.evaluate(()=>document.querySelector('#page-list .page-select[aria-pressed="true"]').dataset.id),id,'Selected page UUID must match the clicked page');}
async function openEdit(id){await page.focus(edit(id));await page.key('Enter');await page.waitFor('rename input focus',()=>document.activeElement.id==='task-edit-input');}
async function exportPdf(profileDir,name,expected){
  const count=page.downloads.length;
  if(!await page.evaluate(()=>document.querySelector('#human-check').checked))await page.click('#human-check');
  assert.equal(await page.evaluate(()=>document.querySelector('#export-button').disabled),false,'Manual confirmation must enable PDF export');
  await page.click('#export-button');await page.waitFor('PDF result link',()=>!document.querySelector('#download-result').hidden);
  const end=Date.now()+12000;let event;
  while(Date.now()<end){event=page.downloads[count];if(event&&page.completed.has(event.guid))break;await delay(40);}
  assert.ok(event&&page.completed.has(event.guid),`A new browser PDF download must complete; observed ${page.downloads.length-count} new downloads`);
  assert.match(event.guid,/^[a-z0-9-]{1,80}$/i,'Browser download GUID must be a safe filename');assert.match(event.suggestedFilename,/^ScanProof-\d{4}-\d{2}-\d{2}\.pdf$/,'Browser download must use the app PDF filename');
  assert.equal(event.url,await page.evaluate(()=>document.querySelector('#download-result a').href),'Downloaded blob must be the current PDF result');
  const bytes=await readFile(join(profileDir,'downloads',event.guid)),result=assertPdfImages(bytes,expected,name);
  await writeFile(join(profileDir,name),bytes);return {bytes,result,guid:event.guid,href:event.url};
}

try{
  currentStep='setup: build';
  const build=spawnSync(process.execPath,[join(root,'scripts','build.mjs')],{cwd:root,encoding:'utf8',windowsHide:true});
  if(build.error||build.status!==0)throw Error(`Static build failed (${build.status}): ${build.error?.message||build.stderr||build.stdout}`);
  const files=new Map();for(const path of production)files.set('/'+path,await readFile(join(root,'dist',path)));
  currentStep='setup: loopback server';
  server=createServer((req,res)=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end();return;}if(path==='/')path='/index.html';
    const bytes=files.get(path);if(!bytes){res.writeHead(404);res.end();return;}
    const type=path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;report.origin=origin;
  currentStep='setup: installed browser';browser=await launchBrowser();report.browser=browser.version;
  for(const viewport of [{name:'desktop',width:1440,height:1000,mobile:false},{name:'mobile-390',width:390,height:844,mobile:true}]){
    currentProfile=viewport.name;const profileDir=join(output,viewport.name),fixtureDir=join(profileDir,'fixtures');await mkdir(fixtureDir,{recursive:true});await mkdir(join(profileDir,'downloads'));
    currentStep='setup: isolated browser context';page=await browser.newPage({...viewport,downloadPath:join(profileDir,'downloads')});await page.goto(origin);
    let fixtures,ids,q1,q2,q3,baseline,before,after;
    await check('clean startup is empty and cannot export',async()=>{
      assert.equal(await text('#page-count'),'0','Fresh browser context must start with zero pages');assert.equal(await text('#coverage-count'),'0 / 0');assert.equal(await page.evaluate(()=>document.querySelector('#export-button').disabled),true);assert.equal(await state(),null,'Fresh context must not contain a saved user draft');
    });
    await check('blank task input has a visible error and no mutation',async()=>{
      await page.fill('#task-input',' \n ');await page.click('#task-form button');assert.match(await text('#notice'),/хотя бы/);assert.equal(await text('#coverage-count'),'0 / 0');
    });
    await check('failed image batch is atomic; real JPG/PNG/WebP import succeeds',async()=>{
      fixtures=await createFixtures(page,fixtureDir);await page.files([fixtures.paths['A.jpg'],fixtures.paths.corrupt]);await idle();assert.equal(await text('#page-count'),'0','A valid + corrupt batch must not partially import');assert.match(await text('#notice'),/не импортирован/);
      await page.files(['A.jpg','B.png','C.webp'].map(n=>fixtures.paths[n]));await idle();await saved();assert.equal(await text('#page-count'),'3');
      await page.waitFor('three decoded thumbnails',()=>[...document.querySelectorAll('.page-thumbnail img')].length===3&&[...document.querySelectorAll('.page-thumbnail img')].every(i=>i.complete&&i.naturalWidth>100));
      assert.deepEqual((await state()).pages.map(p=>p.name),['A.jpg','B.png','C.webp']);ids=Object.fromEntries((await state()).pages.map(p=>[p.name,p.id]));
    });
    await check('manual task mapping produces exact 3/3 coverage',async()=>{
      await page.fill('#task-input','Algebra\nGeometry areaa\nGraph');await page.click('#task-form button');await saved();[q1,q2,q3]=(await state()).tasks.map(t=>t.id);
      for(const [name,tasks]of [['A.jpg',[q1,q2]],['B.png',[q2]],['C.webp',[q3]]]){await select(ids[name]);for(const task of tasks)await page.click(`#assignments input[data-task-id="${task}"]`);await saved();}
      assert.equal(await text('#coverage-count'),'3 / 3');assert.deepEqual((await state()).pages.map(p=>p.taskIds),[[q1,q2],[q2],[q3]]);
    });
    await check('keyboard selection, checkbox Space/Tab and repeated reorder keep focus',async()=>{
      await page.focus(card(ids['A.jpg'],'select'));await page.key('Enter');await saved();assert.equal((await active()).page,ids['A.jpg']);
      await page.focus(`#assignments input[data-task-id="${q1}"]`);await page.key('Space');assert.equal((await active()).task,q1);assert.equal(await text('#coverage-count'),'2 / 3');await page.key('Tab');assert.equal((await active()).task,q2,'Tab after Q1 must advance to Q2');
      await page.focus(`#assignments input[data-task-id="${q1}"]`);await page.key('Space');await saved();assert.equal(await text('#coverage-count'),'3 / 3');
      await page.focus(card(ids['C.webp'],'up'));await page.key('Space');assert.equal((await active()).action,'up');assert.equal((await active()).page,ids['C.webp']);await page.key('Space');await saved();assert.deepEqual((await state()).pages.map(p=>p.name),['C.webp','A.jpg','B.png']);assert.equal((await active()).page,ids['C.webp']);
    });
    await check('rotation and delete/undo preserve stable page/task IDs',async()=>{
      await select(ids['C.webp']);await page.focus('[data-action="rotate-right"]');await page.key('Enter');await idle();await saved();baseline=await state();assert.deepEqual(baseline.pages.map(p=>p.rotation),[90,0,0]);
      await page.click(card(ids['A.jpg'],'delete'));await saved();assert.equal(await text('#coverage-count'),'2 / 3');assert.equal((await state()).pages.filter(p=>p.taskIds.includes(q1)).length,0);assert.equal((await state()).pages.filter(p=>p.taskIds.includes(q2)).length,1);
      await page.click('[data-action="undo"]');await saved();assert.deepEqual((await state()).pages,baseline.pages);assert.equal(await text('#coverage-count'),'3 / 3');
    });
    const expected=[fixtures.expected['C.webp'][90],fixtures.expected['A.jpg'][0],fixtures.expected['B.png'][0]];
    await check('real PDF download has three correctly ordered/oriented images',async()=>{before=await exportPdf(profileDir,'before-rename.pdf',expected);return {sha256:before.result.sha256,pageCount:before.result.pages.length};});
    await check('PDF assertions reject wrong order and a truncated export',async()=>{
      assert.throws(()=>assertPdfImages(before.bytes,[expected[0],expected[2],expected[1]]),/image hash mismatch/,'Checker must detect a swapped A/B image');assert.throws(()=>inspectPdf(before.bytes.subarray(0,before.bytes.length-30)),/xref|trailer/,'Checker must detect a truncated PDF');
    });
    await check('rename with Enter retains UUID, both links and exact coverage',async()=>{
      const oldPages=(await state()).pages;await openEdit(q2);await page.fill('#task-edit-input','Geometry area');await page.key('Enter');await page.waitFor('rename form to close',()=>!document.querySelector('.task-edit-form'));await saved();
      const renamed=await state();assert.deepEqual(renamed.tasks.map(t=>t.id),[q1,q2,q3]);assert.equal(renamed.tasks[1].label,'Geometry area');assert.deepEqual(renamed.pages,oldPages);assert.equal(await text('#coverage-count'),'3 / 3');assert.equal((await active()).action,'edit-task');assert.equal((await active()).page,q2);assert.equal(await page.evaluate(()=>document.querySelector('#human-check').checked),false,'Changed task metadata must require a new manual check');
    });
    await check('empty/duplicate rename and Escape/Cancel keep the saved task',async()=>{
      const oldTasks=(await state()).tasks,oldPages=(await state()).pages;await openEdit(q2);await page.fill('#task-edit-input','');await page.key('Enter');assert.match(await text('#task-edit-error'),/Введите название/);
      await page.fill('#task-edit-input',' algebra ');await page.key('Enter');assert.match(await text('#task-edit-error'),/уже есть/);assert.deepEqual((await state()).tasks,oldTasks);await page.key('Escape');assert.equal((await active()).page,q2);
      await openEdit(q2);await page.fill('#task-edit-input','Discard this');await page.click('[data-action="cancel-task-edit"]');assert.deepEqual((await state()).tasks,oldTasks);assert.deepEqual((await state()).pages,oldPages);
    });
    await check('task-only rename leaves exported PDF bytes unchanged',async()=>{after=await exportPdf(profileDir,'after-rename.pdf',expected);assert.deepEqual(after.bytes,before.bytes,'Renaming a checklist label must not change the image PDF');assert.notEqual(after.guid,before.guid,'Must be a new browser download');});
    await check('view-only navigation keeps ready PDF and manual confirmation',async()=>{
      await select(ids['B.png']);assert.equal(await text('#page-details span'),'B.png');assert.equal(await page.evaluate(()=>document.querySelector('#human-check').checked),true);assert.equal(await page.evaluate(()=>document.querySelector('#download-result a').href),after.href);assert.equal((await state()).lastViewed,ids['B.png']);
    });
    await check('reload restores view/renamed links but resets confirmation and PDF',async()=>{
      const previous=await state();await page.reload();assert.equal(await text('#page-details span'),'B.png','Reload must restore last viewed B, not the last modified page');const restored=await state();assert.deepEqual(restored.tasks,previous.tasks);assert.deepEqual(restored.pages,previous.pages);assert.equal(await text('#coverage-count'),'3 / 3');
      assert.equal(await page.evaluate(()=>document.querySelector('#human-check').checked),false,'Manual confirmation must not survive reload');assert.equal(await page.evaluate(()=>document.querySelector('#download-result').hidden),true,'Ready PDF link must not survive reload');assert.equal(await page.evaluate(()=>document.querySelector('#export-button').disabled),true);
    });
    await check('PDF is genuinely recreated after a new confirmation',async()=>{const recreated=await exportPdf(profileDir,'after-reload.pdf',expected);assert.notEqual(recreated.guid,after.guid);assert.notEqual(recreated.href,after.href);assert.deepEqual(recreated.bytes,before.bytes,'Same unchanged images must produce the same PDF bytes after reload');});
    await check('repeat image import warns about exact bytes and preserves mappings',async()=>{
      await page.files([fixtures.paths.renamed]);await idle();await saved();assert.equal(await text('#page-count'),'4');assert.match(await text('#warnings'),/стр\. 4 = 2/);assert.equal(await text('#coverage-count'),'3 / 3');const duplicate=(await state()).pages[3];await page.click(card(duplicate.id,'delete'));await saved();assert.deepEqual((await state()).pages,baseline.pages);
    });
    await check('390px-compatible editor uses Tab/Escape without overflow',async()=>{
      await openEdit(q2);assert.equal(await page.evaluate(width=>document.documentElement.scrollWidth<=width,viewport.width),true);assert.equal(await page.evaluate(width=>{const r=document.querySelector('.task-edit-form').getBoundingClientRect();return r.left>=0&&r.right<=width;},viewport.width),true);await page.key('Tab');assert.equal((await active()).tag,'BUTTON');assert.equal(await page.evaluate(()=>document.activeElement.type),'submit');await page.key('Escape');assert.equal((await active()).page,q2);
    });
    await check('no page exceptions, broken assets or upload/external requests',async()=>{
      assert.deepEqual(page.errors,[],'Page must not emit uncaught JS exceptions');assert.deepEqual(page.responses,[],'All app assets must return successful HTTP responses');assert.deepEqual(page.requests.filter(r=>!r.url.startsWith(origin+'/')&&!r.url.startsWith('blob:'+origin+'/')&&r.url!=='about:blank'),[],'App requests must stay on the test origin/blob URLs');assert.deepEqual(page.requests.filter(r=>!['GET','HEAD'].includes(r.method)),[],'App must not upload files or send mutating requests');
    });
    await page.evaluate(()=>document.querySelector('#notice').hidden=true);await page.screenshot(join(profileDir,'success.png'));report.profiles.push({...viewport,requests:page.requests,export:before.result});await page.dispose();page=null;
  }
  report.status='passed';
}catch(error){
  report.status='failed';report.failure={profile:currentProfile,step:currentStep,message:error.message,stack:error.stack};console.error(`FAIL [${currentProfile}] ${currentStep}\n${error.message}`);
  if(page){report.failure.ui=await page.evaluate(()=>({pageCount:document.querySelector('#page-count')?.textContent,coverage:document.querySelector('#coverage-count')?.textContent,saveStatus:document.querySelector('#save-status')?.textContent,notice:document.querySelector('#notice')?.textContent,active:{tag:document.activeElement?.tagName,id:document.activeElement?.id,action:document.activeElement?.dataset.action}})).catch(error=>({unavailable:error.message}));await page.screenshot(join(output,'failure.png')).catch(error=>{report.failure.screenshotError=error.message;});}
  process.exitCode=1;
}finally{
  if(browser)await browser.close().catch(error=>{cleanupError=error.message;});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.profileCleaned=!!browser&&!cleanupError;report.serverClosed=!server?.listening;
  if(cleanupError){report.status='failed';report.errors.push(`Teardown: ${cleanupError}`);process.exitCode=1;}
  report.productionUnchanged=true;for(const path of production)if(sha(await readFile(join(root,path)))!==initialHashes[path]){report.productionUnchanged=false;report.status='failed';report.errors.push(`Production file changed: ${path}`);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`SMOKE ${report.status.toUpperCase()}: ${report.steps.filter(s=>s.status==='passed').length}/${report.steps.length} checks. Report: ${join(output,'report.json')}`);
}
