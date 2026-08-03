import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  RotateCw,
  Plus,
  Download,
  X,
  FileText,
  Eye,
  Check,
  Layers,
} from "lucide-react";
import { ImageElement } from "../types";

interface PdfPageNavigationProps {
  pdfPages: ImageElement[];
  currentPageIndex: number;
  onJumpToPage: (index: number) => void;
  onRotatePage?: (pageId: string) => void;
  onExportPdf?: () => void;
  onInsertBlankPage?: () => void;
  isExporting?: boolean;
}

export default function PdfPageNavigation({
  pdfPages,
  currentPageIndex,
  onJumpToPage,
  onRotatePage,
  onExportPdf,
  onInsertBlankPage,
  isExporting = false,
}: PdfPageNavigationProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pageInput, setPageInput] = useState<string>("");

  if (pdfPages.length === 0) return null;

  const totalPages = pdfPages.length;
  const currentPage = currentPageIndex + 1;

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

  return (
    <>
      {/* Thumbnail Drawer Sidebar */}
      {isDrawerOpen && (
        <div className="fixed top-16 left-4 bottom-20 w-72 bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-2xl rounded-3xl z-30 flex flex-col overflow-hidden animate-in fade-in slide-in-from-left duration-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Document Pages ({totalPages})
              </span>
            </div>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-1 hover:bg-slate-200/60 rounded-lg text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

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
                    {onRotatePage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRotatePage(page.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-all cursor-pointer"
                        title="Rotate Page"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Thumbnail Image */}
                  <div className="relative aspect-[3/4] bg-slate-100 rounded-xl overflow-hidden border border-slate-200/60 flex items-center justify-center">
                    <img
                      src={page.src}
                      alt={`Page ${idx + 1}`}
                      className="w-full h-full object-contain"
                    />
                    {isCurrent && (
                      <div className="absolute inset-0 bg-indigo-600/10 backdrop-blur-[1px] flex items-center justify-center">
                        <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs">
                          Active
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Bottom Navigation Bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-xl rounded-2xl px-3 py-1.5 flex items-center space-x-2 text-slate-700">
        {/* Toggle Page Drawer */}
        <button
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className={`p-2 rounded-xl transition-colors flex items-center space-x-1 cursor-pointer ${
            isDrawerOpen
              ? "bg-indigo-50 text-indigo-600 font-bold"
              : "hover:bg-slate-100 text-slate-600"
          }`}
          title="Toggle Page Drawer"
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
        {onRotatePage && pdfPages[currentPageIndex] && (
          <button
            onClick={() => onRotatePage(pdfPages[currentPageIndex].id)}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
            title="Rotate Page 90°"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        )}

        {/* Insert Page */}
        {onInsertBlankPage && (
          <button
            onClick={onInsertBlankPage}
            className="p-2 rounded-xl hover:bg-indigo-50 text-indigo-600 transition-colors flex items-center space-x-1 cursor-pointer"
            title="Insert Blank Page"
          >
            <Plus className="w-4 h-4" />
            <span className="text-xs font-semibold hidden md:inline">Add Page</span>
          </button>
        )}

        {/* Export Annotated PDF */}
        {onExportPdf && (
          <button
            onClick={onExportPdf}
            disabled={isExporting}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
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
