/**
 * Materials components exports
 */

export * from './types';
export { MaterialsTreeTable } from './MaterialsTreeTable';
export { MaterialsTreeView } from './MaterialsTreeView';
export { DetailPanel } from './DetailPanel';
export { MaterialEditModal, type MaterialEditType } from './MaterialEditModal';
export { TrimsTable } from './TrimsTable';
export { ServicesTable } from './ServicesTable';

// Cell components
export * from './cells';

// Hooks
export { useMaterialsTree, useMaterialsTreeMutations, materialsTreeKeys } from './hooks/useMaterialsTree';
