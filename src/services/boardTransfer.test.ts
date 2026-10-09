import { beforeEach, describe, it, expect, vi } from "vitest";
import type { BoardElement, Whiteboard, ImageElement } from "../types";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
  initialize: vi.fn(),
  cleanup: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../supabase", () => ({
  auth: { currentUser: { uid: "teacher", isAnonymous: false } },
  db: {},
}));
vi.mock("../lib/supabaseDb", () => ({
  collection: () => ({}),
  doc: (_db: any, _collection: any, id: string) => ({ id }),
  addDoc: mocks.create,
  deleteDoc: mocks.remove,
}));
vi.mock("./storageService", () => ({
  getBoardAsset: mocks.read,
  listBoardAssetIds: mocks.list,
  saveBoardAsset: mocks.save,
  deleteIncompleteTransferAssets: mocks.cleanup,
}));
vi.mock("./boardPersistence", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  loadBoardState: mocks.load,
  initializeBoardWithElements: mocks.initialize,
  disposeBoardPersistence: vi.fn(),
}));
vi.mock("../utils/sandboxGuard", () => ({ isSandboxEnvironment: () => false }));
import {
  createCompleteBackup,
  duplicateCompleteBoard,
  restoreBoardArchive,
  remapElements,
  prepareClearRecovery,
} from "./boardTransfer";
import { parseBoardBackup } from "../utils/boardBackup";
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { annotationIds } from '../utils/classroomPreferences';
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl4sAAAAASUVORK5CYII=";
const board: Whiteboard = {
  id: "source",
  name: "PDF: lesson",
  createdAt: 1,
  createdBy: "teacher",
  accessMode: "shared",
  editorUids: ["student"],
};
const elements: BoardElement[] = [
  {
    id: "pdf-page-one",
    type: "image",
    assetId: "image-original",
    x: 4,
    y: 8,
    width: 800,
    height: 1000,
    zIndex: -1,
  },
  {
    id: "image-two",
    type: "image",
    assetId: "image-original",
    x: 900,
    y: 8,
    width: 20,
    height: 20,
    zIndex: 3,
  },
  {
    id: "voice",
    type: "audio",
    assetId: "audio-original",
    x: 20,
    y: 50,
    zIndex: 4,
  },
  {
    id: "signature",
    type: "stamp",
    stampType: "signature",
    signatureAssetId: "image-original",
    x: 1,
    y: 2,
    width: 30,
    height: 20,
    zIndex: 6,
  },
  {
    id: "join",
    type: "connector",
    fromId: "pdf-page-one",
    toId: "image-two",
    fromSocket: "right",
    toSocket: "left",
    color: "#000",
    zIndex: 5,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "destination" });
  mocks.initialize.mockResolvedValue(undefined);
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({ loadState: "ready", elements });
  mocks.read.mockImplementation(async (_board, id) => ({
    data: id === "audio-original" ? "data:audio/webm;base64,GkXfow==" : png,
    mimeType: id === "audio-original" ? "audio/webm" : "image/png",
  }));
  mocks.save.mockImplementation(async (_board, _id, _data, mime) => ({
    assetId: `new-${mime === "audio/webm" ? "audio" : "image"}`,
  }));
});
describe("complete board transfer", () => {
  it('duplicates fixture PNG/PDF bytes and restores a pre-clear archive through a local in-memory asset backend', async () => {
    const fixture = parseBoardBackup(readFileSync(resolve('scripts/qa-1-fixtures/media.whiteboard.json'), 'utf8'));
    const image = `data:image/png;base64,${readFileSync(resolve('scripts/qa-2-fixtures/pixel.png')).toString('base64')}`;
    const pdf = `data:application/pdf;base64,${readFileSync(resolve('scripts/qa-2-fixtures/one-page.pdf')).toString('base64')}`;
    const assets = new Map([['source:qa-png', { data: image, mimeType: 'image/png' }], ['source:original-pdf', { data: pdf, mimeType: 'application/pdf' }]]);
    const boards = new Map<string, BoardElement[]>([['source', structuredClone(fixture.elements)]]);
    let count = 0;
    mocks.load.mockImplementation(async id => ({ loadState: 'ready', elements: boards.get(id) }));
    mocks.list.mockImplementation(async id => [...assets.keys()].filter(key => key.startsWith(id + ':')).map(key => key.slice(id.length + 1)));
    mocks.read.mockImplementation(async (id, asset) => assets.get(`${id}:${asset}`));
    mocks.create.mockImplementation(async () => ({ id: `destination-${++count}` }));
    mocks.save.mockImplementation(async (id, _asset, data, mimeType) => {
      const assetId = `asset-${assets.size}`;
      assets.set(`${id}:${assetId}`, { data, mimeType }); return { assetId };
    });
    mocks.initialize.mockImplementation(async (id, content) => boards.set(id, structuredClone(content)));
    const before = structuredClone(boards.get('source'));
    const copy = await duplicateCompleteBoard(board, 'Teacher');
    const copied = boards.get(copy.id)!;
    expect(copy).toMatchObject({ accessMode: 'private', studentsCanWrite: false });
    expect(boards.get('source')).toEqual(before);
    expect(copied).toHaveLength(8);
    expect(copied.every(e => !before!.some(original => original.id === e.id))).toBe(true);
    expect(copied.filter(e => e.id.startsWith('pdf-page-'))).toHaveLength(2);
    expect([...assets].filter(([key]) => key.startsWith(copy.id + ':')).map(([, value]) => value.data).sort()).toEqual([image, pdf].sort());
    const archive = await prepareClearRecovery(board, before!, 'source', () => boards.get('source')!, () => true);
    const pages = before!.filter(e => e.id.startsWith('pdf-page-'));
    const remove = annotationIds(before!, pages, pages[0].id);
    boards.set('source', before!.filter(e => !remove.has(e.id)));
    expect(boards.get('source')!.map(e => e.id)).toEqual(['pdf-page-qa1', 'pdf-page-qa2', 'qa-second-page']);
    const recovered = await restoreBoardArchive(parseBoardBackup(JSON.stringify(archive)), 'Recovered fixture', 'Teacher');
    expect(recovered.id).not.toBe(copy.id);
    expect(boards.get(recovered.id)).toHaveLength(8);
    expect(boards.get('source')).toHaveLength(3);
    expect([...assets].filter(([key]) => key.startsWith(recovered.id + ':')).map(([, value]) => value.data).sort()).toEqual([image, pdf].sort());
  });
  it('rejects the committed malformed archive before allocating a destination', async () => {
    const malformed = JSON.parse(readFileSync(resolve('scripts/qa-1-fixtures/malformed.whiteboard.json'), 'utf8'));
    await expect(restoreBoardArchive(malformed, 'Invalid', 'Teacher')).rejects.toThrow(/Unsupported archive version/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("copies actual referenced private media and remaps pages, signatures, audio and connectors into a private board", async () => {
    const copy = await duplicateCompleteBoard(board, "Teacher");
    expect(copy.accessMode).toBe("private");
    expect(copy.editorUids).toBeUndefined();
    expect(copy.viewerUids).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(
      mocks.save.mock.calls.every(
        (c) => c[0] === "destination" && c[1] === undefined && c[5] === true,
      ),
    ).toBe(true);
    const copied = mocks.initialize.mock.calls[0][1] as any[];
    expect(copied[0].id).toMatch(/^pdf-page-/);
    expect(copied[0].id).not.toBe(elements[0].id);
    expect(copied[0]).toMatchObject({
      x: 4,
      y: 8,
      zIndex: -1,
      assetId: "new-image",
    });
    expect(copied[2].assetId).toBe("new-audio");
    expect(copied[3].signatureAssetId).toBe("new-image");
    expect(copied[4].fromId).toBe(copied[0].id);
    expect(copied[4].toId).toBe(copied[1].id);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("includes retained original PDF assets even when rendered pages use images", async () => {
    mocks.list.mockResolvedValue(["retained-pdf"]);
    const original = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async (board, id) =>
      id === "retained-pdf"
        ? {
            data: "data:application/pdf;base64,JVBERi0xLjcK",
            mimeType: "application/pdf",
          }
        : original(board, id),
    );
    const archive = await createCompleteBackup(board, elements, "source");
    expect(archive.assets?.find((a) => a.id === "retained-pdf")?.mimeType).toBe(
      "application/pdf",
    );
    await restoreBoardArchive(archive, "PDF copy", "Teacher");
    expect(mocks.save).toHaveBeenCalledWith(
      "destination",
      undefined,
      "data:application/pdf;base64,JVBERi0xLjcK",
      "application/pdf",
      "teacher",
      true,
    );
  });
  it("round trips a version 2 archive including real PNG and audio bytes without permissions or paths", async () => {
    const archive = await createCompleteBackup(board, elements, "source");
    const parsed = parseBoardBackup(JSON.stringify(archive));
    expect(parsed.assets?.[0].data).toBe(png);
    expect(parsed.board.accessMode).toBeUndefined();
    await restoreBoardArchive(parsed, "Restored lesson", "Teacher");
    expect(mocks.initialize.mock.calls[0][1]).toHaveLength(elements.length);
  });
  it("handles a 1500 page PDF board while copying a shared asset once", async () => {
    const pages = Array.from({ length: 1500 }, (_, i) => ({
      ...elements[0],
      id: `pdf-page-${i}`,
      y: i * 1050,
    }));
    mocks.load.mockResolvedValue({ loadState: "ready", elements: pages });
    await duplicateCompleteBoard(board, "Teacher");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.initialize.mock.calls[0][1]).toHaveLength(1500);
  });
  it("removes only the destination draft and its assets after a quota failure", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Storage quota exceeded"));
    await expect(duplicateCompleteBoard(board, "Teacher")).rejects.toThrow(
      /incomplete copy removed.*quota/,
    );
    expect(mocks.cleanup).toHaveBeenCalledWith("destination");
    expect(mocks.remove).toHaveBeenCalledWith({ id: "destination" });
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it("cleans up after a partially initialized large board and exposes cleanup failures for retry", async () => {
    mocks.initialize.mockRejectedValue(new Error("Checkpoint failed"));
    mocks.cleanup.mockRejectedValue(new Error("Storage offline"));
    await expect(duplicateCompleteBoard(board, "Teacher")).rejects.toThrow(
      /Cleanup also failed.*destination.*Storage offline/,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not allocate a board when source content/media is unavailable or a legacy backup has missing references", async () => {
    mocks.read.mockResolvedValueOnce(null);
    await expect(duplicateCompleteBoard(board, "Teacher")).rejects.toThrow(
      /could not be read/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
    await expect(
      restoreBoardArchive(
        { version: 1, exportedAt: 1, board: { name: "Legacy" }, elements },
        "Restore",
        "Teacher",
      ),
    ).rejects.toThrow(/missing media/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("imports legacy JSON with inline images through private Storage", async () => {
    await restoreBoardArchive(
      {
        version: 1,
        exportedAt: 1,
        board: { name: "Old" },
        elements: [
          { ...(elements[0] as ImageElement), assetId: undefined, src: png },
        ],
      },
      "Restored old",
      "Teacher",
    );
    expect(mocks.save).toHaveBeenCalledWith(
      "destination",
      undefined,
      png,
      "image/png",
      "teacher",
      true,
    );
    expect(mocks.initialize.mock.calls[0][1][0].src).toBeUndefined();
  });
  it("rejects dangling connector references", () => {
    expect(() => remapElements([elements[4]], new Map())).toThrow(
      /missing element/,
    );
  });
});

describe("clear recovery", () => {
  it("blocks a stale clear snapshot when newer collaborator edits arrived during media loading", async () => {
    const changed = [
      ...elements,
      {
        id: "new-note",
        type: "text",
        x: 1,
        y: 2,
        text: "Newer collaborator edit",
        color: "#000",
        width: 100,
        height: 40,
        fontSize: 16,
        zIndex: 9,
      },
    ] as BoardElement[];
    await expect(
      prepareClearRecovery(
        board,
        elements,
        "source",
        () => changed,
        () => true,
      ),
    ).rejects.toThrow(/Board changed/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("requires a complete snapshot and rechecks permission before allowing clear", async () => {
    const archive = await prepareClearRecovery(
      board,
      elements,
      "source",
      () => elements,
      () => true,
    );
    expect(archive.assets).toHaveLength(2);
    await expect(
      prepareClearRecovery(
        board,
        elements,
        "source",
        () => elements,
        () => false,
      ),
    ).rejects.toThrow(/Board changed/);
    mocks.read.mockResolvedValueOnce(null);
    await expect(
      prepareClearRecovery(
        board,
        elements,
        "source",
        () => elements,
        () => true,
      ),
    ).rejects.toThrow(/could not be read/);
  });
});
