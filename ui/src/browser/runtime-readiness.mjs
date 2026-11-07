// DOM attestation is invoked only from React's post-commit effect. Static
// HTML and a ready build manifest are not sufficient release evidence.
export function markApplicationReady(doc) {
  const root = doc.getElementById("app");
  const applicationActions = root?.querySelector('nav[aria-label="Application actions"]') ?? root?.querySelector('section[aria-label="Main actions"]');
  if (!root?.querySelector('.app-frame[data-app-runtime="ready"]') ||
      !applicationActions ||
      !root.querySelector(".workspace-grid")) return false;
  doc.documentElement.dataset.appRuntime = "ready";
  doc.body.dataset.appRuntime = "ready";
  return true;
}
export function markApplicationStopped(doc) {
  doc.documentElement.dataset.appRuntime = "stopped";
  doc.body.dataset.appRuntime = "stopped";
}
