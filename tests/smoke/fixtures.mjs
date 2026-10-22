import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function createFixtures(page,directory){
  // Artificial sheets only. PDF expectations are prepared independently of app modules.
  const fixtures=await page.evaluate(async()=>{
    const blob=(canvas,type)=>new Promise(resolve=>canvas.toBlob(resolve,type,.94));
    const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
    const result=[];
    for(const [name,type,title,color]of [['A.jpg','image/jpeg','A / Algebra + Geometry','#243d6b'],['B.png','image/png','B / Geometry continued','#5b3468'],['C.webp','image/webp','C / Graph','#236746']]){
      const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=1900;const x=canvas.getContext('2d');
      x.fillStyle='#fff';x.fillRect(0,0,1400,1900);x.fillStyle=color;x.fillRect(75,70,1250,24);x.font='bold 55px serif';x.fillText(title,110,220);x.font='italic 44px serif';
      ['SYNTHETIC SMOKE FIXTURE','No student or personal data','2x + 7 = 19','x = 6','Check: 2(6) + 7 = 19',name].forEach((text,i)=>x.fillText(text,110,430+i*230));
      const source=await blob(canvas,type),bitmap=await createImageBitmap(source),expected={};
      for(const rotation of [0,90]){
        const c=document.createElement('canvas');c.width=rotation?bitmap.height:bitmap.width;c.height=rotation?bitmap.width:bitmap.height;
        const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.translate(c.width/2,c.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);
        expected[rotation]={name,rotation,width:c.width,height:c.height,sha256:await hash(await blob(c,'image/jpeg'))};
      }
      bitmap.close();result.push({name,bytes:Array.from(new Uint8Array(await source.arrayBuffer())),expected});
    }
    return result;
  });
  const paths={},expected={};
  for(const fixture of fixtures){paths[fixture.name]=join(directory,fixture.name);expected[fixture.name]=fixture.expected;await writeFile(paths[fixture.name],new Uint8Array(fixture.bytes));}
  paths.corrupt=join(directory,'corrupt.png');await writeFile(paths.corrupt,'synthetic invalid PNG');
  paths.renamed=join(directory,'renamed-exact.jpg');await writeFile(paths.renamed,new Uint8Array(fixtures.find(f=>f.name==='A.jpg').bytes));
  return {paths,expected};
}
