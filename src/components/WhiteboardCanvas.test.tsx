import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ listener: null as any, backup: vi.fn(), download: vi.fn() }));
vi.mock('../supabase', () => ({ auth: {currentUser:{uid:'qa-owner'}}, db:{}, supabase:{} }));
vi.mock('../utils/pdf', () => ({ exportPdfWithDrawings:vi.fn(), pdfToImages:vi.fn() }));
vi.mock('../utils/boardExport', () => ({ exportBoardImage:vi.fn(), exportSelectionImage:vi.fn() }));
vi.mock('../utils/boardBackup', () => ({ downloadBoardBackup:mock.download }));
vi.mock('../services/boardTransfer', () => ({ createCompleteBackup:mock.backup, prepareClearRecovery:vi.fn() }));
vi.mock('../services/boardPersistence', () => ({
  subscribeToBoardState: (_id:any,cb:any) => {mock.listener=cb; return () => {};},
  queueElementMutation:vi.fn(), applyRemoteOperation:vi.fn(), applyBoardMetadataPatchLocally:vi.fn(),
  flushBoardCheckpoint:vi.fn(), getBoardSaveStatus:()=>'saved', sanitizeElementForStorage:(e:any)=>e, MAX_SINGLE_ELEMENT_BYTES:900000,
}));
vi.mock('../services/boardSocketService', () => ({
  getBoardSocketHandle:()=>({readyState:3,send:vi.fn()}),
  subscribeBoardSocketMessages:()=>()=>{}, subscribeBoardSocketStatus:()=>()=>{},
}));
vi.mock('../hooks/useBoardTimer', () => ({useBoardTimer:()=>({state:null,error:null,busy:false,transition:vi.fn(),serverNow:Date.now})}));
import WhiteboardCanvas from './WhiteboardCanvas';
beforeEach(() => { localStorage.clear(); mock.backup.mockReset(); mock.download.mockReset(); mock.backup.mockResolvedValue({version:2,elements:[],assets:[]}); });
afterEach(cleanup);
const user = {id:'qa-owner',name:'QA Teacher',color:'#000000',role:'teacher' as const};
const ready = (id:string,name:string) => ({loadState:'ready',elements:[],boardData:{id,name,ownerUid:'qa-owner',createdBy:'QA Teacher',createdAt:1}});
it('uses the authorized saved lesson title after a direct-link reload and exports it in recovery metadata', async () => {
  const changed = vi.fn();
  render(<WhiteboardCanvas boardId="qa-board" boardName="Collaborative Whiteboard" currentUser={user} onBackToDashboard={()=>{}} onBoardNameChanged={changed}/>);
  await act(async()=>mock.listener(ready('qa-board','QA Algebra Lesson')));
  expect(screen.getByText('QA Algebra Lesson')).toBeTruthy();
  expect(changed).toHaveBeenCalledWith('QA Algebra Lesson');
  expect(screen.queryByText('Collaborative Whiteboard')).toBeNull();
  fireEvent.click(screen.getByTitle('More board options'));
  fireEvent.click(screen.getByText('Complete Backup (.json)'));
  await waitFor(()=>expect(mock.backup).toHaveBeenCalled());
  expect(mock.backup.mock.calls[0][0].name).toBe('QA Algebra Lesson');
  await act(async()=>mock.listener(ready('qa-board','QA Renamed Lesson')));
  expect(screen.getByText('QA Renamed Lesson')).toBeTruthy();
});
it('does not display another board manifest title while changing boards', async () => {
  const view=render(<WhiteboardCanvas boardId="qa-old" boardName="Old fallback" currentUser={user} onBackToDashboard={()=>{}}/>);
  await act(async()=>mock.listener(ready('qa-old','Old saved title')));
  view.rerender(<WhiteboardCanvas boardId="qa-new" boardName="New fallback" currentUser={user} onBackToDashboard={()=>{}}/>);
  expect(screen.getByText('New fallback')).toBeTruthy();
  expect(screen.queryByText('Old saved title')).toBeNull();
  await act(async()=>mock.listener(ready('qa-new','New saved title')));
  expect(screen.getByText('New saved title')).toBeTruthy();
});
