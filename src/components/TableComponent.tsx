import React, { useState, useRef, useEffect } from "react";
import { TableElement } from "../types";
import {
  Plus,
  Minus,
  Trash2,
  Lock,
  Unlock,
  Smile,
  Check,
  Palette,
  Type as TypeIcon,
  Layout,
  Grid,
  GripHorizontal,
} from "lucide-react";

interface TableComponentProps {
  element: TableElement;
  isSelected: boolean;
  isReadOnly?: boolean;
  onUpdate: (updated: Partial<TableElement>) => void;
  onDelete?: () => void;
  onSelect?: (id: string, e?: any) => void;
}

const TABLE_THEMES = [
  { name: "Default Slate", headerBg: "#f1f5f9", cellBg: "#ffffff", border: "#cbd5e1", text: "#0f172a" },
  { name: "Ocean Blue", headerBg: "#dbeafe", cellBg: "#ffffff", border: "#93c5fd", text: "#1e3a8a" },
  { name: "Emerald Mint", headerBg: "#d1fae5", cellBg: "#ffffff", border: "#6ee7b7", text: "#064e3b" },
  { name: "Amber Warm", headerBg: "#fef3c7", cellBg: "#ffffff", border: "#fcd34d", text: "#78350f" },
  { name: "Purple Dream", headerBg: "#f3e8ff", cellBg: "#ffffff", border: "#c084fc", text: "#581c87" },
  { name: "Rose Soft", headerBg: "#ffe4e6", cellBg: "#ffffff", border: "#fda4af", text: "#881337" },
  { name: "Dark Modern", headerBg: "#334155", cellBg: "#1e293b", border: "#475569", text: "#f8fafc" },
];

