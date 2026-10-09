import { beforeEach, describe, it, expect } from "vitest";
import {
  annotationIds,
  boardsForUser,
  clampViewport,
  readPreferences,
  writePreferences,
  rememberBoard,
  preferenceKey,
} from "./classroomPreferences";
beforeEach(() => localStorage.clear());
describe("classroom preferences", () => {
  it("isolates favorites and recents by authenticated user and deduplicates recent visits", () => {
    writePreferences("teacher-a", { favorites: ["private-a"], recent: [] });
    rememberBoard("teacher-a", "lesson-a");
    rememberBoard("teacher-b", "lesson-b");
    rememberBoard("teacher-a", "lesson-a");
    expect(readPreferences("teacher-a")).toMatchObject({
      favorites: ["private-a"],
      recent: ["lesson-a"],
    });
    expect(readPreferences("teacher-b")).toMatchObject({
      favorites: [],
      recent: ["lesson-b"],
    });
    expect(readPreferences("")).toEqual({ favorites: [], recent: [] });
  });
  it("bounds recent visits and handles malformed device preferences", () => {
    for (let i = 0; i < 15; i++) rememberBoard("teacher", `board-${i}`);
    expect(readPreferences("teacher").recent).toHaveLength(8);
    localStorage.setItem(preferenceKey("teacher"), "broken");
    expect(readPreferences("teacher").favorites).toEqual([]);
  });
  it("clamps extreme positions and rejects invalid numeric view state", () => {
    expect(clampViewport({ panX: 999999, panY: -999999, zoom: 90 })).toEqual({
      panX: 100000,
      panY: -100000,
      zoom: 5,
    });
    expect(clampViewport({ panX: 0, panY: 0, zoom: 0.001 })?.zoom).toBe(0.1);
    expect(clampViewport({ panX: Infinity, panY: 1, zoom: 1 })).toBeUndefined();
    expect(clampViewport({ panX: "1", panY: 1, zoom: 1 })).toBeUndefined();
  });
  it("isolates bookmarks and viewport by board and account", () => {
    writePreferences(
      "teacher",
      {
        favorites: [],
        recent: [],
        viewport: { panX: 10, panY: 20, zoom: 2 },
        bookmarks: { "pdf-page-a": "Algebra" },
      },
      "lesson-a",
    );
    expect(readPreferences("teacher", "lesson-b").bookmarks).toEqual({});
    expect(readPreferences("student", "lesson-a").viewport).toBeUndefined();
    expect(readPreferences("teacher", "lesson-a").bookmarks).toEqual({
      "pdf-page-a": "Algebra",
    });
  });
  it("clears only wholly contained active-page annotations and never removes PDF pages or other pages", () => {
    const pages = [
      { id: "pdf-page-a", x: 0, y: 0, width: 800, height: 1000 },
      { id: "pdf-page-b", x: 0, y: 1100, width: 800, height: 1000 },
    ];
    const elements = [
      ...pages,
      { id: "note-a", type: "text", x: 20, y: 30 },
      { id: "note-b", type: "text", x: 20, y: 1200 },
      {
        id: "stroke-a",
        type: "drawing",
        points: [
          { x: 10, y: 20 },
          { x: 20, y: 30 },
        ],
      },
      {
        id: "cross-page",
        type: "drawing",
        points: [
          { x: 10, y: 20 },
          { x: 10, y: 1200 },
        ],
      },
    ];
    expect([...annotationIds(elements, pages, "pdf-page-a")]).toEqual([
      "note-a",
      "stroke-a",
    ]);
    expect([...annotationIds(elements, pages)]).toEqual([
      "note-a",
      "note-b",
      "stroke-a",
      "cross-page",
    ]);
    expect(annotationIds(elements, pages, "deleted").size).toBe(0);
  });
});

it('hides an earlier account board list during an account switch',()=>{
  const boards=[{id:'private-lesson',name:'Private lesson'}];
  expect(boardsForUser('teacher-a','teacher-b',boards)).toEqual([]);expect(boardsForUser('teacher-a','teacher-a',boards)).toEqual(boards);
});
