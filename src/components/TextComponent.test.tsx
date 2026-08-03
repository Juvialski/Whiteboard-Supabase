import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TextComponent from './TextComponent';
import { TextElement, UserProfile } from '../types';

describe('TextComponent', () => {
  const mockElement: TextElement = {
    id: '1',
    type: 'text',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    text: 'Hello World',
    color: '#000',
    fontSize: 16,
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

  it('renders text correctly', () => {
    render(<TextComponent {...defaultProps} />);
    expect(screen.getByText('Hello World')).toBeTruthy();
  });

  it('shows action menu when selected', () => {
    render(<TextComponent {...defaultProps} isSelected={true} />);
    expect(screen.getByTitle('Lock Text')).toBeTruthy();
    expect(screen.getByTitle('Delete text box')).toBeTruthy();
  });

  it('allows text editing when double clicked', () => {
    render(<TextComponent {...defaultProps} isSelected={true} />);
    const textEl = screen.getByText('Hello World');
    
    fireEvent.doubleClick(textEl);
    
    // Should turn into textarea
    const textarea = screen.getByDisplayValue('Hello World');
    expect(textarea).toBeTruthy();
  });

  it('calls onDelete when trash icon is clicked', () => {
    const onDelete = vi.fn();
    render(<TextComponent {...defaultProps} isSelected={true} onDelete={onDelete} />);
    
    fireEvent.click(screen.getByTitle('Delete text box'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('calls onUpdate when font size is changed', () => {
    const onUpdate = vi.fn();
    render(<TextComponent {...defaultProps} isSelected={true} onUpdate={onUpdate} />);
    
    fireEvent.click(screen.getByTitle('Larger font'));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18 }));
  });
});
