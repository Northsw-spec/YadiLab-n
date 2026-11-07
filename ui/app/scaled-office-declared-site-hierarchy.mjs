/**
 * SCALE-001 P2b2A. An independently authorized *presentation* classification
 * of existing, source-reviewed Builder devices. Never guesses real locations,
 * moves source objects, or promotes declared connections to physical truth.
 *
 * The host supplies trusted prior Office-source provenance separately from
 * the proposed sidecar. This module never trusts the sidecar's own hashes.
 */
export const DECLARED_OFFICE_SITE_PROFILE="office.declared-site-hierarchy.v1";

const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const MAX_DEVICES=10000;
const MAX_EDGES=25000;
const fail=code=>{
  const error=new Error(code);
  error.code=code;
  throw error;
};
const object=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&
  Object.keys(value).sort().join(",")===keys.slice().sort().join(",");
const array=(value,max)=>Array.isArray(value)&&value.length<=max;
const validId=value=>typeof value==="string"&&ID.test(value);
const validHash=value=>typeof value==="string"&&SHA.test(value);
const validLabel=value=>typeof value==="string"&&value===value.trim()&&
  value.length>=1&&value.length<=96&&
  !/[\x00-\x1f\x7f<>]/.test(value);
const validProvenance=value=>exact(value,["sourceModelHash","sourceOriginalSha256"])&&
  validHash(value.sourceModelHash)&&validHash(value.sourceOriginalSha256);
const immutable=value=>Object.freeze(value);
const immutableRows=values=>immutable(values.map(v=>immutable(v)));
const equalOwn=(actual,expected)=>actual===expected;

function declareGroup(groups,kind,keys,global,parents){
  if(!array(groups,10000))fail("SCALE_P2B2_DECLARATIONS_INVALID");
  const found=new Map();
  for(const item of groups){
    if(!exact(item,keys)||!validId(item.id)||
       !validLabel(item.label)||item.acknowledged!==true)
      fail("SCALE_P2B2_DECLARATIONS_INVALID");
    if(global.has(item.id))fail("SCALE_P2B2_DUPLICATE_ID");
    global.add(item.id);
    if(parents){
      if(!validId(item[parents.key])||!parents.ids.has(item[parents.key]))
        fail("SCALE_P2B2_PARENT_INVALID");
    }
    found.set(item.id,item);
  }
  return found;
}

function validateOriginal(source){
  if(!object(source)||!array(source.resources,MAX_DEVICES)||
     !array(source.connections,MAX_EDGES)||source.resources.length===0||
     !Array.isArray(source.tests)||source.tests.length!==0)
    fail("SCALE_P2B2_SOURCE_BLOCKED");
  const resources=new Map();
  for(const node of source.resources){
    if(!object(node)||!validId(node.id)||resources.has(node.id)||
       !array(node.interfaces,10000))
      fail("SCALE_P2B2_SOURCE_BLOCKED");
    const ports=new Set();
    for(const item of node.interfaces){
      if(!object(item)||!validId(item.id)||ports.has(item.id))
        fail("SCALE_P2B2_SOURCE_BLOCKED");
      ports.add(item.id);
    }
    resources.set(node.id,ports);
  }
  const linkIds=new Set();
  for(const link of source.connections){
    if(!object(link)||!validId(link.id)||linkIds.has(link.id)||
       !object(link.from)||!object(link.to)||
       !resources.has(link.from.resource)||!resources.has(link.to.resource))
      fail("SCALE_P2B2_SOURCE_BLOCKED");
    for(const endpoint of [link.from,link.to]){
      if(endpoint.port!==undefined &&
         (!validId(endpoint.port)||
          !resources.get(endpoint.resource).has(endpoint.port)))
        fail("SCALE_P2B2_SOURCE_BLOCKED");
    }
    linkIds.add(link.id);
  }
  return resources;
}

/**
 * @param {object} source - The ordinary immutable original editable Builder source
 * @param {object} declaration - User-approved presentation declaration
 * @param {object} trustedOrigin - Separately stored verified Office SHA and actual
 *   source-model hash. Must be supplied by the source-import host, not user input.
 * @returns {Promise<object>} immutable, strictly bounded non-Engine evidence
 */
