import { useEffect, useRef, useState } from "react";

export function useAnalysisRequest(load, key, sourceRevision, enabled = true) {
  const [state, setState] = useState({ data: null, loading: true, error: "", key });
  const [revision, setRevision] = useState(0);
  const loadRef = useRef(load);
  const requestRef = useRef(null);
  const sourceRef = useRef({ key, revision: sourceRevision });
  loadRef.current = load;
  useEffect(() => {
    if (!enabled) return undefined;
    let active = false;
    let pending = false;
    let disposed = false;
    let controller;
    const read = async () => {
      if (active) { pending = true; return; }
      active = true;
      pending = false;
      controller = new AbortController();
      setState((previous) => ({ data: previous.key === key ? previous.data : null, loading: true, error: "", key }));
      try {
        const data = await loadRef.current({ signal: controller.signal });
        if (!disposed) setState({ data, loading: false, error: "", key });
      } catch (error) {
        if (!disposed) setState((previous) => ({ ...previous, loading: false, error: error.message }));
      } finally {
        active = false;
        if (pending && !disposed) void read();
      }
    };
    requestRef.current = read;
    void read();
    return () => { disposed = true; controller?.abort(); requestRef.current = null; };
  }, [key, revision, enabled]);
  useEffect(() => {
    const previous = sourceRef.current;
    sourceRef.current = { key, revision: sourceRevision };
    // Finish the current snapshot before merging a newer source revision.
    if (enabled && previous.key === key && previous.revision !== sourceRevision) requestRef.current?.();
  }, [key, sourceRevision, enabled]);
  return { ...state, loading: enabled && state.loading, data: state.key === key ? state.data : null,
    reload: () => setRevision((value) => value + 1) };
}
