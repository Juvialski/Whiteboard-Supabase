export interface ClassroomPreferences {
  favorites: string[];
  recent: string[];
  viewport?: { panX: number; panY: number; zoom: number };
  bookmarks?: Record<string, string>;
}
export function preferenceKey(user: string, board = ""): string {
  return `whiteboard:ux1:${encodeURIComponent(user)}:${encodeURIComponent(board)}`;
}
export function clampViewport(view: any): ClassroomPreferences["viewport"] {
  if (
    !view ||
    !["panX", "panY", "zoom"].every(
      (k) => typeof view[k] === "number" && Number.isFinite(view[k]),
    )
  )
    return undefined;
  return {
    panX: Math.max(-100000, Math.min(100000, view.panX)),
    panY: Math.max(-100000, Math.min(100000, view.panY)),
    zoom: Math.max(0.1, Math.min(5, view.zoom)),
  };
}
export function readPreferences(
  user: string,
  board = "",
): ClassroomPreferences {
  if (!user) return { favorites: [], recent: [] };
  try {
    const v = JSON.parse(
      localStorage.getItem(preferenceKey(user, board)) || "{}",
    );
    const strings = (a: any) =>
      Array.isArray(a)
        ? a.filter((s: any) => typeof s === "string").slice(0, 100)
        : [];
    const bookmarks: Record<string, string> = {};
    if (v.bookmarks && typeof v.bookmarks === "object")
      for (const [id, label] of Object.entries(v.bookmarks).slice(0, 500))
        if (/^[A-Za-z0-9_-]{1,128}$/.test(id) && typeof label === "string")
          bookmarks[id] = label.slice(0, 100);
    return {
      favorites: strings(v.favorites),
      recent: strings(v.recent),
      viewport: clampViewport(v.viewport),
      bookmarks,
    };
  } catch {
    return { favorites: [], recent: [] };
  }
}
export function writePreferences(
  user: string,
  value: ClassroomPreferences,
  board = "",
): void {
  if (!user) return;
  try {
    localStorage.setItem(preferenceKey(user, board), JSON.stringify(value));
  } catch {
    /* Personal preferences are optional when storage is unavailable. */
  }
}
export function rememberBoard(user: string, board: string): void {
  const p = readPreferences(user);
  p.recent = [board, ...p.recent.filter((id) => id !== board)].slice(0, 8);
  writePreferences(user, p);
}
export function annotationIds(
  elements: any[],
  pages: any[],
  activePageId?: string,
): Set<string> {
  const pageIds = new Set(pages.map((p) => p.id));
  const page = pages.find((p) => p.id === activePageId);
  return new Set(
    elements
      .filter((e) => {
        if (pageIds.has(e.id)) return false;
        if (!activePageId) return true;
        if (!page) return false;
        const points = e.type === "drawing" ? e.points : [{ x: e.x, y: e.y }];
        // A drawing belongs to a page only if every point is on that page.
        return (
          points?.length &&
          points.every(
            (p: any) =>
              p.x >= page.x &&
              p.x <= page.x + page.width &&
              p.y >= page.y &&
              p.y <= page.y + page.height,
          )
        );
      })
      .map((e) => e.id),
  );
}

/** Hide a previously loaded account's board list while its replacement request is pending. */
export function boardsForUser<T>(loadedUser:string,currentUser:string,boards:T[]):T[] {
  return loadedUser === currentUser ? boards : [];
}
