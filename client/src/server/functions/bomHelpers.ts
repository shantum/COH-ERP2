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

export const SIZE_ORDER = [
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL',
] as const;

export async function getMainFabricRole(prisma: PrismaClient) {
  return prisma.componentRole.findFirst({
    where: {
      code: 'main',
      type: { code: 'FABRIC' },
    },
  });
}

export function sortBySizeOrder(sizes: string[]): string[] {
  return sizes.sort((a, b) => {
    const indexA = SIZE_ORDER.indexOf(a as (typeof SIZE_ORDER)[number]);
    const indexB = SIZE_ORDER.indexOf(b as (typeof SIZE_ORDER)[number]);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}
