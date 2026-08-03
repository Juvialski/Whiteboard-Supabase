import React, { useState, useRef, useEffect } from 'react';
import { TextElement, UserProfile } from '../types';
import { 
  Trash2, Lock, Unlock, AlignLeft, AlignCenter, AlignRight, 
  Bold, Italic, Underline, Strikethrough, Type, Palette, 
  Square, Copy, ChevronDown 
} from 'lucide-react';

interface TextComponentProps {
  element: TextElement;
  isSelected: boolean;
  currentUser: UserProfile;
  zoom: number;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (updates: Partial<TextElement>) => void;
  onDelete: () => void;
  isDraggingOrResizing: boolean;
  activeTool?: string;
  canWrite?: boolean;
}

const EMOJIS = ['👍', '❤️', '🔥', '💡', '❓', '🎉'];

interface FontFamilyOption {
  id: 'sans' | 'serif' | 'mono' | 'handwritten' | 'display';
  name: string;
  fontClass?: string;
  fontStyleObj?: React.CSSProperties;
}

const FONT_FAMILIES: FontFamilyOption[] = [
  { id: 'sans', name: 'Sans', fontStyleObj: { fontFamily: "'Plus Jakarta Sans', sans-serif" } },
  { id: 'serif', name: 'Serif', fontStyleObj: { fontFamily: "'EB Garamond', serif" } },
  { id: 'mono', name: 'Mono', fontStyleObj: { fontFamily: "'Fira Code', monospace" } },
  { id: 'handwritten', name: 'Handdrawn', fontStyleObj: { fontFamily: "'Caveat', cursive, sans-serif" } },
  { id: 'display', name: 'Display', fontStyleObj: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800 } }
];

