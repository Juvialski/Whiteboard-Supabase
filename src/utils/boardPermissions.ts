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
  if (!authUser || !authUser.uid) {
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
  const uid = authUser.uid;
  const ownerUid = boardData?.ownerUid || '';
  const isOwner = ownerUid === uid;

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

  const accessMode = boardData?.accessMode || 'private';
  const editorUids: string[] = Array.isArray(boardData?.editorUids) ? boardData.editorUids : [];
  const viewerUids: string[] = Array.isArray(boardData?.viewerUids) ? boardData.viewerUids : [];
  const studentsCanWrite = boardData?.studentsCanWrite !== false;

  const isEditor = editorUids.includes(uid);
  const isViewer = viewerUids.includes(uid);

  const canRead =
    isEditor ||
    isViewer ||
    accessMode === 'link-view' ||
    accessMode === 'link-edit' ||
    accessMode === 'public';

  const canWrite =
    isEditor ||
    ((accessMode === 'link-edit' || accessMode === 'public') && studentsCanWrite);

  return {
    canRead,
    canWrite,
    canManage: false, // Only owner or admin can manage settings / ACLs / studentsCanWrite
    canDelete: false, // Only owner or admin can delete
    isOwner: false,
    isAdmin: false,
  };
}
