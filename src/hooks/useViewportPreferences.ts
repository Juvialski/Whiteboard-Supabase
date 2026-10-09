import { useEffect, useRef } from "react";
import {
  clampViewport,
  readPreferences,
  writePreferences,
} from "../utils/classroomPreferences";
export interface PersonalViewport {
  panX: number;
  panY: number;
  zoom: number;
}
/** Personal camera state never enters board shards or the collaboration relay. */
export function useViewportPreferences(
  user: string,
  board: string,
  view: PersonalViewport,
  restore: (view: PersonalViewport) => void,
  ready: boolean,
  controlled: boolean,
): void {
  const scope = `${user}:${board}`;
  const callback = useRef(restore);
  callback.current = restore;
  const state = useRef({
    scope,
    user,
    board,
    personal: view,
    controlled,
    ready,
  });
  const save = (snapshot: typeof state.current) => {
    if (!snapshot.ready || !snapshot.user) return;
    const p = readPreferences(snapshot.user, snapshot.board);
    p.viewport = clampViewport(snapshot.personal);
    writePreferences(snapshot.user, p, snapshot.board);
  };
  useEffect(() => {
    const previous = state.current;
    if (previous.scope !== scope) {
      save(previous);
      const personal = readPreferences(user, board).viewport || {
        panX: window.innerWidth / 2 - 400,
        panY: window.innerHeight / 2 - 300,
        zoom: 1,
      };
      state.current = { scope, user, board, personal, controlled, ready };
      if (!controlled) callback.current(personal);
      return;
    }
    state.current = { ...previous, controlled, ready };
    if (controlled) {
      if (!previous.controlled) save(previous);
      return;
    }
    if (previous.controlled) {
      callback.current(previous.personal);
      return;
    }
    state.current.personal = view;
    const timer = setTimeout(() => save(state.current), 300);
    return () => clearTimeout(timer);
  }, [scope, user, board, view.panX, view.panY, view.zoom, ready, controlled]);
  useEffect(() => () => save(state.current), []);
}
