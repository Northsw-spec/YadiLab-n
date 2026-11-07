import { deflateRawSync } from "node:zlib";

export const ODT_MIME = "application/vnd.oasis.opendocument.text";
export const XML_OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
export const XML_TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
export const XML_TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
export const XML_MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
const encode=s=>new TextEncoder().encode(s);
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let n=i;
  for(let k=0;k<8;k++)n=(n&1)?(0xedb88320^(n>>>1)):(n>>>1);
  return n>>>0;
});
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function u16(buf,at,n){buf.writeUInt16LE(n,at);}
function u32(buf,at,n){buf.writeUInt32LE(n>>>0,at);}

/** Independent exact ZIP writer, not production ZipJs. No local extra, descriptor or ZIP64. */
export function makeOdtZip(entries){
  const local=[],central=[];
  let offset=0;
  for(const item of entries){
    const filename=encode(item.path),raw=typeof item.data==="string"?encode(item.data):item.data;
    const level=item.stored===true?0:8;
    const body=level===0?raw:deflateRawSync(raw,{level:6});
    const localHeader=Buffer.alloc(30);
    u32(localHeader,0,0x04034b50);u16(localHeader,4,20);
    u16(localHeader,6,0);u16(localHeader,8,level);
    u16(localHeader,10,0);u16(localHeader,12,33);
    u32(localHeader,14,crc32(raw));u32(localHeader,18,body.length);
    u32(localHeader,22,raw.length);u16(localHeader,26,filename.length);
    u16(localHeader,28,0);
    local.push(localHeader,Buffer.from(filename),Buffer.from(body));
    const centralHeader=Buffer.alloc(46);
    u32(centralHeader,0,0x02014b50);u16(centralHeader,4,20);u16(centralHeader,6,20);
    u16(centralHeader,8,0);u16(centralHeader,10,level);
    u16(centralHeader,12,0);u16(centralHeader,14,33);
    u32(centralHeader,16,crc32(raw));u32(centralHeader,20,body.length);
    u32(centralHeader,24,raw.length);u16(centralHeader,28,filename.length);
    u16(centralHeader,30,0);u16(centralHeader,32,0);u16(centralHeader,34,0);
    u16(centralHeader,36,0);u32(centralHeader,38,0);u32(centralHeader,42,offset);
    central.push(centralHeader,Buffer.from(filename));
    offset+=30+filename.length+body.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);
  u32(end,0,0x06054b50);u16(end,4,0);u16(end,6,0);
  u16(end,8,entries.length);u16(end,10,entries.length);
  u32(end,12,cd.length);u32(end,16,offset);u16(end,20,0);
  return new Uint8Array(Buffer.concat([...local,cd,end]));
}
export const cell=value=>"<table:table-cell office:value-type=\"string\"><text:p>"+value+"</text:p></table:table-cell>";
export const row=values=>"<table:table-row>"+values.map(cell).join("")+"</table:table-row>";
export const table=rows=>"<table:table table:name=\"Inventory\"><table:table-column/>"+
  rows.map(row).join("")+"</table:table>";
export const content=(tables=[],ns=XML_OFFICE)=>'<office:document-content xmlns:office="'+ns+
  '" xmlns:table="'+XML_TABLE+'" xmlns:text="'+XML_TEXT+'" office:version="1.3">'+
  '<office:body><office:text>'+tables.join("")+'</office:text></office:body></office:document-content>';
export const manifest=(rootMime=ODT_MIME)=>'<manifest:manifest xmlns:manifest="'+XML_MANIFEST+'" manifest:version="1.3">'+
  '<manifest:file-entry manifest:full-path="/" manifest:media-type="'+rootMime+'"/>'+
  '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
  '</manifest:manifest>';
export function packageEntries({tables=[table([["Host","IP"],["node01","SECRET_ODT_CANARY_917"]])],
  extra={},mime=ODT_MIME,contentXml,manifestXml,compressedMimetype=false}={}){
 const members=[
   {path:"mimetype",data:mime,stored:!compressedMimetype},
   {path:"content.xml",data:contentXml??content(tables),stored:false},
   {path:"META-INF/manifest.xml",data:manifestXml??manifest(mime),stored:false},
 ];
 for(const [path,data] of Object.entries(extra))members.push({path,data,stored:false});
 return members;
}
