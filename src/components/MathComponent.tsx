import React, { useState, useRef, useEffect } from 'react';
import { MathElement, UserProfile } from '../types';
import { 
  Trash2, Lock, Unlock, Calculator, Palette, Square, Copy, ChevronDown, Sparkles 
} from 'lucide-react';
import katex from 'katex';

interface MathComponentProps {
  element: MathElement;
  isSelected: boolean;
  currentUser: UserProfile;
  zoom: number;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (updates: Partial<MathElement>) => void;
  onDelete: () => void;
  isDraggingOrResizing: boolean;
  activeTool?: string;
  canWrite?: boolean;
}

const EMOJIS = ['👍', '❤️', '🔥', '💡', '❓', '🎉'];

const MATH_COLORS = [
  { name: 'Deep Indigo', value: '#1e1b4b' },
  { name: 'Charcoal', value: '#1e293b' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Amber', value: '#d97706' },
  { name: 'Emerald', value: '#16a34a' },
];

const FILL_COLORS = [
  { name: 'Soft Indigo', value: '#e0e7ff' },
  { name: 'Soft Purple', value: '#f3e8ff' },
  { name: 'Soft Blue', value: '#dbeafe' },
  { name: 'Soft Green', value: '#dcfce7' },
  { name: 'Soft Yellow', value: '#fef08a' },
  { name: 'Soft Pink', value: '#fce7f3' },
  { name: 'White', value: '#ffffff' },
  { name: 'Soft Slate', value: '#f8fafc' },
  { name: 'None', value: 'transparent' },
];

interface MathTemplate {
  label: string;
  latex: string;
  description: string;
}

const MATH_TEMPLATES: MathTemplate[] = [
  { label: 'Fraction', latex: '\\frac{a}{b}', description: 'Simple fraction' },
  { label: 'Square Root', latex: '\\sqrt{x}', description: 'Square root operator' },
  { label: 'Exponent', latex: 'x^{n}', description: 'Power / Superscript' },
  { label: 'Subscript', latex: 'x_{i}', description: 'Subscript indicator' },
  { label: 'Integral', latex: '\\int_{a}^{b} f(x) \\, dx', description: 'Definite integral' },
  { label: 'Summation', latex: '\\sum_{i=1}^{n} i', description: 'Sigma summation' },
  { label: 'Limit', latex: '\\lim_{x \\to 0} f(x)', description: 'Limit notation' },
  { label: 'Quadratic', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', description: 'Quadratic formula' },
  { label: 'Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', description: '2x2 Matrix' },
  { label: 'Cases', latex: '\\begin{cases} x + y = 2 \\\\ x - y = 0 \\end{cases}', description: 'System of equations' },
];

export default function MathComponent({
  element,
  isSelected,
  currentUser,
  zoom,
  onSelect,
  onUpdate,
  onDelete,
  isDraggingOrResizing,
  activeTool = 'select',
  canWrite = true
}: MathComponentProps) {
  const [isEditing, setIsEditing] = useState(() => element.text === '' && canWrite && !element.locked);
  const [text, setText] = useState(element.text);
  const [activePopover, setActivePopover] = useState<'color' | 'fill' | 'border' | 'templates' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [katexError, setKatexError] = useState<string | null>(null);

  useEffect(() => {
    setText(element.text);
  }, [element.text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      if (text.length > 0) {
        textareaRef.current.select();
      }
    }
  }, [isEditing]);

  useEffect(() => {
    if (!canWrite) {
      setIsEditing(false);
      setActivePopover(null);
    }
  }, [canWrite]);

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    // If focus is moving to the formatting toolbar, keep editing!
    if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest('.lucidspark-action-bar')) {
      return;
    }
    setIsEditing(false);
    setActivePopover(null);
    if (text !== element.text) {
      onUpdate({ text: text });
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    
    // Live KaTeX syntax check
    try {
      if (val.trim()) {
        katex.renderToString(val, { throwOnError: true });
      }
      setKatexError(null);
    } catch (err: any) {
      setKatexError(err.message || 'Syntax error');
    }
  };

  const handleEmojiClick = (emoji: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentReactions = element.reactions || {};
    const users = currentReactions[emoji] || [];

    let newUsers: string[];
    if (users.includes(currentUser.name)) {
      newUsers = users.filter((u) => u !== currentUser.name);
    } else {
      newUsers = [...users, currentUser.name];
    }

    const updatedReactions = { ...currentReactions };
    if (newUsers.length === 0) {
      delete updatedReactions[emoji];
    } else {
      updatedReactions[emoji] = newUsers;
    }

    onUpdate({ reactions: updatedReactions });
  };

  const insertTemplate = (latex: string) => {
    if (!textareaRef.current) {
      const newText = text ? text + " " + latex : latex;
      setText(newText);
      onUpdate({ text: newText });
      return;
    }
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newText = text.substring(0, start) + latex + text.substring(end);
    setText(newText);
    onUpdate({ text: newText });
    
    // Keep focus and select inserted template
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, start + latex.length);
      }
    }, 50);
  };

  const cursorClass = element.locked
    ? 'cursor-default'
    : activeTool === 'select' 
      ? 'cursor-grab active:cursor-grabbing' 
      : activeTool === 'eraser' 
        ? 'cursor-pointer hover:bg-rose-50 hover:ring-2 hover:ring-rose-500 hover:ring-offset-1 transition-all' 
        : 'cursor-default';

  // Memoize Compiled KaTeX HTML to prevent expensive re-parsing on every pointer drag event
  const memoizedKatexHtml = React.useMemo(() => {
    const rawLatex = element.text || "f(x) = x^2";
    try {
      return katex.renderToString(rawLatex, {
        throwOnError: false,
        displayMode: true,
        trust: false,
      });
    } catch (err) {
      return null;
    }
  }, [element.text]);

  // Render KaTeX HTML
  const renderKaTeX = () => {
    const rawLatex = element.text || "f(x) = x^2";
    if (memoizedKatexHtml) {
      return (
        <div 
          className="katex-container select-text cursor-text flex items-center justify-center w-full h-full overflow-auto text-slate-800"
          style={{ 
            fontSize: `${element.fontSize || 20}px`,
            color: element.color || '#1e1b4b'
          }}
          dangerouslySetInnerHTML={{ __html: memoizedKatexHtml }}
        />
      );
    }
    return (
      <div className="text-rose-500 text-xs font-mono break-all p-1">
        {rawLatex}
      </div>
    );
  };

  return (
    <div
      onPointerDown={onSelect}
      className={`absolute select-none flex flex-col justify-between transition-shadow duration-150 rounded-2xl group p-3 ${cursorClass} ${
        isSelected ? 'ring-2 ring-blue-500 bg-blue-50/20 shadow-md' : 'hover:bg-slate-50/40'
      }`}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        backgroundColor: element.backgroundColor || '#e0e7ff',
        borderColor: element.borderColor || (isSelected ? '#3b82f6' : '#6366f1'),
        borderStyle: element.borderStyle || 'solid',
        borderWidth: element.borderStyle && element.borderStyle !== 'none' ? `${element.borderWidth || 1}px` : '1px',
        zIndex: isSelected ? 40 : (element.zIndex ?? 10),
      }}
      id={`math-${element.id}`}
    >
      <div className="flex-1 relative w-full h-full overflow-hidden flex items-center justify-center">
        {isEditing && !element.locked ? (
          <div className="w-full h-full flex flex-col space-y-1">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onBlur={handleBlur}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              className="w-full flex-1 bg-white/80 border border-slate-300 rounded-lg p-2 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
              style={{ color: element.color || '#1e1b4b' }}
              placeholder="Enter LaTeX equation..."
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  textareaRef.current?.blur();
                }
              }}
            />
            {katexError && (
              <span className="text-[10px] text-rose-500 font-semibold px-1 truncate">
                {katexError}
              </span>
            )}
          </div>
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!canWrite || element.locked) return;
              setIsEditing(true);
            }}
            className="w-full h-full flex items-center justify-center select-text"
          >
            {renderKaTeX()}
          </div>
        )}
      </div>

      {/* Floating Formatting Action Bar */}
      {isSelected && !isDraggingOrResizing && (
        <div 
          onPointerDown={(e) => { e.stopPropagation(); }} 
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl px-2 py-1.5 flex items-center space-x-1 flex-wrap md:flex-nowrap gap-y-1 z-40 animate-fade-in max-w-[95vw] lucidspark-action-bar"
        >
          {/* Reaction & Lock */}
          <div className="flex items-center space-x-0.5 pr-1.5 border-r border-slate-100 shrink-0">
            {canWrite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate({ locked: !element.locked });
                }}
                className={`p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer ${
                  element.locked ? 'text-amber-600 bg-amber-50' : 'text-slate-500'
                }`}
                title={element.locked ? 'Unlock' : 'Lock'}
              >
                {element.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
            )}

            {EMOJIS.slice(0, 3).map((emoji) => (
              <button
                key={emoji}
                onClick={(e) => handleEmojiClick(emoji, e)}
                className="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center text-xs transition-transform hover:scale-125 cursor-pointer"
              >
                {emoji}
              </button>
            ))}
          </div>

          {canWrite && !element.locked && (
            <>
              {/* LaTeX Quick Templates */}
              <div className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopover(activePopover === 'templates' ? null : 'templates');
                  }}
                  className="px-2 py-1 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center space-x-1 border border-slate-200/60 cursor-pointer"
                  title="Insert LaTeX Template"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500 mr-0.5" />
                  <span>Templates</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {activePopover === 'templates' && (
                  <div className="absolute top-9 left-0 bg-white border border-slate-200 rounded-xl shadow-xl p-1 z-50 flex flex-col w-52 max-h-60 overflow-y-auto animate-scale-up">
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      Latex Equation Presets
                    </div>
                    {MATH_TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.label}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isEditing) {
                            setIsEditing(true);
                            setTimeout(() => {
                              insertTemplate(tmpl.latex);
                            }, 50);
                          } else {
                            insertTemplate(tmpl.latex);
                          }
                          setActivePopover(null);
                        }}
                        className="px-2 py-1.5 rounded-lg text-xs text-left cursor-pointer hover:bg-slate-50 flex flex-col"
                      >
                        <span className="font-semibold text-slate-700">{tmpl.label}</span>
                        <span className="text-[10px] text-slate-400 font-mono truncate">{tmpl.latex}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* FontSize controls */}
              <div className="flex items-center space-x-0.5 border-r border-slate-100 pr-1.5 pl-0.5 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ fontSize: Math.max(12, (element.fontSize || 20) - 2) });
                  }}
                  className="p-1 hover:bg-slate-100 rounded-lg text-xs font-extrabold text-slate-600 cursor-pointer min-w-[22px]"
                  title="Smaller equation size"
                >
                  A-
                </button>
                <span className="text-[11px] text-slate-600 font-mono font-bold px-1 min-w-[24px] text-center">
                  {element.fontSize || 20}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ fontSize: Math.min(64, (element.fontSize || 20) + 2) });
                  }}
                  className="p-1 hover:bg-slate-100 rounded-lg text-xs font-extrabold text-slate-600 cursor-pointer min-w-[22px]"
                  title="Larger equation size"
                >
                  A+
                </button>
              </div>

              {/* Math Equation Formula Color Picker */}
              <div className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopover(activePopover === 'color' ? null : 'color');
                  }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 flex items-center space-x-1 cursor-pointer"
                  title="Formula Color"
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-xs"
                    style={{ backgroundColor: element.color || '#1e1b4b' }}
                  />
                  <span className="text-[11px] font-bold text-slate-500">Color</span>
                </button>

                {activePopover === 'color' && (
                  <div className="absolute top-9 left-0 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 z-50 grid grid-cols-5 gap-1.5 w-36 animate-scale-up">
                    {MATH_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={(e) => {
                          e.stopPropagation();
                           onUpdate({ color: c.value });
                          setActivePopover(null);
                        }}
                        className="w-6 h-6 rounded-full border border-slate-200 hover:scale-110 transition-transform cursor-pointer flex items-center justify-center"
                        style={{ backgroundColor: c.value }}
                        title={c.name}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Fill / Background Color Picker */}
              <div className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopover(activePopover === 'fill' ? null : 'fill');
                  }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 flex items-center space-x-1 cursor-pointer"
                  title="Callout Fill Color"
                >
                  <Palette className="w-3.5 h-3.5 text-slate-600" />
                  <div
                    className="w-3 h-3 rounded border border-slate-300 shadow-xs"
                    style={{ backgroundColor: element.backgroundColor || '#e0e7ff' }}
                  />
                </button>

                {activePopover === 'fill' && (
                  <div className="absolute top-9 left-0 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 z-50 grid grid-cols-5 gap-1.5 w-36 animate-scale-up">
                    {FILL_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdate({ backgroundColor: c.value });
                          setActivePopover(null);
                        }}
                        className="w-6 h-6 rounded-md border border-slate-200 hover:scale-110 transition-transform cursor-pointer flex items-center justify-center relative"
                        style={{ backgroundColor: c.value }}
                        title={c.name}
                      >
                        {c.value === 'transparent' && (
                          <div className="w-full h-0.5 bg-rose-500 rotate-45" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Border Style Toggle */}
              <div className="relative shrink-0 pr-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextStyle = element.borderStyle === 'solid' ? 'dashed' : element.borderStyle === 'dashed' ? 'none' : 'solid';
                    onUpdate({ borderStyle: nextStyle, borderColor: element.borderColor || '#6366f1', borderWidth: 1 });
                  }}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    element.borderStyle && element.borderStyle !== 'none' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  title={`Border Style: ${element.borderStyle || 'solid'}`}
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}

          {canWrite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-600 transition-colors flex items-center border-l border-slate-100 pl-1.5 shrink-0 cursor-pointer"
              title="Delete math equation callout"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Reactions badges underneath */}
      <div 
        onPointerDown={(e) => e.stopPropagation()} 
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute -bottom-5 left-1 flex flex-wrap gap-1 z-10"
      >
        {Object.entries(element.reactions || {}).map(([emoji, users]) => (
          <div
            key={emoji}
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white border border-slate-100 shadow-xs text-slate-500"
            title={users.join(', ')}
          >
            <span>{emoji}</span>
            <span className="text-[9px] ml-0.5">{users.length}</span>
          </div>
        ))}
      </div>

      {/* Resize handles */}
      {isSelected && canWrite && !element.locked && (
        <div
          className="absolute -bottom-2 -right-2 w-8 h-8 cursor-se-resize flex items-center justify-center pointer-events-auto z-30"
          onPointerDown={(e) => {
            e.stopPropagation();
            const canvasEvent = new CustomEvent('init-resize', {
              detail: { elementId: element.id, originalEvent: { clientX: e.clientX, clientY: e.clientY } }
            });
            window.dispatchEvent(canvasEvent);
          }}
        >
          <div className="w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-md hover:scale-125 transition-transform" />
        </div>
      )}
    </div>
  );
}
