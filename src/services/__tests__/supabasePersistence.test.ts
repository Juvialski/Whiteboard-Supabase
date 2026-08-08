import { describe, expect, it } from 'vitest';
import {
  SHARD_COUNT,
  getShardIdForElement,
  partitionElementsIntoChunks,
  partitionMutationPayloads,
  sanitizeForDatabase,
  sanitizeElementForStorage,
  mergeRemoteElementData,
  simplifyPoints,
  stableHash,
} from '../boardPersistence';
import type { BoardElement } from '../../types';

describe('Supabase persistence primitives', () => {
  it('assigns every element to one of sixteen stable shards', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `element-${index}`);
    const first = ids.map((id) => getShardIdForElement(id));
    const second = ids.map((id) => getShardIdForElement(id));

    expect(first).toEqual(second);
    expect(new Set(first).size).toBeGreaterThan(1);
    first.forEach((shardId) => {
      const shardNumber = Number(shardId.replace('shard_', ''));
      expect(shardNumber).toBeGreaterThanOrEqual(0);
      expect(shardNumber).toBeLessThan(SHARD_COUNT);
    });
  });

  it('uses a deterministic unsigned hash', () => {
    expect(stableHash('same-id')).toBe(stableHash('same-id'));
    expect(stableHash('same-id')).toBeGreaterThanOrEqual(0);
  });

  it('removes undefined values before JSONB persistence', () => {
    expect(sanitizeForDatabase({ a: 1, b: undefined, nested: { c: undefined, d: 2 } }))
      .toEqual({ a: 1, nested: { d: 2 } });
  });

  it('reduces dense drawing point streams while preserving endpoints', () => {
    const points = Array.from({ length: 100 }, (_, index) => ({ x: index * 0.1, y: index * 0.1 }));
    const simplified = simplifyPoints(points, 1);
    expect(simplified.length).toBeLessThan(points.length);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified.at(-1)).toEqual(points.at(-1));
  });

  it('partitions imports by approximate JSON byte target', () => {
    const elements = Array.from({ length: 12 }, (_, index) => ({
      id: `note-${index}`,
      type: 'text',
      text: 'x'.repeat(300),
      x: index,
      y: index,
    })) as unknown as BoardElement[];
    const chunks = partitionElementsIntoChunks(elements, 1_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(elements.length);
  });
  it('partitions mutation RPCs below both count and byte limits', () => {
    const payloads = Array.from({ length: 11 }, (_, index) => ({
      elementId: `element-${index}`,
      shardId: `shard_${index % 4}`,
      action: 'set' as const,
      data: {
        id: `element-${index}`,
        type: 'text' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        text: 'x'.repeat(250),
        color: '#000000',
        fontSize: 16,
        zIndex: index,
      },
      updatedAt: index,
      updatedByClientId: 'test-client',
    }));

    const batches = partitionMutationPayloads(payloads, 1_500, 4);
    expect(batches.flat()).toHaveLength(payloads.length);
    expect(batches.every((batch) => batch.length <= 4)).toBe(true);
    expect(batches.length).toBeGreaterThan(2);
  });

  it('rejects prototype keys and non-finite numbers before persistence', () => {
    const poisoned = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}');
    expect(() => sanitizeForDatabase(poisoned)).toThrow(/forbidden key/i);
    expect(() => sanitizeForDatabase({ x: Number.NaN })).toThrow(/non-finite/i);
  });

  it('validates element identity and type before persistence', () => {
    expect(() => sanitizeElementForStorage({ id: '', type: 'text' } as unknown as BoardElement))
      .toThrow(/element id/i);
    expect(() => sanitizeElementForStorage({ id: 'bad', type: 'unknown' } as unknown as BoardElement))
      .toThrow(/element type/i);
  });

  it('merges compact realtime patches into a complete validated element', () => {
    const existing = {
      id: 'text-live-1',
      type: 'text',
      x: 10,
      y: 20,
      width: 200,
      height: 60,
      text: 'old',
      color: '#000000',
      fontSize: 16,
      zIndex: 4,
    } as BoardElement;

    const merged = mergeRemoteElementData(existing, { text: 'live text' }, existing.id, true);
    expect(merged).toMatchObject({
      id: 'text-live-1',
      type: 'text',
      x: 10,
      y: 20,
      text: 'live text',
    });
  });

  it('rejects a compact realtime patch when no complete element exists', () => {
    expect(() => mergeRemoteElementData(undefined, { text: 'orphan patch' }, 'text-missing', true))
      .toThrow(/element type/i);
  });

});
