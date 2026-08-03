import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StickyComponent from './StickyComponent';
import { StickyElement, UserProfile } from '../types';

describe('StickyComponent', () => {
  const mockElement: StickyElement = {
    id: 's1',
    type: 'sticky',
    x: 0,
    y: 0,
    width: 150,
    height: 150,
    text: 'Sticky text',
    color: '#fef08a',
    zIndex: 1,
    reactions: {
      '👍': ['TestUser']
    }
  };

  const mockUser: UserProfile = {
    id: 'u1',
    name: 'TestUser',
    color: '#123',
    role: 'student'
  };

  const defaultProps = {
    element: mockElement,
    isSelected: false,
    currentUser: mockUser,
    zoom: 1,
    onSelect: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    isDraggingOrResizing: false,
  };

  it('renders sticky content', () => {
    render(<StickyComponent {...defaultProps} />);
    expect(screen.getByText('Sticky text')).toBeTruthy();
  });

  it('shows reactions', () => {
    render(<StickyComponent {...defaultProps} />);
    // The emoji itself
    expect(screen.getByText('👍')).toBeTruthy();
    // The count
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('allows adding reactions when selected', () => {
    const onUpdate = vi.fn();
    render(<StickyComponent {...defaultProps} isSelected={true} onUpdate={onUpdate} />);
    
    // Open emoji picker
    fireEvent.click(screen.getByTitle('Add reaction'));
    
    // Click heart
    fireEvent.click(screen.getByText('❤️'));
    
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      reactions: {
        '👍': ['TestUser'],
        '❤️': ['TestUser']
      }
    }));
  });

  it('allows removing own reaction', () => {
    const onUpdate = vi.fn();
    render(<StickyComponent {...defaultProps} isSelected={true} onUpdate={onUpdate} />);
    
    // Open emoji picker
    fireEvent.click(screen.getByTitle('Add reaction'));
    
    // Click thumbs up again to toggle it off
    fireEvent.click(screen.getAllByText('👍')[1]); // first one is badge, second is picker
    
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      reactions: {} // empty because the only reaction was removed
    }));
  });
});
