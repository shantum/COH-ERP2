/**
 * Re-export canonical size constants from shared package.
 * All size definitions originate from @coh/shared/config/product.
 */
export { SIZE_ORDER, sortBySizeOrder, getSizeIndex, type StandardSize } from '@coh/shared/config/product';

import { SIZE_ORDER as _SIZE_ORDER, type StandardSize as _StandardSize } from '@coh/shared/config/product';

/** Check if a size is a standard size */
export const isStandardSize = (size: string): size is _StandardSize => {
    return (_SIZE_ORDER as readonly string[]).includes(size);
};
