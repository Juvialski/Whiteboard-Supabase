import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ImageComponent from './ImageComponent';
import { ImageElement, UserProfile } from '../types';

describe('ImageComponent', () => {
  const mockElement: ImageElement = {
    id: 'img1',
    type: 'image',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    src: 'data:image/jpeg;base64,mock',
    zIndex: 1,
    locked: false,
    reactions: {
      '🔥': ['TestUser']
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
    boardId: 'board-test',
    onSelect: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    isDraggingOrResizing: false,
  };

  it('renders image', () => {
    render(<ImageComponent {...defaultProps} />);
    expect(screen.getByAltText('Pasted canvas content')).toBeTruthy();
  });

  it('shows action menu when selected', () => {
    render(<ImageComponent {...defaultProps} isSelected={true} />);
    
    expect(screen.getByTitle('Lock element')).toBeTruthy();
    expect(screen.getByTitle('Delete Image')).toBeTruthy();
    expect(screen.getByTitle('Crop Image')).toBeTruthy();
  });

  it('toggles full screen on click of maximize button', () => {
    render(<ImageComponent {...defaultProps} isSelected={true} />);
    
    // By default not fullscreen
    expect(screen.queryByAltText('Full Resolution')).toBeNull();

    // Click maximize
    fireEvent.click(screen.getByTitle('View Full Image'));

    // Should be in fullscreen
    expect(screen.getByAltText('Full Resolution')).toBeTruthy();
  });

  it('renders rotated PDF pages with the rotated image bounds', () => {
    render(
      <ImageComponent
        {...defaultProps}
        element={{
          ...mockElement,
          id: 'pdf-page-1',
          width: 800,
          height: 1100,
          rotation: 90,
        }}
      />
    );

    const image = screen.getByAltText('PDF Page pdf-page-1') as HTMLImageElement;
    expect(image.style.width).toBe('1100px');
    expect(image.style.height).toBe('800px');
    expect(image.style.transform).toBe('rotate(90deg)');
  });

  it('shows a recovery state when image data cannot be decoded', () => {
    render(<ImageComponent {...defaultProps} />);

    fireEvent.error(screen.getByAltText('Pasted canvas content'));

    expect(screen.getByText('Image preview failed')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('does not render a blank rectangle when an image has no source', () => {
    render(
      <ImageComponent
        {...defaultProps}
        element={{ ...mockElement, src: undefined }}
      />
    );

    expect(screen.getByText('Image source unavailable')).toBeTruthy();
    expect(screen.queryByAltText('Pasted canvas content')).toBeNull();
  });
});
