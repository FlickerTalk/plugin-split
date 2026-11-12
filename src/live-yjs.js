import * as Y from "yjs";
import { fromBase64, toBase64 } from "./live.js";

// onChange never reports this origin, so what the twin sent doesn't echo back
export const LIVE_ORIGIN = "live";

const EMPTY = 2; // an empty update is [0, 0]

export function yjsReplica(doc) {
  return {
    have: () => toBase64(Y.encodeStateVector(doc)),
    missing(have) {
      const update = Y.encodeStateAsUpdate(doc, fromBase64(have));
      return update.length <= EMPTY ? null : toBase64(update);
    },
    apply(payload) {
      const update = fromBase64(payload);
      // decode first so garbage throws here, not halfway into the document
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
