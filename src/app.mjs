import {LIMITS,validateBatch,movePage,removePage,restorePage,review,addTasks,makePdf,validateDraft} from './core.mjs';
import {acquireDraftLock,openDraft,readDraft,writeDraft,eraseDraft} from './storage.mjs';
import {importImage,drawPage,canvasBlob,demoFiles,tick} from './images.mjs';
const $=s=>document.querySelector(s), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={pages:[],tasks:[],selected:null},undo=[],busy=false,importToken=null,dbReady=false,ready=false,recoveryMode=false,saveQueue=Promise.resolve(),revision=0,downloadUrl=null,noticeTimer,busyFocus=null,zoomReturnFocus=null;
const urls=new Map();
const current=()=>state.pages.find(p=>p.id===state.selected);
function previewUrl(p){if(!urls.has(p.id))urls.set(p.id,URL.createObjectURL(p.preview));return urls.get(p.id);}
function release(id){if(urls.has(id)){URL.revokeObjectURL(urls.get(id));urls.delete(id);}}
function notice(message,error=false){clearTimeout(noticeTimer);$('#notice').textContent=message;$('#notice').classList.toggle('error',error);$('#notice').hidden=false;noticeTimer=setTimeout(()=>$('#notice').hidden=true,error?18000:8000);}
function invalidate(){revision++;$('#human-check').checked=false;if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}$('#download-result').hidden=true;}
function persist(){
  if(recoveryMode){document.querySelector('#save-status').textContent='Повреждённый черновик сохранён; автосохранение приостановлено';return;}
  if(!dbReady){$('#save-status').textContent='Недоступен — сохраните PDF перед закрытием';return;}
  $('#save-status').textContent='Сохраняем на устройстве…';
  // Serialize writes and capture state now, so older writes never win races.
  const saved=structuredClone({version:1,pages:state.pages,tasks:state.tasks,selected:state.selected,savedAt:new Date().toISOString()});
  const rev=revision;
  saveQueue=saveQueue.then(()=>writeDraft(saved)).then(()=>{if(rev===revision)$('#save-status').textContent='Сохранён в этом браузере';}).catch(()=>{$('#save-status').textContent='Не сохранён: мало места или запрет браузера';notice('Не удалось сохранить черновик. Текущая работа остаётся открытой. Скачайте PDF перед закрытием.',true);});
}
function changed(){invalidate();render();persist();}
function rememberFocus(element=document.activeElement){
  if(!element?.matches('button,input,textarea,a,[tabindex]'))return null;
  if(element.id)return {elementId:element.id};
  const regionId=element.closest('[id]')?.id;
  if(!regionId)return null;
  if(element.matches('input[data-task-id]'))return {regionId,taskId:element.dataset.taskId};
  if(element.dataset.action)return {regionId,action:element.dataset.action,pageId:element.dataset.id,taskId:element.closest('.task-card')?.dataset.taskId};
  return null;
}
function restoreFocus(mark){
  if(!mark||busy||document.querySelector('dialog[open]'))return;
  const region=mark.regionId?document.getElementById(mark.regionId):null;
  let target=mark.elementId?document.getElementById(mark.elementId):mark.action?
    [...(region?.querySelectorAll('[data-action]')||[])].find(e=>e.dataset.action===mark.action&&e.dataset.id===mark.pageId&&e.closest('.task-card')?.dataset.taskId===mark.taskId):
    [...(region?.querySelectorAll('input[data-task-id]')||[])].find(e=>e.dataset.taskId===mark.taskId);
  // The move button at the first/last position becomes disabled; keep focus on its page.
  if((!target||target.disabled)&&mark.pageId)target=[...document.querySelectorAll('#page-list .page-select')].find(e=>e.dataset.id===mark.pageId)||document.querySelector('#page-list .page-select');
  if(target&&!target.disabled)target.focus({preventScroll:true});
}
function lock(value){if(value&&!busy)busyFocus=rememberFocus();busy=value;render();if(!value){if(document.activeElement===document.body)restoreFocus(busyFocus);busyFocus=null;}}
function render(){
  const focused=document.activeElement,focusMark=rememberFocus(focused);
  const r=review(state.pages,state.tasks),p=current();
  $('#page-count').textContent=state.pages.length;$('#drop-zone').hidden=state.pages.length>0;$('#page-hint').textContent=state.pages.length?`${(state.pages.reduce((s,p)=>s+p.size,0)/1024/1024).toFixed(1)} из 50 МБ · Стрелки меняют порядок. Можно перетаскивать.`:'HEIC, PDF и анимация не поддерживаются. Ошибка импорта не затронет черновик.';
  $('#page-list').innerHTML=state.pages.map((page,i)=>`<article class="page-card ${page.id===state.selected?'selected':''}" data-id="${page.id}" draggable="${!busy}" aria-label="Страница ${i+1}"><button class="page-select" data-action="select" data-id="${page.id}" aria-pressed="${page.id===state.selected}"><span class="page-thumbnail"><img src="${previewUrl(page)}" alt="Миниатюра страницы ${i+1}"></span><span class="page-card-info"><strong><span class="page-number">${String(i+1).padStart(2,'0')}</span> Страница ${i+1}</strong><small title="${esc(page.name)}">${esc(page.name)}</small><span class="page-tags">${r.duplicates.some(d=>d.page.id===page.id)?'<span class="tag warning-tag">Дубликат</span>':''}${page.analysis.blank?'<span class="tag warning-tag">Проверьте пустоту</span>':''}<span class="tag">${page.taskIds.filter(id=>state.tasks.some(t=>t.id===id)).length} зад.</span></span></span></button><div class="page-actions"><button class="icon-button" data-action="up" data-id="${page.id}" aria-label="Страница ${i+1}: выше" ${i===0||busy?'disabled':''}>↑</button><button class="icon-button" data-action="down" data-id="${page.id}" aria-label="Страница ${i+1}: ниже" ${i===state.pages.length-1||busy?'disabled':''}>↓</button><button class="icon-button delete-button" data-action="delete" data-id="${page.id}" aria-label="Удалить страницу ${i+1}" ${busy?'disabled':''}>×</button></div></article>`).join('');
  $('#viewer-title').textContent=p?`Страница ${state.pages.indexOf(p)+1} из ${state.pages.length}`:'Ваша работа — здесь';$('#viewer-tools').hidden=!p;
  if(p)$('#viewer-stage').innerHTML=`<button class="preview-button" data-action="zoom" aria-label="Открыть страницу крупно"><img class="preview-image" src="${previewUrl(p)}" alt="${esc(p.name)}, текущая ориентация"><span class="preview-zoom">⤢ Открыть крупно</span></button>`;
  else $('#viewer-stage').innerHTML='<div class="viewer-empty"><div class="sheet-illustration" aria-hidden="true"><span>1.</span><i></i><i></i><i></i><span>2.</span><i></i><i></i></div><h3>От фотографий к готовой работе</h3><p>Начните с импорта или откройте пример.<br>Затем проверьте порядок и читаемость.</p></div>';
  $('#page-details').hidden=!p;if(p)$('#page-details').innerHTML=`<span>${esc(p.name)}</span><span>${p.width} × ${p.height} px · поворот ${p.rotation}°</span>`;
  $('#assignments').hidden=!p;if(p)$('#assignments').innerHTML=`<h3>Что есть на этой странице?</h3><p>Отметьте задания после визуальной проверки.</p><div class="assignment-options">${state.tasks.length?state.tasks.map(t=>`<label><input type="checkbox" data-task-id="${t.id}" ${p.taskIds.includes(t.id)?'checked':''} ${busy?'disabled':''}><span>${esc(t.label)}</span></label>`).join(''):'<span class="muted">Сначала добавьте ожидаемые задания в чеклист.</span>'}</div>`;
  $('#coverage-count').textContent=`${state.tasks.length-r.unassigned.length} / ${state.tasks.length}`;
  $('#coverage-empty').hidden=state.tasks.length>0;
  $('#task-list').innerHTML=state.tasks.map(t=>{const pages=state.pages.map((p,i)=>p.taskIds.includes(t.id)?{p,i}:null).filter(Boolean);return `<div data-task-id="${t.id}" class="task-card ${pages.length?'covered':''}"><span class="task-status" aria-label="${pages.length?'Есть привязка':'Нет привязки'}">${pages.length?'✓':'○'}</span><div><strong>${esc(t.label)}</strong><span>${pages.length?pages.map(({p,i})=>`<button class="page-link" data-action="select" data-id="${p.id}">стр. ${i+1}</button>`).join(' · '):'Нет привязанных страниц'}</span></div><button class="icon-button" data-action="delete-task" data-id="${t.id}" aria-label="Удалить задание ${esc(t.label)}" ${busy?'disabled':''}>×</button></div>`;}).join('');
  const warning=(tone,text)=>`<div class="check-row ${tone}"><span aria-hidden="true">${tone==='ok'?'✓':'!'}</span><p>${text}</p></div>`;
  $('#warnings').innerHTML=[!state.tasks.length?warning('warn','Список заданий пока не задан. Покрытие не проверено.'):r.unassigned.length?warning('warn',`Без привязки: ${r.unassigned.length} из ${state.tasks.length} заданий.`):warning('ok',`У всех ${state.tasks.length} заданий есть ручная привязка.`),r.duplicates.length?warning('warn',`Точные дубликаты: ${r.duplicates.map(d=>`стр. ${state.pages.indexOf(d.page)+1} = ${state.pages.indexOf(d.original)+1}`).join('; ')}.`):warning('ok','Точных дубликатов не найдено.'),r.blank.length?warning('warn',`Подозрительно пустые: ${r.blank.map(p=>`стр. ${state.pages.indexOf(p)+1}`).join(', ')}. Проверьте вручную.`):warning('ok','Эвристика не отметила пустых страниц.'),r.unmapped.length&&state.tasks.length?warning('warn',`Страниц без заданий: ${r.unmapped.length}. Это может быть обложка.`):''].join('');
  $('#export-button').disabled=!ready||busy||!state.pages.length||!$('#human-check').checked;
  $('#export-note').textContent=!state.pages.length?'Добавьте хотя бы одну страницу.':!$('#human-check').checked?'Экспорт доступен после вашей проверки.':`A4 · ${state.pages.length} стр. · текущий порядок`;
  for(const el of [$('#import-button'),$('#demo-button'),$('#task-input'),$('#task-form button'),$('#clear-button'),$('#human-check'),...document.querySelectorAll('#viewer-tools button')])el.disabled=busy||!ready;
  $('#undo-area').hidden=!undo.length;$('#undo-area').innerHTML=undo.length?`<span title="Восстановление доступно до следующего импорта или перезагрузки">Удалена: ${esc(undo.at(-1).page.name)}<small>До импорта или перезагрузки</small></span><button data-action="undo" class="text-button" ${busy?'disabled':''}>Восстановить${undo.length>1?` (${undo.length})`:''}</button>`:'';
  if(!focused.isConnected||focused.disabled)restoreFocus(focusMark);
}
async function importFiles(files,{demo=false}={}){
  if(busy||!ready)return;
  const error=validateBatch(files,state.pages);if(error){notice(error,true);return;}
  const token={cancelled:false};importToken=token;lock(true);$('#import-progress').hidden=false;const staged=[];
  try{
    for(let i=0;i<files.length;i++) {
      $('#import-status').textContent=`Подготовка ${i+1} из ${files.length}…`;await tick();if(token.cancelled)break;
      try{staged.push(await importImage(files[i]));}catch(e){throw Error(`${files[i].name}: ${e.message}`);}
      await tick();if(token.cancelled)break;
    }
    if(token.cancelled){notice('Импорт отменён. Текущая работа сохранена.');return;}
    const nextTasks=demo?addTasks(state.tasks,'Задание 1: уравнение\nЗадание 2: площадь\nЗадание 3: доказательство',()=>crypto.randomUUID()):state.tasks;
    state.pages=[...state.pages,...staged];state.selected=staged[0].id;state.tasks=nextTasks;
    for(const removed of undo)release(removed.page.id);
    undo=[];changed();notice(`Добавлено страниц: ${staged.length}.${demo?' Пример синтетический; страница 3 намеренно пустая.':''}`);
  }catch(e){notice(`Набор не импортирован. ${e.message} Текущая работа не изменена.`,true);}
  finally{importToken=null;$('#file-input').value='';$('#import-progress').hidden=true;lock(false);}
}
async function rotate(delta){const p=current();if(!p||busy)return;lock(true);try{const next={...p,rotation:(p.rotation+delta+360)%360};next.preview=await canvasBlob(await drawPage(next,1100));release(p.id);state.pages=state.pages.map(a=>a.id===p.id?next:a);changed();}catch{notice('Не удалось повернуть страницу. Оригинал сохранён.',true);}finally{lock(false);}}
async function openZoom(opener){const p=current();if(!p||busy)return;zoomReturnFocus=rememberFocus(opener);lock(true);try{const c=await drawPage(p,Math.max(p.width,p.height));c.setAttribute('role','img');c.setAttribute('aria-label',`Страница ${state.pages.indexOf(p)+1}, крупный просмотр`);$('#zoom-title').textContent=`Страница ${state.pages.indexOf(p)+1} · проверьте читаемость`;$('#zoom-body').replaceChildren(c);$('#zoom-body').classList.remove('actual');$('#zoom-toggle').textContent='Масштаб 100%';$('#zoom-dialog').showModal();}catch{notice('Не удалось открыть крупный просмотр.',true);}finally{lock(false);}}
document.addEventListener('click',async e=>{
  const close=e.target.closest('[data-close]');if(close){$('#'+close.dataset.close).close();return;}
  const button=e.target.closest('[data-action]');if(!button||busy)return;const {action,id}=button.dataset;
  if(action==='select'){state.selected=id;render();return;}
  if(action==='rotate-left')return rotate(-90);if(action==='rotate-right')return rotate(90);if(action==='zoom')return openZoom(button);
  if(action==='up'||action==='down'){state.pages=movePage(state.pages,id,state.pages.findIndex(p=>p.id===id)+(action==='up'?-1:1));changed();}
  if(action==='delete'){const result=removePage(state.pages,id);state.pages=result.pages;if(result.removed)undo.push(result.removed);if(state.selected===id)state.selected=state.pages[Math.min(result.removed.index,state.pages.length-1)]?.id||null;changed();notice('Страница удалена. Привязки можно вернуть кнопкой «Восстановить».');}
  if(action==='undo'){const item=undo.at(-1);if(!item)return;const error=validateBatch([{name:item.page.name,size:item.page.size}],state.pages);if(error){notice(error,true);return;}state.pages=restorePage(state.pages,undo.pop());state.selected=item.page.id;changed();}
  if(action==='delete-task'){state.tasks=state.tasks.filter(t=>t.id!==id);state.pages=state.pages.map(p=>({...p,taskIds:p.taskIds.filter(t=>t!==id)}));undo=undo.map(u=>({...u,page:{...u.page,taskIds:u.page.taskIds.filter(t=>t!==id)}}));changed();}
});
$('#assignments').addEventListener('change',e=>{const p=current(),id=e.target.dataset.taskId;if(!p||!id||busy)return;p.taskIds=e.target.checked?[...new Set([...p.taskIds,id])]:p.taskIds.filter(t=>t!==id);changed();});
$('#task-form').addEventListener('submit',e=>{e.preventDefault();if(busy||!ready)return;try{state.tasks=addTasks(state.tasks,$('#task-input').value,()=>crypto.randomUUID());$('#task-input').value='';changed();}catch(e){notice(e.message,true);}});
$('#human-check').addEventListener('change',render);
$('#import-button').addEventListener('click',()=>$('#file-input').click());$('#drop-zone').addEventListener('click',()=>{if(!busy&&ready)$('#file-input').click();});$('#drop-zone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy&&ready)$('#file-input').click();}});
$('#file-input').addEventListener('change',e=>importFiles([...e.target.files]));$('#file-input').addEventListener('cancel',()=>notice('Выбор файлов закрыт. Работа не изменена.'));
$('#cancel-import').addEventListener('click',()=>{if(importToken){importToken.cancelled=true;$('#import-status').textContent='Отменяем импорт…';}});
let dragId=null;
$('#page-list').addEventListener('dragstart',e=>{if(busy){e.preventDefault();return;}dragId=e.target.closest('[data-id]')?.dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId||'');});
$('#page-list').addEventListener('dragover',e=>{if(dragId){e.preventDefault();e.dataTransfer.dropEffect='move';}});
$('#page-list').addEventListener('drop',e=>{if(!dragId||busy)return;e.preventDefault();const target=e.target.closest('.page-card')?.dataset.id;if(target){state.pages=movePage(state.pages,dragId,state.pages.findIndex(p=>p.id===target));changed();}dragId=null;});
$('#page-list').addEventListener('dragend',()=>dragId=null);
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();$('.pages-panel').classList.add('drag-over');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('.pages-panel').classList.remove('drag-over');});
document.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();$('.pages-panel').classList.remove('drag-over');importFiles([...e.dataTransfer.files]);}});
$('#demo-button').addEventListener('click',async()=>{if(busy||!ready)return;lock(true);try{const files=await demoFiles();lock(false);await importFiles(files,{demo:true});}catch{lock(false);notice('Не удалось подготовить пример.',true);}});
$('#help-button').addEventListener('click',()=>$('#help-dialog').showModal());
$('#zoom-toggle').addEventListener('click',()=>{$('#zoom-body').classList.toggle('actual');$('#zoom-toggle').textContent=$('#zoom-body').classList.contains('actual')?'Вписать страницу':'Масштаб 100%';});
$('#zoom-dialog').addEventListener('close',()=>{$('#zoom-body').replaceChildren();restoreFocus(zoomReturnFocus);zoomReturnFocus=null;});
$('#clear-button').addEventListener('click',()=>$('#clear-dialog').showModal());
$('#confirm-clear').addEventListener('click',async()=>{if(busy)return;$('#clear-dialog').close();lock(true);await saveQueue;try{if(dbReady)await eraseDraft();for(const id of urls.keys())release(id);state={pages:[],tasks:[],selected:null};undo=[];recoveryMode=false;invalidate();$('#save-status').textContent=dbReady?'Черновик удалён с устройства':'Хранилище недоступно';notice(dbReady?'Черновик удалён.':'Текущая работа очищена. Хранилище недоступно; сохранённые данные удаляются в настройках браузера.',!dbReady);}catch{notice('Не удалось удалить сохранённый черновик. Закройте другие вкладки и повторите.',true);}finally{lock(false);}});
$('#export-button').addEventListener('click',async()=>{
  if(busy||!state.pages.length||!$('#human-check').checked)return;
  lock(true);const images=[];
  try{for(let i=0;i<state.pages.length;i++){$('#export-note').textContent=`Готовим PDF: ${i+1} из ${state.pages.length}…`;await tick();const c=await drawPage(state.pages[i],3200);const jpeg=new Uint8Array(await (await canvasBlob(c)).arrayBuffer());images.push({width:c.width,height:c.height,jpeg});c.width=c.height=1;}
    const pdf=makePdf(images);downloadUrl=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));const name=`ScanProof-${new Date().toISOString().slice(0,10)}.pdf`;
    const a=document.createElement('a');a.href=downloadUrl;a.download=name;a.click();
    $('#download-result').hidden=false;$('#download-result').innerHTML=`<strong>PDF подготовлен · ${(pdf.length/1024/1024).toFixed(1)} МБ</strong><a href="${downloadUrl}" download="${name}">Скачать PDF ещё раз</a><span>Откройте файл и проверьте результат перед отправкой.</span>`;notice('PDF подготовлен в выбранном порядке. Проверьте скачанный файл.');
  }catch(e){notice(`Экспорт не выполнен: ${e.message} Текущая работа сохранена.`,true);}finally{lock(false);}
});
window.addEventListener('beforeunload',e=>{if(busy||$('#save-status').textContent.includes('Сохраняем')||((!dbReady||recoveryMode)&&state.pages.length)||$('#save-status').textContent.startsWith('Не сохранён')){e.preventDefault();e.returnValue='';}});
async function init(){
  render();
  try{
    const ownsLock=await acquireDraftLock();
    if(!ownsLock){
      $('#save-status').textContent='Занят другой вкладкой или браузер не поддерживает блокировку';
      $('#viewer-title').textContent='Черновик защищён от перезаписи';
      notice('Откройте ScanProof в одной вкладке. Закройте другие вкладки и обновите эту. Если это не помогает, нужен современный браузер с Web Locks.',true);
      document.body.dataset.ready='blocked';return;
    }
    try{
      await openDraft();dbReady=true;const saved=await readDraft();
      if(saved!==undefined){
        try{
          const restored=validateDraft(saved),verified=[];
          for(let i=0;i<restored.pages.length;i++){
            $('#save-status').textContent=`Проверяем черновик: ${i+1} из ${restored.pages.length}…`;
            const p=restored.pages[i],fresh=await importImage(new File([p.blob],p.name,{type:p.blob.type}));
            if(fresh.hash!==p.hash||fresh.width!==p.width||fresh.height!==p.height)throw Error('Данные фотографии не совпадают.');
            const next={...fresh,id:p.id,rotation:p.rotation,taskIds:p.taskIds};
            if(p.rotation)next.preview=await canvasBlob(await drawPage(next,1100));verified.push(next);
          }
          state={...restored,pages:verified};if(state.pages.length)notice('Локальный черновик восстановлен. Проверьте страницы перед экспортом.');
        }catch{
          recoveryMode=true;state={pages:[],tasks:[],selected:null};
          notice('Локальный черновик повреждён или несовместим. Исходная запись сохранена, автосохранение приостановлено. Кнопка «Удалить локальный черновик» позволяет начать заново.',true);
        }
      }
      $('#save-status').textContent=recoveryMode?'Повреждённый черновик сохранён; автосохранение приостановлено':state.pages.length||state.tasks.length?'Восстановлен в этом браузере':'Хранится только в этом браузере';
    }
    catch{dbReady=false;$('#save-status').textContent='Недоступен — сохраните PDF перед закрытием';notice('Локальное хранилище недоступно. Можно работать, но черновик исчезнет после закрытия.',true);}
    ready=true;document.body.dataset.ready='true';render();
  }catch{notice('Не удалось безопасно открыть черновик. Закройте другие вкладки и обновите страницу.',true);document.body.dataset.ready='blocked';}
}
init();
