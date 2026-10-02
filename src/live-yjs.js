// A Yjs document as the replica of the common live protocol (`live.js`): what it has is its state
// vector, what the twin lacks is the update since that vector, and what the twin sends is
// applied with `LIVE_ORIGIN`, which `onChange` never reports, so nothing echoes back. Copy this
// file with `live.js` when a plugin keeps its document in Yjs.
import * as Y from "yjs";
import { fromBase64, toBase64 } from "./live.js";

/** The origin of what came from the twin. */
export const LIVE_ORIGIN = "live";

const EMPTY = 2; // an update with no structs and no deletions: [0, 0]

export function yjsReplica(doc) {
  return {
    have: () => toBase64(Y.encodeStateVector(doc)),
    missing(have) {
      const update = Y.encodeStateAsUpdate(doc, fromBase64(have));
      return update.length <= EMPTY ? null : toBase64(update);
    },
    apply(payload) {
      const update = fromBase64(payload);
      // Read it whole before touching the document: garbage throws here, not halfway in.
      Y.decodeUpdate(update);
      Y.applyUpdate(doc, update, LIVE_ORIGIN);
    },
    onChange(listener) {
      const heard = (update, origin) => {
        if (origin !== LIVE_ORIGIN) listener(toBase64(update));
      };
      doc.on("update", heard);
      return () => doc.off("update", heard);
    },
  };
}
