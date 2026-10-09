import React, { useState } from "react";
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { useViewportPreferences } from "./useViewportPreferences";
import {
  readPreferences,
  writePreferences,
} from "../utils/classroomPreferences";
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
describe("personal viewport persistence", () => {
  function useCamera({
    user = "teacher",
    board = "lesson",
    controlled = false,
  }: {
    user?: string;
    board?: string;
    controlled?: boolean;
  }) {
    const [view, setView] = useState(
      readPreferences(user, board).viewport || { panX: 0, panY: 0, zoom: 1 },
    );
    useViewportPreferences(user, board, view, setView, true, controlled);
    return { view, setView };
  }
  it("restores saved view and saves each user/board separately", () => {
    writePreferences(
      "teacher",
      { favorites: [], recent: [], viewport: { panX: 40, panY: 80, zoom: 2 } },
      "lesson",
    );
    const { result, rerender } = renderHook(useCamera, {
      initialProps: { user: "teacher", board: "lesson", controlled: false },
    });
    expect(result.current.view).toEqual({ panX: 40, panY: 80, zoom: 2 });
    act(() => result.current.setView({ panX: 20, panY: 30, zoom: 1.5 }));
    act(() => vi.advanceTimersByTime(350));
    expect(readPreferences("teacher", "lesson").viewport?.panX).toBe(20);
    rerender({ user: "student", board: "lesson", controlled: false });
    expect(result.current.view.zoom).toBe(1);
    expect(readPreferences("student", "lesson").viewport).toBeUndefined();
  });
  it("does not persist followed/presenter camera state and restores the personal view when released", () => {
    const { result, rerender } = renderHook(useCamera, {
      initialProps: { controlled: false },
    });
    act(() => result.current.setView({ panX: 15, panY: 25, zoom: 2 }));
    act(() => vi.advanceTimersByTime(350));
    rerender({ controlled: true });
    act(() => result.current.setView({ panX: 900, panY: 800, zoom: 4 }));
    act(() => vi.advanceTimersByTime(350));
    expect(readPreferences("teacher", "lesson").viewport).toEqual({
      panX: 15,
      panY: 25,
      zoom: 2,
    });
    rerender({ controlled: false });
    expect(result.current.view).toEqual({ panX: 15, panY: 25, zoom: 2 });
  });
  it("flushes a quick navigation away without saving a followed viewport", () => {
    const { result, unmount, rerender } = renderHook(useCamera, {
      initialProps: { controlled: false },
    });
    act(() => result.current.setView({ panX: 123, panY: 456, zoom: 3 }));
    rerender({ controlled: true });
    act(() => result.current.setView({ panX: 999, panY: 999, zoom: 4 }));
    unmount();
    expect(readPreferences("teacher", "lesson").viewport).toEqual({
      panX: 123,
      panY: 456,
      zoom: 3,
    });
  });
});
