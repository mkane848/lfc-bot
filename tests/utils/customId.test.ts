import { describe, expect, it } from 'vitest';
import {
  decodeBatchSelectId,
  decodeEditModalId,
  decodeEditNextId,
  decodeListingActionId,
  encodeBatchSelectId,
  encodeEditModalId,
  encodeEditNextId,
  encodeListingActionId,
  decodeMultiModalKind,
  encodeMultiModalId,
  HAVE_MULTI_MODAL_ID,
  WANT_MULTI_MODAL_ID,
} from '../../src/utils/customId.js';

describe('listing action id (fulfill/delete buttons)', () => {
  it('round-trips both actions', () => {
    expect(decodeListingActionId(encodeListingActionId('fulfill', 12))).toEqual({
      action: 'fulfill',
      id: 12,
    });
    expect(decodeListingActionId(encodeListingActionId('delete', 7))).toEqual({
      action: 'delete',
      id: 7,
    });
  });

  it('rejects a customId from a different prefix', () => {
    expect(decodeListingActionId('other:fulfill:12')).toBeNull();
  });

  it('rejects an unknown action', () => {
    expect(decodeListingActionId('lfc:archive:12')).toBeNull();
  });

  it('rejects a non-numeric id', () => {
    expect(decodeListingActionId('lfc:fulfill:abc')).toBeNull();
  });
});

describe('edit modal id', () => {
  it('regression: correctly parses a real editmodal customId (the original bug always failed this)', () => {
    // The original handler destructured `customId.split(':')` into only two
    // variables and compared the first against the literal 'lfc:editmodal',
    // which can never match since split(':') on a 3-segment string yields
    // 'lfc' as the first element, not 'lfc:editmodal'. This case is exactly
    // what a real /edit invocation produces.
    expect(decodeEditModalId('lfc:editmodal:12')).toEqual({ id: 12, queue: [] });
  });

  it('round-trips an empty queue', () => {
    expect(decodeEditModalId(encodeEditModalId(12))).toEqual({ id: 12, queue: [] });
  });

  it('round-trips a non-empty queue', () => {
    expect(decodeEditModalId(encodeEditModalId(12, [15, 19]))).toEqual({
      id: 12,
      queue: [15, 19],
    });
  });

  it('rejects a wrong prefix', () => {
    expect(decodeEditModalId('lfc:editnext:12')).toBeNull();
  });

  it('rejects a non-numeric id', () => {
    expect(decodeEditModalId('lfc:editmodal:abc')).toBeNull();
  });

  it('rejects a non-numeric queue entry', () => {
    expect(decodeEditModalId('lfc:editmodal:12:15,abc')).toBeNull();
  });
});

describe('edit next id', () => {
  it('round-trips an empty and non-empty queue, and is distinct from editmodal', () => {
    expect(decodeEditNextId(encodeEditNextId(15))).toEqual({ id: 15, queue: [] });
    expect(decodeEditNextId(encodeEditNextId(15, [19]))).toEqual({ id: 15, queue: [19] });
    expect(decodeEditNextId(encodeEditModalId(15))).toBeNull();
    expect(decodeEditModalId(encodeEditNextId(15))).toBeNull();
  });
});

describe('batch select id', () => {
  it('round-trips every batch select action', () => {
    expect(decodeBatchSelectId(encodeBatchSelectId('batchdelete'))).toBe('batchdelete');
    expect(decodeBatchSelectId(encodeBatchSelectId('batchfulfill'))).toBe('batchfulfill');
    expect(decodeBatchSelectId(encodeBatchSelectId('batchedit'))).toBe('batchedit');
  });

  it('rejects an unknown action', () => {
    expect(decodeBatchSelectId('lfc:batcharchive')).toBeNull();
  });

  it('rejects a wrong prefix', () => {
    expect(decodeBatchSelectId('other:batchdelete')).toBeNull();
  });
});

describe('batch-create modal ids', () => {
  it('round-trips the listing kind for both batch modals', () => {
    expect(decodeMultiModalKind(encodeMultiModalId(HAVE_MULTI_MODAL_ID, 'sealed'))).toBe('sealed');
    expect(decodeMultiModalKind(encodeMultiModalId(HAVE_MULTI_MODAL_ID, 'card'))).toBe('card');
    expect(decodeMultiModalKind(encodeMultiModalId(WANT_MULTI_MODAL_ID, 'sealed'))).toBe('sealed');
  });

  it('keeps the base id as a prefix so routing still matches', () => {
    expect(encodeMultiModalId(HAVE_MULTI_MODAL_ID, 'sealed').startsWith(HAVE_MULTI_MODAL_ID)).toBe(
      true,
    );
  });

  // A modal opened before the kind segment existed and submitted after a
  // deploy has a bare id, and `card` is what it meant.
  it('defaults a kind-less id to card', () => {
    expect(decodeMultiModalKind(HAVE_MULTI_MODAL_ID)).toBe('card');
    expect(decodeMultiModalKind('lfc:havemultimodal:nonsense')).toBe('card');
  });
});
