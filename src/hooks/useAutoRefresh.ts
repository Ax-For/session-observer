import { useEffect, useRef } from 'react';
import { useApp } from '../store/context';

const INTERVAL_MS = 5000;

export function useAutoRefresh() {
  const { state, dispatch } = useApp();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state.autoRefreshEnabled) {
      timerRef.current = setInterval(() => {
        // Trigger a re-fetch — parent component should handle actual data loading
        window.dispatchEvent(new CustomEvent('so:auto-refresh'));
      }, INTERVAL_MS);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.autoRefreshEnabled]);
}
