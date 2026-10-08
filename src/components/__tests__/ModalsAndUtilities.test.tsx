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
import type { TimerState } from '../../services/timerState';
const timerState: TimerState = { board_id: 'test', mode: 'timer', running: false,
  baseline_ms: 300000, total_seconds: 300, started_at: null, visible: true,
  completed: false, revision: 0, run_id: 0 };

describe('Modals & Workspace Utilities Test Suite', () => {
  describe('WorkspaceTimer Component', () => {
    it('renders timer modal when open and toggles play/pause state', () => {
      const onAction = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(<WorkspaceTimer isOpen={true} onClose={vi.fn()} state={timerState} serverNow={() => 1000} onAction={onAction} />);

      expect(screen.getByText('Sprint Timer')).toBeTruthy();
      expect(screen.getByDisplayValue('05')).toBeTruthy();

      const startBtn = screen.getByText('Start');
      fireEvent.click(startBtn);

      expect(onAction).toHaveBeenCalledWith('start', undefined);
      expect(screen.getByText('Start')).toBeTruthy();
      rerender(<WorkspaceTimer isOpen={true} onClose={vi.fn()} state={{...timerState, running: true, started_at: new Date(1000).toISOString()}} serverNow={() => 1000} onAction={onAction} />);
      expect(screen.getByText('Pause')).toBeTruthy();
    });

    it('allows switching between timer and stopwatch mode', () => {
      const onAction = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(<WorkspaceTimer isOpen={true} onClose={vi.fn()} state={timerState} serverNow={() => 1000} onAction={onAction} />);

      const stopwatchTab = screen.getByText('Stopwatch');
      fireEvent.click(stopwatchTab);
      expect(onAction).toHaveBeenCalledWith('mode', 1);
      rerender(<WorkspaceTimer isOpen={true} onClose={vi.fn()} state={{...timerState, mode: 'stopwatch', baseline_ms: 0}} serverNow={() => 1000} onAction={onAction} />);

      expect(screen.getByText('00:00')).toBeTruthy();
    });

    it('resets time when reset button is clicked', () => {
      const onAction = vi.fn().mockResolvedValue(undefined);
      render(<WorkspaceTimer isOpen={true} onClose={vi.fn()} state={timerState} serverNow={() => 1000} onAction={onAction} />);

      const resetBtn = screen.getByTitle('Reset Timer');
      fireEvent.click(resetBtn);
      expect(onAction).toHaveBeenCalledWith('reset', undefined);

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

      const openBtn = screen.queryByTitle('Open Canvas Minimap');
      if (openBtn) {
        fireEvent.click(openBtn);
      }

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
