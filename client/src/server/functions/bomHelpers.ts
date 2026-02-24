import { getPrisma } from '@coh/shared/services/db';

type PrismaClient = Awaited<ReturnType<typeof getPrisma>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbRecord = any;

export interface MutationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN';
    message: string;
  };
}

export { SIZE_ORDER, sortBySizeOrder as _sortBySizeComparator } from '@coh/shared/config/product';
import { sortBySizeOrder as _comparator } from '@coh/shared/config/product';

export async function getMainFabricRole(prisma: PrismaClient) {
  return prisma.componentRole.findFirst({
    where: {
      code: 'main',
      type: { code: 'FABRIC' },
    },
  });
}

/** Sort an array of size strings in standard order (mutates + returns) */
export function sortBySizeOrder(sizes: string[]): string[] {
  return sizes.sort(_comparator);
}
