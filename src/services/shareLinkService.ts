import { supabase } from '../supabase';

export type BoardShareRole = 'viewer' | 'editor';

interface ShareLinkRow {
  id: string;
  role: BoardShareRole;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

const MAX_ACTIVE_SHARE_LINKS_PER_BOARD = 10;

function isActiveLink(link: ShareLinkRow, now: number): boolean {
  if (link.revoked_at) return false;
  if (!link.expires_at) return true;
  const expiresAt = Date.parse(link.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

async function keepShareLinksBounded(boardId: string): Promise<void> {
  const { data, error } = await supabase.rpc('list_board_share_links', {
    p_board_id: boardId,
  });
  if (error) {
    throw new Error(`Unable to inspect existing sharing links: ${error.message}. Apply the latest Supabase migration.`);
  }

  const now = Date.now();
  const activeLinks = (Array.isArray(data) ? data : [])
    .map((row: any): ShareLinkRow => ({
      id: String(row.id || ''),
      role: row.role === 'viewer' ? 'viewer' : 'editor',
      created_at: String(row.created_at || ''),
      expires_at: row.expires_at ? String(row.expires_at) : null,
      revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    }))
    .filter((link) => link.id && isActiveLink(link, now))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  // Leave one slot for the link that will be created immediately afterward.
  const linksToRevoke = activeLinks.slice(0, Math.max(0, activeLinks.length - (MAX_ACTIVE_SHARE_LINKS_PER_BOARD - 1)));
  for (const link of linksToRevoke) {
    const { error: revokeError } = await supabase.rpc('revoke_board_share_link', {
      p_link_id: link.id,
    });
    if (revokeError) throw new Error(`Unable to rotate an old sharing link: ${revokeError.message}`);
  }
}

export async function createSecureBoardShareLink(
  boardId: string,
  role: BoardShareRole,
  expiresAt: string | null = null
): Promise<string> {
  await keepShareLinksBounded(boardId);

  const { data, error } = await supabase.rpc('create_board_share_link', {
    p_board_id: boardId,
    p_role: role,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);

  const payload = data as any;
  const rawToken = String(payload?.rawToken || payload?.raw_token || '');
  if (!rawToken) throw new Error('Supabase did not return a sharing token.');
  return rawToken;
}
