import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,realpath,lstat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute,basename,sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export function findBrowser(){
  const configured=process.env.SCANPROOF_BROWSER||process.env.CHROME_BIN;
  if(configured){if(!existsSync(configured))throw Error(`Configured browser does not exist: ${configured}. No browser is installed by this suite.`);return configured;}
  const candidates=process.platform==='win32'?[
    join(process.env.PROGRAMFILES||'C:\\Program Files','Google','Chrome','Application','chrome.exe'),
    join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe')
  ]:process.platform==='darwin'?[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  const browser=candidates.find(existsSync);
  if(!browser)throw Error('No installed Chrome/Edge found. Set SCANPROOF_BROWSER (or CHROME_BIN) to an existing executable. This suite never downloads a browser.');
  return browser;
}

export async function launchBrowser(){
  const executable=findBrowser(),tempRoot=await realpath(tmpdir()),profile=await mkdtemp(join(tempRoot,'scanproof-smoke-'));
  let socket,child,exited=false,stderr='',nextId=0;
  const pending=new Map(),listeners=new Map();
  const on=(method,handler)=>{if(!listeners.has(method))listeners.set(method,new Set());listeners.get(method).add(handler);return()=>listeners.get(method)?.delete(handler);};
  async function removeProfile(){
    const stat=await lstat(profile);if(stat.isSymbolicLink())throw Error('Refusing to clean a symlink browser profile');
    const target=await realpath(profile),rel=relative(tempRoot,target);
    if(isAbsolute(rel)||rel.startsWith('..')||rel.includes(sep)||!basename(target).startsWith('scanproof-smoke-'))throw Error('Unsafe temporary profile cleanup target');
    await rm(target,{recursive:true,force:true,maxRetries:8,retryDelay:150});
  }
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    if(!socket||socket.readyState!==WebSocket.OPEN){reject(Error(`CDP ${method}: browser connection is closed`));return;}
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP ${method}: response timed out after 10 seconds`));},10000);
    pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  async function close(){
    if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error(`CDP ${item.method}: browser teardown`));}pending.clear();
    for(let i=0;child&&!exited&&i<40;i++)await delay(100);
    if(child&&!exited){child.kill();for(let i=0;!exited&&i<20;i++)await delay(100);}
    await removeProfile();
  }
  try{
    child=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-dev-shm-usage','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-12000);});child.once('exit',()=>{exited=true;});
    let spawnError;child.once('error',error=>{spawnError=error;exited=true;});
    let port;
    for(let i=0;i<150;i++){
      if(spawnError)throw spawnError;
      if(exited)throw Error(`Browser exited before startup. ${stderr.slice(-1800)}`);
      try{const first=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];if(/^\d+$/.test(first)){port=Number(first);break;}}catch{}
      await delay(100);
    }
    if(!port)throw Error(`Browser startup timed out. ${stderr.slice(-1800)}`);
    const versionResponse=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(5000)});
    if(!versionResponse.ok)throw Error(`Browser version endpoint returned ${versionResponse.status}`);
    const version=await versionResponse.json();socket=new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser WebSocket startup timed out')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Browser WebSocket failed to open'));},{once:true});});
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(`CDP ${item.method}: ${message.error.message}`)):item.resolve(message.result);}
      else for(const handler of listeners.get(message.method)||[])handler(message.params,message.sessionId);
    };
    socket.onclose=()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error(`CDP ${item.method}: browser disconnected`));}pending.clear();};
    return {version:version.Browser,close,async newPage({width,height,mobile,downloadPath}){
      const {browserContextId}=await send('Target.createBrowserContext');
      const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
      const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
      const command=(method,params={})=>send(method,params,sessionId),errors=[],requests=[],responses=[],downloads=[],completed=new Set(),unsubscribers=[];
      const listen=(method,handler)=>unsubscribers.push(on(method,(event,eventSession)=>{if(!eventSession||eventSession===sessionId)handler(event);}));
      listen('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text));
      listen('Network.requestWillBeSent',event=>requests.push({url:event.request.url,method:event.request.method}));
      listen('Network.responseReceived',event=>{if(event.response.status>=400)responses.push({url:event.response.url,status:event.response.status});});
      listen('Browser.downloadWillBegin',event=>downloads.push(event));listen('Browser.downloadProgress',event=>{if(event.state==='completed')completed.add(event.guid);});
      await command('Page.enable');await command('Runtime.enable');await command('DOM.enable');await command('Network.enable');
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await command('Emulation.setTouchEmulationEnabled',{enabled:mobile});
      await send('Browser.setDownloadBehavior',{behavior:'allowAndName',browserContextId,downloadPath,eventsEnabled:true});
      const evaluate=async(fn,...args)=>{
        const expression=typeof fn==='function'?`(${fn.toString()})(...${JSON.stringify(args)})`:fn;
        const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
        if(result.exceptionDetails)throw Error(`Page evaluation: ${result.exceptionDetails.exception?.description||result.exceptionDetails.text}`);
        return result.result.value;
      };
      const waitFor=async(description,fn,...args)=>{
        const end=Date.now()+12000;let last;
        while(Date.now()<end){try{last=await evaluate(fn,...args);if(last)return last;}catch(error){if(!/context was destroyed|Cannot find context|Inspected target navigated/i.test(error.message))throw error;}await delay(40);}
        throw Error(`Timed out waiting for ${description}. Last result: ${JSON.stringify(last)}`);
      };
      const key=async key=>{
        const map={Enter:['Enter',13],Space:['Space',32],Tab:['Tab',9],Escape:['Escape',27]};if(!map[key])throw Error(`Unsupported smoke key: ${key}`);
        const [code,number]=map[key],value=key==='Space'?' ':key;
        for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:value,code,windowsVirtualKeyCode:number,nativeVirtualKeyCode:number,...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});
      };
      const focus=async selector=>{const found=await evaluate(s=>{const e=document.querySelector(s);if(!e||e.disabled)return false;e.focus();return document.activeElement===e;},selector);if(!found)throw Error(`Cannot focus ${selector}: absent, disabled or not focusable`);};
      const click=async selector=>{
        const point=await evaluate(s=>{const e=document.querySelector(s);if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;},selector);
        if(!point)throw Error(`Cannot click ${selector}: absent, disabled or has no visible bounds`);
        if(mobile){await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,radiusX:1,radiusY:1,force:1}]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
        else for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
      };
      return {evaluate,waitFor,key,focus,click,errors,requests,responses,downloads,completed,command,
        async goto(url){const result=await command('Page.navigate',{url});if(result.errorText)throw Error(`Navigation failed: ${result.errorText}`);await waitFor('ScanProof startup',()=>document.body?.dataset.ready==='true');},
        async reload(){const before=(await command('Page.getFrameTree')).frameTree.frame.loaderId;await command('Page.reload');const end=Date.now()+12000;let navigated=false;while(Date.now()<end){if((await command('Page.getFrameTree')).frameTree.frame.loaderId!==before){navigated=true;break;}await delay(40);}if(!navigated)throw Error('Reload did not create a new document within 12 seconds');await waitFor('reloaded ScanProof startup',()=>document.body?.dataset.ready==='true');},
        async fill(selector,value){await focus(selector);await evaluate(s=>document.querySelector(s).select(),selector);await command('Input.insertText',{text:value});},
        async files(paths){const {root}=await command('DOM.getDocument');const {nodeId}=await command('DOM.querySelector',{nodeId:root.nodeId,selector:'#file-input'});if(!nodeId)throw Error('Import input #file-input is missing');await command('DOM.setFileInputFiles',{nodeId,files:paths});},
        async screenshot(path){const layout=await command('Page.getLayoutMetrics'),size=layout.cssContentSize;const result=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});await writeFile(path,Buffer.from(result.data,'base64'));},
        async dispose(){for(const unsubscribe of unsubscribers)unsubscribe();await send('Target.disposeBrowserContext',{browserContextId});}
      };
    }};
  }catch(error){await close().catch(cleanup=>{error.message+=`\nCleanup: ${cleanup.message}`;});throw error;}
}
