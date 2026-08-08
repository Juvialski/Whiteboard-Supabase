import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ElementWrapper } from './ElementWrapper';
import type { BoardElement, UserProfile } from '../../types';

vi.mock('../ImageComponent', () => ({
  default: (props: { boardId: string; element: BoardElement }) => (
    <div data-testid="image-component" data-board-id={props.boardId} data-element-id={props.element.id} />
  ),
}));
vi.mock('../AudioComponent', () => ({
  default: (props: { boardId: string; element: BoardElement }) => (
    <div data-testid="audio-component" data-board-id={props.boardId} data-element-id={props.element.id} />
  ),
}));
vi.mock('../StampComponent', () => ({
  default: (props: { boardId: string; element: BoardElement }) => (
    <div data-testid="stamp-component" data-board-id={props.boardId} data-element-id={props.element.id} />
  ),
}));

const currentUser: UserProfile = {
  id: 'teacher-1',
  name: 'Teacher',
  color: '#2563eb',
  role: 'teacher',
};

const baseProps = {
  isSelected: false,
  isInteractive: true,
  currentUser,
  zoom: 1,
  isDragging: false,
  isResizing: false,
  selectedIdsLength: 1,
  activeTool: 'select',
  canWrite: true,
  boardId: 'board-media-context',
  onSelectElement: vi.fn(),
  onUpdateElement: vi.fn(),
  onDeleteElement: vi.fn(),
};

describe('ElementWrapper media board context', () => {
  it.each([
    ['image', 'image-component'],
    ['audio', 'audio-component'],
    ['stamp', 'stamp-component'],
  ] as const)('forwards boardId to %s media elements', (type, testId) => {
    const element = {
      id: `${type}-1`,
      type,
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      zIndex: 1,
      ...(type === 'image' ? { assetId: 'asset-image-1' } : {}),
      ...(type === 'audio' ? { assetId: 'asset-audio-1' } : {}),
      ...(type === 'stamp' ? { stampType: 'signature', signatureAssetId: 'asset-signature-1' } : {}),
    } as unknown as BoardElement;

    render(<ElementWrapper {...baseProps} el={element} />);
    expect(screen.getByTestId(testId).getAttribute('data-board-id')).toBe('board-media-context');
  });
});
