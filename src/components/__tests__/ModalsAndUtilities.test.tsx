import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WorkspaceTimer from '../WorkspaceTimer';
import Minimap from '../Minimap';
import StampPickerModal from '../StampPickerModal';
import VoiceRecordModal from '../VoiceRecordModal';
import ClearCanvasModal from '../ClearCanvasModal';
import KeyboardShortcutsModal from '../KeyboardShortcutsModal';
import { BoardElement } from '../../types';

describe('Modals & Workspace Utilities Test Suite', () => {
  describe('WorkspaceTimer Component', () => {
    it('renders timer modal when open and toggles play/pause state', () => {
      render(<WorkspaceTimer isOpen={true} onClose={vi.fn()} />);

      expect(screen.getByText('Sprint Timer')).toBeTruthy();
      expect(screen.getByDisplayValue('05')).toBeTruthy();

      const startBtn = screen.getByText('Start');
      fireEvent.click(startBtn);

      expect(screen.getByText('Pause')).toBeTruthy();
    });

    it('allows switching between timer and stopwatch mode', () => {
      render(<WorkspaceTimer isOpen={true} onClose={vi.fn()} />);

      const stopwatchTab = screen.getByText('Stopwatch');
      fireEvent.click(stopwatchTab);

      expect(screen.getByText('00:00')).toBeTruthy();
    });

    it('resets time when reset button is clicked', () => {
      render(<WorkspaceTimer isOpen={true} onClose={vi.fn()} />);

      const resetBtn = screen.getByTitle('Reset Timer');
      fireEvent.click(resetBtn);

      expect(screen.getByDisplayValue('05')).toBeTruthy();
      expect(screen.getByDisplayValue('00')).toBeTruthy();
    });
  });

  describe('Minimap Component', () => {
    const dummyElements: BoardElement[] = [
      { id: '1', type: 'sticky', x: 0, y: 0, width: 100, height: 100, text: 'A', color: '#fff', zIndex: 1, updatedAt: Date.now() },
      { id: '2', type: 'shape', x: 500, y: 500, width: 200, height: 200, shapeType: 'rect', text: '', color: '#3b82f6', borderColor: '#2563eb', zIndex: 2, updatedAt: Date.now() },
    ];

    it('renders minimap container and triggers onPanTo on map click', () => {
      const onPanTo = vi.fn();
      const { container } = render(
        <Minimap
          elements={dummyElements}
          panX={0}
          panY={0}
          zoom={1}
          containerWidth={1000}
          containerHeight={800}
          onPanTo={onPanTo}
        />
      );

      expect(screen.getByText('Canvas Overview')).toBeTruthy();
      const mapBox = container.querySelector('.cursor-crosshair');
      expect(mapBox).toBeTruthy();

      if (mapBox) {
        fireEvent.click(mapBox, { clientX: 50, clientY: 50 });
        expect(onPanTo).toHaveBeenCalled();
      }
    });
  });

  describe('StampPickerModal Component', () => {
    it('renders stamp choices and selects a stamp', () => {
      const onSelectStamp = vi.fn();
      render(<StampPickerModal isOpen={true} onClose={vi.fn()} onSelectStamp={onSelectStamp} />);

      expect(screen.getByText('Educational Stamps & Signatures')).toBeTruthy();
      expect(screen.getByText('Approved')).toBeTruthy();

      const approvedStampBtn = screen.getByText('Approved');
      fireEvent.click(approvedStampBtn);

      expect(onSelectStamp).toHaveBeenCalledWith('approved', 'Approved', undefined, expect.any(String), expect.any(String));
    });

    it('switches to signature tab', () => {
      render(<StampPickerModal isOpen={true} onClose={vi.fn()} onSelectStamp={vi.fn()} />);

      const sigTab = screen.getByText('Signature');
      fireEvent.click(sigTab);

      expect(screen.getByText('Place Signature')).toBeTruthy();
    });
  });

  describe('VoiceRecordModal Component', () => {
    it('renders voice recording controls', () => {
      render(<VoiceRecordModal isOpen={true} onClose={vi.fn()} onSaveAudio={vi.fn()} />);

      expect(screen.getByText('Record Voice Comment')).toBeTruthy();
      expect(screen.getByText('Start Recording')).toBeTruthy();
    });
  });

  describe('ClearCanvasModal Component', () => {
    it('displays element count and fires confirm', () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <ClearCanvasModal
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          elementCount={12}
        />
      );

      expect(screen.getByText('12')).toBeTruthy();

      const clearBtn = screen.getByText('Clear Canvas');
      fireEvent.click(clearBtn);

      expect(onConfirm).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('KeyboardShortcutsModal Component', () => {
    it('renders keyboard shortcuts sections', () => {
      render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

      expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
      expect(screen.getByText('Tools & Drawing')).toBeTruthy();
      expect(screen.getByText('Editing & History')).toBeTruthy();
    });
  });
});
