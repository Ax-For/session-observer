import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/context';

export function useKeyboardShortcuts() {
  const { state, dispatch } = useApp();
  const ggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKey = useCallback((e: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in input/select/textarea
    const target = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
      if (e.key === 'Escape') {
        (target as HTMLElement).blur();
      }
      return;
    }

    // Modal close
    if (e.key === 'Escape') {
      dispatch({ type: 'SET_DETAIL_MODAL', payload: { event: null, index: -1 } });
      return;
    }

    // Single key shortcuts
    switch (e.key) {
      case '/':
      case 'f':
        e.preventDefault();
        const searchInput = document.getElementById('filter-search') as HTMLInputElement;
        if (searchInput) searchInput.focus();
        break;
      case 'r':
        window.dispatchEvent(new CustomEvent('so:refresh'));
        break;
      case 'a':
        dispatch({ type: 'SET_AUTO_REFRESH', payload: !state.autoRefreshEnabled });
        break;
      case 't':
        dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' });
        break;
      case 'm':
        dispatch({ type: 'SET_VIEW_MODE', payload: state.viewMode === 'raw' ? 'observe' : 'raw' });
        break;
      case 'j':
      case 'ArrowDown':
        if (e.key === 'j' || !e.shiftKey) {
          e.preventDefault();
          const next = Math.min(state.selectedRowIndex + 1, state.filtered.length - 1);
          dispatch({ type: 'SET_SELECTED_ROW', payload: next });
        }
        break;
      case 'k':
      case 'ArrowUp':
        if (e.key === 'k' || !e.shiftKey) {
          e.preventDefault();
          const prev = Math.max(state.selectedRowIndex - 1, 0);
          dispatch({ type: 'SET_SELECTED_ROW', payload: prev });
        }
        break;
      case 'Enter':
        if (state.selectedRowIndex >= 0 && state.filtered[state.selectedRowIndex]) {
          dispatch({
            type: 'SET_DETAIL_MODAL',
            payload: { event: state.filtered[state.selectedRowIndex], index: state.selectedRowIndex },
          });
        }
        break;
      case 'g':
        if (ggTimerRef.current) {
          // gg - jump to first
          clearTimeout(ggTimerRef.current);
          ggTimerRef.current = null;
          dispatch({ type: 'SET_SELECTED_ROW', payload: 0 });
        } else {
          ggTimerRef.current = setTimeout(() => {
            ggTimerRef.current = null;
          }, 400);
        }
        break;
      case 'G':
        dispatch({ type: 'SET_SELECTED_ROW', payload: state.filtered.length - 1 });
        break;
    }
  }, [state.autoRefreshEnabled, state.theme, state.viewMode, state.selectedRowIndex, state.filtered, dispatch]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);
}
