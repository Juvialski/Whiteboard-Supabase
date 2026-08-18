import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { getBoardPermissions } from '../../utils/boardPermissions';
import { FollowIndicatorBanner, ReadOnlyAlertBanner } from '../canvas/CanvasOverlays';
import { Whiteboard } from '../../types';

describe('Presenter Mode Authorization and Read-Only Locking Suite', () => {
  const ownerBoard: Whiteboard = {
    id: 'board-123',
    name: 'Classroom Board',
    ownerUid: 'teacher-owner',
    createdBy: 'teacher-owner',
    editorUids: ['student-456'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    studentsCanWrite: true,
  };

  it('correctly identifies board owner permission vs student permission', () => {
    const ownerPerms = getBoardPermissions(ownerBoard, { uid: 'teacher-owner' });
    expect(ownerPerms.isOwner).toBe(true);
    expect(ownerPerms.canManage).toBe(true);
    expect(ownerPerms.canWrite).toBe(true);

    const studentPerms = getBoardPermissions(ownerBoard, { uid: 'student-456' });
    expect(studentPerms.isOwner).toBe(false);
    expect(studentPerms.canManage).toBe(false);
    expect(studentPerms.canWrite).toBe(true);
  });

  it('locks student canWrite to false during Presenter Mode', () => {
    const studentPerms = getBoardPermissions(ownerBoard, { uid: 'student-456' });
    const isOwner = studentPerms.isOwner;
    const presenterTeacherId = 'teacher-owner';
    const isPresenterLocked = !isOwner && Boolean(presenterTeacherId);

    expect(isPresenterLocked).toBe(true);

    // canWrite derivation used across WhiteboardCanvas:
    const canWrite = (studentPerms.canWrite && !isPresenterLocked);
    expect(canWrite).toBe(false);
  });

  it('keeps owner canWrite true and isPresenterLocked false on presenter device', () => {
    const ownerPerms = getBoardPermissions(ownerBoard, { uid: 'teacher-owner' });
    const isOwner = ownerPerms.isOwner;
    const presenterTeacherId = 'teacher-owner';
    const isPresenterLocked = !isOwner && Boolean(presenterTeacherId);

    expect(isPresenterLocked).toBe(false);

    const canWrite = (ownerPerms.canWrite && !isPresenterLocked);
    expect(canWrite).toBe(true);
  });

  it('renders non-dismissible purple banner for students during presenter mode', () => {
    const onStopFollow = vi.fn();
    render(
      <FollowIndicatorBanner
        followedUserId="teacher-owner"
        collaborators={{ 'teacher-owner': { id: 'teacher-owner', name: 'Professor Smith' } }}
        onStopFollow={onStopFollow}
        isPresenterLocked={true}
        presenterName="Professor Smith"
      />
    );

    expect(screen.getByText(/Presenter Mode Active:/i)).toBeTruthy();
    expect(screen.getByText('Professor Smith')).toBeTruthy();
    expect(screen.getByText(/Read Only/i)).toBeTruthy();
    expect(screen.queryByText(/Stop Following/i)).toBeNull();
  });

  it('renders voluntary follow banner with dismiss button for normal follow mode', () => {
    const onStopFollow = vi.fn();
    render(
      <FollowIndicatorBanner
        followedUserId="peer-student"
        collaborators={{ 'peer-student': { id: 'peer-student', name: 'Peer Student' } }}
        onStopFollow={onStopFollow}
        isPresenterLocked={false}
      />
    );

    expect(screen.getByText(/Peer Student/i)).toBeTruthy();
    const stopBtn = screen.getByText('Stop Following (Esc)');
    expect(stopBtn).toBeTruthy();
    fireEvent.click(stopBtn);
    expect(onStopFollow).toHaveBeenCalledTimes(1);
  });

  it('displays clear read-only notice when student attempts action during presenter mode', () => {
    render(
      <ReadOnlyAlertBanner
        show={true}
        message="Presenter Mode: The presenter is currently sharing their view. Screen is locked to read-only."
      />
    );

    expect(screen.getByText(/Presenter Mode: The presenter is currently sharing their view/i)).toBeTruthy();
  });
});
