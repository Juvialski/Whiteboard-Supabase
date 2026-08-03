import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ShapeComponent from './ShapeComponent';
import { ShapeElement, UserProfile } from '../types';

describe('ShapeComponent', () => {
  const mockElement: ShapeElement = {
    id: '1',
    type: 'shape',
    shapeType: 'rect',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    text: 'Rect Text',
    color: '#000',
    borderColor: '#111',
    zIndex: 1,
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

  it('renders shape and text', () => {
    render(<ShapeComponent {...defaultProps} />);
    expect(screen.getByText('Rect Text')).toBeTruthy();
  });

  it('allows editing text on double click', () => {
    render(<ShapeComponent {...defaultProps} isSelected={true} />);
    const textEl = screen.getByText('Rect Text');
    
    fireEvent.doubleClick(textEl);
    
    // Should turn into textarea
    const textarea = screen.getByDisplayValue('Rect Text');
    expect(textarea).toBeTruthy();
  });

  it('shows action menu when selected', () => {
    render(<ShapeComponent {...defaultProps} isSelected={true} />);
    
    expect(screen.getByTitle('Lock Shape')).toBeTruthy();
    expect(screen.getByTitle('Delete shape')).toBeTruthy();
  });

  it('calls onDelete when trash is clicked', () => {
    const onDelete = vi.fn();
    render(<ShapeComponent {...defaultProps} isSelected={true} onDelete={onDelete} />);
    
    fireEvent.click(screen.getByTitle('Delete shape'));
    expect(onDelete).toHaveBeenCalled();
  });
});
