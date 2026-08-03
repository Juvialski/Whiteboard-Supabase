/**
 * Optional local-only sandbox mode. Normal localhost development uses Supabase.
 * Enable this mode explicitly with VITE_LOCAL_SANDBOX=true or localStorage.
 */

export const isSandboxEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    import.meta.env.VITE_LOCAL_SANDBOX === 'true' ||
    host.includes('ais-dev') ||
    host.includes('ais-pre') ||
    Boolean(localStorage.getItem('WHITEBOARD_LOCAL_SANDBOX'))
  );
};

export const getSandboxLocalBoards = (): any[] => {
  try {
    const raw = localStorage.getItem('lucid_spark_boards');
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading sandbox local boards:', err);
  }
  // Default fallback board for sandbox testing
  const defaultBoards = [
    {
      id: 'sandbox-board-1',
      name: 'Sandbox Local Whiteboard',
      description: 'Local Sandbox Workspace (no cloud database usage)',
      createdAt: Date.now(),
      createdBy: 'Sandbox Developer',
      studentId: '',
      studentName: 'All Collaborative',
      studentsCanWrite: true
    }
  ];
  try {
    localStorage.setItem('lucid_spark_boards', JSON.stringify(defaultBoards));
  } catch (err) {
    console.warn('Could not save default sandbox boards to localStorage:', err);
  }
  return defaultBoards;
};

export const saveSandboxLocalBoards = (boards: any[]) => {
  try {
    localStorage.setItem('lucid_spark_boards', JSON.stringify(boards));
    window.dispatchEvent(new CustomEvent('lucid_spark_boards_updated'));
  } catch (err) {
    console.error('Error saving sandbox local boards:', err);
  }
};

export const getSandboxLocalElements = (boardId: string): any[] => {
  try {
    const raw = localStorage.getItem(`lucid_spark_board_elements_${boardId}`);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading sandbox elements for board', boardId, err);
  }
  return [];
};

export const saveSandboxLocalElements = (boardId: string, elements: any[]) => {
  try {
    localStorage.setItem(`lucid_spark_board_elements_${boardId}`, JSON.stringify(elements));
    window.dispatchEvent(new CustomEvent('lucid_spark_elements_updated', { detail: { boardId } }));
  } catch (err) {
    console.error('Error saving sandbox elements for board', boardId, err);
  }
};
