import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Toolbar from './Toolbar';

describe('Toolbar', () => {
  const defaultProps = {
    activeTool: 'select' as const,
    onChangeTool: vi.fn(),
    activeColor: '#fef08a',
    onChangeColor: vi.fn(),
    activeShape: 'rect' as const,
    onChangeShape: vi.fn(),
    zoom: 1,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    strokeWidth: 4,
    onChangeStrokeWidth: vi.fn(),
    gridMode: 'dots' as const,
    onChangeGridMode: vi.fn(),
  };

  it('renders the compact primary tools and canvas controls', () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByTitle('Select & Edit (V)')).toBeTruthy();
    expect(screen.getByTitle('Pan Canvas (H)')).toBeTruthy();
    expect(screen.getAllByTitle('More Tools').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Canvas View Options')).toBeTruthy();
  });

  it('calls onChangeTool when a primary tool is clicked', () => {
    const onChangeTool = vi.fn();
    render(<Toolbar {...defaultProps} onChangeTool={onChangeTool} />);

    fireEvent.click(screen.getByTitle('Pan Canvas (H)'));
    expect(onChangeTool).toHaveBeenCalledWith('pan');
  });

  it('keeps secondary tools available through More Tools', () => {
    const onChangeTool = vi.fn();
    render(<Toolbar {...defaultProps} onChangeTool={onChangeTool} />);

    fireEvent.click(screen.getAllByTitle('More Tools')[0]);
    fireEvent.click(screen.getByTitle('Sticky Note (N)'));
    expect(onChangeTool).toHaveBeenCalledWith('sticky');
  });

  it('changes the canvas background through View', () => {
    const onChangeGridMode = vi.fn();
    render(<Toolbar {...defaultProps} onChangeGridMode={onChangeGridMode} />);

    fireEvent.click(screen.getByTitle('Canvas View Options'));
    fireEvent.click(screen.getByTitle('Math Grid (Graph Paper)'));
    expect(onChangeGridMode).toHaveBeenCalledWith('math');
  });

  it('calls zoom handlers', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();
    render(
      <Toolbar
        {...defaultProps}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
      />
    );

    fireEvent.click(screen.getByTitle('Zoom In'));
    expect(onZoomIn).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Zoom Out'));
    expect(onZoomOut).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Reset Zoom'));
    expect(onZoomReset).toHaveBeenCalled();
  });
});