const TEXT_COLORS = [
  { name: 'Charcoal', value: '#1e293b' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Amber', value: '#d97706' },
  { name: 'Emerald', value: '#16a34a' },
  { name: 'White', value: '#ffffff' },
];

const FILL_COLORS = [
  { name: 'None', value: 'transparent' },
  { name: 'White', value: '#ffffff' },
  { name: 'Soft Slate', value: '#f8fafc' },
  { name: 'Soft Yellow', value: '#fef08a' },
  { name: 'Soft Green', value: '#dcfce7' },
  { name: 'Soft Blue', value: '#dbeafe' },
  { name: 'Soft Purple', value: '#f3e8ff' },
  { name: 'Soft Pink', value: '#fce7f3' },
  { name: 'Dark Slate', value: '#1e293b' },
];

const parseRichText = (str: string): React.ReactNode => {
  if (!str) return '';

  const regex = /(\*\*.*?\*\*|\*.*?\*|~~.*?~~|<u>.*?<\/u>|<span style="[^"]*">.*?<\/span>)/gs;
  const parts = str.split(regex);
  
  if (parts.length === 1) {
    return str;
  }
  
  return parts.map((part, index) => {
    if (!part) return null;
    
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2);
      return <strong key={index} className="font-bold">{parseRichText(inner)}</strong>;
    }
    
    if (part.startsWith('*') && part.endsWith('*')) {
      const inner = part.slice(1, -1);
      return <em key={index} className="italic">{parseRichText(inner)}</em>;
    }
    
    if (part.startsWith('~~') && part.endsWith('~~')) {
      const inner = part.slice(2, -2);
      return <del key={index} className="line-through">{parseRichText(inner)}</del>;
    }
    
    if (part.startsWith('<u>') && part.endsWith('</u>')) {
      const inner = part.slice(3, -4);
      return <span key={index} className="underline">{parseRichText(inner)}</span>;
    }
    
    if (part.startsWith('<span style="') && part.endsWith('</span>')) {
      const styleMatch = part.match(/style="([^"]*)"/);
      const innerMatch = part.match(/>(.*?)<\/span>/s);
      const styleStr = styleMatch ? styleMatch[1] : '';
      const inner = innerMatch ? innerMatch[1] : '';
      
      const styleObj: React.CSSProperties = {};
      if (styleStr) {
        const colorMatch = styleStr.match(/color:\s*([^;"]+)/);
        const sizeMatch = styleStr.match(/font-size:\s*([^;"]+)/);
        if (colorMatch) styleObj.color = colorMatch[1].trim();
        if (sizeMatch) styleObj.fontSize = sizeMatch[1].trim();
      }
      
      return <span key={index} style={styleObj}>{parseRichText(inner)}</span>;
    }
    
    return part;
  });
};

export default function TextComponent({
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
}: TextComponentProps) {
  // Auto-edit newly created empty text boxes
  const [isEditing, setIsEditing] = useState(() => element.text === '' && canWrite && !element.locked);
  const [text, setText] = useState(element.text);
  const [activePopover, setActivePopover] = useState<'font' | 'color' | 'fill' | 'border' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Adjust height on text change to prevent vertical truncation without scrolling/reflow jumps
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const scrollHeight = textareaRef.current.scrollHeight;
      if (scrollHeight > element.height) {
        onUpdate({ height: Math.max(scrollHeight + 16, 40) });
      }
    }
  }, [text, isEditing, element.height]);

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
    setText(e.target.value);
  };

  const handleFormatSelection = (
    type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'fontSize' | 'color',
    value?: string | number
  ) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    
    if (start === end) {
      if (type === 'bold') {
        onUpdate({ fontWeight: isBold ? 'normal' : 'bold' });
      } else if (type === 'italic') {
        onUpdate({ fontStyle: isItalic ? 'normal' : 'italic' });
      } else if (type === 'underline') {
        onUpdate({ textDecoration: isUnderline ? 'none' : 'underline' });
      } else if (type === 'strikethrough') {
        onUpdate({ textDecoration: isStrikethrough ? 'none' : 'line-through' });
      } else if (type === 'fontSize') {
        onUpdate({ fontSize: value as number });
      } else if (type === 'color') {
        onUpdate({ color: value as string });
      }
      return;
    }

    const selectedText = text.substring(start, end);
    let formattedText = '';
    
    if (type === 'bold') {
      formattedText = `**${selectedText}**`;
    } else if (type === 'italic') {
      formattedText = `*${selectedText}*`;
    } else if (type === 'underline') {
      formattedText = `<u>${selectedText}</u>`;
    } else if (type === 'strikethrough') {
      formattedText = `~~${selectedText}~~`;
    } else if (type === 'fontSize') {
      formattedText = `<span style="font-size: ${value}px">${selectedText}</span>`;
    } else if (type === 'color') {
      formattedText = `<span style="color: ${value}">${selectedText}</span>`;
    }
    
    const newText = text.substring(0, start) + formattedText + text.substring(end);
    setText(newText);
    onUpdate({ text: newText });
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, start + formattedText.length);
      }
    }, 50);
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

  const currentFontFamily = FONT_FAMILIES.find(f => f.id === element.fontFamily) || FONT_FAMILIES[0];

  const getFontFamilyStyle = () => {
    switch (element.fontFamily) {
      case 'serif':
        return { fontFamily: "'EB Garamond', serif" };
      case 'mono':
        return { fontFamily: "'Fira Code', monospace" };
      case 'handwritten':
        return { fontFamily: "'Caveat', cursive, sans-serif" };
      case 'display':
        return { fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800 };
      case 'sans':
      default:
        return { fontFamily: "'Plus Jakarta Sans', sans-serif" };
    }
  };

  const getFontFamilyClass = () => {
    return '';
  };

  const cursorClass = element.locked
    ? 'cursor-default'
    : activeTool === 'select' 
      ? 'cursor-grab active:cursor-grabbing' 
      : activeTool === 'eraser' 
        ? 'cursor-pointer hover:bg-rose-50 hover:ring-2 hover:ring-rose-500 hover:ring-offset-1 transition-all' 
        : 'cursor-default';

  const isBold = element.fontWeight === 'bold';
  const isItalic = element.fontStyle === 'italic';
  const isUnderline = element.textDecoration === 'underline';
  const isStrikethrough = element.textDecoration === 'line-through';

  const textAlignClass = element.textAlign === 'center' 
    ? 'text-center' 
    : element.textAlign === 'right' 
      ? 'text-right' 
      : 'text-left';

  return (
    <div
      onPointerDown={onSelect}
      className={`absolute select-none flex flex-col justify-between transition-shadow duration-150 rounded-xl group p-2.5 ${cursorClass} ${
        isSelected ? 'ring-2 ring-blue-500 bg-blue-50/20 shadow-md' : 'hover:bg-slate-50/40'
      }`}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        backgroundColor: element.backgroundColor || 'transparent',
        borderColor: element.borderColor || (isSelected ? '#3b82f6' : 'transparent'),
        borderStyle: element.borderStyle || 'none',
        borderWidth: element.borderStyle && element.borderStyle !== 'none' ? `${element.borderWidth || 1}px` : '0px',
        zIndex: isSelected ? 40 : (element.zIndex ?? 10),
      }}
      id={`text-${element.id}`}
    >
      <div className="flex-1 relative w-full h-full overflow-hidden">
        {isEditing && !element.locked ? (
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
            className={`w-full h-full bg-transparent border-none resize-none focus:outline-none p-1 ${getFontFamilyClass()} ${textAlignClass}`}
            style={{ 
              fontSize: `${element.fontSize || 16}px`, 
              color: element.color || '#1e293b',
              fontWeight: isBold ? 'bold' : 'normal',
              fontStyle: isItalic ? 'italic' : 'normal',
              textDecoration: isUnderline ? 'underline' : isStrikethrough ? 'line-through' : 'none',
              ...getFontFamilyStyle()
            }}
            placeholder="Type text..."
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                textareaRef.current?.blur();
              }
            }}
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!canWrite || element.locked) return;
              setIsEditing(true);
            }}
            className={`w-full h-full break-words overflow-y-auto select-text cursor-text p-1 ${getFontFamilyClass()} ${textAlignClass}`}
            style={{ 
              fontSize: `${element.fontSize || 16}px`, 
              color: element.color || '#1e293b', 
              whiteSpace: 'pre-wrap',
              fontWeight: isBold ? 'bold' : 'normal',
              fontStyle: isItalic ? 'italic' : 'normal',
              textDecoration: isUnderline ? 'underline' : isStrikethrough ? 'line-through' : 'none',
              ...getFontFamilyStyle()
            }}
          >
            {element.text ? parseRichText(element.text) : (canWrite ? <span className="opacity-30 italic text-xs font-normal">Double click to type text</span> : '')}
          </div>
        )}
      </div>

      {/* Floating Lucidspark Formatting Action Bar */}
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
                title={element.locked ? 'Unlock Text' : 'Lock Text'}
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
              {/* Font Family Picker */}
              <div className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopover(activePopover === 'font' ? null : 'font');
                  }}
                  className="px-2 py-1 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center space-x-1 border border-slate-200/60 cursor-pointer"
                  title="Font Family"
                >
                  <span>{currentFontFamily.name}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {activePopover === 'font' && (
                  <div className="absolute top-9 left-0 bg-white border border-slate-200 rounded-xl shadow-xl p-1 z-50 flex flex-col w-28 animate-scale-up">
                    {FONT_FAMILIES.map((fam) => (
                      <button
                        key={fam.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdate({ fontFamily: fam.id as any });
                          setActivePopover(null);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-xs text-left cursor-pointer flex items-center justify-between ${
                          element.fontFamily === fam.id ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span className={fam.fontClass || ''} style={fam.fontStyleObj || {}}>
                          {fam.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-0.5 border-r border-slate-100 pr-1.5 pl-0.5 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentSize = element.fontSize || 16;
                    const nextSize = Math.max(12, currentSize - 2);
                    if (textareaRef.current && textareaRef.current.selectionStart !== textareaRef.current.selectionEnd) {
                      handleFormatSelection('fontSize', nextSize);
                    } else {
                      onUpdate({ fontSize: nextSize });
                    }
                  }}
                  className="p-1 hover:bg-slate-100 rounded-lg text-xs font-extrabold text-slate-600 cursor-pointer min-w-[22px]"
                  title="Smaller font"
                >
                  A-
                </button>
                <span className="text-[11px] text-slate-600 font-mono font-bold px-1 min-w-[24px] text-center">
                  {element.fontSize || 16}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const currentSize = element.fontSize || 16;
                    const nextSize = Math.min(64, currentSize + 2);
                    if (textareaRef.current && textareaRef.current.selectionStart !== textareaRef.current.selectionEnd) {
                      handleFormatSelection('fontSize', nextSize);
                    } else {
                      onUpdate({ fontSize: nextSize });
                    }
                  }}
                  className="p-1 hover:bg-slate-100 rounded-lg text-xs font-extrabold text-slate-600 cursor-pointer min-w-[22px]"
                  title="Larger font"
                >
                  A+
                </button>
              </div>

              {/* Text Styling: Bold, Italic, Underline, Strikethrough */}
              <div className="flex items-center space-x-0.5 border-r border-slate-100 pr-1.5 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFormatSelection('bold');
                  }}
                  className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isBold ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title="Bold"
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFormatSelection('italic');
                  }}
                  className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                    isItalic ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title="Italic"
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFormatSelection('underline');
                  }}
                  className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                    isUnderline ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title="Underline"
                >
                  <Underline className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFormatSelection('strikethrough');
                  }}
                  className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                    isStrikethrough ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title="Strikethrough"
                >
                  <Strikethrough className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Text Alignment */}
              <div className="flex items-center space-x-0.5 border-r border-slate-100 pr-1.5 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ textAlign: 'left' });
                  }}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    (element.textAlign || 'left') === 'left' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  title="Align Left"
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ textAlign: 'center' });
                  }}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    element.textAlign === 'center' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  title="Align Center"
                >
                  <AlignCenter className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ textAlign: 'right' });
                  }}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    element.textAlign === 'right' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  title="Align Right"
                >
                  <AlignRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopover(activePopover === 'color' ? null : 'color');
                  }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 flex items-center space-x-1 cursor-pointer"
                  title="Text Color"
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-xs"
                    style={{ backgroundColor: element.color || '#1e293b' }}
                  />
                  <Type className="w-3 h-3 text-slate-500" />
                </button>

                {activePopover === 'color' && (
                  <div className="absolute top-9 left-0 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 z-50 grid grid-cols-5 gap-1.5 w-36 animate-scale-up">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (textareaRef.current && textareaRef.current.selectionStart !== textareaRef.current.selectionEnd) {
                            handleFormatSelection('color', c.value);
                          } else {
                            onUpdate({ color: c.value });
                          }
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
                  title="Fill Color"
                >
                  <Palette className="w-3.5 h-3.5 text-slate-600" />
                  <div
                    className="w-3 h-3 rounded border border-slate-300 shadow-xs"
                    style={{ backgroundColor: element.backgroundColor || 'transparent' }}
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
                    onUpdate({ borderStyle: nextStyle, borderColor: element.borderColor || '#3b82f6', borderWidth: 1 });
                  }}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    element.borderStyle && element.borderStyle !== 'none' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  title={`Border Style: ${element.borderStyle || 'none'}`}
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
              title="Delete text box"
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
