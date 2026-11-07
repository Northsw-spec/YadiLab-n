import { PackageIOError } from "./errors.js";

const ALLOWED_TAGS = new Set(["svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc"]);
const GLOBAL_ATTRS = new Set(["id","class","fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","opacity","transform"]);
const TAG_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  svg: new Set(["xmlns","viewBox","width","height","preserveAspectRatio"]),
  g: new Set([]),
  path: new Set(["d","pathLength"]),
  rect: new Set(["x","y","width","height","rx","ry"]),
  circle: new Set(["cx","cy","r"]),
  ellipse: new Set(["cx","cy","rx","ry"]),
  line: new Set(["x1","y1","x2","y2"]),
  polyline: new Set(["points"]),
  polygon: new Set(["points"]),
  text: new Set(["x","y","dx","dy","font-size","font-family","font-weight","text-anchor"]),
  tspan: new Set(["x","y","dx","dy","font-size","font-family","font-weight","text-anchor"]),
  title: new Set([]),
  desc: new Set([]),
};
const FORBIDDEN_VALUE = /(?:javascript\s*:|data\s*:|https?\s*:|file\s*:|blob\s*:|\/\/|@import|url\s*\()/i;
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const NUMERIC_LIST = /^[0-9eE+\-.,\s]*$/;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+\-.,\s]*$/;
const TRANSFORM = /^(?:\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([0-9eE+\-.,\s]*\))\s*)*$/;

