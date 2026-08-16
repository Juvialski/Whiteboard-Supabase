import { BoardElement, Whiteboard } from '../types';

export interface BoardBackupData {
  version: number;
  exportedAt: number;
  board: Partial<Whiteboard>;
  elements: BoardElement[];
}

/**
 * Creates and triggers a download of a JSON backup file for the given board.
 */
export function exportBoardBackup(board: Partial<Whiteboard>, elements: BoardElement[]): void {
  const data: BoardBackupData = {
    version: 1,
    exportedAt: Date.now(),
    board: {
      name: board.name || 'Whiteboard',
      description: board.description || '',
      studentName: board.studentName || '',
      studentsCanWrite: board.studentsCanWrite,
    },
    elements,
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (board.name || 'whiteboard').replace(/[^a-zA-Z0-9_-]/g, '_');
  a.href = url;
  a.download = `${safeName}-backup.whiteboard.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parses and validates a JSON backup string.
 */
export function parseBoardBackup(jsonString: string): BoardBackupData {
  const data = JSON.parse(jsonString);
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid board backup file format.');
  }
  if (!Array.isArray(data.elements)) {
    throw new Error('Missing or invalid elements in board backup.');
  }
  return {
    version: data.version || 1,
    exportedAt: data.exportedAt || Date.now(),
    board: data.board || {},
    elements: data.elements,
  };
}
