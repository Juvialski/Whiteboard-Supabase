import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpotlightOverlay from './SpotlightOverlay';

describe('SpotlightOverlay', () => {
  it('renders nothing when not active', () => {
    const { container } = render(<SpotlightOverlay isActive={false} onClose={vi.fn()} x={100} y={100} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders spotlight cutout and exit button when active', () => {
    const handleClose = vi.fn();
    render(<SpotlightOverlay isActive={true} onClose={handleClose} x={250} y={350} canManage={true} />);

    expect(screen.getByText(/spotlight mode active/i)).toBeTruthy();
    const closeBtn = screen.getByTitle(/exit spotlight/i);
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });
});