function fail(code:string,message:string,path?:string): never { throw new PackageIOError(code,message,path); }
function decode(bytes:Uint8Array,path?:string):string {
  try { return new TextDecoder("utf-8",{fatal:true}).decode(bytes); }
  catch { return fail("PACKAGE_SVG_UTF8_INVALID","Custom SVG is not valid UTF-8.",path); }
}
function findTagEnd(text:string,start:number,path?:string):number {
  let quote:string|undefined;
  for(let i=start;i<text.length;i++){
    const ch=text[i]!;
    if(quote){ if(ch===quote)quote=undefined; continue; }
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='>')return i;
  }
  return fail("PACKAGE_SVG_NOT_WELL_FORMED","Custom SVG contains an unterminated tag.",path);
}
function parseAttributes(raw:string,tag:string,isRoot:boolean,path?:string):Readonly<Record<string,string>> {
  const attrs:Record<string,string>={}; let i=0;
  while(i<raw.length){
    while(i<raw.length&&/\s/.test(raw[i]!))i++;
    if(i>=raw.length)break;
    const start=i; while(i<raw.length&&!/[\s=]/.test(raw[i]!))i++; const name=raw.slice(start,i);
    if(!NAME.test(name)||name.includes(":"))fail("PACKAGE_SVG_ATTRIBUTE_NOT_ALLOWED",`SVG attribute '${name}' is not allowed.`,path);
    if(name.toLowerCase().startsWith("on")||["href","src","style"].includes(name))fail("PACKAGE_SVG_ATTRIBUTE_NOT_ALLOWED",`SVG attribute '${name}' is active/reference-capable and forbidden.`,path);
    if(!GLOBAL_ATTRS.has(name)&&!(TAG_ATTRS[tag]?.has(name)??false))fail("PACKAGE_SVG_ATTRIBUTE_NOT_ALLOWED",`SVG attribute '${name}' is not allowed on <${tag}>.`,path);
    if(Object.hasOwn(attrs,name))fail("PACKAGE_SVG_NOT_WELL_FORMED",`Duplicate SVG attribute '${name}'.`,path);
    while(i<raw.length&&/\s/.test(raw[i]!))i++; if(raw[i]!=="=")fail("PACKAGE_SVG_NOT_WELL_FORMED",`SVG attribute '${name}' must use a quoted value.`,path);i++;
    while(i<raw.length&&/\s/.test(raw[i]!))i++; const q=raw[i]; if(q!=='"'&&q!=="'")fail("PACKAGE_SVG_NOT_WELL_FORMED",`SVG attribute '${name}' must be quoted.`,path);i++;
    const valueStart=i; while(i<raw.length&&raw[i]!==q)i++; if(i>=raw.length)fail("PACKAGE_SVG_NOT_WELL_FORMED",`SVG attribute '${name}' has an unterminated value.`,path);
    const value=raw.slice(valueStart,i);i++;
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>`&]/.test(value))fail("PACKAGE_SVG_ATTRIBUTE_NOT_ALLOWED",`SVG attribute '${name}' contains forbidden characters.`,path);
    if(name==="xmlns"){
      if(!isRoot||value!=="http://www.w3.org/2000/svg")fail("PACKAGE_SVG_NAMESPACE_INVALID","Only the canonical SVG namespace is allowed on the root <svg>.",path);
    } else if(FORBIDDEN_VALUE.test(value)) {
      fail("PACKAGE_SVG_EXTERNAL_REFERENCE",`SVG attribute '${name}' contains a forbidden external/active reference.`,path);
    }
    if(["x","y","dx","dy","width","height","rx","ry","cx","cy","r","x1","y1","x2","y2","stroke-width","pathLength","font-size","opacity","fill-opacity","stroke-opacity"].includes(name) && !/^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+\-]?[0-9]+)?(?:px|%)?$/.test(value)) fail("PACKAGE_SVG_ATTRIBUTE_VALUE_INVALID",`SVG numeric attribute '${name}' has a value outside the passive policy.`,path);
    if(name==="viewBox"&&!NUMERIC_LIST.test(value))fail("PACKAGE_SVG_ATTRIBUTE_VALUE_INVALID","SVG viewBox is invalid.",path);
    if(name==="points"&&!NUMERIC_LIST.test(value))fail("PACKAGE_SVG_ATTRIBUTE_VALUE_INVALID","SVG points data is invalid.",path);
    if(name==="d"&&!PATH_DATA.test(value))fail("PACKAGE_SVG_ATTRIBUTE_VALUE_INVALID","SVG path data contains unsupported syntax.",path);
    if(name==="transform"&&!TRANSFORM.test(value))fail("PACKAGE_SVG_ATTRIBUTE_VALUE_INVALID","SVG transform contains unsupported syntax.",path);
    attrs[name]=value;
  }
  return attrs;
}

/**
 * Strict accept-or-reject sanitizer for scenario-provided SVG.
 * It deliberately accepts only a passive subset and returns byte-identical UTF-8 content when safe.
 */
export function sanitizeCustomSvg(bytes:Uint8Array,path?:string):Uint8Array {
  const text=decode(bytes,path);
  if(text.length===0)fail("PACKAGE_SVG_NOT_WELL_FORMED","Custom SVG is empty.",path);
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail("PACKAGE_SVG_UNSAFE_MARKUP","Custom SVG contains forbidden control characters.",path);
  if(/<!|<\?|<!--|<!\[CDATA\[/i.test(text))fail("PACKAGE_SVG_UNSAFE_MARKUP","SVG declarations, entities, comments, processing instructions, and CDATA are forbidden.",path);
  const stack:string[]=[];let i=0;let roots=0;
  while(i<text.length){
    const lt=text.indexOf("<",i);
    const chunk=(lt<0?text.slice(i):text.slice(i,lt));
    if(chunk.includes("&"))fail("PACKAGE_SVG_UNSAFE_MARKUP","SVG entity references are forbidden.",path);
    if(lt<0){ if(chunk.trim()&&stack.length===0)fail("PACKAGE_SVG_NOT_WELL_FORMED","Text outside the SVG root is forbidden.",path); break; }
    const end=findTagEnd(text,lt+1,path); let inside=text.slice(lt+1,end).trim();
    if(!inside)fail("PACKAGE_SVG_NOT_WELL_FORMED","Empty SVG tag is invalid.",path);
    if(inside.startsWith("/")){
      const name=inside.slice(1).trim(); if(!NAME.test(name)||inside.slice(1).trim()!==name)fail("PACKAGE_SVG_NOT_WELL_FORMED","Malformed closing SVG tag.",path);
      const expected=stack.pop(); if(expected!==name)fail("PACKAGE_SVG_NOT_WELL_FORMED",`Unexpected closing tag </${name}>.`,path);
    } else {
      const selfClosing=/\/\s*$/.test(inside); if(selfClosing)inside=inside.replace(/\/\s*$/,"").trimEnd();
      const m=/^([A-Za-z][A-Za-z0-9_-]*)([\s\S]*)$/.exec(inside); if(!m)fail("PACKAGE_SVG_NOT_WELL_FORMED","Malformed SVG element.",path);
      const tag=m[1]!; if(!ALLOWED_TAGS.has(tag))fail("PACKAGE_SVG_TAG_NOT_ALLOWED",`SVG element <${tag}> is not in the passive allowlist.`,path);
      const isRoot=stack.length===0; if(isRoot){roots++;if(tag!=="svg"||roots!==1)fail("PACKAGE_SVG_NOT_WELL_FORMED","Custom SVG must contain exactly one root <svg> element.",path);} else if(roots!==1)fail("PACKAGE_SVG_NOT_WELL_FORMED","SVG child appeared before root.",path);
      const attrs=parseAttributes(m[2]??"",tag,isRoot,path); if(isRoot&&attrs.xmlns!=="http://www.w3.org/2000/svg")fail("PACKAGE_SVG_NAMESPACE_INVALID","Root <svg> must declare xmlns=\"http://www.w3.org/2000/svg\".",path);
      if(!selfClosing)stack.push(tag);
    }
    i=end+1;
  }
  if(roots!==1||stack.length)fail("PACKAGE_SVG_NOT_WELL_FORMED","Custom SVG is not a complete well-formed passive SVG document.",path);
  return new Uint8Array(bytes);
}

export function isCustomSvgPath(path:string,mime:string):boolean { return path.toLowerCase().endsWith(".svg")&&mime==="image/svg+xml"; }
