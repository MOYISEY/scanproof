export const LIMITS = Object.freeze({pages:20, fileBytes:10*1024*1024, totalBytes:50*1024*1024, pixels:24_000_000, tasks:100});
export function validateBatch(files, pages) {
  if (!files.length) return 'Не выбраны фотографии.';
  if (pages.length + files.length > LIMITS.pages) return 'Не больше 20 страниц в работе. Уменьшите набор.';
  for (const f of files) {
    if(typeof f.name!=='string'||!f.name.length||f.name.length>255)return 'Имя файла: от 1 до 255 символов.';
    if (!/\.(jpe?g|png|webp)$/i.test(f.name)) return `${f.name}: формат не поддерживается. Нужны JPG, PNG или WebP; HEIC и PDF не принимаются.`;
    if (!f.size) return `${f.name}: пустой файл.`;
    if (f.size > LIMITS.fileBytes) return `${f.name}: больше 10 МБ. Уменьшите размер фотографии.`;
  }
  if ([...pages, ...files].reduce((s,p)=>s+(p.size||p.blob?.size||0),0) > LIMITS.totalBytes) return 'Общий размер превышает 50 МБ. Уменьшите набор.';
  return null;
}
export function imageInfo(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), v = new DataView(a.buffer,a.byteOffset,a.byteLength);
  const str=(i,n)=>String.fromCharCode(...a.slice(i,i+n));
  let width,height,type;
  if (a.length>=24 && str(0,8)==='\x89PNG\r\n\x1a\n' && str(12,4)==='IHDR') {
    type='image/png'; width=v.getUint32(16); height=v.getUint32(20);
    for(let i=8;i+12<=a.length;) {const n=v.getUint32(i); if(str(i+4,4)==='acTL') throw Error('Анимированные PNG не поддерживаются.'); i+=n+12;}
  } else if(a.length>=12 && str(0,4)==='RIFF' && str(8,4)==='WEBP') {
    type='image/webp';
    for(let i=12;i+8<=a.length;) {
      const kind=str(i,4), n=v.getUint32(i+4,true), p=i+8;
      if(p+n>a.length) throw Error('Повреждённый WebP.');
      if(kind==='ANIM'||kind==='ANMF'||(kind==='VP8X'&&(a[p]&2))) throw Error('Анимированные WebP не поддерживаются.');
      if(kind==='VP8X'&&n>=10) {width=1+a[p+4]+(a[p+5]<<8)+(a[p+6]<<16);height=1+a[p+7]+(a[p+8]<<8)+(a[p+9]<<16);}
      if(kind==='VP8 '&&n>=10&&str(p+3,3)==='\x9d\x01\x2a') {width=v.getUint16(p+6,true)&0x3fff;height=v.getUint16(p+8,true)&0x3fff;}
      if(kind==='VP8L'&&n>=5&&a[p]===0x2f) {const b=v.getUint32(p+1,true);width=1+(b&0x3fff);height=1+((b>>>14)&0x3fff);}
      i=p+n+(n%2);
    }
  } else if(a.length>=4&&a[0]===0xff&&a[1]===0xd8) {
    type='image/jpeg';
    for(let i=2;i+3<a.length;) {
      if(a[i++]!==0xff) continue;
      let m=a[i++]; while(m===0xff&&i<a.length)m=a[i++];
      if(m===0xda||m===0xd9)break;
      if(m===0x01||(m>=0xd0&&m<=0xd8))continue;
      if(i+2>a.length)break;
      const n=v.getUint16(i); if(n<2||i+n>a.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(m)&&n>=7) {height=v.getUint16(i+3);width=v.getUint16(i+5);break;}
      i+=n;
    }
  }
  if(!width||!height)throw Error('Не удалось прочитать статическое изображение JPG/PNG/WebP.');
  if(width*height>LIMITS.pixels)throw Error('Больше 24 мегапикселей. Уменьшите разрешение фотографии.');
  return {width,height,type};
}
export function analyzePixels(data) {
  let sum=0,sum2=0,dark=0; const n=data.length/4;
  for(let i=0;i<data.length;i+=4) {const alpha=data[i+3]/255; const y=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])*alpha+255*(1-alpha); sum+=y;sum2+=y*y;if(y<205)dark++;}
  const mean=sum/n, deviation=Math.sqrt(Math.max(0,sum2/n-mean*mean));
  return {blank:dark/n<.003&&deviation<9&&mean>225, darkRatio:dark/n, deviation};
}
export function movePage(pages,id,to) {
  const from=pages.findIndex(p=>p.id===id);if(from<0||to<0||to>=pages.length)return pages;
  const next=[...pages], [page]=next.splice(from,1);next.splice(to,0,page);return next;
}
export function removePage(pages,id) {const index=pages.findIndex(p=>p.id===id);return index<0?{pages,removed:null}:{pages:pages.filter(p=>p.id!==id),removed:{page:pages[index],index}};}
export function restorePage(pages,removed) {if(!removed||pages.some(p=>p.id===removed.page.id)||pages.length>=LIMITS.pages||pages.reduce((s,p)=>s+p.size,0)+removed.page.size>LIMITS.totalBytes)return pages;const next=[...pages];next.splice(Math.min(removed.index,pages.length),0,removed.page);return next;}
export function validateDraft(draft) {
  const fail=()=>{throw Error('Повреждённый или несовместимый локальный черновик.');};
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if(!plain(draft)||draft.version!==1||!Array.isArray(draft.pages)||!Array.isArray(draft.tasks)||draft.pages.length>LIMITS.pages||draft.tasks.length>LIMITS.tasks)fail();
  const taskIds=new Set(),pageIds=new Set();
  const tasks=draft.tasks.map(t=>{if(!plain(t)||!uuid(t.id)||taskIds.has(t.id)||typeof t.label!=='string'||!t.label.trim()||t.label.length>160)fail();taskIds.add(t.id);return {id:t.id,label:t.label};});
  let total=0;
  const pages=draft.pages.map(p=>{
    if(!plain(p)||!uuid(p.id)||pageIds.has(p.id)||typeof p.name!=='string'||!p.name.length||p.name.length>255||!/\.(jpe?g|png|webp)$/i.test(p.name))fail();
    if(!(p.blob instanceof Blob)||!['image/jpeg','image/png','image/webp'].includes(p.blob.type)||!Number.isSafeInteger(p.size)||p.size<=0||p.size!==p.blob.size||p.size>LIMITS.fileBytes)fail();
    if(!(p.preview instanceof Blob)||p.preview.type!=='image/jpeg'||p.preview.size<=0||p.preview.size>5*1024*1024)fail();
    if(!Number.isSafeInteger(p.width)||!Number.isSafeInteger(p.height)||p.width<=0||p.height<=0||p.width*p.height>LIMITS.pixels||![0,90,180,270].includes(p.rotation))fail();
    if(typeof p.hash!=='string'||!/^[a-f0-9]{64}$/i.test(p.hash)||!Array.isArray(p.taskIds)||new Set(p.taskIds).size!==p.taskIds.length||p.taskIds.some(id=>!taskIds.has(id)))fail();
    if(!plain(p.analysis)||typeof p.analysis.blank!=='boolean'||!Number.isFinite(p.analysis.darkRatio)||p.analysis.darkRatio<0||p.analysis.darkRatio>1||!Number.isFinite(p.analysis.deviation)||p.analysis.deviation<0||p.analysis.deviation>128)fail();
    pageIds.add(p.id);total+=p.size;
    return {id:p.id,name:p.name,size:p.size,blob:p.blob,preview:p.preview,width:p.width,height:p.height,rotation:p.rotation,hash:p.hash,taskIds:[...p.taskIds],analysis:{blank:p.analysis.blank,darkRatio:p.analysis.darkRatio,deviation:p.analysis.deviation}};
  });
  if(total>LIMITS.totalBytes||(draft.selected!==null&&!pageIds.has(draft.selected)))fail();
  return {version:1,pages,tasks,selected:draft.selected};
}
export function review(pages,tasks) {
  const hashes=new Map(), duplicates=[];
  for(const p of pages) {if(hashes.has(p.hash))duplicates.push({page:p,original:hashes.get(p.hash)});else hashes.set(p.hash,p);}
  return {duplicates,blank:pages.filter(p=>p.analysis?.blank),unassigned:tasks.filter(t=>!pages.some(p=>p.taskIds.includes(t.id))),unmapped:pages.filter(p=>!p.taskIds.some(id=>tasks.some(t=>t.id===id)))};
}
export function addTasks(tasks,input,idFactory) {
  const labels=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!labels.length)throw Error('Введите хотя бы одно задание.');
  if(labels.some(t=>t.length>160))throw Error('Название задания: не больше 160 символов.');
  const existing=new Set(tasks.map(t=>t.label.toLocaleLowerCase('ru'))), next=[...tasks];
  for(const label of labels)if(!existing.has(label.toLocaleLowerCase('ru'))) {next.push({id:idFactory(),label});existing.add(label.toLocaleLowerCase('ru'));}
  if(next.length>LIMITS.tasks)throw Error('Можно добавить до 100 заданий.');
  return next;
}
// Minimal PDF 1.4 writer. Each page embeds one already-rotated RGB JPEG.
// Byte offsets, stream lengths and xref are calculated from encoded bytes.
export function makePdf(images) {
  if(!images.length)throw Error('В PDF нужна хотя бы одна страница.');
  const encoder=new TextEncoder(), chunks=[], offsets=[0];let length=0;
  const push=x=>{const a=typeof x==='string'?encoder.encode(x):x;chunks.push(a);length+=a.length;};
  const object=(id,body)=>{offsets[id]=length;push(`${id} 0 obj\n`);body();push('\nendobj\n');};
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1,()=>push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2,()=>push(`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`));
  images.forEach((im,i)=>{
    if(!(im.width>0&&im.height>0&&im.jpeg?.length))throw Error('Некорректное изображение PDF.');
    const p=3+i*3, landscape=im.width>im.height, pw=landscape?841.89:595.28, ph=landscape?595.28:841.89;
    const scale=Math.min((pw-32)/im.width,(ph-32)/im.height), w=im.width*scale,h=im.height*scale;
    const commands=`q\n${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${((pw-w)/2).toFixed(3)} ${((ph-h)/2).toFixed(3)} cm\n/Im0 Do\nQ\n`;
    object(p,()=>push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${p+2} 0 R >> >> /Contents ${p+1} 0 R >>`));
    object(p+1,()=>push(`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`));
    object(p+2,()=>{push(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`);push(im.jpeg);push('\nendstream');});
  });
  const xref=length;push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for(const offset of offsets.slice(1))push(`${String(offset).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out=new Uint8Array(length);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}return out;
}
