import {imageInfo,analyzePixels} from './core.mjs';
export const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
export function canvasBlob(canvas,type='image/jpeg',quality=.94) {return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось подготовить изображение.')),type,quality));}
export async function drawPage(page,maxSide) {
  const bitmap=await createImageBitmap(page.blob);
  try {
    const rotate=((page.rotation||0)%360+360)%360, swap=rotate%180!==0;
    const factor=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const w=Math.max(1,Math.round(bitmap.width*factor)),h=Math.max(1,Math.round(bitmap.height*factor));
    const canvas=document.createElement('canvas');canvas.width=swap?h:w;canvas.height=swap?w:h;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotate*Math.PI/180);ctx.drawImage(bitmap,-w/2,-h/2,w,h);
    return canvas;
  }finally{bitmap.close();}
}
export async function importImage(file) {
  const bytes=await file.arrayBuffer(),info=imageInfo(bytes);
  const blob=new Blob([bytes],{type:info.type});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const page={id:crypto.randomUUID(),name:file.name,size:file.size,blob,hash,rotation:0,taskIds:[],width:0,height:0};
  const bitmap=await createImageBitmap(blob);page.width=bitmap.width;page.height=bitmap.height;bitmap.close();
  const sample=await drawPage(page,640),ctx=sample.getContext('2d',{willReadFrequently:true});
  page.analysis=analyzePixels(ctx.getImageData(0,0,sample.width,sample.height).data);
  page.preview=await canvasBlob(await drawPage(page,1100));
  return page;
}
export async function demoFiles() {
  const out=[];
  for(let i=1;i<=3;i++) {
    const c=document.createElement('canvas');c.width=1400;c.height=1900;const x=c.getContext('2d');
    x.fillStyle='#fffef9';x.fillRect(0,0,c.width,c.height);
    x.strokeStyle='#e5eaf0';x.lineWidth=1;for(let y=210;y<1800;y+=65){x.beginPath();x.moveTo(90,y);x.lineTo(1300,y);x.stroke();}
    x.fillStyle='#637b75';x.font='24px sans-serif';x.fillText('SCANPROOF / SYNTHETIC SAMPLE / NO PERSONAL DATA',95,90);
    x.fillStyle='#213d63';x.font='italic 45px Georgia';x.fillText(`Practice sheet ${i}`,100,160);
    if(i!==3) {
      const rows=i===1?['1. Solve the equation','2x + 7 = 19','2x = 12','x = 6','Check: 2 (6) + 7 = 19','Answer: x = 6']:['2. Area of a triangle','b = 8 cm, h = 5 cm','S = (b x h) / 2','S = (8 x 5) / 2','S = 20 cm^2','Answer: 20 cm^2'];
      x.font='italic 48px Georgia';rows.forEach((s,j)=>x.fillText(s,115,310+j*130));
      if(i===2) {x.beginPath();x.moveTo(320,1530);x.lineTo(1000,1530);x.lineTo(620,1150);x.closePath();x.lineWidth=5;x.strokeStyle='#213d63';x.stroke();x.fillText('8 cm',570,1610);x.fillText('5 cm',660,1350);}
    } else {
      // Truly near-empty white sheet intentionally exercises the heuristic.
      x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
    }
    const type=i===1?'image/jpeg':i===2?'image/png':'image/webp',ext=i===1?'jpg':i===2?'png':'webp';
    out.push(new File([await canvasBlob(c,type)],`synthetic-${i}.${ext}`,{type}));
  }
  return out;
}
