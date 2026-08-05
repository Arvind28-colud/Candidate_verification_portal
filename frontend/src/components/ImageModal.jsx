import React, { useEffect } from 'react';
import { X, ZoomIn, Download, Eye } from 'lucide-react';

const ImageModal = ({ src, alt, title, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!src) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = src;
    link.download = `${(title || 'image').replace(/\s+/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 overflow-hidden animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[90vh] bg-white border border-slate-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header (Clean Light Corporate Theme) */}
        <div className="bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                {title || 'Full Image View'}
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Official Document & Identity Preview
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer"
              title="Download Image"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image Body */}
        <div className="p-6 flex-1 flex items-center justify-center bg-slate-100/90 overflow-auto">
          <img
            src={src}
            alt={alt || title || 'Full View'}
            className="max-w-full max-h-[72vh] object-contain rounded-2xl shadow-lg border border-slate-200 bg-white p-2"
          />
        </div>

        {/* Footer info */}
        <div className="bg-white px-5 py-3 border-t border-slate-200 text-xs font-medium text-slate-500 flex justify-between items-center">
          <span>Click anywhere outside or press ESC to exit preview</span>
          <span className="text-indigo-600 font-bold uppercase text-[11px] bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
            Original Resolution
          </span>
        </div>
      </div>
    </div>
  );
};

export default ImageModal;
