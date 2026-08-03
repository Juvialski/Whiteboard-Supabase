import { describe, expect, it } from 'vitest';
import {
  SHARD_COUNT,
  getShardIdForElement,
  partitionElementsIntoChunks,
  sanitizeForDatabase,
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
});
