import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  RotateCw,
  Plus,
  Download,
  X,
  Layers,
  Trash2,
  FilePlus,
  AlertTriangle,
  Loader2,
  ArrowUp,
  ArrowDown,
  Bookmark,
} from "lucide-react";
import { ImageElement, normalizeImageRotation } from "../types";
import { useBoardAsset } from "../hooks/useBoardAsset";

interface PdfPageNavigationProps {
  boardId: string;
  pdfPages: ImageElement[];
  currentPageIndex: number;
  onJumpToPage: (index: number) => void;
  onRotatePage?: (pageId: string) => void;
  onDeletePage?: (pageId: string) => void;
  onMovePage?: (fromIndex: number, toIndex: number) => void;
  onBookmarkPage?: (pageId: string, label: string) => void;
  onAppendPdf?: (file: File) => void;
  onExportPdf?: () => void;
  onInsertBlankPage?: () => void;
  isExporting?: boolean;
  isAppending?: boolean;
  canWrite?: boolean;
}

interface PdfPageThumbnailProps {
  boardId: string;
  page: ImageElement;
  pageNumber: number;
  isCurrent: boolean;
}

function PdfPageThumbnail({ boardId, page, pageNumber, isCurrent }: PdfPageThumbnailProps) {
  const {
    data: imageSrc,
    loading: isLoading,
    error: assetError,
    retry: retryAsset,
  } = useBoardAsset(boardId, page.assetId, page.src);
  const [imageLoadError, setImageLoadError] = useState(false);

  useEffect(() => {
    setImageLoadError(false);
  }, [imageSrc]);

  const pageWidth = Math.max(1, page.width || 1);
  const pageHeight = Math.max(1, page.height || 1);
  const rotation = normalizeImageRotation(page.rotation);
  const isQuarterTurn = rotation === 90 || rotation === 270;
  const imageStyle: React.CSSProperties = {
    ...(isQuarterTurn ? {
      width: `${(pageHeight / pageWidth) * 100}%`,
      height: `${(pageWidth / pageHeight) * 100}%`,
      maxWidth: "none",
      maxHeight: "none",
      flexShrink: 0,
    } : {}),
    ...(rotation !== 0 ? {
      transform: `rotate(${rotation}deg)`,
      transformOrigin: "center",
    } : {}),
  };
  const canRetry = Boolean(assetError || imageLoadError);

  const handleRetry = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setImageLoadError(false);
    retryAsset();
  };

  return (
    <div
      className="relative w-full bg-slate-100 rounded-xl overflow-hidden border border-slate-200/60 flex items-center justify-center"
      style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}
    >
      {isLoading ? (
        <div className="w-full h-full animate-pulse flex items-center justify-center text-slate-400 text-[10px]">
          Loading page...
        </div>
      ) : imageSrc && !imageLoadError ? (
        <img
          src={imageSrc}
          alt={`Page ${pageNumber}`}
          className="w-full h-full object-contain"
          style={imageStyle}
          onError={() => setImageLoadError(true)}
          draggable={false}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-center text-rose-500 text-[10px]">
          <span>{canRetry ? "Page preview unavailable" : "No page preview"}</span>
          {canRetry && (
            <button
              type="button"
              onClick={handleRetry}
              className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 font-semibold cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {isCurrent && (
        <div className="absolute inset-0 bg-indigo-600/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs">
            Active
          </span>
        </div>
      )}
    </div>
  );
}

export default function PdfPageNavigation({
  boardId,
  pdfPages,
  currentPageIndex,
  onJumpToPage,
  onRotatePage,
  onDeletePage,
  onMovePage,
  onBookmarkPage,
  onAppendPdf,
  onExportPdf,
  onInsertBlankPage,
  isExporting = false,
  isAppending = false,
  canWrite = true,
}: PdfPageNavigationProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pageInput, setPageInput] = useState<string>("");
  const [pageToDelete, setPageToDelete] = useState<{ id: string; index: number } | null>(null);
  const appendFileInputRef = useRef<HTMLInputElement>(null);

  if (pdfPages.length === 0) return null;

  const totalPages = pdfPages.length;
  const currentPage = Math.min(Math.max(1, currentPageIndex + 1), totalPages);

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(pageInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      onJumpToPage(target - 1);
      setPageInput("");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (onAppendPdf) {
      onAppendPdf(file);
    }
    if (appendFileInputRef.current) {
      appendFileInputRef.current.value = "";
    }
  };

  const handleConfirmDelete = () => {
    if (pageToDelete && onDeletePage) {
      onDeletePage(pageToDelete.id);
      setPageToDelete(null);
    }
  };

  return (
    <>
      {/* Hidden File Input for Combining PDFs */}
      <input
        ref={appendFileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Delete Page Confirmation Modal */}
      {pageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Remove PDF Page</h3>
                <p className="text-xs text-slate-500">Page {pageToDelete.index + 1} of {totalPages}</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to remove this PDF page from the whiteboard? Any annotations drawn on the canvas will remain.
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setPageToDelete(null)}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                Remove Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thumbnail Drawer Sidebar */}
      {isDrawerOpen && (
        <div className="fixed top-14 sm:top-16 left-2 sm:left-4 bottom-24 sm:bottom-20 w-80 max-w-[calc(100vw-1rem)] bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-2xl rounded-3xl z-30 flex flex-col overflow-hidden animate-in fade-in slide-in-from-left duration-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                PDF Pages ({totalPages})
              </span>
            </div>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-1 hover:bg-slate-200/60 rounded-lg text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              title="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Actions Toolbar */}
          {canWrite && (
            <div className="px-3 py-2 border-b border-slate-100 bg-white flex items-center gap-2">
              {onAppendPdf && (
                <button
                  onClick={() => appendFileInputRef.current?.click()}
                  disabled={isAppending}
                  className="flex-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
                  title="Combine another PDF into this board"
                >
                  {isAppending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FilePlus className="w-3.5 h-3.5" />
                  )}
                  <span>{isAppending ? "Adding PDF..." : "+ Combine PDF"}</span>
                </button>
              )}
              {onInsertBlankPage && (
                <button
                  onClick={onInsertBlankPage}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1 cursor-pointer"
                  title="Insert blank canvas page"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Blank</span>
                </button>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-200">
            {pdfPages.map((page, idx) => {
              const isCurrent = idx === currentPageIndex;
              return (
                <div
                  key={page.id}
                  onClick={() => onJumpToPage(idx)}
                  className={`group relative p-2 rounded-2xl border transition-all cursor-pointer flex flex-col space-y-1.5 ${
                    isCurrent
                      ? "bg-indigo-50/80 border-indigo-500 ring-2 ring-indigo-500/20 shadow-md"
                      : "bg-white border-slate-200/80 hover:border-indigo-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between px-1">
                    <span
                      className={`text-[11px] font-bold ${
                        isCurrent ? "text-indigo-700" : "text-slate-600"
                      }`}
                    >
                      Page {idx + 1}
                    </span>
                    <div className="flex items-center space-x-1">
                      {onMovePage && canWrite && idx > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onMovePage(idx, idx - 1);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-all cursor-pointer"
                          title="Move Page Up"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                      )}
                      {onMovePage && canWrite && idx < pdfPages.length - 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onMovePage(idx, idx + 1);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-all cursor-pointer"
                          title="Move Page Down"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      )}
                      {onBookmarkPage && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onBookmarkPage(page.id, `Page ${idx + 1}`);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-amber-100 rounded text-slate-500 hover:text-amber-600 transition-all cursor-pointer"
                          title="Bookmark Page"
                        >
                          <Bookmark className="w-3 h-3" />
                        </button>
                      )}
                      {onRotatePage && canWrite && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRotatePage(page.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-all cursor-pointer"
                          title="Rotate Page 90°"
                        >
                          <RotateCw className="w-3 h-3" />
                        </button>
                      )}
                      {onDeletePage && canWrite && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPageToDelete({ id: page.id, index: idx });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-100 rounded text-slate-400 hover:text-rose-600 transition-all cursor-pointer"
                          title="Delete Page"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <PdfPageThumbnail
                    boardId={boardId}
                    page={page}
                    pageNumber={idx + 1}
                    isCurrent={isCurrent}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Bottom Navigation Bar */}
      <div className="fixed bottom-18 md:bottom-6 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-xl rounded-2xl px-2.5 sm:px-3 py-1.5 flex items-center space-x-1.5 sm:space-x-2 text-slate-700 max-w-[96vw] overflow-x-auto scrollbar-none">
        {/* Toggle Page Drawer */}
        <button
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className={`p-2 rounded-xl transition-colors flex items-center space-x-1 cursor-pointer ${
            isDrawerOpen
              ? "bg-indigo-50 text-indigo-600 font-bold"
              : "hover:bg-slate-100 text-slate-600"
          }`}
          title="Toggle PDF Page Drawer"
        >
          <LayoutGrid className="w-4 h-4" />
          <span className="text-xs font-semibold hidden sm:inline">Pages</span>
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        {/* Previous Page */}
        <button
          onClick={() => onJumpToPage(Math.max(0, currentPageIndex - 1))}
          disabled={currentPageIndex <= 0}
          className="p-1.5 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-slate-700 cursor-pointer"
          title="Previous Page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Page Jump Form */}
        <form onSubmit={handlePageInputSubmit} className="flex items-center space-x-1">
          <span className="text-xs text-slate-500 font-medium">Page</span>
          <input
            type="text"
            placeholder={String(currentPage)}
            value={pageInput}
            onChange={handlePageInputChange}
            className="w-9 h-7 text-center text-xs font-bold font-mono bg-slate-100 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
          />
          <span className="text-xs text-slate-500 font-medium">of {totalPages}</span>
        </form>

        {/* Next Page */}
        <button
          onClick={() => onJumpToPage(Math.min(totalPages - 1, currentPageIndex + 1))}
          disabled={currentPageIndex >= totalPages - 1}
          className="p-1.5 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-slate-700 cursor-pointer"
          title="Next Page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        {/* Rotate Active Page */}
        {onRotatePage && canWrite && pdfPages[currentPageIndex] && (
          <button
            onClick={() => onRotatePage(pdfPages[currentPageIndex].id)}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
            title="Rotate Active Page 90°"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        )}

        {/* Delete Active Page */}
        {onDeletePage && canWrite && pdfPages[currentPageIndex] && (
          <button
            onClick={() => setPageToDelete({ id: pdfPages[currentPageIndex].id, index: currentPageIndex })}
            className="p-2 rounded-xl hover:bg-rose-50 text-slate-600 hover:text-rose-600 transition-colors cursor-pointer"
            title="Remove Current Page"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Combine PDF / Add Pages */}
        {onAppendPdf && canWrite && (
          <button
            onClick={() => appendFileInputRef.current?.click()}
            disabled={isAppending}
            className="p-2 rounded-xl hover:bg-indigo-50 text-indigo-600 transition-colors flex items-center space-x-1 cursor-pointer disabled:opacity-50"
            title="Combine / Append another PDF file"
          >
            {isAppending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FilePlus className="w-4 h-4" />
            )}
            <span className="text-xs font-semibold hidden md:inline">
              {isAppending ? "Adding..." : "Combine PDF"}
            </span>
          </button>
        )}

        {/* Insert Blank Page */}
        {onInsertBlankPage && canWrite && (
          <button
            onClick={onInsertBlankPage}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors flex items-center space-x-1 cursor-pointer"
            title="Insert Blank Page"
          >
            <Plus className="w-4 h-4" />
            <span className="text-xs font-semibold hidden lg:inline">Add Blank</span>
          </button>
        )}

        {/* Export Annotated PDF */}
        {onExportPdf && (
          <button
            onClick={onExportPdf}
            disabled={isExporting}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            title="Export Annotated PDF"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? "Exporting..." : "Export PDF"}</span>
          </button>
        )}
      </div>
    </>
  );
}