export async function validateDeclaredOfficeSiteHierarchy(
  source,declaration,trustedOrigin
){
  if(!validProvenance(trustedOrigin))
    fail("SCALE_P2B2_PROVENANCE_REQUIRED");
  if(!exact(declaration,[
      "formatId","schemaVersion","sourceModelHash","sourceOriginalSha256",
      "declaredByUser","sites","buildings","floors","areas","assignments"
    ])||
    declaration.formatId!==DECLARED_OFFICE_SITE_PROFILE||
    declaration.schemaVersion!=="1.0.0"||
    declaration.declaredByUser!==true||
    !validHash(declaration.sourceModelHash)||
    !validHash(declaration.sourceOriginalSha256))
    fail("SCALE_P2B2_SELECTION_INVALID");

  if(!equalOwn(declaration.sourceModelHash,trustedOrigin.sourceModelHash)||
     !equalOwn(declaration.sourceOriginalSha256,trustedOrigin.sourceOriginalSha256))
    fail("SCALE_P2B2_SOURCE_CHANGED");

  // Check the *actual* original Builder model, not just two hashes from the
  // same potentially malicious sidecar. Do not normalize/reorder the source.
  let before;
  try {before=JSON.stringify(source);}
  catch{fail("SCALE_P2B2_SOURCE_BLOCKED");}
  if(typeof before!=="string"||before.length>10*1024*1024)
    fail("SCALE_P2B2_SOURCE_BLOCKED");
  const subtle=globalThis.crypto?.subtle;
  if(!subtle)fail("SCALE_P2B2_HASH_UNAVAILABLE");
  const digest=new Uint8Array(await subtle.digest("SHA-256",new TextEncoder().encode(before)));
  const actualHash=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
  if(actualHash!==trustedOrigin.sourceModelHash||JSON.stringify(source)!==before)
    fail("SCALE_P2B2_SOURCE_CHANGED");
  const resources=validateOriginal(source);

  if(!array(declaration.sites,1000)||declaration.sites.length===0||
     !array(declaration.buildings,3000)||
     !array(declaration.floors,10000)||
     !array(declaration.areas,10000)||
     !array(declaration.assignments,MAX_DEVICES))
    fail("SCALE_P2B2_DECLARATIONS_INVALID");

  const globallyUsedIds=new Set();
  const sites=declareGroup(declaration.sites,"site",
    ["id","label","acknowledged"],globallyUsedIds);
  const buildings=declareGroup(declaration.buildings,"building",
    ["id","siteId","label","acknowledged"],globallyUsedIds,
    {key:"siteId",ids:sites});
  const floors=declareGroup(declaration.floors,"floor",
    ["id","buildingId","label","acknowledged"],globallyUsedIds,
    {key:"buildingId",ids:buildings});
  const areas=declareGroup(declaration.areas,"area",
    ["id","floorId","label","acknowledged"],globallyUsedIds,
    {key:"floorId",ids:floors});
  const floorHasAreas=new Set([...areas.values()].map(a=>a.floorId));

  const memberships=[];
  const assignmentByNode=new Map();
  for(const item of declaration.assignments){
    if(!object(item)||!validId(item.deviceId)||item.acknowledged!==true||
       !resources.has(item.deviceId)||
       !(exact(item,["deviceId","floorId","acknowledged"])||
         exact(item,["deviceId","areaId","acknowledged"])))
      fail("SCALE_P2B2_ASSIGNMENT_INVALID");
    if(assignmentByNode.has(item.deviceId))
      fail("SCALE_P2B2_DUPLICATE_ASSIGNMENT");
    let areaId,floorId;
    if("areaId" in item){
      if(!validId(item.areaId)||!areas.has(item.areaId))
        fail("SCALE_P2B2_PARENT_INVALID");
      areaId=item.areaId;
      floorId=areas.get(areaId).floorId;
    }else{
      if(!validId(item.floorId)||!floors.has(item.floorId)||
         floorHasAreas.has(item.floorId))
        fail("SCALE_P2B2_PARENT_INVALID");
      floorId=item.floorId;
    }
    const buildingId=floors.get(floorId).buildingId;
    const siteId=buildings.get(buildingId).siteId;
    const membership=immutable({
      deviceId:item.deviceId,siteId,buildingId,floorId,
      ...(areaId?{areaId}:{})
    });
    memberships.push(membership);
    assignmentByNode.set(item.deviceId,membership);
  }
  const unassignedDeviceIds=immutable(source.resources
    .map(node=>node.id).filter(id=>!assignmentByNode.has(id)));

  // Each evidence row references exactly one existing original semantic link
  // and its original endpoint/port pair. No synthetic aggregate cable.
  const crossSiteOriginalLinks=[];
  for(const link of source.connections){
    const left=assignmentByNode.get(link.from.resource);
    const right=assignmentByNode.get(link.to.resource);
    if(!left||!right||left.siteId===right.siteId)continue;
    crossSiteOriginalLinks.push(immutable({
      linkId:link.id,from:immutable({
        resource:link.from.resource,
        ...(link.from.port!==undefined?{port:link.from.port}:{})
      }),to:immutable({
        resource:link.to.resource,
        ...(link.to.port!==undefined?{port:link.to.port}:{})
      }),fromSiteId:left.siteId,toSiteId:right.siteId
    }));
  }
  if(JSON.stringify(source)!==before)
    fail("SCALE_P2B2_SOURCE_CHANGED");

  return immutable({
    status:"READY_FOR_PRESENTATION",
    profileId:DECLARED_OFFICE_SITE_PROFILE,
    sourceModelHash:trustedOrigin.sourceModelHash,
    sourceOriginalSha256:trustedOrigin.sourceOriginalSha256,
    memberships:immutable(memberships),
    unassignedDeviceIds,
    crossSiteOriginalLinks:immutable(crossSiteOriginalLinks),
    declaredSites:immutableRows(declaration.sites.map(({id,label})=>({id,label}))),
    declaredBuildings:immutableRows(declaration.buildings.map(({id,label,siteId})=>({id,label,siteId}))),
    declaredFloors:immutableRows(declaration.floors.map(({id,label,buildingId})=>({id,label,buildingId}))),
    declaredAreas:immutableRows(declaration.areas.map(({id,label,floorId})=>({id,label,floorId}))),
    canActivate:false,
    engineVerified:false,
    physicalTopologyVerified:false
  });
}
