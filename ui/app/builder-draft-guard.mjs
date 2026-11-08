// A typed but unapplied Builder form is user data, yet it is not part of
// the canonical source and cannot be represented by a .yadilab snapshot.
// Track live form owners independently of React's eventual repaint.
export function createPendingBuilderDraftRegistry() {
  const pending = new Set();
  return {
    mark(owner, dirty) {
      if (typeof owner !== "object" || owner === null) throw new TypeError("Draft owner required.");
      if (dirty) pending.add(owner);
      else pending.delete(owner);
      return pending.size;
    },
    hasPending() { return pending.size > 0; },
    hasOtherPending(owner) {
      for (const candidate of pending) if (candidate !== owner) return true;
      return false;
    },
    count() { return pending.size; },
  };
}
