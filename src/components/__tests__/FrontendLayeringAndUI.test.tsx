import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ImageComponent from '../ImageComponent';
import StickyComponent from '../StickyComponent';
import StampComponent from '../StampComponent';
import AudioComponent from '../AudioComponent';
import PdfPageNavigation from '../PdfPageNavigation';
import { BoardElement, ImageElement } from '../../types';

describe('Frontend UI & Layering Automated Test Suite', () => {
  const dummyUser = { id: 'usr-1', name: 'Test Teacher', color: '#2563eb' };

  it('renders PDF Page image element with zIndex 1 by default', () => {
    const pdfElement: ImageElement = {
      id: 'pdf-page-0-12345',
      type: 'image',
      x: 100,
      y: 100,
      width: 600,
      height: 800,
      src: 'data:image/svg+xml;utf8,<svg></svg>',
      zIndex: -1,
      updatedAt: Date.now(),
    };

    const { container } = render(
      <ImageComponent
        element={pdfElement}
        isSelected={false}
        currentUser={dummyUser}
        zoom={1}
        isDraggingOrResizing={false}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const pdfDiv = container.querySelector('#image-pdf-page-0-12345');
    expect(pdfDiv).toBeTruthy();
    expect(window.getComputedStyle(pdfDiv!).zIndex).toBe('1');
  });

  it('elevates selected elements zIndex to 40 so they render on top of all canvas layers', () => {
    const stickyElement: BoardElement = {
      id: 'sticky-1',
      type: 'sticky',
      x: 200,
      y: 200,
      width: 200,
      height: 200,
      text: 'Student Note',
      color: '#fef08a',
      zIndex: 10,
      updatedAt: Date.now(),
    };

    const { container: unselectedContainer } = render(
      <StickyComponent
        element={stickyElement as any}
        isSelected={false}
        currentUser={dummyUser}
        zoom={1}
        isDraggingOrResizing={false}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const unselectedDiv = unselectedContainer.querySelector('div[id="sticky-sticky-1"]');
    expect(unselectedDiv).toBeTruthy();
    expect(window.getComputedStyle(unselectedDiv!).zIndex).toBe('10');

    const { container: selectedContainer } = render(
      <StickyComponent
        element={stickyElement as any}
        isSelected={true}
        currentUser={dummyUser}
        zoom={1}
        isDraggingOrResizing={false}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const selectedDiv = selectedContainer.querySelector('div[id="sticky-sticky-1"]');
    expect(selectedDiv).toBeTruthy();
    expect(window.getComputedStyle(selectedDiv!).zIndex).toBe('40');
  });

  it('renders Stamp component with appropriate badge and border styles', () => {
    const stampElement: BoardElement = {
      id: 'stamp-1',
      type: 'stamp',
      x: 150,
      y: 150,
      width: 140,
      height: 60,
      stampType: 'approved',
      label: 'APPROVED',
      zIndex: 15,
      updatedAt: Date.now(),
    } as any;

    render(
      <StampComponent
        element={stampElement as any}
        isSelected={false}
        isInteractive={true}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('renders Audio voice comment component with play button', () => {
    const audioElement: BoardElement = {
      id: 'audio-1',
      type: 'audio',
      x: 300,
      y: 300,
      audioUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
      duration: 5,
      authorName: 'Teacher Sarah',
      zIndex: 20,
      updatedAt: Date.now(),
    } as any;

    render(
      <AudioComponent
        element={audioElement as any}
        isSelected={false}
        isInteractive={true}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        currentUser={dummyUser}
      />
    );

    expect(screen.getByText('Teacher Sarah')).toBeTruthy();
    expect(screen.getByText('0:05')).toBeTruthy();
  });

  it('renders PDF Page Navigation bar and triggers jump and blank page events', () => {
    const mockPdfPages: ImageElement[] = [
      {
        id: 'pdf-page-0-1',
        type: 'image',
        x: 0,
        y: 0,
        width: 600,
        height: 800,
        src: 'mock-src-1',
        zIndex: -1,
        updatedAt: Date.now(),
      },
      {
        id: 'pdf-page-1-2',
        type: 'image',
        x: 0,
        y: 840,
        width: 600,
        height: 800,
        src: 'mock-src-2',
        zIndex: -1,
        updatedAt: Date.now(),
      },
    ];

    const onJumpToPage = vi.fn();
    const onInsertBlankPage = vi.fn();

    render(
      <PdfPageNavigation
        pdfPages={mockPdfPages}
        currentPageIndex={0}
        onJumpToPage={onJumpToPage}
        onInsertBlankPage={onInsertBlankPage}
        onExportPdf={vi.fn()}
        isExporting={false}
      />
    );

    expect(screen.getByText('Page')).toBeTruthy();
    expect(screen.getByText('of 2')).toBeTruthy();

    const nextPageBtn = screen.getByTitle('Next Page');
    fireEvent.click(nextPageBtn);
    expect(onJumpToPage).toHaveBeenCalledWith(1);

    const addPageBtn = screen.getByTitle('Insert Blank Page');
    fireEvent.click(addPageBtn);
    expect(onInsertBlankPage).toHaveBeenCalled();
  });
});
