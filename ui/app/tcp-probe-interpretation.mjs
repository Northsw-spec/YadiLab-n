export function modeledTcpProbeInterpretation(transcript) {
  if (transcript?.protocol !== "tcp") return null;
  const blockedPolicy = transcript.policyDecisions?.find((decision) => decision.truth === "FALSE");
  if (transcript.truth === "FALSE" && blockedPolicy) {
    return {
      code: "POLICY_BLOCKED",
      text: `Engine-evidens: trafikpolicyn blockerade på ${blockedPolicy.resourceId}. Det här testet visar inte om målserverns modellerade tjänst är aktiv eller avstängd.`,
    };
  }
  const listener = transcript.listenerServiceDecision;
  if (transcript.truth === "FALSE" && (listener?.disposition === "SERVICE_DISABLED" || listener?.serviceState === "DISABLED")) {
    return {
      code: "SERVICE_DISABLED",
      text: "Engine-evidens: destinationens modellerade tjänst är avstängd. Kontrollera tjänstestatus och verifiera nätverksvägen separat innan du drar slutsatser om hela anslutningen.",
    };
  }
  if (transcript.truth === "TRUE") {
    return {
      code: "REACHABLE_LISTENER",
      text: "Engine-evidens: TCP/porten nådde en aktiv listener på målservern. Det verifierar tjänstetillgänglighet för den modellerade vägen.",
    };
  }
  return {
    code: "CAUSE_NOT_PROVEN",
    text: "Tolkning: TCP-resultatet ensamt skiljer inte mellan tjänst och policy. Kör en tjänsteobservation och en policyobservation innan du väljer remediation.",
  };
}
