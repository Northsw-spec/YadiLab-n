import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { compileBuilderWorkspace, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";
import { previewGraphmlReadOnly } from "../../dist-browser-test/enterprise-import/src/graphml-preview.js";
import { mapReviewedGraphmlToBuilder } from "../../dist-browser-test/enterprise-import/src/graphml-review-mapping.js";

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false, validateSchema: true });
const validateSource=ajv.compile(sourceSchema),validateNormalized=ajv.compile(normalizedSchema);
const compilerOptions={compilerContext:{
  validateSource: (data) => ({valid: !!validateSource(data),diagnostics: (validateSource.errors??[]).map(x=>`${x.instancePath}: ${x.message}`)}),
  validateNormalized: (data) => ({valid: !!validateNormalized(data),diagnostics: (validateNormalized.errors??[]).map(x=>`${x.instancePath}: ${x.message}`)}),
  catalog: {capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION,
}};
const preview = await previewGraphmlReadOnly(Uint8Array.from(fs.readFileSync("tests/fixtures/import/graphml/valid-two-nodes.graphml")));
for (const edges of [[],[0]]) {
  const decisions={sourceSha256:preview.sourceSha256,graphId:preview.graphId,
    roles:[{nodeOrdinal:0,type:"network.router"},{nodeOrdinal:1,type:"network.switch"}],
    modeledEdgeOrdinals:edges,acknowledgeModeledConnections:edges.length>0};
  const mapped=mapReviewedGraphmlToBuilder(preview,decisions);
  assert.equal(mapped.status,"READY_FOR_COMPILATION",JSON.stringify(mapped.diagnostics));
  assert.equal(Boolean(validateSource(mapped.source)),true,JSON.stringify(validateSource.errors));
  const candidate = await compileBuilderWorkspace(createBuilderWorkspace(mapped.source),compilerOptions);
  assert.equal(candidate.compile.status,"valid",JSON.stringify(candidate.compile.diagnostics));
  assert.equal(candidate.source.connections.length,edges.length,"No unreviewed graph edge may enter Builder");
  assert.equal(candidate.source.resources.length,2);
  assert.notEqual(candidate.source.completion.path,"type","Imported existence must not be a tautological success condition");
}
console.log("PASS GRAPHML-P2B: canonical schema + actual Builder compilation for nodes-only and explicitly confirmed link; no inferred links.");
