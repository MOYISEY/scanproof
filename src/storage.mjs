const NAME='scanproof-local-v1';
let db;
// Hold the browser lock until this document closes. A second tab cannot overwrite it.
export function acquireDraftLock() {
  if(!navigator.locks)return Promise.resolve(false);
  return new Promise((resolve,reject)=>{
    navigator.locks.request('scanproof-local-draft-v1',{ifAvailable:true},async lock=>{
      if(!lock){resolve(false);return;}
      resolve(true);await new Promise(()=>{});
    }).catch(reject);
  });
}
export function openDraft() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('draft');
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error('Хранилище занято другой вкладкой.'));
    request.onsuccess=()=>{db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  });
}
function transaction(mode,action) {
  return new Promise((resolve,reject)=>{
    if(!db){reject(Error('Хранилище недоступно'));return;}
    const tx=db.transaction('draft',mode);let value;
    const req=action(tx.objectStore('draft'));if(req)req.onsuccess=()=>{value=req.result;};
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Транзакция отменена'));
  });
}
export const readDraft=()=>transaction('readonly',store=>store.get('current'));
export const readSelection=()=>transaction('readonly',store=>store.get('selection'));
export const writeSelection=id=>transaction('readwrite',store=>store.put(id,'selection'));
export const writeDraft=draft=>transaction('readwrite',store=>{store.delete('selection');return store.put(draft,'current');});
export const eraseDraft=()=>transaction('readwrite',store=>store.clear());
