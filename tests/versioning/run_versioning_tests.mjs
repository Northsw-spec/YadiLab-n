import assert from "node:assert/strict";
import { CURRENT_SCENARIO_SCHEMA_VERSION, FOUNDATION_MIGRATION_REGISTRY, MigrationRegistry, NORMALIZED_FORMAT_ID, SOURCE_FORMAT_ID, checkCurrentSchemaVersion } from "../../dist-versioning-test/versioning/src/index.js";
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};

eq(CURRENT_SCENARIO_SCHEMA_VERSION,"0.1.0","current schema version is explicit");
eq(FOUNDATION_MIGRATION_REGISTRY.currentVersion(SOURCE_FORMAT_ID),"0.1.0","source current version registered");
eq(FOUNDATION_MIGRATION_REGISTRY.currentVersion(NORMALIZED_FORMAT_ID),"0.1.0","normalized current version registered");
const current={formatId:SOURCE_FORMAT_ID,schemaVersion:"0.1.0",scenarioId:"x",metadata:{title:"X"}};
let r=FOUNDATION_MIGRATION_REGISTRY.migrate(current); ok(r.ok,"current document migrate is valid no-op"); if(!r.ok)process.exit(1); eq(r.changed,false,"current migration does not claim change"); eq(r.path,["0.1.0"],"no-op path explicit"); eq(r.document,current,"no-op preserves data"); ok(r.document!==current,"no-op returns cloned document");
eq(checkCurrentSchemaVersion(current,SOURCE_FORMAT_ID),undefined,"current source compatibility passes");

const registry=new MigrationRegistry({[SOURCE_FORMAT_ID]:"0.1.0",[NORMALIZED_FORMAT_ID]:"0.1.0"},[
 {formatId:SOURCE_FORMAT_ID,fromVersion:"0.0.1",toVersion:"0.0.2",migrate(d){return {...d,schemaVersion:"0.0.2",first:true}}},
 {formatId:SOURCE_FORMAT_ID,fromVersion:"0.0.2",toVersion:"0.1.0",migrate(d){return {...d,schemaVersion:"0.1.0",second:true}}},
]);
const legacy={formatId:SOURCE_FORMAT_ID,schemaVersion:"0.0.1",scenarioId:"legacy"};
r=registry.migrate(legacy); ok(r.ok,"registered migration chain succeeds"); if(!r.ok)process.exit(1); eq(r.path,["0.0.1","0.0.2","0.1.0"],"migration path recorded explicitly"); eq(r.document.schemaVersion,"0.1.0","chain reaches exact current version"); eq(r.document.first,true,"first step applied"); eq(r.document.second,true,"second step applied"); eq(legacy.schemaVersion,"0.0.1","migration never mutates input");
console.log(`PASS versioning/migration suite: ${checks} assertions.`);
