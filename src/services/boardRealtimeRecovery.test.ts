import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  shards: [] as any[],
  message: null as null | ((m: any) => void),
}));
vi.mock("../supabase", () => ({
  authPersistenceReady: Promise.resolve(),
  activeSupabaseUrl: "https://synthetic.supabase.test",
  auth: { currentUser: { uid: "viewer" }, authStateReady: async () => {} },
  supabase: {
    rpc: mocks.rpc,
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ in: async () => ({ data: mocks.shards, error: null }) }),
      }),
    }),
  },
}));
vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
  keys: async () => [],
}));
vi.mock("./storageService", () => ({ hydrateBoardAssetMetadata: () => {} }));
vi.mock("./boardSocketService", () => ({
  sendBoardSocketMessage: () => {},
  subscribeBoardSocketMessages: (_id: string, cb: any) => {
    mocks.message = cb;
    return () => {};
  },
  subscribeBoardSocketStatus: () => () => {},
}));
vi.mock("../utils/sandboxGuard", () => ({ isSandboxEnvironment: () => false }));
import {
  applyRemoteOperation,
  getOrCreateControl,
  loadBoardState,
  subscribeToBoardState,
  getShardIdForElement,
  queueElementMutation,
  disposeBoardPersistence,
} from "./boardPersistence";
import type { DrawingElement, ShapeElement } from "../types";
const stroke: DrawingElement = {
  id: "stroke-a",
  type: "drawing",
  points: [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ],
  color: "#000",
  width: 2,
  isHighlighter: false,
  zIndex: 1,
};
const row = (revision: number, elements: any = {}) => ({
  shard_id: getShardIdForElement(stroke.id),
  revision,
  elements,
});
beforeEach(() => {
  mocks.message = null;
  mocks.shards = [];
  mocks.rpc.mockResolvedValue({
    data: {
      board: {
        id: "lesson",
        name: "Lesson",
        current_revision: 27,
        effective_permission: "viewer",
        effective_can_write: false,
        owner_uid: "teacher",
        status: "ready",
      },
      shards: [],
      assets: [],
    },
    error: null,
  });
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => {
  disposeBoardPersistence();
  vi.unstubAllGlobals();
});
async function viewer() {
  await loadBoardState("lesson");
  const unsub = subscribeToBoardState("lesson", () => {});
  return { control: getOrCreateControl("lesson"), unsub };
}
async function checkpoint(revision: number, elements: any) {
  mocks.shards = [row(revision, elements)];
  mocks.message!({
    type: "board_manifest_changed",
    boardId: "lesson",
    revision,
    changedShardIds: [getShardIdForElement(stroke.id)],
    deletedShardIds: [],
  });
  await waitFor(() =>
    expect(getOrCreateControl("lesson").revision).toBe(revision),
  );
}
describe("WebSocket preview to checkpoint handoff", () => {
  it("shows a completed teacher stroke immediately on an existing board and survives unrelated shard refreshes", async () => {
    const { control, unsub } = await viewer();
    expect(control.revision).toBe(27);
    applyRemoteOperation("lesson", {
      operationId: "live-stroke",
      clientId: "teacher",
      elementId: stroke.id,
      action: "set",
      data: stroke,
      updatedAt: 100,
    });
    expect(control.currentElements.get(stroke.id)).toEqual(stroke);
    expect(control.pendingMutations.size).toBe(0);
    await checkpoint(28, {
      "other-note": {
        id: "other-note",
        type: "text",
        text: "Other collaborator",
        x: 1,
        y: 2,
        zIndex: 2,
      },
    });
    expect(control.currentElements.get(stroke.id)).toEqual(stroke);
    expect(control.remotePreviews.size).toBe(1);
    await checkpoint(29, {
      [stroke.id]: { ...stroke, updatedAt: 101, updatedByClientId: "teacher" },
    });
    expect(control.currentElements.get(stroke.id)?.type).toBe("drawing");
    expect(control.remotePreviews.size).toBe(0);
    await checkpoint(30, {});
    expect(control.currentElements.has(stroke.id)).toBe(false);
    unsub();
  });
  it("keeps a newer live edit when an older checkpoint from the same writer arrives", async () => {
    const { control, unsub } = await viewer();
    const newer = {
      ...stroke,
      points: [
        { x: 50, y: 60 },
        { x: 70, y: 80 },
      ],
      updatedAt: 200,
      updatedByClientId: "teacher",
    };
    applyRemoteOperation("lesson", {
      operationId: "newer",
      clientId: "teacher",
      elementId: stroke.id,
      action: "set",
      data: newer,
      updatedAt: 200,
    });
    await checkpoint(28, {
      [stroke.id]: { ...stroke, updatedAt: 100, updatedByClientId: "teacher" },
    });
    expect(
      (control.currentElements.get(stroke.id) as DrawingElement).points,
    ).toEqual(newer.points);
    await checkpoint(29, { [stroke.id]: newer });
    expect(control.remotePreviews.size).toBe(0);
    unsub();
  });
  it("still rejects explicitly stale revision messages and prohibits viewer writes", async () => {
    const { control, unsub } = await viewer();
    applyRemoteOperation("lesson", {
      operationId: "stale",
      clientId: "teacher",
      baseRevision: 1,
      elementId: stroke.id,
      action: "set",
      data: stroke,
      updatedAt: 100,
    });
    expect(control.currentElements.has(stroke.id)).toBe(false);
    expect(() => queueElementMutation("lesson", stroke.id, stroke)).toThrow(
      /read-only/,
    );
    unsub();
  });
  it("synchronizes reveal state immediately and accepts authoritative state after reload", async () => {
    const { control, unsub } = await viewer();
    const cover: ShapeElement = {
      id: "cover-a",
      type: "shape",
      shapeType: "rect",
      answerCover: true,
      revealed: false,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      text: "",
      color: "#334155",
      borderColor: "#94a3b8",
      zIndex: 9,
    };
    control.shards.set(
      getShardIdForElement(cover.id),
      new Map([[cover.id, cover]]),
    );
    control.currentElements.set(cover.id, cover);
    applyRemoteOperation("lesson", {
      operationId: "reveal",
      clientId: "teacher",
      elementId: cover.id,
      action: "set",
      data: { revealed: true } as any,
      isMerge: true,
      updatedAt: 100,
    });
    expect(
      (control.currentElements.get(cover.id) as ShapeElement).revealed,
    ).toBe(true);
    expect(control.pendingMutations.size).toBe(0);
    unsub();
    disposeBoardPersistence();
    mocks.rpc.mockResolvedValue({
      data: {
        board: {
          id: "lesson",
          name: "Lesson",
          current_revision: 28,
          effective_permission: "viewer",
          effective_can_write: false,
        },
        shards: [
          {
            shard_id: getShardIdForElement(cover.id),
            elements: { [cover.id]: { ...cover, revealed: true } },
          },
        ],
        assets: [],
      },
      error: null,
    });
    const reloaded = await loadBoardState("lesson");
    expect((reloaded.elements[0] as ShapeElement).revealed).toBe(true);
  });
});
