import { auth, db } from "../supabase";
import { addDoc, collection, deleteDoc, doc } from "../lib/supabaseDb";
import { BoardElement, Whiteboard } from "../types";
import {
  assetReferences,
  BoardBackupData,
  mediaByteSize,
  parseBoardBackup,
  MAX_ARCHIVE_MEDIA_BYTES,
} from "../utils/boardBackup";
import {
  getBoardAsset,
  listBoardAssetIds,
  saveBoardAsset,
  deleteIncompleteTransferAssets,
} from "./storageService";
import {
  loadBoardState,
  initializeBoardWithElements,
  sanitizeElementForStorage,
  MAX_SINGLE_ELEMENT_BYTES,
  disposeBoardPersistence,
  releaseIdleBoardState,
} from "./boardPersistence";
import {
  isSandboxEnvironment,
  getSandboxLocalBoards,
  saveSandboxLocalBoards,
  saveSandboxLocalElements,
} from "../utils/sandboxGuard";
export type TransferProgress = (message: string) => void;
export async function createCompleteBackup(
  board: Partial<Whiteboard>,
  elements: BoardElement[],
  boardId: string,
  progress: TransferProgress = () => {},
): Promise<BoardBackupData> {
  const refs = [
    ...new Set([
      ...assetReferences(elements),
      ...(await listBoardAssetIds(boardId)),
    ]),
  ];
  if (refs.length > 2000 || elements.length > 50000)
    throw new Error("Board exceeds portable archive count limits.");
  const assets: NonNullable<BoardBackupData["assets"]> = [];
  let total = 0;
  for (let i = 0; i < refs.length; i++) {
    progress(`Reading media ${i + 1}/${refs.length}`);
    const asset = await getBoardAsset(boardId, refs[i]);
    if (!asset)
      throw new Error(
        `Media ${i + 1} could not be read. The archive was not downloaded.`,
      );
    const byteSize = mediaByteSize(asset.data, asset.mimeType);
    total += byteSize;
    if (total > MAX_ARCHIVE_MEDIA_BYTES)
      throw new Error("Board media exceeds the 128 MB portable archive limit.");
    assets.push({
      id: refs[i],
      mimeType: asset.mimeType,
      data: asset.data,
      byteSize,
    });
  }
  // Only portable fields leave the application; permissions and Storage paths never do.
  const cleanElements = elements.map((e) => {
    const copy: any = { ...e };
    delete copy.objectPath;
    delete copy.object_path;
    if (copy.assetId) {
      delete copy.src;
      delete copy.audioUrl;
    }
    if (copy.signatureAssetId || copy.assetId) delete copy.signatureDataUrl;
    return copy;
  });
  return parseBoardBackup(
    JSON.stringify({
      version: 2,
      exportedAt: Date.now(),
      board: { name: board.name, description: board.description },
      elements: cleanElements,
      assets,
    }),
  );
}
export async function prepareClearRecovery(
  board: Partial<Whiteboard>,
  elements: BoardElement[],
  boardId: string,
  current: () => BoardElement[],
  mayWrite: () => boolean,
): Promise<BoardBackupData> {
  const baseline = JSON.stringify(elements);
  const archive = await createCompleteBackup(board, elements, boardId);
  if (!mayWrite() || JSON.stringify(current()) !== baseline)
    throw new Error(
      "Board changed while preparing the snapshot. Retry clearing after collaboration settles.",
    );
  return archive;
}
export function remapElements(
  elements: BoardElement[],
  assets: Map<string, string>,
): BoardElement[] {
  const ids = new Map(
    elements.map((e) => [
      e.id,
      `${e.id.startsWith("pdf-page-") ? "pdf-page-" : "el-"}${crypto.randomUUID()}`,
    ]),
  );
  return elements.map((e) => {
    const copy: any = { ...e, id: ids.get(e.id), updatedAt: Date.now() };
    delete copy.updatedByClientId;
    for (const key of ["assetId", "signatureAssetId"])
      if (copy[key]) {
        if (!assets.has(copy[key]))
          throw new Error(
            "Legacy backup references media it does not contain. Export a complete archive from the original board.",
          );
        copy[key] = assets.get(copy[key]);
      }
    if (copy.type === "connector") {
      if (!ids.has(copy.fromId) || (copy.toId && !ids.has(copy.toId)))
        throw new Error("Connector references a missing element.");
      copy.fromId = ids.get(copy.fromId);
      if (copy.toId) copy.toId = ids.get(copy.toId);
    }
    return copy;
  });
}
export async function restoreBoardArchive(
  input: BoardBackupData,
  name: string,
  author: string,
  progress: TransferProgress = () => {},
): Promise<Whiteboard> {
  const archive = parseBoardBackup(JSON.stringify(input));
  const sandbox = isSandboxEnvironment();
  const uid = auth.currentUser?.uid;
  if (!sandbox && (!uid || auth.currentUser?.isAnonymous))
    throw new Error("Sign in with Google to restore or duplicate boards.");
  const data: Omit<Whiteboard, "id"> = {
    name,
    description: archive.board.description || "",
    createdBy: author,
    ownerUid: uid,
    createdAt: Date.now(),
    accessMode: "private",
    studentsCanWrite: false,
    status: "initializing",
  };
  // Validate shapes/drawings/tables before allocating anything, including legacy inline media.
  for (const e of archive.elements) {
    const candidate: any = { ...e };
    delete candidate.src;
    delete candidate.audioUrl;
    delete candidate.signatureDataUrl;
    const clean = sanitizeElementForStorage(candidate);
    if (
      new TextEncoder().encode(JSON.stringify(clean)).length >
      MAX_SINGLE_ELEMENT_BYTES
    )
      throw new Error("Archive element exceeds the 900 KB persistence limit.");
    if (clean.type === "drawing" && clean.points.length > 20000)
      throw new Error("Archive drawing exceeds 20000 points.");
  }
  const references = assetReferences(archive.elements);
  if (references.some((id) => !archive.assets?.some((a) => a.id === id)))
    throw new Error(
      "Legacy backup has missing media. Re-export a complete archive from the source board.",
    );
  progress("Creating private board");
  const id = sandbox
    ? `board-${crypto.randomUUID()}`
    : (await addDoc(collection(db, "whiteboards"), data)).id;
  try {
    const map = new Map<string, string>();
    const assets = archive.assets || [];
    for (let i = 0; i < assets.length; i++) {
      progress(`Copying media ${i + 1}/${assets.length}`);
      const a = assets[i];
      if (sandbox) map.set(a.id, a.id);
      else
        map.set(
          a.id,
          (await saveBoardAsset(id, undefined, a.data, a.mimeType, uid, true))
            .assetId,
        );
    }
    const elements = remapElements(archive.elements, map);
    for (const e of elements as any[]) {
      for (const [field, target] of [
        ["src", "assetId"],
        ["audioUrl", "assetId"],
        ["signatureDataUrl", "signatureAssetId"],
      ])
        if (e[field]) {
          if (!sandbox) {
            const mime = e[field].slice(5, e[field].indexOf(";"));
            e[target] = (
              await saveBoardAsset(id, undefined, e[field], mime, uid, true)
            ).assetId;
            delete e[field];
          }
        }
      if (sandbox) {
        if (e.assetId) {
          const a = assets.find((a) => a.id === e.assetId);
          if (a) e[e.type === "audio" ? "audioUrl" : "src"] = a.data;
          delete e.assetId;
        }
        if (e.signatureAssetId) {
          e.signatureDataUrl = assets.find(
            (a) => a.id === e.signatureAssetId,
          )?.data;
          delete e.signatureAssetId;
        }
      }
    }
    progress(`Saving ${elements.length} elements`);
    if (sandbox) {
      saveSandboxLocalElements(id, elements);
      saveSandboxLocalBoards([
        { id, ...data, status: "ready" },
        ...getSandboxLocalBoards(),
      ]);
    } else await initializeBoardWithElements(id, elements, data);
    progress("Complete");
    return { id, ...data, status: "ready" };
  } catch (error) {
    progress("Cleaning up incomplete copy");
    try {
      if (!sandbox) {
        await deleteIncompleteTransferAssets(id);
        await deleteDoc(doc(db, "whiteboards", id));
        disposeBoardPersistence(id);
      } else localStorage.removeItem(`lucid_spark_board_elements_${id}`);
    } catch (cleanupError) {
      throw new Error(
        `Transfer failed: ${error instanceof Error ? error.message : error}. Cleanup also failed for private draft ${id}: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}. Retry deletion from the owner account before retrying.`,
      );
    }
    throw new Error(
      `Transfer failed; incomplete copy removed. ${error instanceof Error ? error.message : error}`,
    );
  }
}
export async function duplicateCompleteBoard(
  board: Whiteboard,
  author: string,
  progress: TransferProgress = () => {},
): Promise<Whiteboard> {
  progress("Loading board content");
  try {
    const state = await loadBoardState(board.id);
    if (state.loadState !== "ready")
      throw new Error(
        state.loadError ||
          "Board content is not ready. Retry after synchronization.",
      );
    const archive = await createCompleteBackup(
      board,
      state.elements,
      board.id,
      progress,
    );
    return await restoreBoardArchive(
      archive,
      `Copy of ${board.name}`,
      author,
      progress,
    );
  } finally {
    releaseIdleBoardState(board.id);
  }
}
