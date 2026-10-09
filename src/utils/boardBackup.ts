import { BoardElement, Whiteboard } from "../types";

export interface PortableAsset {
  id: string;
  mimeType: string;
  data: string;
  byteSize: number;
}
export interface BoardBackupData {
  version: number;
  exportedAt: number;
  board: Partial<Whiteboard>;
  elements: BoardElement[];
  assets?: PortableAsset[];
}
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_MEDIA_BYTES = 128 * 1024 * 1024;
const types = new Set([
  "sticky",
  "shape",
  "text",
  "drawing",
  "image",
  "connector",
  "audio",
  "stamp",
  "math",
  "table",
]);
const mimes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
]);
export function assetReferences(elements: BoardElement[]): string[] {
  return [
    ...new Set(
      elements.flatMap((e) =>
        [(e as any).assetId, (e as any).signatureAssetId].filter(Boolean),
      ),
    ),
  ];
}
function verifyMediaHeader(body: string, mime: string): void {
  const bytes = atob(body.slice(0, 64));
  const codes = Array.from(bytes, (c) => c.charCodeAt(0));
  const starts = (signature: number[]) =>
    signature.every((b, i) => codes[i] === b);
  const valid =
    mime === "image/png"
      ? starts([137, 80, 78, 71, 13, 10, 26, 10])
      : mime === "image/jpeg"
        ? starts([255, 216, 255])
        : mime === "image/gif"
          ? bytes.startsWith("GIF87a") || bytes.startsWith("GIF89a")
          : mime === "image/webp"
            ? bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP"
            : mime === "application/pdf"
              ? bytes.startsWith("%PDF-")
              : mime === "audio/wav"
                ? bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WAVE"
                : mime === "audio/ogg"
                  ? bytes.startsWith("OggS")
                  : mime === "audio/webm"
                    ? starts([26, 69, 223, 163])
                    : mime === "audio/mpeg"
                      ? bytes.startsWith("ID3") ||
                        (codes[0] === 255 && (codes[1] & 224) === 224)
                      : false;
  if (!valid) throw new Error(`Asset contents do not match ${mime}.`);
}
export function mediaByteSize(data: string, mimeType: string): number {
  const prefix = `data:${mimeType};base64,`;
  if (!mimes.has(mimeType) || !data.startsWith(prefix))
    throw new Error("Unsupported asset type or encoding.");
  const body = data.slice(prefix.length);
  if (!body.length || body.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body))
    throw new Error("Malformed asset encoding.");
  verifyMediaHeader(body, mimeType);
  const bytes =
    (body.length / 4) * 3 -
    (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0);
  if (bytes > 20 * 1024 * 1024) throw new Error("Asset exceeds 20 MB.");
  return bytes;
}
export function downloadBoardBackup(data: BoardBackupData): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(data.board.name || "whiteboard").replace(/[^a-zA-Z0-9_-]/g, "_")}-backup.whiteboard.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/** Legacy metadata-only export; the canvas uses the complete version 2 archive service. */
export function exportBoardBackup(
  board: Partial<Whiteboard>,
  elements: BoardElement[],
): void {
  downloadBoardBackup({
    version: 1,
    exportedAt: Date.now(),
    board: { name: board.name, description: board.description },
    elements,
  });
}
export function parseBoardBackup(json: string): BoardBackupData {
  if (new TextEncoder().encode(json).length > MAX_ARCHIVE_BYTES)
    throw new Error("Archive exceeds 256 MB.");
  const data = JSON.parse(json, (key, value) => {
    if (
      [
        "__proto__",
        "constructor",
        "prototype",
        "objectPath",
        "object_path",
      ].includes(key)
    )
      throw new Error("Unsafe archive key.");
    return value;
  });
  if (!data || !Array.isArray(data.elements))
    throw new Error("Missing or invalid elements in board backup.");
  if (![1, 2].includes(data.version ?? 1))
    throw new Error("Unsupported archive version.");
  if (data.elements.length > 50000) throw new Error("Too many elements.");
  const ids = new Set<string>();
  for (const e of data.elements) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(e.id) ||
      ids.has(e.id) ||
      !types.has(e.type)
    )
      throw new Error("Invalid or duplicate element.");
    ids.add(e.id);
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "zIndex",
      "fontSize",
      "duration",
    ]) {
      if (
        e[key] !== undefined &&
        (typeof e[key] !== "number" ||
          !Number.isFinite(e[key]) ||
          Math.abs(e[key]) > 10000000)
      )
        throw new Error("Invalid element coordinates.");
    }
    if (
      e.answerCover !== undefined &&
      (e.type !== "shape" ||
        typeof e.answerCover !== "boolean" ||
        (e.revealed !== undefined && typeof e.revealed !== "boolean"))
    )
      throw new Error("Invalid answer cover.");
    for (const key of ["assetId", "signatureAssetId"])
      if (
        e[key] !== undefined &&
        (typeof e[key] !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(e[key]))
      )
        throw new Error("Unsafe asset reference.");
    for (const key of ["src", "audioUrl", "signatureDataUrl"])
      if (e[key] && (typeof e[key] !== "string" || !e[key].startsWith("data:")))
        throw new Error("External or temporary media is not portable.");
    if (JSON.stringify(e).length > 30000000)
      throw new Error("Element is too large.");
  }
  const assets = data.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 2000)
    throw new Error("Too many or invalid assets.");
  const assetIds = new Set<string>();
  let total = 0;
  for (const a of assets) {
    if (
      !a ||
      typeof a.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(a.id) ||
      assetIds.has(a.id) ||
      typeof a.data !== "string"
    )
      throw new Error("Unsafe or duplicate asset ID.");
    if (a.objectPath || a.path || a.object_path)
      throw new Error("Archive paths are not allowed.");
    const bytes = mediaByteSize(a.data, a.mimeType);
    if (bytes !== a.byteSize) throw new Error("Asset size mismatch.");
    total += bytes;
    assetIds.add(a.id);
  }
  for (const e of data.elements)
    for (const key of ["src", "audioUrl", "signatureDataUrl"])
      if (e[key]) {
        const mime = e[key].slice(5, e[key].indexOf(";"));
        total += mediaByteSize(e[key], mime);
      }
  for (const e of data.elements) {
    for (const key of ["src", "audioUrl", "signatureDataUrl"])
      if (e[key]) {
        const mime = e[key].slice(5, e[key].indexOf(";"));
        if (
          !(key === "audioUrl"
            ? e.type === "audio" && mime.startsWith("audio/")
            : mime.startsWith("image/") &&
              (e.type === "image" || e.type === "stamp"))
        )
          throw new Error("Element media type mismatch.");
      }
    for (const key of ["assetId", "signatureAssetId"])
      if (e[key]) {
        const asset = assets.find((a: PortableAsset) => a.id === e[key]);
        if (
          asset &&
          !(e.type === "audio"
            ? asset.mimeType.startsWith("audio/")
            : (e.type === "image" || e.type === "stamp") &&
              asset.mimeType.startsWith("image/"))
        )
          throw new Error("Element asset type mismatch.");
      }
  }
  if (total > MAX_ARCHIVE_MEDIA_BYTES)
    throw new Error("Archive media exceeds 128 MB.");
  if (
    (data.version ?? 1) === 2 &&
    assetReferences(data.elements).some((id) => !assetIds.has(id))
  )
    throw new Error("Missing archive asset.");
  const board = data.board || {};
  if (
    typeof board !== "object" ||
    (board.name !== undefined && typeof board.name !== "string") ||
    (board.description !== undefined && typeof board.description !== "string")
  )
    throw new Error("Invalid board metadata.");
  return {
    version: data.version ?? 1,
    exportedAt: Number(data.exportedAt) || Date.now(),
    board: {
      name: String(board.name || "Restored board").slice(0, 200),
      description: String(board.description || "").slice(0, 10000),
    },
    elements: data.elements,
    assets,
  };
}
