import React, { useState, useEffect } from 'react';
import { ImageElement, UserProfile, normalizeImageRotation } from '../types';
import { Smile, Trash2, Maximize2, X, Crop, Check, Lock, Unlock, Loader2, AlertCircle } from 'lucide-react';
import { useBoardAsset } from '../hooks/useBoardAsset';
import { saveBoardAsset } from '../services/storageService';
import { isSandboxEnvironment } from '../utils/sandboxGuard';

interface ImageComponentProps {
  element: ImageElement;
  isSelected: boolean;
  currentUser: UserProfile;
  zoom: number;
  boardId: string;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (updates: Partial<ImageElement>) => void;
  onDelete: () => void;
  isDraggingOrResizing: boolean;
  activeTool?: string;
  canWrite?: boolean;
}

const EMOJIS = ['👍', '❤️', '🔥', '💡', '❓', '🎉'];

export default function ImageComponent({
  element,
  isSelected,
  currentUser,
  zoom,
  boardId,
  onSelect,
  onUpdate,
  onDelete,
  isDraggingOrResizing,
  activeTool = 'select',
  canWrite = true
}: ImageComponentProps) {
  const { data: imageSrc, loading: isAssetLoading, error: assetError, retry: retryAsset } = useBoardAsset(
    boardId,
    element.assetId,
    element.src
  );

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState({ top: 0, left: 0, right: 0, bottom: 0 });
  const [imageLoadError, setImageLoadError] = useState(false);

  useEffect(() => {
    if (!canWrite) {
      setIsCropping(false);
      setShowEmojiPicker(false);
    }
  }, [canWrite]);

  useEffect(() => {
    setImageLoadError(false);
  }, [imageSrc]);

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
    setShowEmojiPicker(false);
  };

  const handleCropDrag = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, edge: 'top' | 'bottom' | 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      
      const startX = e.clientX;
      const startY = e.clientY;
      const startCrop = { ...crop };
      
      const onPointerMove = (moveEvent: PointerEvent) => {
          const dx = (moveEvent.clientX - startX) / zoom;
          const dy = (moveEvent.clientY - startY) / zoom;
          
          if (edge === 'left') {
              setCrop({ ...startCrop, left: Math.max(0, Math.min(startCrop.left + dx, element.width - startCrop.right - 20)) });
          } else if (edge === 'right') {
              setCrop({ ...startCrop, right: Math.max(0, Math.min(startCrop.right - dx, element.width - startCrop.left - 20)) });
          } else if (edge === 'top') {
              setCrop({ ...startCrop, top: Math.max(0, Math.min(startCrop.top + dy, element.height - startCrop.bottom - 20)) });
          } else if (edge === 'bottom') {
              setCrop({ ...startCrop, bottom: Math.max(0, Math.min(startCrop.bottom - dy, element.height - startCrop.top - 20)) });
          }
      };
      
      const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
      };
      
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
  };

  const [isSavingCrop, setIsSavingCrop] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  const handleConfirmCrop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCropError(null);
    if (!imageSrc) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        const scaleX = img.naturalWidth / element.width;
        const scaleY = img.naturalHeight / element.height;

        const cropW = Math.round(element.width - crop.left - crop.right);
        const cropH = Math.round(element.height - crop.top - crop.bottom);

        const sourceX = crop.left * scaleX;
        const sourceY = crop.top * scaleY;
        const sourceW = cropW * scaleX;
        const sourceH = cropH * scaleY;

        const sX = Math.max(0, Math.floor(sourceX));
        const sY = Math.max(0, Math.floor(sourceY));
        const sW = Math.max(1, Math.floor(sourceW));
        const sH = Math.max(1, Math.floor(sourceH));

        const canvas = document.createElement("canvas");
        canvas.width = sW;
        canvas.height = sH;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, sX, sY, sW, sH, 0, 0, sW, sH);
        const croppedData = canvas.toDataURL("image/jpeg", 0.9);
        const newX = element.x + crop.left;
        const newY = element.y + crop.top;

        if (boardId && !isSandboxEnvironment()) {
          setIsSavingCrop(true);
          const saved = await saveBoardAsset(boardId, undefined, croppedData, "image/jpeg");
          onUpdate({
            assetId: saved.assetId,
            mimeType: saved.mimeType,
            src: undefined,
            width: cropW,
            height: cropH,
            x: newX,
            y: newY,
          });
        } else {
          onUpdate({
            src: croppedData,
            width: cropW,
            height: cropH,
            x: newX,
            y: newY,
          });
        }
        setIsCropping(false);
        setCrop({ top: 0, left: 0, right: 0, bottom: 0 });
      } catch (err: any) {
        console.error("Failed to save cropped image asset:", err);
        setCropError("Failed to save cropped image asset. Please try again.");
      } finally {
        setIsSavingCrop(false);
      }
    };
    img.onerror = () => {
      setCropError("Image loading failed during crop.");
    };
    img.src = imageSrc;
  };

  const cursorClass = element.locked 
    ? 'cursor-default' 
    : activeTool === 'select' 
      ? 'cursor-grab active:cursor-grabbing hover:shadow-md' 
      : activeTool === 'eraser' 
        ? 'cursor-pointer hover:brightness-95 hover:ring-2 hover:ring-rose-500 hover:ring-offset-1 transition-all' 
        : 'cursor-default';

  const isLocked = element.locked;

  const isPdfPage = Boolean(element.id && typeof element.id === 'string' && element.id.startsWith('pdf-page-'));
  const pdfRotation = isPdfPage ? normalizeImageRotation(element.rotation) : 0;
  const isQuarterTurn = pdfRotation === 90 || pdfRotation === 270;
  const imageStyle: React.CSSProperties = {
    imageRendering: 'auto',
    ...(isQuarterTurn ? {
      width: element.height,
      height: element.width,
      maxWidth: 'none',
      maxHeight: 'none',
      flexShrink: 0,
    } : {}),
    ...(pdfRotation !== 0 ? {
      transform: `rotate(${pdfRotation}deg)`,
      transformOrigin: 'center',
    } : {}),
  };
  const handleRetryImage = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setImageLoadError(false);
    retryAsset();
  };

  return (
    <>
      <div
        onPointerDown={onSelect}
        className={`absolute select-none flex flex-col justify-between transition-shadow duration-150 group ${cursorClass} ${
          isSelected ? 'ring-2 ring-blue-600 shadow-xl' : ''
        } ${isPdfPage ? 'shadow-lg bg-white border border-slate-200' : ''}`}
        style={{
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          zIndex: isSelected ? 40 : (isPdfPage ? 1 : (element.zIndex ?? 10)),
        }}
        id={`image-${element.id}`}
      >
        {/* Image Content Frame */}
        <div className="w-full h-full relative rounded-xs overflow-hidden flex items-center justify-center group/img">
          {isAssetLoading ? (
            <div className="w-full h-full bg-slate-100 animate-pulse flex items-center justify-center text-slate-400 text-xs gap-1.5 p-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span>Loading asset...</span>
            </div>
          ) : assetError && !imageSrc ? (
            <div
              className="w-full h-full bg-rose-50 border border-rose-200 flex flex-col items-center justify-center p-2 text-rose-600 text-xs gap-1 text-center"
              title={assetError.message}
            >
              <span>Asset load failed</span>
              <button
                onClick={handleRetryImage}
                className="px-2 py-0.5 bg-rose-100 hover:bg-rose-200 rounded font-semibold text-[10px] cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : imageLoadError ? (
            <div
              className="w-full h-full bg-rose-50 border border-rose-200 flex flex-col items-center justify-center p-2 text-rose-600 text-xs gap-1 text-center"
              title="The image data could not be decoded."
            >
              <span>Image preview failed</span>
              <button
                onClick={handleRetryImage}
                className="px-2 py-0.5 bg-rose-100 hover:bg-rose-200 rounded font-semibold text-[10px] cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (
            <img
              src={imageSrc || ''}
              alt={isPdfPage ? `PDF Page ${element.id}` : 'Pasted canvas content'}
              className={`w-full h-full select-none pointer-events-none ${isPdfPage ? 'object-contain' : 'object-cover'}`}
              style={imageStyle}
              onError={() => setImageLoadError(true)}
              draggable={false}
              referrerPolicy="no-referrer"
            />
          )}
          
          {isCropping && (
            <div className="absolute inset-0 pointer-events-none">
               <div className="absolute top-0 left-0 right-0 bg-black/50" style={{ height: crop.top }} />
               <div className="absolute bottom-0 left-0 right-0 bg-black/50" style={{ height: crop.bottom }} />
               <div className="absolute left-0 bg-black/50" style={{ top: crop.top, bottom: crop.bottom, width: crop.left }} />
               <div className="absolute right-0 bg-black/50" style={{ top: crop.top, bottom: crop.bottom, width: crop.right }} />
               
               <div className="absolute border border-white border-dashed pointer-events-auto" 
                    style={{ top: crop.top, left: crop.left, right: crop.right, bottom: crop.bottom }} />

               <div className="absolute left-1/2 -translate-x-1/2 w-8 h-4 cursor-n-resize pointer-events-auto flex items-start justify-center" 
                    style={{ top: crop.top - 2 }}
                    onPointerDown={(e) => handleCropDrag(e, 'top')}>
                    <div className="w-4 h-1.5 bg-white rounded-full shadow" />
               </div>
               <div className="absolute left-1/2 -translate-x-1/2 w-8 h-4 cursor-s-resize pointer-events-auto flex items-end justify-center" 
                    style={{ bottom: crop.bottom - 2 }}
                    onPointerDown={(e) => handleCropDrag(e, 'bottom')}>
                    <div className="w-4 h-1.5 bg-white rounded-full shadow" />
               </div>
               <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 cursor-w-resize pointer-events-auto flex items-center justify-start" 
                    style={{ left: crop.left - 2 }}
                    onPointerDown={(e) => handleCropDrag(e, 'left')}>
                    <div className="w-1.5 h-4 bg-white rounded-full shadow" />
               </div>
               <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 cursor-e-resize pointer-events-auto flex items-center justify-end" 
                    style={{ right: crop.right - 2 }}
                    onPointerDown={(e) => handleCropDrag(e, 'right')}>
                    <div className="w-1.5 h-4 bg-white rounded-full shadow" />
               </div>
            </div>
          )}
          
          {/* Quick full-screen preview button on hover */}
          {!isCropping && imageSrc && !imageLoadError && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsFullscreen(true);
              }}
              className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity cursor-pointer shadow-xs"
              title="View Full Image"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Floating Controls Overlay (Visible when selected, or when reactions exist) */}
        {(isSelected || Object.keys(element.reactions || {}).length > 0) && (
          <div 
            onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex items-center bg-white/95 border border-slate-200/80 rounded-full px-2.5 py-1 shadow-md gap-2 z-30 min-h-[34px] whitespace-nowrap"
          >
            {/* Render Reactions */}
            <div className="flex flex-wrap gap-1">
              {Object.entries(element.reactions || {}).map(([emoji, users]) => (
                <button
                  key={emoji}
                  onClick={(e) => handleEmojiClick(emoji, e)}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold transition-transform hover:scale-110 cursor-pointer ${
                    users.includes(currentUser.name) 
                      ? 'bg-blue-500/10 text-blue-950 border border-blue-400/20' 
                      : 'bg-slate-100 border border-transparent'
                  }`}
                  title={users.join(', ')}
                >
                  <span>{emoji}</span>
                  <span className="text-[10px] ml-0.5 opacity-80">{users.length}</span>
                </button>
              ))}
            </div>

            {isSelected && !isDraggingOrResizing && (
              <>
                {Object.keys(element.reactions || {}).length > 0 && (
                  <div className="w-[1px] h-3 bg-slate-200" />
                )}
                
                {/* Lock/Unlock Trigger (Teacher only or owner?) */}
                {canWrite && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate({ locked: !element.locked });
                    }}
                    className={`p-1 rounded transition-colors cursor-pointer ${
                      element.locked ? 'text-amber-600 bg-amber-50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                    }`}
                    title={element.locked ? 'Unlock element' : 'Lock element'}
                  >
                    {element.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  </button>
                )}

                {/* Emoji Trigger */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEmojiPicker(!showEmojiPicker);
                    }}
                    className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Add reaction"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  
                  {showEmojiPicker && (
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-full shadow-lg p-1.5 flex items-center space-x-1 z-40 animate-scale-up">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={(e) => handleEmojiClick(emoji, e)}
                          className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-sm transition-transform hover:scale-120 cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Crop Trigger */}
                {canWrite && !isCropping && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsCropping(true);
                      setCrop({ top: 0, left: 0, right: 0, bottom: 0 });
                    }}
                    className="p-1 rounded text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                    title="Crop Image"
                  >
                    <Crop className="w-4 h-4" />
                  </button>
                )}
                
                {/* Confirm Crop Trigger */}
                {canWrite && isCropping && (
                  <button
                    onClick={handleConfirmCrop}
                    className="p-1 rounded text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer"
                    title="Confirm Crop"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}

                {/* Cancel Crop Trigger */}
                {canWrite && isCropping && (
                  <button
                    onClick={(e) => {
                       e.stopPropagation();
                       setIsCropping(false);
                    }}
                    className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Cancel Crop"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}

                {/* Delete Trigger */}
                {canWrite && !isCropping && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Delete Image"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Resize corner handle */}
        {isSelected && canWrite && !isLocked && (
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
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shadow-sm" />
          </div>
        )}
      </div>

      {/* Lightbox / Modal overlay for full-screen view */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 pointer-events-auto cursor-zoom-out animate-fade-in"
          onClick={() => setIsFullscreen(false)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setIsFullscreen(false)}
              className="absolute -top-10 right-0 text-white hover:text-slate-200 p-1 bg-black/40 hover:bg-black/60 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={imageSrc || ''}
              alt="Full Resolution"
              className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain bg-neutral-900 border border-neutral-800"
              style={pdfRotation !== 0 ? { transform: `rotate(${pdfRotation}deg)`, transformOrigin: 'center' } : undefined}
              draggable={false}
              onClick={(e) => e.stopPropagation()} // prevent closing on image click
            />
          </div>
        </div>
      )}
    </>
  );
}
