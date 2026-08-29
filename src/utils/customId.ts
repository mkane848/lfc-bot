/**
 * Encode/decode pairs for every `lfc:*` component customId used across the
 * bot, kept in one place so a builder and its parser can never silently
 * disagree about the string format (which is exactly how `/edit` broke:
 * `buildEditModal` and `handleEditModal` each assumed a different segment
 * count for the same customId).
 */

const PREFIX = 'lfc';

// --- Listing action buttons: lfc:fulfill:{id} / lfc:delete:{id} ---

export type ListingAction = 'fulfill' | 'delete';

export function encodeListingActionId(action: ListingAction, listingId: number): string {
  return `${PREFIX}:${action}:${listingId}`;
}

export function decodeListingActionId(
  customId: string,
): { action: ListingAction; id: number } | null {
  const [prefix, action, idPart] = customId.split(':');
  if (prefix !== PREFIX || (action !== 'fulfill' && action !== 'delete') || idPart === undefined) {
    return null;
  }
  const id = Number(idPart);
  if (!Number.isInteger(id)) {
    return null;
  }
  return { action, id };
}

// --- Edit modal / edit-next button: a listing id plus an optional queue of
// --- remaining listing ids still to be edited in this batch. ---

export const EDIT_MODAL_KIND = 'editmodal';
export const EDIT_NEXT_KIND = 'editnext';

export interface IdWithQueue {
  id: number;
  queue: number[];
}

function encodeIdWithQueue(kind: string, id: number, queue: number[]): string {
  const suffix = queue.length > 0 ? `:${queue.join(',')}` : '';
  return `${PREFIX}:${kind}:${id}${suffix}`;
}

function decodeIdWithQueue(customId: string, kind: string): IdWithQueue | null {
  const [prefix, k, idPart, queuePart] = customId.split(':');
  if (prefix !== PREFIX || k !== kind || idPart === undefined) {
    return null;
  }
  const id = Number(idPart);
  if (!Number.isInteger(id)) {
    return null;
  }
  const queue = queuePart ? queuePart.split(',').map(Number) : [];
  if (queue.some((n) => !Number.isInteger(n))) {
    return null;
  }
  return { id, queue };
}

export function encodeEditModalId(id: number, queue: number[] = []): string {
  return encodeIdWithQueue(EDIT_MODAL_KIND, id, queue);
}

export function decodeEditModalId(customId: string): IdWithQueue | null {
  return decodeIdWithQueue(customId, EDIT_MODAL_KIND);
}

export function encodeEditNextId(id: number, queue: number[] = []): string {
  return encodeIdWithQueue(EDIT_NEXT_KIND, id, queue);
}

export function decodeEditNextId(customId: string): IdWithQueue | null {
  return decodeIdWithQueue(customId, EDIT_NEXT_KIND);
}

// --- Batch select menus: lfc:batchdelete / lfc:batchfulfill / lfc:batchedit ---

export type BatchSelectAction = 'batchdelete' | 'batchfulfill' | 'batchedit';
const BATCH_SELECT_ACTIONS: readonly BatchSelectAction[] = [
  'batchdelete',
  'batchfulfill',
  'batchedit',
];

export function encodeBatchSelectId(action: BatchSelectAction): string {
  return `${PREFIX}:${action}`;
}

export function decodeBatchSelectId(customId: string): BatchSelectAction | null {
  const [prefix, action] = customId.split(':');
  if (prefix !== PREFIX) {
    return null;
  }
  return (BATCH_SELECT_ACTIONS as readonly string[]).includes(action ?? '')
    ? (action as BatchSelectAction)
    : null;
}

// --- Batch-create modals: fixed ids, no dynamic segment ---

export const HAVE_MULTI_MODAL_ID = `${PREFIX}:havemultimodal`;
export const WANT_MULTI_MODAL_ID = `${PREFIX}:wantmultimodal`;
