// A typed but unapplied Builder form is user data, yet it is not part of
// the canonical source and cannot be represented by a .yadilab snapshot.
// Track live form owners independently of React's eventual repaint.
export function createPendingBuilderDraftRegistry() {
  const pending = new Set();
  let generation = 0;
  return {
    // Project replacement is a synchronous boundary. Old React component
    // effects may unmount later; their input callbacks cannot re-register
    // a draft against a new document generation.
    beginGeneration(nextGeneration) {
      if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= generation)
        throw new RangeError("The project generation must strictly advance.");
      generation = nextGeneration;
      pending.clear();
      return pending.size;
    },
    mark(owner, dirty, ownerGeneration = generation) {
      if (typeof owner !== "object" || owner === null) throw new TypeError("Draft owner required.");
      if (ownerGeneration !== generation) return pending.size;
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
