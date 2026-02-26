import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="alert"
              onClick={() => dismiss(t.id)}
              style={{
                pointerEvents: 'auto',
                padding: '10px 16px',
                borderRadius: 10,
                fontSize: 13,
                fontFamily: 'inherit',
                maxWidth: 360,
                cursor: 'pointer',
                animation: 'toastIn 0.25s ease-out',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                border: '1px solid',
                ...(t.type === 'success'
                  ? { background: '#f0faf0', borderColor: '#b4d9b4', color: '#2d6a2d' }
                  : t.type === 'error'
                    ? { background: '#fef2f0', borderColor: '#e8b4a8', color: '#933623' }
                    : { background: '#fbf8f2', borderColor: 'rgba(120,98,83,0.22)', color: '#2b2522' }),
              }}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
}
