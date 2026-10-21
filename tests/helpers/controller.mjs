import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
export const turn=()=>new Promise(setImmediate);

// Run the actual controller and core. Only DOM, storage and image decoding are adapters.
// No personal profiles/files, native prompts, timing claims or network are involved.
export async function controller({openFails=false,writeFails=false,saved}={}){
  const elements=new Map(),windowHandlers=new Map(),documentHandlers=new Map();
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'',textContent:'',innerHTML:'',hidden:false,checked:false,disabled:false,handlers:new Map(),classList:{toggle(){},add(){},remove(){}},addEventListener(name,fn){this.handlers.set(name,fn);},showModal(){},close(){},focus(){},select(){}});
    return elements.get(selector);
  };
  const body={dataset:{},matches:()=>false,isConnected:true};
  const document={body,activeElement:body,querySelector:s=>s==='dialog[open]'?null:element(s),querySelectorAll:()=>[],getElementById:id=>element('#'+id),addEventListener(name,fn){documentHandlers.set(name,fn);},createElement:()=>({click(){}})};
  const storage={saved,openFails,writeFails,contentGate:null,selectionGate:null,writes:0,selectionWrites:0,async acquireDraftLock(){return true;},async openDraft(){if(this.openFails)throw Error('synthetic IDB denial');},async readDraft(){return this.saved;},async readSelection(){return this.selected;},async writeDraft(value){this.writes++;if(this.contentGate)await this.contentGate();if(this.writeFails)throw Error('synthetic quota failure');this.saved=value;this.selected=undefined;},async writeSelection(id){this.selectionWrites++;if(this.selectionGate)await this.selectionGate();this.selected=id;},async eraseDraft(){this.saved=undefined;this.selected=undefined;}};
  const context=vm.createContext({console,TextEncoder,Uint8Array,DataView,Blob,File,crypto,structuredClone,document,window:{addEventListener(name,fn){windowHandlers.set(name,fn);}},URL:{createObjectURL:()=> 'blob:synthetic-fixture',revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){},__storage:storage});
  const source=await readFile(new URL('../../src/app.mjs',import.meta.url),'utf8');
  const app=new vm.SourceTextModule(source.replace(/init\(\);\s*$/,'globalThis.__init=init();globalThis.__inspect=()=>({state,busy,ready,dbReady,recoveryMode,unsavedContent,saveQueue});globalThis.__import=importFiles;'),{context});
  const core=new vm.SourceTextModule(await readFile(new URL('../../src/core.mjs',import.meta.url),'utf8'),{context});
  const store=new vm.SourceTextModule(['acquireDraftLock','openDraft','readDraft','writeDraft','readSelection','writeSelection','eraseDraft'].map(name=>`export const ${name}=(...args)=>__storage.${name}(...args);`).join('\n'),{context});
  const images=new vm.SourceTextModule(`export async function importImage(file){return{id:crypto.randomUUID(),name:file.name,size:file.size,blob:file,preview:new Blob(['synthetic preview'],{type:'image/jpeg'}),width:1,height:1,rotation:0,hash:'a'.repeat(64),taskIds:[],analysis:{blank:false,darkRatio:.1,deviation:3}};}export async function drawPage(){throw Error('No PDF/image operations in durability tests');}export async function canvasBlob(){throw Error('No encoding in durability tests');}export async function demoFiles(){return [];}export async function tick(){}`,{context});
  await app.link(path=>({'./core.mjs':core,'./storage.mjs':store,'./images.mjs':images}[path]));await app.evaluate();await context.__init;
  const inspect=()=>context.__inspect(),flush=async()=>{await inspect().saveQueue;};
  return {storage,element,inspect,flush,
    unload(){const event={defaultPrevented:false,returnValue:undefined,preventDefault(){this.defaultPrevented=true;}};windowHandlers.get('beforeunload')(event);return event;},
    async task(label,{wait=true}={}){element('#task-input').value=label;await element('#task-form').handlers.get('submit')({preventDefault(){}});if(wait)await flush();},
    async importPages(){await context.__import([new File(['synthetic A'],'A.png',{type:'image/png'}),new File(['synthetic B'],'B.png',{type:'image/png'})]);await flush();},
    async select(id){const button={dataset:{action:'select',id}};await documentHandlers.get('click')({target:{closest:selector=>selector==='[data-action]'?button:null}});},
    async clear(){await element('#confirm-clear').handlers.get('click')();}
  };
}
