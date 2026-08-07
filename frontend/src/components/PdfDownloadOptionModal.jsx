import React, { useState } from 'react';
import { Download, X, FileText, CheckSquare, Square } from 'lucide-react';

const PdfDownloadOptionModal = ({ isOpen, title, subtitle, onConfirm, onClose }) => {
  const [includePage2, setIncludePage2] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!isOpen) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await onConfirm({ includePage2 });
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloading(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full overflow-hidden shadow-2xl relative text-slate-900">
        
        {/* HEADER */}
        <div className="bg-black p-5 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold font-sans text-white">{title || 'PDF Download Options'}</h3>
              <p className="text-xs text-slate-300 font-medium">{subtitle || 'Choose report page options before downloading'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 text-slate-300 hover:text-white" />
          </button>
        </div>

        {/* BODY CONTENT */}
        <div className="p-6 space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-start space-x-3 cursor-pointer" onClick={() => setIncludePage2(!includePage2)}>
              <button type="button" className="mt-0.5 text-indigo-600 focus:outline-none cursor-pointer">
                {includePage2 ? (
                  <CheckSquare className="w-5 h-5 text-indigo-600 shrink-0" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400 shrink-0" />
                )}
              </button>
              <div className="space-y-1 select-none">
                <span className="text-sm font-bold text-slate-900 block font-sans">
                  Include Page 2 (Police Verification Remarks &amp; Attachments)
                </span>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Unchecked (default) generates a clean 1-Page Identity Report. Check this box if you require the 2nd page with handwritten Police Remarks &amp; Card attachments.
                </p>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center space-x-2">
            <FileText className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              {includePage2 ? 'Selected Format: 2-Page Full Verification Report' : 'Selected Format: 1-Page Clean Official PDF Report'}
            </span>
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold tracking-wide flex items-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? 'Preparing Download...' : 'Download Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PdfDownloadOptionModal;
