import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);
const DISMISS_MS = 6000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((list) => [...list.slice(-2), { ...toast, id }]);
      setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex gap-2 rounded-md border border-line bg-surface p-3 text-sm shadow-lg"
          >
            {toast.tone === 'error' ? (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-600" />
            ) : (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{toast.title}</p>
              {toast.body && <p className="mt-0.5 break-words text-xs text-muted">{toast.body}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="self-start text-subtle hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
