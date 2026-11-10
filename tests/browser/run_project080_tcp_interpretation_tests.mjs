import assert from "node:assert/strict";
import { modeledTcpProbeInterpretation } from "../../ui/app/tcp-probe-interpretation.mjs";

let checks = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const absent = (text, fragment, message) => { ok(!text.includes(fragment), message); };

const confirmedService = modeledTcpProbeInterpretation({
  protocol: "tcp",
  truth: "FALSE",
  policyDecisions: [{ truth: "TRUE" }],
  listenerServiceDecision: { disposition: "SERVICE_DISABLED", serviceState: "DISABLED" },
});
equal(confirmedService.code, "SERVICE_DISABLED", "disabled service is classified from listener evidence");
ok(confirmedService.text.includes("destinationens modellerade tjänst är avstängd"), "disabled service remains learner-visible");
absent(confirmedService.text, "nätväg och policy passerade", "service text does not claim path and policy passed");
ok(confirmedService.text.includes("verifiera nätverksvägen separat"), "service text names the remaining network uncertainty");

const uncertainPath = modeledTcpProbeInterpretation({
  protocol: "tcp",
  truth: "FALSE",
  listenerServiceDecision: { disposition: "SERVICE_DISABLED", serviceState: "DISABLED" },
});
equal(uncertainPath.code, "SERVICE_DISABLED", "known service failure is preserved when path evidence is absent");
absent(uncertainPath.text, "alla policy", "unknown path does not become a policy claim");
absent(uncertainPath.text, "nätväg och policy passerade", "unknown path does not become a path claim");

const blockedPolicy = modeledTcpProbeInterpretation({
  protocol: "tcp",
  truth: "FALSE",
  policyDecisions: [{ resourceId: "client1", truth: "FALSE" }],
});
equal(blockedPolicy.code, "POLICY_BLOCKED", "false policy decision is classified as policy blocking");
ok(blockedPolicy.text.includes("trafikpolicyn blockerade"), "policy evidence remains learner-visible");
absent(blockedPolicy.text, "tjänst är avstängd", "policy evidence does not infer a disabled service");

const insufficientEvidence = modeledTcpProbeInterpretation({
  protocol: "tcp",
  truth: "FALSE",
  policyDecisions: [{ resourceId: "client1", truth: "UNKNOWN" }],
  listenerServiceDecision: { disposition: "SERVICE_STATE_UNKNOWN", serviceState: "UNKNOWN" },
});
equal(insufficientEvidence.code, "CAUSE_NOT_PROVEN", "incomplete listener and policy evidence remains fail-closed");
ok(insufficientEvidence.text.includes("TCP-resultatet ensamt"), "insufficient evidence gives next diagnostic guidance");

console.log(`PASS PROJECT-080 TCP interpretation logic: ${checks} assertions.`);
