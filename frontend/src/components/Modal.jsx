import { useEffect } from 'react';

export default function Modal({ open, onClose, title, children, width = 1280 }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[1000] flex items-start justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-6xl mt-6 overflow-hidden flex flex-col h-[85vh]"
        style={{ maxWidth: width, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-900">
          <div className="font-extrabold text-slate-900 dark:text-white">{title}</div>
          <button
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] shadow-md"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="p-4 flex-1 overflow-auto text-slate-900 dark:text-slate-200">
          {children}
        </div>
      </div>
    </div>
  );
}
