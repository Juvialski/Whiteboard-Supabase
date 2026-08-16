import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PdfPageNavigation from './PdfPageNavigation';
import type { ImageElement } from '../types';

const mockPdfPages: ImageElement[] = [
  { id: 'pdf-page-0-1', type: 'image', x: 0, y: 0, width: 800, height: 1100, src: 'data:image/jpeg;base64,page1', zIndex: 1 },
  { id: 'pdf-page-1-2', type: 'image', x: 0, y: 1140, width: 800, height: 1100, src: 'data:image/jpeg;base64,page2', zIndex: 1 },
];

describe('PdfPageNavigation', () => {
  it('renders page navigation controls and drawer button', () => {
    const handleJump = vi.fn();
    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={handleJump}
      />
    );

    expect(screen.getByText(/of 2/i)).toBeTruthy();
    expect(screen.getByTitle(/toggle pdf page drawer/i)).toBeTruthy();
  });

  it('navigates between pages with next and previous buttons', () => {
    const handleJump = vi.fn();
    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={handleJump}
      />
    );

    const nextBtn = screen.getByTitle(/next page/i);
    fireEvent.click(nextBtn);
    expect(handleJump).toHaveBeenCalledWith(1);
  });

  it('jumps to typed page number on form submit', () => {
    const handleJump = vi.fn();
    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={handleJump}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.submit(input.closest('form')!);
    expect(handleJump).toHaveBeenCalledWith(1);
  });

  it('opens drawer and triggers page deletion modal and confirmation', () => {
    const handleDelete = vi.fn();
    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={vi.fn()}
        onDeletePage={handleDelete}
        canWrite={true}
      />
    );

    // Open drawer
    const drawerBtn = screen.getByTitle(/toggle pdf page drawer/i);
    fireEvent.click(drawerBtn);

    expect(screen.getByText(/pdf pages \(2\)/i)).toBeTruthy();

    // Click delete on first page
    const deleteBtns = screen.getAllByTitle(/delete page/i);
    fireEvent.click(deleteBtns[0]);

    // Modal appears
    expect(screen.getByText(/remove pdf page/i)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: /remove page/i });
    fireEvent.click(confirmBtn);

    expect(handleDelete).toHaveBeenCalledWith('pdf-page-0-1');
  });

  it('calls onRotatePage when rotate button is clicked', () => {
    const handleRotate = vi.fn();
    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={vi.fn()}
        onRotatePage={handleRotate}
        canWrite={true}
      />
    );

    const rotateBtn = screen.getByTitle(/rotate active page 90°/i);
    fireEvent.click(rotateBtn);
    expect(handleRotate).toHaveBeenCalledWith('pdf-page-0-1');
  });

  it('calls onMovePage when move down is clicked', () => {
    const handleMove = vi.fn();
    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={vi.fn()}
        onMovePage={handleMove}
        canWrite={true}
      />
    );

    // Open drawer
    const drawerBtn = screen.getByTitle(/toggle pdf page drawer/i);
    fireEvent.click(drawerBtn);

    const moveDownBtn = screen.getByTitle(/move page down/i);
    fireEvent.click(moveDownBtn);
    expect(handleMove).toHaveBeenCalledWith(0, 1);
  });
});
