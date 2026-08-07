import { supabase } from '../supabase';

export type BoardMemberRole = 'viewer' | 'editor';

export interface BoardMember {
  userId: string;
  role: BoardMemberRole;
  createdAt: string;
  expiresAt: string | null;
  displayName: string;
}

function normalizeMember(row: any): BoardMember | null {
  const userId = String(row?.user_id || row?.userId || '');
  if (!userId) return null;
  return {
    userId,
    role: row?.role === 'editor' ? 'editor' : 'viewer',
    createdAt: String(row?.created_at || row?.createdAt || ''),
    expiresAt: row?.expires_at || row?.expiresAt ? String(row?.expires_at || row?.expiresAt) : null,
    displayName: String(row?.display_name || row?.displayName || 'Guest user'),
  };
}

export async function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  const { data, error } = await supabase.rpc('list_board_members', {
    p_board_id: boardId,
  });
  if (error) {
    throw new Error(`Unable to load board members: ${error.message}`);
  }

  return (Array.isArray(data) ? data : [])
    .map(normalizeMember)
    .filter((member): member is BoardMember => member !== null);
}

export async function updateBoardMemberRole(
  boardId: string,
  userId: string,
  role: BoardMemberRole,
): Promise<void> {
  const { data, error } = await supabase.rpc('update_board_member_role', {
    p_board_id: boardId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) {
    throw new Error(`Unable to update member access: ${error.message}. Apply the latest Supabase migration.`);
  }
  if (data !== true) {
    throw new Error('That user no longer has an active board membership. Refresh the People menu and try again.');
  }
}