export const TableComponent: React.FC<TableComponentProps> = ({
  element,
  isSelected,
  isReadOnly = false,
  onUpdate,
  onDelete,
  onSelect,
}) => {
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const cellInputRef = useRef<HTMLTextAreaElement | null>(null);

  const rows = element.rows || 3;
  const cols = element.cols || 3;
  const data = element.data || Array.from({ length: rows }, () => Array(cols).fill(""));
  const hasHeaderRow = element.hasHeaderRow ?? true;
  const fontSize = element.fontSize || 14;

  const currentTheme = {
    headerBg: element.headerBgColor || "#f1f5f9",
    cellBg: element.cellBgColor || "#ffffff",
    border: element.borderColor || "#cbd5e1",
    text: element.textColor || "#0f172a",
  };

  // Focus textarea when editing cell changes
  useEffect(() => {
    if (editingCell && cellInputRef.current) {
      cellInputRef.current.focus();
      cellInputRef.current.select();
    }
  }, [editingCell]);

  const handleCellChange = (r: number, c: number, value: string) => {
    const newData = data.map((rowArr, rowIndex) => {
      if (rowIndex !== r) return [...rowArr];
      const newRow = [...rowArr];
      newRow[c] = value;
      return newRow;
    });
    onUpdate({ data: newData, updatedAt: Date.now() });
  };

  const handleKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    e.stopPropagation();
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (c > 0) {
          setEditingCell({ r, c: c - 1 });
        } else if (r > 0) {
          setEditingCell({ r: r - 1, c: cols - 1 });
        }
      } else {
        if (c < cols - 1) {
          setEditingCell({ r, c: c + 1 });
        } else if (r < rows - 1) {
          setEditingCell({ r: r + 1, c: 0 });
        }
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (r < rows - 1) {
        setEditingCell({ r: r + 1, c });
      } else {
        setEditingCell(null);
      }
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const setRowsDirectly = (targetRows: number) => {
    if (isReadOnly || targetRows < 1) return;
    let newData = [...data];
    if (targetRows > rows) {
      for (let r = rows; r < targetRows; r++) {
        newData.push(Array(cols).fill(""));
      }
    } else if (targetRows < rows) {
      newData = newData.slice(0, targetRows);
    }
    const heightChange = (targetRows - rows) * 40;
    onUpdate({
      rows: targetRows,
      data: newData,
      height: Math.max(80, element.height + heightChange),
      updatedAt: Date.now(),
    });
  };

  const setColsDirectly = (targetCols: number) => {
    if (isReadOnly || targetCols < 1) return;
    let newData = data.map((rowArr) => {
      let newRow = [...rowArr];
      if (targetCols > cols) {
        for (let c = cols; c < targetCols; c++) {
          newRow.push("");
        }
      } else if (targetCols < cols) {
        newRow = newRow.slice(0, targetCols);
      }
      return newRow;
    });
    const widthChange = (targetCols - cols) * 100;
    onUpdate({
      cols: targetCols,
      data: newData,
      width: Math.max(120, element.width + widthChange),
      updatedAt: Date.now(),
    });
  };

  const addRow = () => {
    setRowsDirectly(rows + 1);
  };

  const removeRow = () => {
    if (rows > 1) setRowsDirectly(rows - 1);
  };

  const addColumn = () => {
    setColsDirectly(cols + 1);
  };

  const removeColumn = () => {
    if (cols > 1) setColsDirectly(cols - 1);
  };

  const toggleHeaderRow = () => {
    if (isReadOnly) return;
    onUpdate({
      hasHeaderRow: !hasHeaderRow,
      updatedAt: Date.now(),
    });
  };

  const applyTheme = (theme: typeof TABLE_THEMES[0]) => {
    onUpdate({
      headerBgColor: theme.headerBg,
      cellBgColor: theme.cellBg,
      borderColor: theme.border,
      textColor: theme.text,
      updatedAt: Date.now(),
    });
    setShowColorMenu(false);
  };

  const changeFontSize = (delta: number) => {
    const newSize = Math.min(32, Math.max(10, fontSize + delta));
    onUpdate({ fontSize: newSize, updatedAt: Date.now() });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (onSelect) {
      onSelect(element.id, e);
    }
  };

  const handleResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const event = new CustomEvent("init-resize", {
      detail: {
        elementId: element.id,
        originalEvent: e,
      },
    });
    window.dispatchEvent(event);
  };

  return (
    <div
      id={`table-element-${element.id}`}
      className="absolute group touch-none select-none transition-shadow"
      style={{
        left: `${element.x}px`,
        top: `${element.y}px`,
        width: `${element.width}px`,
        height: `${element.height}px`,
        zIndex: element.zIndex,
      }}
      onPointerDown={handleMouseDownWrapper}
    >
      {/* Table Element Wrapper Container */}
      <div
        className={`w-full h-full rounded-xl overflow-hidden flex flex-col border transition-all ${
          isSelected
            ? "ring-2 ring-blue-500 shadow-lg"
            : "hover:shadow-md shadow-xs"
        }`}
        style={{
          borderColor: currentTheme.border,
          backgroundColor: currentTheme.cellBg,
        }}
      >
        {/* Top Drag Handle Bar for Easy Mobile & Desktop Moving */}
        <div
          className="w-full bg-slate-100/90 hover:bg-slate-200/90 border-b border-slate-200/80 px-2 py-1 flex items-center justify-between cursor-move touch-none select-none shrink-0"
          onPointerDown={(e) => {
            e.stopPropagation();
            if (onSelect) onSelect(element.id, e);
          }}
          title="Drag to move table"
        >
          <div className="flex items-center gap-1.5 text-slate-500">
            <GripHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-bold text-[10px] tracking-wider uppercase text-slate-600">
              Table ({rows}×{cols})
            </span>
          </div>
          {isSelected && (
            <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold uppercase">
              Selected
            </span>
          )}
        </div>

        {/* Floating Action Bar when Selected */}
        {isSelected && !isReadOnly && (
          <div
            className="absolute -top-12 left-0 z-50 flex items-center gap-1.5 bg-white/95 backdrop-blur-md px-2 py-1 rounded-xl border border-slate-200 shadow-xl text-xs font-sans text-slate-700 pointer-events-auto select-none transition-all animate-fade-in"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Rows Control with Direct Numeric Input */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <span className="text-[10px] font-bold text-slate-500 px-0.5 uppercase">R:</span>
              <input
                type="number"
                min={1}
                max={100}
                value={rows}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1) {
                    setRowsDirectly(val);
                  }
                }}
                className="w-9 px-1 py-0.5 text-xs font-mono font-bold bg-white border border-slate-200 rounded text-slate-800 outline-none focus:border-blue-500 text-center"
                title="Exact Row Count"
              />
              <button
                onClick={addRow}
                className="p-1 hover:bg-white rounded text-slate-700 hover:text-blue-600 transition-colors cursor-pointer"
                title="Add Row"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={removeRow}
                disabled={rows <= 1}
                className="p-1 hover:bg-white disabled:opacity-30 rounded text-slate-700 hover:text-rose-600 transition-colors cursor-pointer"
                title="Remove Bottom Row"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-4 bg-slate-200" />

            {/* Cols Control with Direct Numeric Input */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <span className="text-[10px] font-bold text-slate-500 px-0.5 uppercase">C:</span>
              <input
                type="number"
                min={1}
                max={100}
                value={cols}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1) {
                    setColsDirectly(val);
                  }
                }}
                className="w-9 px-1 py-0.5 text-xs font-mono font-bold bg-white border border-slate-200 rounded text-slate-800 outline-none focus:border-blue-500 text-center"
                title="Exact Column Count"
              />
              <button
                onClick={addColumn}
                className="p-1 hover:bg-white rounded text-slate-700 hover:text-blue-600 transition-colors cursor-pointer"
                title="Add Column"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={removeColumn}
                disabled={cols <= 1}
                className="p-1 hover:bg-white disabled:opacity-30 rounded text-slate-700 hover:text-rose-600 transition-colors cursor-pointer"
                title="Remove Rightmost Column"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-4 bg-slate-200" />

            {/* Toggle Header Row */}
            <button
              onClick={toggleHeaderRow}
              className={`px-1.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                hasHeaderRow
                  ? "bg-blue-100 text-blue-700 font-bold"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title="Toggle Header Row Formatting"
            >
              Header
            </button>

            <div className="w-px h-4 bg-slate-200" />

            {/* Font Size Adjust */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => changeFontSize(-1)}
                className="p-1 hover:bg-white rounded text-slate-700 transition-colors cursor-pointer"
                title="Decrease Text Size"
              >
                <TypeIcon className="w-3 h-3 scale-90" />
              </button>
              <span className="text-[10px] font-mono px-1">{fontSize}px</span>
              <button
                onClick={() => changeFontSize(1)}
                className="p-1 hover:bg-white rounded text-slate-700 transition-colors cursor-pointer"
                title="Increase Text Size"
              >
                <TypeIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-4 bg-slate-200" />

            {/* Theme / Palette Button */}
            <div className="relative">
              <button
                onClick={() => setShowColorMenu(!showColorMenu)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-700 hover:text-blue-600 transition-colors cursor-pointer flex items-center gap-1"
                title="Table Color Theme"
              >
                <Palette className="w-3.5 h-3.5" />
              </button>

              {/* Color Theme Dropdown */}
              {showColorMenu && (
                <div className="absolute top-8 left-0 bg-white rounded-xl border border-slate-200 shadow-2xl p-2 z-50 w-48 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Themes</span>
                  {TABLE_THEMES.map((theme) => (
                    <button
                      key={theme.name}
                      onClick={() => applyTheme(theme)}
                      className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-left text-xs text-slate-700 cursor-pointer"
                    >
                      <div
                        className="w-4 h-4 rounded-md border border-slate-300 shrink-0"
                        style={{ backgroundColor: theme.headerBg }}
                      />
                      <span className="flex-1 text-[11px] font-medium">{theme.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-4 bg-slate-200" />

            {/* Lock / Unlock */}
            <button
              onClick={() => onUpdate({ locked: !element.locked })}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                element.locked ? "bg-amber-100 text-amber-700" : "hover:bg-slate-100 text-slate-600"
              }`}
              title={element.locked ? "Unlock Table" : "Lock Table"}
            >
              {element.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>

            {/* Delete Table */}
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-600 transition-colors cursor-pointer"
                title="Delete Table"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Interactive Rendered Grid Table */}
        <div className="w-full h-full overflow-auto scrollbar-thin">
          <table
            className="w-full h-full border-collapse"
            style={{
              borderColor: currentTheme.border,
              color: currentTheme.text,
              fontSize: `${fontSize}px`,
            }}
          >
            <tbody>
              {Array.from({ length: rows }).map((_, r) => {
                const isHeader = hasHeaderRow && r === 0;
                return (
                  <tr
                    key={r}
                    style={{
                      backgroundColor: isHeader ? currentTheme.headerBg : currentTheme.cellBg,
                    }}
                  >
                    {Array.from({ length: cols }).map((_, c) => {
                      const cellText = data[r]?.[c] || "";
                      const isEditing = editingCell?.r === r && editingCell?.c === c;

                      return (
                        <td
                          key={c}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isReadOnly && !element.locked) {
                              setEditingCell({ r, c });
                            }
                          }}
                          className={`p-2 border border-slate-300 relative min-w-[60px] align-top transition-colors ${
                            isHeader ? "font-bold text-center select-none" : ""
                          } ${isEditing ? "bg-blue-50/80 ring-2 ring-blue-500 z-10" : "hover:bg-blue-50/30 cursor-text"}`}
                          style={{
                            borderColor: currentTheme.border,
                            color: currentTheme.text,
                          }}
                        >
                          {isEditing ? (
                            <textarea
                              ref={cellInputRef}
                              value={cellText}
                              onChange={(e) => handleCellChange(r, c, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(e, r, c)}
                              onBlur={() => setEditingCell(null)}
                              className="w-full h-full min-h-[30px] p-1 bg-transparent border-none outline-none resize-none font-inherit text-inherit focus:ring-0 leading-tight"
                              style={{ fontSize: `${fontSize}px` }}
                              placeholder={isHeader ? `Header ${c + 1}` : ""}
                            />
                          ) : (
                            <div className="w-full h-full min-h-[24px] whitespace-pre-wrap break-words leading-snug">
                              {cellText || (
                                <span className="opacity-30 italic text-[11px] font-normal">
                                  {isHeader ? `Header ${c + 1}` : ""}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resize Handle at Bottom-Right Corner */}
      {isSelected && !isReadOnly && !element.locked && (
        <div
          className="absolute -bottom-2 -right-2 w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-md cursor-nwse-resize z-30 hover:scale-125 transition-transform"
          onPointerDown={handleResizeStart}
        />
      )}
    </div>
  );

  function handleMouseDownWrapper(e: React.PointerEvent) {
    if (editingCell) return;
    handlePointerDown(e);
  }
};

