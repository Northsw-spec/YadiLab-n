import { webCryptoImportHashProvider } from "./hash.js";
import { EnterpriseImportError } from "./types.js";

export const ANSIBLE_INI_PREVIEW_PROFILE = "ansible.inventory.static.ini.v1" as const;
const MAX_BYTES=262144, MAX_LINES=5000, MAX_LINE=4096, MAX_HOSTS=500, MAX_GROUPS=200, MAX_MEMBERSHIPS=2000, MAX_DEPTH=10;
const NAME=/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const FORBIDDEN=new Set(["__proto__","prototype","constructor"]);
function fail(code:string,message:string):never {throw new EnterpriseImportError(code,message);}
function ident(s:string):string {
  if(!NAME.test(s)||FORBIDDEN.has(s)||s==="ungrouped") fail("ANSIBLE_INI_NAME_UNSUPPORTED","Unsupported host or group identifier.");
  return s;
}
function literalAddress(s:string):string {
  if(!s||s.length>253||/[{}$()[\]\\\/:@'"\s;]/.test(s)) fail("ANSIBLE_INI_ADDRESS_UNSUPPORTED","ansible_host requires a literal IPv4 or simple hostname.");
  if(/^\d+(?:\.\d+){3}$/.test(s)) {
    if(s.split(".").some(v=>!/^(?:0|[1-9]\d{0,2})$/.test(v)||Number(v)>255)) fail("ANSIBLE_INI_ADDRESS_UNSUPPORTED","Invalid IPv4 address.");
  } else if(s.split(".").some(v=>!LABEL.test(v))) fail("ANSIBLE_INI_ADDRESS_UNSUPPORTED","Invalid hostname literal.");
  return s;
}
export interface AnsibleIniHostLocator {
  readonly kind:"ansible-ini-host"; readonly sourceSha256:string; readonly lineNumber:number; readonly section:string; readonly hostKey:string;
}
export interface AnsibleIniHost {
  readonly inventoryName:string; readonly reportedConnectionAddress?:string;
  readonly addressTruth:"REPORTED_NOT_VERIFIED"|"UNKNOWN"; readonly directGroups:readonly string[];
  readonly locators:readonly AnsibleIniHostLocator[];
}
export interface AnsibleIniPreview {
  readonly status:"REVIEW_REQUIRED"; readonly canActivate:false;
  readonly profileId:typeof ANSIBLE_INI_PREVIEW_PROFILE; readonly semanticTrack:"CONFIG_DOCUMENTED";
  readonly sourceSha256:string; readonly hosts:readonly AnsibleIniHost[];
  readonly groupNames:readonly string[]; readonly groupChildren:Readonly<Record<string,readonly string[]>>;
  readonly diagnostics:readonly {readonly code:string;readonly message:string}[];
}
type Host={address?:string;groups:string[];locators:AnsibleIniHostLocator[]};
type Section={group:string;mode:"hosts"|"vars"|"children"};
/* Complete bounded source validation. No Ansible execution, external I/O, Engine or Builder updates. */
export async function previewAnsibleIniStaticInventory(bytes:Uint8Array):Promise<AnsibleIniPreview> {
  if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>MAX_BYTES) fail("ANSIBLE_INI_SOURCE_SIZE_INVALID","Nonempty inventory limited to 256 KiB.");
  let source:string;
  try {source=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch {return fail("ANSIBLE_INI_UTF8_INVALID","Source must be UTF-8.");}
  if(source.includes("\0")||/(^|[^\n])\r(?!\n)/.test(source)) fail("ANSIBLE_INI_CHARACTER_UNSUPPORTED","Embedded NUL or stray CR.");
  const lines=source.split(/\r?\n/);
  if(lines.length>MAX_LINES) fail("ANSIBLE_INI_LINE_BUDGET","Too many source lines.");
  const sourceSha256=await webCryptoImportHashProvider.sha256Bytes(bytes);
  const hosts=new Map<string,Host>(), groups=new Set<string>(), defined=new Set<string>(), referenced=new Set<string>();
  const groupNames:string[]=[], edges=new Map<string,string[]>(), seenSections=new Set<string>(), seenRows=new Set<string>();
  let section:Section|undefined, memberships=0, variablesIgnored=false;
  function addGroup(g:string):void {
    if(!groups.has(g)){if(groups.size>=MAX_GROUPS) fail("ANSIBLE_INI_GROUP_BUDGET","Too many groups."); groups.add(g);groupNames.push(g);}
  }
  function vars(rest:string):string|undefined {
    if(/[{}$()[\]\\'";]/.test(rest)) fail("ANSIBLE_INI_VARIABLE_UNSUPPORTED","Unsupported variable quoting or interpolation.");
    let reported:string|undefined;
    const names=new Set<string>();
    for(const token of rest.split(/\s+/)){
      const at=token.indexOf("=");
      if(at<1) fail("ANSIBLE_INI_HOST_TOKEN_INVALID","Expected literal key=value.");
      const key=token.slice(0,at),value=token.slice(at+1);
      if(!KEY.test(key)||FORBIDDEN.has(key)||names.has(key)) fail("ANSIBLE_INI_HOST_TOKEN_INVALID","Duplicate or invalid variable name.");
      names.add(key);
      if(key==="ansible_host") reported=literalAddress(value);
      else {if(!value||!/^[A-Za-z0-9_./:@-]+$/.test(value)) fail("ANSIBLE_INI_VARIABLE_UNSUPPORTED","Variable representation is outside the strict static subset.");variablesIgnored=true;}
    }
    return reported;
  }
  for(let i=0;i<lines.length;i++){
    const raw=lines[i]!;
    if(raw.length>MAX_LINE) fail("ANSIBLE_INI_LINE_BUDGET","Source line is too long.");
    const line=raw.trim();
    if(!line||line.startsWith("#")) continue;
    if(line.startsWith("[")){
      const m=/^\[([A-Za-z_][A-Za-z0-9_.-]{0,127})(?::(vars|children))?\]$/.exec(line);
      if(!m) fail("ANSIBLE_INI_SECTION_UNSUPPORTED","Unsupported section modifier or heading.");
      const group=ident(m[1]!),mode=(m[2]??"hosts") as Section["mode"], sectionId=group+":"+mode;
      if(seenSections.has(sectionId)) fail("ANSIBLE_INI_SECTION_DUPLICATE","Section declared more than once.");
      seenSections.add(sectionId);addGroup(group);
      if(mode!=="vars") defined.add(group);
      section={group,mode};continue;
    }
    if(line.includes("[")||line.includes("]")) fail("ANSIBLE_INI_HOST_RANGE_UNSUPPORTED","Host ranges are not supported in v1.");
    if(section?.mode==="vars"){
      const at=line.indexOf("="),key=line.slice(0,at).trim();
      if(at<1||!KEY.test(key)||FORBIDDEN.has(key)) fail("ANSIBLE_INI_VARIABLE_UNSUPPORTED","Unsupported group variable assignment.");
      variablesIgnored=true;continue;
    }
    if(section?.mode==="children"){
      if(!NAME.test(line)) fail("ANSIBLE_INI_CHILD_UNDECLARED","Child group must be a literal group name.");
      const child=ident(line),list=edges.get(section.group)??[];
      if(list.includes(child)) fail("ANSIBLE_INI_SECTION_DUPLICATE","Duplicate child group edge.");
      list.push(child);edges.set(section.group,list);referenced.add(child);continue;
    }
    const match=/^([A-Za-z_][A-Za-z0-9_.-]{0,127})(?:\s+(.+))?$/.exec(line);
    if(!match) fail("ANSIBLE_INI_HOST_TOKEN_INVALID","Invalid host alias or host row.");
    const hostKey=ident(match[1]!),reported=match[2]?vars(match[2]):undefined;
    if(!hosts.has(hostKey)&&hosts.size>=MAX_HOSTS) fail("ANSIBLE_INI_HOST_BUDGET","Too many hosts.");
    if(++memberships>MAX_MEMBERSHIPS) fail("ANSIBLE_INI_MEMBERSHIP_BUDGET","Too many direct memberships.");
    const g=section?.group, key=(g??"<ungrouped>")+"\0"+hostKey;
    if(seenRows.has(key)) fail("ANSIBLE_INI_SECTION_DUPLICATE","Duplicate host membership.");
    seenRows.add(key);
    const prev=hosts.get(hostKey);
    if(prev&&prev.address!==reported) fail("ANSIBLE_INI_HOST_CONFLICT","Conflicting inventory alias connection addresses.");
    const h:Host=prev??{...(reported===undefined?{}:{address:reported}),groups:[],locators:[]};
    if(g&&!h.groups.includes(g)) h.groups.push(g);
    h.locators.push({kind:"ansible-ini-host",sourceSha256,lineNumber:i+1,section:g??"ungrouped",hostKey});
    hosts.set(hostKey,h);
  }
  for(const child of referenced) if(!defined.has(child)) fail("ANSIBLE_INI_CHILD_UNDECLARED","Referenced child group was not declared.");
  for(const group of groups) if(group!=="all"&&!defined.has(group)) fail("ANSIBLE_INI_CHILD_UNDECLARED","Variables-only group requires a declared section.");
  function walk(g:string,ancestors:Set<string>,depth:number):void {
    if(ancestors.has(g)) fail("ANSIBLE_INI_GROUP_CYCLE","Circular group relationship.");
    if(depth>MAX_DEPTH) fail("ANSIBLE_INI_GROUP_BUDGET","Group hierarchy exceeds maximum depth.");
    const path=new Set(ancestors);path.add(g);
    for(const child of edges.get(g)??[]) walk(child,path,depth+1);
  }
  for(const g of groups) walk(g,new Set(),0);
  const groupChildren:Record<string,readonly string[]>=Object.create(null) as Record<string,readonly string[]>;
  for(const [g,children] of edges) groupChildren[g]=[...children];
  return {
    status:"REVIEW_REQUIRED",canActivate:false,profileId:ANSIBLE_INI_PREVIEW_PROFILE,
    semanticTrack:"CONFIG_DOCUMENTED",sourceSha256,
    hosts:[...hosts].map(([inventoryName,h])=>({
      inventoryName,...(h.address===undefined?{}:{reportedConnectionAddress:h.address}),
      addressTruth:h.address===undefined?"UNKNOWN" as const:"REPORTED_NOT_VERIFIED" as const,
      directGroups:[...h.groups],locators:[...h.locators]
    })),
    groupNames:[...groupNames],groupChildren,
    diagnostics:variablesIgnored?[{code:"ANSIBLE_INI_VARIABLES_NOT_IMPORTED",message:"Host and group variable values are not imported or exported."}]:[]
  };
}
