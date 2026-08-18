import { Whiteboard } from '../types';

export interface BoardPermissions {
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
  canDelete: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

export interface AuthUser {
  uid: string;
  admin?: boolean;
}

/**
  * Derives board authorization permissions deterministically based on board ACL data and authenticated user.
  */
export function getBoardPermissions(
  boardData: Whiteboard | any,
  authUser: AuthUser | null
): BoardPermissions {
  const effectivePermission = String(
    boardData?.effectivePermission || boardData?.effective_permission || ''
  ).toLowerCase();

  // The hardened get_board_state RPC returns the effective permission after RLS
  // and membership checks. When present, it is the only authority used by the UI.
  if (effectivePermission) {
    const canRead = ['viewer', 'editor', 'owner', 'admin'].includes(effectivePermission);
    const canWrite = boardData?.effectiveCanWrite === true || boardData?.effective_can_write === true;
    const canManage = boardData?.effectiveCanManage === true || boardData?.effective_can_manage === true || ['owner', 'admin'].includes(effectivePermission);
    return {
      canRead,
      canWrite,
      canManage,
      canDelete: canManage,
      isOwner: ['owner', 'admin'].includes(effectivePermission),
      isAdmin: effectivePermission === 'admin',
    };
  }

  const studentsCanWrite = boardData?.studentsCanWrite !== false;
  const accessMode = boardData?.accessMode || 'private';
  const isExplicitlyViewOnly = accessMode === 'link-view';

  // Deny while the secure board manifest is unresolved. This prevents guests
  // from making edits that look successful locally but are rejected by Supabase.
  if (!boardData || !authUser || (!authUser.uid && !(authUser as any).id)) {
    return {
      canRead: false,
      canWrite: false,
      canManage: false,
      canDelete: false,
      isOwner: false,
      isAdmin: false,
    };
  }

  const isAdmin = !!authUser.admin;
  const uid = authUser.uid || (authUser as any).id || '';
  const ownerUid = boardData?.ownerUid || boardData?.owner_uid || '';
  const isOwner = Boolean(ownerUid && ownerUid === uid);

  if (isAdmin || isOwner) {
    return {
      canRead: true,
      canWrite: true,
      canManage: true,
      canDelete: true,
      isOwner: true,
      isAdmin,
    };
  }

  const editorUids: string[] = Array.isArray(boardData?.editorUids) ? boardData.editorUids : [];
  const viewerUids: string[] = Array.isArray(boardData?.viewerUids) ? boardData.viewerUids : [];

  const isEditor = editorUids.includes(uid);
  const isViewer = viewerUids.includes(uid);

  const canRead = isOwner || isAdmin || isEditor || isViewer;

  const canWrite = isEditor && !isExplicitlyViewOnly && studentsCanWrite;

  return {
    canRead,
    canWrite,
    canManage: false, // Only owner or admin can manage settings / ACLs / studentsCanWrite
    canDelete: false, // Only owner or admin can delete
    isOwner: false,
    isAdmin: false,
  };
}
