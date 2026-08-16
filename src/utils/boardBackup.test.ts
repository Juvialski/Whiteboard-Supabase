import { describe, it, expect } from 'vitest';
import { parseBoardBackup, BoardBackupData } from './boardBackup';

describe('boardBackup', () => {
  it('parses valid board backup JSON correctly', () => {
    const validJson = JSON.stringify({
      version: 1,
      exportedAt: 123456789,
      board: { name: 'Sample Board', description: 'Test description' },
      elements: [{ id: 'el-1', type: 'sticky', x: 10, y: 20 }],
    });

    const parsed: BoardBackupData = parseBoardBackup(validJson);
    expect(parsed.version).toBe(1);
    expect(parsed.board.name).toBe('Sample Board');
    expect(parsed.elements.length).toBe(1);
    expect(parsed.elements[0].id).toBe('el-1');
  });

  it('throws error for invalid backup structure', () => {
    expect(() => parseBoardBackup('invalid json')).toThrow();
    expect(() => parseBoardBackup(JSON.stringify({ version: 1 }))).toThrow(/missing or invalid elements/i);
  });
});
