import React from 'react';
import { X, Keyboard, Command } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  const shortcutGroups = [
    {
      title: "Tools & Drawing",
      items: [
        { key: "V", label: "Select / Move tool" },
        { key: "P", label: "Pencil tool" },
        { key: "I", label: "Highlighter" },
        { key: "K", label: "Laser Pointer" },
        { key: "N", label: "Sticky Note" },
        { key: "S", label: "Shapes Picker" },
        { key: "T", label: "Text tool" },
        { key: "M", label: "Math Equation" },
        { key: "L", label: "Connector Line" },
        { key: "E", label: "Eraser" },
        { key: "G", label: "Graphing Paper" },
        { key: "H", label: "Hand (Pan Canvas)" },
        { key: "U", label: "Voice Annotation" },
        { key: "O", label: "Feedback Stamps" },
      ],
    },
    {
      title: "Editing & History",
      items: [
        { key: "Ctrl + Z", label: "Undo last action" },
        { key: "Ctrl + Y", label: "Redo action" },
        { key: "Ctrl + C", label: "Copy selected items" },
        { key: "Ctrl + V", label: "Paste items" },
        { key: "Del / Backspace", label: "Delete selection" },
        { key: "Esc", label: "Clear selection / Stop following" },
      ],
    },
    {
      title: "Canvas & View",
      items: [
        { key: "Space + Drag", label: "Pan around canvas" },
        { key: "Wheel / Pinch", label: "Smooth Zoom in/out" },
        { key: "Shift + Pencil", label: "Draw perfect straight lines" },
        { key: "Click Avatar", label: "Follow live user view" },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800">Keyboard Shortcuts</h3>
              <p className="text-xs text-slate-500 font-medium">Speed up your collaborative workflow</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {shortcutGroups.map((group, idx) => (
            <div key={idx} className="space-y-2.5">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                {group.title}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-2xl"
                  >
                    <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                    <kbd className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-mono font-bold text-slate-600 shadow-2xs whitespace-nowrap">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span className="flex items-center space-x-1">
            <Command className="w-3.5 h-3.5 text-slate-400" />
            <span>Tip: Press <kbd className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-slate-200">?</kbd> anytime to open</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
