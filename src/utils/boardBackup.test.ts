import { describe, it, expect } from "vitest";
import { parseBoardBackup, BoardBackupData } from "./boardBackup";

describe("boardBackup", () => {
  it("parses valid board backup JSON correctly", () => {
    const validJson = JSON.stringify({
      version: 1,
      exportedAt: 123456789,
      board: { name: "Sample Board", description: "Test description" },
      elements: [{ id: "el-1", type: "sticky", x: 10, y: 20 }],
    });

    const parsed: BoardBackupData = parseBoardBackup(validJson);
    expect(parsed.version).toBe(1);
    expect(parsed.board.name).toBe("Sample Board");
    expect(parsed.elements.length).toBe(1);
    expect(parsed.elements[0].id).toBe("el-1");
  });

  it("throws error for invalid backup structure", () => {
    expect(() => parseBoardBackup("invalid json")).toThrow();
    expect(() => parseBoardBackup(JSON.stringify({ version: 1 }))).toThrow(
      /missing or invalid elements/i,
    );
  });
});

describe("portable archive validation", () => {
  const valid = {
    version: 2,
    exportedAt: 1,
    board: { name: "Lesson" },
    elements: [
      { id: "image-a", type: "image", assetId: "media-a", x: 10, y: 20 },
    ],
    assets: [
      {
        id: "media-a",
        mimeType: "image/png",
        data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl4sAAAAASUVORK5CYII=",
        byteSize: 68,
      },
    ],
  };
  it("accepts a complete versioned archive and rejects future versions", () => {
    expect(parseBoardBackup(JSON.stringify(valid)).assets).toHaveLength(1);
    expect(() =>
      parseBoardBackup(JSON.stringify({ ...valid, version: 999 })),
    ).toThrow(/version/);
  });
  it("rejects mismatched sizes, malformed base64, MIME types, missing media and duplicate IDs", () => {
    for (const assets of [
      [{ ...valid.assets[0], byteSize: 99 }],
      [{ ...valid.assets[0], data: "data:image/png;base64,@@==" }],
      [{ ...valid.assets[0], mimeType: "text/html" }],
      [
        {
          ...valid.assets[0],
          data: "data:image/png;base64,SGVsbG8=",
          byteSize: 5,
        },
      ],
      [],
      [valid.assets[0], valid.assets[0]],
    ])
      expect(() =>
        parseBoardBackup(JSON.stringify({ ...valid, assets })),
      ).toThrow();
    expect(() =>
      parseBoardBackup(
        JSON.stringify({
          ...valid,
          elements: [valid.elements[0], valid.elements[0]],
        }),
      ),
    ).toThrow(/duplicate/);
  });
  it("rejects unsafe paths, prototype pollution and nonportable media URLs", () => {
    expect(() =>
      parseBoardBackup(
        JSON.stringify({
          ...valid,
          assets: [{ ...valid.assets[0], id: "../private" }],
        }),
      ),
    ).toThrow(/Unsafe/);
    expect(() =>
      parseBoardBackup(
        JSON.stringify({
          ...valid,
          assets: [{ ...valid.assets[0], objectPath: "boards/source/x" }],
        }),
      ),
    ).toThrow(/Unsafe/);
    expect(() =>
      parseBoardBackup(' {"elements":[],"__proto__":{"admin":true}}'),
    ).toThrow(/Unsafe/);
    expect(() =>
      parseBoardBackup(
        JSON.stringify({
          ...valid,
          elements: [
            { id: "x", type: "image", src: "https://private-signed-url" },
          ],
        }),
      ),
    ).toThrow(/not portable/);
  });
  it("rejects excessive asset counts before any upload", () => {
    expect(() =>
      parseBoardBackup(
        JSON.stringify({ ...valid, assets: Array(2001).fill(valid.assets[0]) }),
      ),
    ).toThrow(/Too many/);
  });
});
