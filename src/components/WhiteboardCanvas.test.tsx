import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ listener: null as any, backup: vi.fn(), download: vi.fn(), queue: vi.fn() }));
vi.mock('../supabase', () => ({ auth: {currentUser:{uid:'qa-owner'}}, db:{}, supabase:{} }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('../utils/pdf', async original => ({ ...await original<any>(), exportPdfWithDrawings:vi.fn(), pdfToImages:vi.fn() }));
vi.mock('../hooks/useBoardAsset', () => ({ useBoardAsset: (_board:any,_asset:any,src:any) => ({data:src,loading:false,error:null,retry:vi.fn()}) }));
vi.mock('../utils/boardExport', () => ({ exportBoardImage:vi.fn(), exportSelectionImage:vi.fn() }));
vi.mock('../utils/boardBackup', () => ({ downloadBoardBackup:mock.download }));
vi.mock('../services/boardTransfer', () => ({ createCompleteBackup:mock.backup, prepareClearRecovery:vi.fn() }));
vi.mock('../services/boardPersistence', () => ({
  subscribeToBoardState: (_id:any,cb:any) => {mock.listener=cb; return () => {};},
  queueElementMutation:mock.queue, applyRemoteOperation:vi.fn(), applyBoardMetadataPatchLocally:vi.fn(),
  flushBoardCheckpoint:vi.fn(), getBoardSaveStatus:()=>'saved', sanitizeElementForStorage:(e:any)=>e, MAX_SINGLE_ELEMENT_BYTES:900000,
}));
vi.mock('../services/boardSocketService', () => ({
  getBoardSocketHandle:()=>({readyState:3,send:vi.fn()}),
  subscribeBoardSocketMessages:()=>()=>{}, subscribeBoardSocketStatus:()=>()=>{},
}));
vi.mock('../hooks/useBoardTimer', () => ({useBoardTimer:()=>({state:null,error:null,busy:false,transition:vi.fn(),serverNow:Date.now})}));
import WhiteboardCanvas from './WhiteboardCanvas';
beforeEach(() => { localStorage.clear(); mock.queue.mockReset(); mock.backup.mockReset(); mock.download.mockReset(); mock.backup.mockResolvedValue({version:2,elements:[],assets:[]}); });
afterEach(cleanup);
const user = {id:'qa-owner',name:'QA Teacher',color:'#000000',role:'teacher' as const};
const ready = (id:string,name:string) => ({loadState:'ready',elements:[],boardData:{id,name,ownerUid:'qa-owner',createdBy:'QA Teacher',createdAt:1}});
it('deletes a PDF page, reflows its surviving annotations, and restores/reapplies the batch with real undo/redo controls', async () => {
  const page = (id:string,y:number) => ({ id, type:'image', x:0, y, width:800, height:1000, zIndex:0, src:'data:image/png;base64,iVBORw0KGgo=' });
  const note = { id:'page-three-note', type:'text', x:40, y:2240, width:100, height:40, text:'Page three annotation', color:'#000000', fontSize:16, zIndex:2 };
  render(<WhiteboardCanvas boardId="qa-pdf" boardName="QA PDF" currentUser={user} onBackToDashboard={()=>{}}/>);
  await act(async()=>mock.listener({ ...ready('qa-pdf','QA PDF'), elements:[page('pdf-page-one',0),page('pdf-page-two',1040),page('pdf-page-three',2080),note] }));
  fireEvent.click(screen.getByTitle('Toggle PDF Page Drawer'));
  fireEvent.click(screen.getAllByTitle('Delete Page')[1]);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Remove Page'})));
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','pdf-page-two',null,'delete');
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','pdf-page-three',expect.objectContaining({y:1040}),'set');
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','page-three-note',expect.objectContaining({y:1200}),'set');
  mock.queue.mockClear();
  await act(async()=>fireEvent.keyDown(window,{key:'z',ctrlKey:true}));
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','pdf-page-two',expect.objectContaining({y:1040}),'set');
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','page-three-note',expect.objectContaining({y:2240}),'set');
  mock.queue.mockClear();
  await act(async()=>fireEvent.keyDown(window,{key:'z',ctrlKey:true,shiftKey:true}));
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','pdf-page-two',null,'delete');
  expect(mock.queue).toHaveBeenCalledWith('qa-pdf','page-three-note',expect.objectContaining({y:1200}),'set');
});
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
