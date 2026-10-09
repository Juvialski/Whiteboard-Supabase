import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import AnswerCover from "./AnswerCover";
import ClearCanvasModal from "./ClearCanvasModal";
import PdfPageNavigation from "./PdfPageNavigation";
import type { ShapeElement, ImageElement } from "../types";
vi.mock("../hooks/useBoardAsset", () => ({
  useBoardAsset: () => ({
    data: undefined,
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
afterEach(cleanup);
const cover: ShapeElement = {
  id: "cover-a",
  type: "shape",
  shapeType: "rect",
  answerCover: true,
  revealed: false,
  x: 30,
  y: 40,
  width: 200,
  height: 100,
  text: "",
  color: "#334155",
  borderColor: "#94a3b8",
  zIndex: 20,
};
describe("classroom controls", () => {
  it("allows a teacher to reveal/hide with one click while a viewer cannot", () => {
    const toggle = vi.fn();
    const { rerender } = render(
      <AnswerCover
        element={cover}
        canManage={false}
        onToggle={toggle}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(toggle).not.toHaveBeenCalled();
    rerender(
      <AnswerCover
        element={cover}
        canManage
        onToggle={toggle}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(toggle).toHaveBeenCalledOnce();
    rerender(
      <AnswerCover
        element={{ ...cover, revealed: true }}
        canManage
        onToggle={toggle}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide answer" })).toBeTruthy();
  });
  it("renders persisted canvas coordinates inside the transformed canvas", () => {
    const { container } = render(
      <AnswerCover
        element={cover}
        canManage
        onToggle={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect((container.firstElementChild as HTMLElement).style.left).toBe(
      "30px",
    );
    expect((container.firstElementChild as HTMLElement).style.width).toBe(
      "200px",
    );
  });
  it("warns truthfully about collaborative clear and a separate-board archive recovery", () => {
    render(
      <ClearCanvasModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        elementCount={4}
        activePageOnly
        isPdfBoard
      />,
    );
    expect(screen.getByText(/Ctrl\+Z cannot undo/)).toBeTruthy();
    expect(screen.getByText(/separate private board/)).toBeTruthy();
    expect(screen.getByText("Clear active page annotations?")).toBeTruthy();
  });
  it("navigates bookmarks by stable page ID after reordering and hides deleted pages", () => {
    const a = {
      id: "pdf-page-a",
      type: "image",
      x: 0,
      y: 0,
      width: 800,
      height: 1000,
      zIndex: 0,
    } as ImageElement;
    const b = { ...a, id: "pdf-page-b", y: 1100 };
    const jump = vi.fn();
    const { rerender } = render(
      <PdfPageNavigation
        boardId="lesson"
        pdfPages={[a, b]}
        currentPageIndex={0}
        onJumpToPage={jump}
        bookmarks={{ [a.id]: "Algebra" }}
      />,
    );
    fireEvent.click(screen.getByTitle("Toggle PDF Page Drawer"));
    fireEvent.click(screen.getByText("Algebra"));
    expect(jump).toHaveBeenLastCalledWith(0);
    rerender(
      <PdfPageNavigation
        boardId="lesson"
        pdfPages={[b, a]}
        currentPageIndex={0}
        onJumpToPage={jump}
        bookmarks={{ [a.id]: "Algebra" }}
      />,
    );
    fireEvent.click(screen.getByText("Algebra"));
    expect(jump).toHaveBeenLastCalledWith(1);
    rerender(
      <PdfPageNavigation
        boardId="lesson"
        pdfPages={[b]}
        currentPageIndex={0}
        onJumpToPage={jump}
        bookmarks={{ [a.id]: "Algebra" }}
      />,
    );
    expect(screen.queryByText("Algebra")).toBeNull();
  });
});
