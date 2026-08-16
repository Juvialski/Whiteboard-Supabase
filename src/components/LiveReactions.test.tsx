import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LiveReactions from './LiveReactions';

describe('LiveReactions', () => {
  it('renders reaction launcher button', () => {
    const handleSend = vi.fn();
    render(<LiveReactions onSendReaction={handleSend} />);
    expect(screen.getByTitle(/live reactions/i)).toBeTruthy();
  });

  it('opens emoji tray and triggers reaction send', () => {
    const handleSend = vi.fn();
    render(<LiveReactions onSendReaction={handleSend} />);

    const launcher = screen.getByTitle(/live reactions/i);
    fireEvent.click(launcher);

    const thumbsUp = screen.getByTitle(/send 👍/i);
    fireEvent.click(thumbsUp);

    expect(handleSend).toHaveBeenCalledWith('👍');
  });

  it('displays incoming reaction with user label', () => {
    render(
      <LiveReactions
        onSendReaction={vi.fn()}
        incomingReaction={{
          id: 'test-1',
          emoji: '🚀',
          userName: 'Alice',
          color: '#3b82f6',
          x: 200,
          y: 300,
          createdAt: Date.now(),
        }}
      />
    );

    expect(screen.getByText('🚀')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
  });
});
