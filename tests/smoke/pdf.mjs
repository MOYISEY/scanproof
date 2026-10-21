import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// This is a bounded reader for ScanProof's image PDF 1.4, not a general PDF renderer.
export function inspectPdf(bytes){
  const buffer=Buffer.from(bytes),text=buffer.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'),'PDF header must be %PDF-1.4');
  assert.ok(text.endsWith('%%EOF\n'),'PDF trailer must end with %%EOF');
  const start=text.lastIndexOf('startxref\n');assert.ok(start>0,'PDF missing startxref/trailer');
  const xref=Number(text.slice(start+10).match(/^\d+/)?.[0]);assert.ok(Number.isSafeInteger(xref)&&xref>0&&xref<buffer.length,'PDF has an invalid xref offset');
  const lines=text.slice(xref).split('\n');assert.equal(lines[0],'xref','xref must point to the cross-reference table');
  const count=Number(lines[1]?.match(/^0 (\d+)$/)?.[1]);assert.ok(count>2&&count<10000,'PDF xref object count is invalid');
  const offsets=[];
  for(let id=1;id<count;id++){const offset=Number(lines[id+2]?.slice(0,10));assert.equal(text.slice(offset,offset+`${id} 0 obj\n`.length),`${id} 0 obj\n`,`xref offset for object ${id}`);offsets[id]=offset;}
  const object=id=>{assert.ok(offsets[id],`PDF object ${id} must exist`);const end=Math.min(...offsets.filter(n=>n>offsets[id]),xref);const body=text.slice(offsets[id],end);assert.ok(body.endsWith('\nendobj\n'),`PDF object ${id} is not terminated`);return body;};
  const stream=id=>{const body=object(id),at=body.indexOf('\nstream\n');assert.ok(at>=0,`PDF object ${id} must contain a stream`);const length=Number(body.slice(0,at).match(/\/Length (\d+)/)?.[1]);assert.ok(Number.isSafeInteger(length)&&length>0,`PDF stream ${id} length must be positive`);const from=offsets[id]+at+8;assert.match(text.slice(from+length,from+length+12),/^\n?endstream/,`PDF stream ${id} length must end at endstream`);return buffer.subarray(from,from+length);};
  const catalog=object(1),pagesId=Number(catalog.match(/\/Pages (\d+) 0 R/)?.[1]),tree=object(pagesId);
  const expectedCount=Number(tree.match(/\/Count (\d+)/)?.[1]),kids=tree.match(/\/Kids \[([^\]]+)\]/)?.[1];assert.ok(kids,'PDF pages tree must contain Kids');
  const ids=[...kids.matchAll(/(\d+) 0 R/g)].map(m=>Number(m[1]));assert.equal(ids.length,expectedCount,'PDF page tree Count must equal Kids length');
  const pages=ids.map((id,index)=>{
    const page=object(id);assert.match(page,/\/Type \/Page\b/,`PDF page ${index+1} type`);
    const mediaBox=page.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)?.slice(1).map(Number);assert.ok(mediaBox,`PDF page ${index+1} MediaBox`);
    const imageId=Number(page.match(/\/Im0 (\d+) 0 R/)?.[1]),image=object(imageId),jpeg=stream(imageId);
    assert.match(image,/\/Filter \/DCTDecode/,`PDF page ${index+1} must embed a JPEG`);assert.equal(jpeg.readUInt16BE(0),0xffd8,'JPEG start marker');assert.equal(jpeg.readUInt16BE(jpeg.length-2),0xffd9,'JPEG end marker');
    const width=Number(image.match(/\/Width (\d+)/)?.[1]),height=Number(image.match(/\/Height (\d+)/)?.[1]);assert.ok(width>0&&height>0,'JPEG dimensions must be positive');
    const contentsId=Number(page.match(/\/Contents (\d+) 0 R/)?.[1]),commands=stream(contentsId).toString('ascii');assert.equal((commands.match(/\/Im0 Do/g)||[]).length,1,`PDF page ${index+1} must paint its image once`);
    const matrix=commands.match(/^q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\n\/Im0 Do\nQ\n$/)?.slice(1).map(Number);
    assert.ok(matrix,`PDF page ${index+1} must paint an upright image in a balanced graphics state`);
    const [w,h,x,y]=matrix,[pw,ph]=mediaBox;
    assert.ok(w>0&&h>0&&x>=0&&y>=0&&x+w<=pw+.002&&y+h<=ph+.002,`PDF page ${index+1} image must fit inside the page`);
    assert.ok(Math.abs(x-(pw-w)/2)<=.002&&Math.abs(y-(ph-h)/2)<=.002,`PDF page ${index+1} image must be centered`);
    assert.ok(Math.abs(w/h-width/height)<.00001,`PDF page ${index+1} image must retain its aspect ratio`);
    return {width,height,mediaBox,matrix,sha256:hash(jpeg)};
  });
  return {bytes:buffer.length,sha256:hash(buffer),pages};
}

export function assertPdfImages(bytes,expected,label='PDF'){
  const actual=inspectPdf(bytes);assert.equal(actual.pages.length,expected.length,`${label}: expected ${expected.length} pages, received ${actual.pages.length}`);
  actual.pages.forEach((page,index)=>{
    const want=expected[index],prefix=`${label} page ${index+1} (${want.name}, ${want.rotation} degrees)`;
    assert.equal(page.width,want.width,`${prefix}: image width`);assert.equal(page.height,want.height,`${prefix}: image height`);assert.equal(page.sha256,want.sha256,`${prefix}: image hash mismatch (wrong image/order/rotation)`);
    const landscape=want.width>want.height,box=landscape?[841.89,595.28]:[595.28,841.89];assert.deepEqual(page.mediaBox,box,`${prefix}: A4 orientation`);
  });
  return actual;
}
