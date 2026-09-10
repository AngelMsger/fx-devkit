// How well a coordinate is known, from best to worst. Combining declared
// confidences takes the weakest: a coordinate is only as trustworthy as
// its least certain part.

import { CONFIDENCE } from '../manifest/common.schema.js';

export type Confidence = (typeof CONFIDENCE)[number];

export function weakest(declared: readonly (Confidence | undefined)[]): Confidence {
  const known = declared.filter((c): c is Confidence => c !== undefined);
  if (known.length === 0) return 'derived';
  return known.reduce((worst, c) =>
    CONFIDENCE.indexOf(c) > CONFIDENCE.indexOf(worst) ? c : worst,
  );
}
