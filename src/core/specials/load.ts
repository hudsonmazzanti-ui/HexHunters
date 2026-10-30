/** Load: put a shell in. The unit's attack (units with needsLoading) can only be used while loaded. */
import type { SpecialDef } from './types';

export const load: SpecialDef = {
  name: 'Load',
  describe: () => 'Load a shell. You can only fire while loaded; it stays loaded through moves and turns until fired.',
  targeting: 'none',
  usable: (_s, unit) => (unit.loaded ? 'already loaded' : null),
  apply: (_s, unit) => {
    unit.loaded = true;
    return {};
  },
};
