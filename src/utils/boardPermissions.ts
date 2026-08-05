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
  const studentsCanWrite = boardData?.studentsCanWrite !== false;
  const accessMode = boardData?.accessMode || 'link-edit';
  const isExplicitlyViewOnly = accessMode === 'link-view';

  if (!authUser || !authUser.uid) {
    return {
      canRead: true,
      canWrite: studentsCanWrite && !isExplicitlyViewOnly,
      canManage: false,
      canDelete: false,
      isOwner: false,
      isAdmin: false,
    };
  }

  const isAdmin = !!authUser.admin;
  const uid = authUser.uid;
  const ownerUid = boardData?.ownerUid || '';
  const isOwner = Boolean(ownerUid && ownerUid === uid);

  if (isAdmin || isOwner) {
    return {
      canRead: true,
      canWrite: true,
      canManage: true,
      canDelete: true,
      isOwner,
      isAdmin,
    };
  }

  const editorUids: string[] = Array.isArray(boardData?.editorUids) ? boardData.editorUids : [];
  const viewerUids: string[] = Array.isArray(boardData?.viewerUids) ? boardData.viewerUids : [];

  const isEditor = editorUids.includes(uid);
  const isViewer = viewerUids.includes(uid);

  const canRead = true;

  const canWrite = isEditor || (!isViewer && !isExplicitlyViewOnly && studentsCanWrite);

  return {
    canRead,
    canWrite,
    canManage: false, // Only owner or admin can manage settings / ACLs / studentsCanWrite
    canDelete: false, // Only owner or admin can delete
    isOwner: false,
    isAdmin: false,
  };
}
