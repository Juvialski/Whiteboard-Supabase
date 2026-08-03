import React, { useEffect, useState } from 'react';
import { Collaborator, UserProfile } from '../types';

interface LiveCursorsProps {
  boardId: string;
  currentUser: UserProfile;
  zoom?: number;
  socketCollaboratorsRef?: React.MutableRefObject<Record<string, Collaborator>>;
  followedUserId?: string | null;
  onFollowUser?: (userId: string) => void;
}

const CollaboratorCursor = React.memo(({
  collaborator,
  zoom,
  isFollowed,
  onFollow,
}: {
  collaborator: Collaborator;
  zoom: number;
  isFollowed?: boolean;
  onFollow?: (userId: string) => void;
}) => {
  return (
    <div
      className="absolute pointer-events-none transition-transform duration-75"
      style={{
        left: collaborator.x,
        top: collaborator.y,
        transform: `translate(-2px, -2px) scale(${1 / zoom})`,
        transformOrigin: 'top left',
      }}
    >
      <svg
        className="w-5 h-5 drop-shadow-md filter"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 3V21L9.12 14.88L15.34 21L18.81 17.53L12.59 11.41L18.71 5.29L3 3Z"
          fill={collaborator.color}
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <button
        onClick={() => onFollow?.(collaborator.id)}
        className={`ml-4 -mt-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold text-white shadow-md select-none whitespace-nowrap pointer-events-auto cursor-pointer flex items-center space-x-1 hover:scale-105 active:scale-95 transition-all ${
          isFollowed ? "ring-2 ring-white ring-offset-2 ring-offset-blue-600 animate-pulse" : ""
        }`}
        style={{ backgroundColor: collaborator.color }}
        title={`Click to follow ${collaborator.name}`}
      >
        <span>{collaborator.name}</span>
        {isFollowed && <span className="text-[9px] bg-white/30 px-1.5 py-0.2 rounded-full">Following</span>}
      </button>
    </div>
  );
});

export default function LiveCursors({
  boardId,
  currentUser,
  zoom = 1,
  socketCollaboratorsRef,
  followedUserId,
  onFollowUser,
}: LiveCursorsProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    let interval: any;
    if (socketCollaboratorsRef) {
      let prevSig = '';
      interval = setInterval(() => {
        const raw = socketCollaboratorsRef.current || {};
        const list = (Object.values(raw) as Collaborator[]).filter(
          (collaborator) => collaborator && collaborator.id !== currentUser.id
        );
        const sig = list.map(c => `${c.id}:${Math.round(c.x)},${Math.round(c.y)}`).join('|');
        if (sig !== prevSig) {
          prevSig = sig;
          setCollaborators(list);
        }
      }, 1000 / 30);
      return () => clearInterval(interval);
    }
  }, [boardId, currentUser.id, socketCollaboratorsRef]);

  return (
    <div className="absolute inset-0 pointer-events-none z-40" id="live-cursors-layer">
      {collaborators.map((c) => (
        <CollaboratorCursor
          key={c.id}
          collaborator={c}
          zoom={zoom}
          isFollowed={c.id === followedUserId}
          onFollow={onFollowUser}
        />
      ))}
    </div>
  );
}
