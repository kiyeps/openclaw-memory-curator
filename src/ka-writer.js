// KA write sequence shared by the CLI and the daemon.
//
// DKG node v10.0.19 seals an assertion at creation time: a KA created WITH
// quads comes back status="wm-sealed", and every later wm/write on it returns
// 409 KA_ASSERTION_ALREADY_FINALIZED. The sequence therefore has to be
// draft -> append batches -> finalize.
//
// The safety net matters just as much: the maturity tracker is only updated
// AFTER the whole sequence succeeds, so a KA abandoned mid-sequence is never
// revisited and never cleaned up. That is exactly how 8,890 partial KAs
// accumulated between 2026-09-25 and 2026-10-14 and inflated the Working
// Memory view by 90%. Any failure now discards the partial KA before the error
// is rethrown, so the failure is visible in the log without leaving residue.

export async function writeKaSequence(dkg, slug, batches) {
  let draftOpened = false;
  try {
    await dkg.createKA(slug, []);
    draftOpened = true;
    for (const b of batches) {
      await dkg.wmWrite(slug, b);
    }
    await dkg.wmFinalize(slug);
  } catch (e) {
    if (draftOpened) {
      try {
        await dkg.wmDiscard(slug);
        e.discarded = true;
      } catch (d) {
        e.discardError = d.message;
      }
    }
    throw e;
  }
  return { draftOpened, batches: batches.length };
}
