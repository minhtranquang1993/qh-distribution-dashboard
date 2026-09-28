/**
 * Upload + worker orchestration. The public build must never hold PII, so
 * `allowPii` is derived from the build mode rather than a runtime toggle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lead, ParseProgress } from '@/types/lead';
import type { ParseRequest, ParseResponse } from '@/workers/messages';

/** Set by Vite at build time; the production deploy compiles this to true. */
export const IS_PRODUCTION_BUILD = import.meta.env.PROD;

export interface IngestState {
  status: 'idle' | 'parsing' | 'ready' | 'error';
  progress: ParseProgress | null;
  leads: Lead[];
  totalRows: number;
  warnings: string[];
  error: string | null;
  /** False in production: PII is stripped during the worker pass. */
  allowPii: boolean;
  fileName: string | null;
}

const INITIAL: IngestState = {
  status: 'idle',
  progress: null,
  leads: [],
  totalRows: 0,
  warnings: [],
  error: null,
  allowPii: !IS_PRODUCTION_BUILD,
  fileName: null,
};

export function useIngest() {
  const [state, setState] = useState<IngestState>(INITIAL);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('@/workers/csvParser.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        setState((prev) => ({ ...prev, progress: msg.payload }));
      } else if (msg.type === 'done') {
        setState((prev) => ({
          ...prev,
          status: 'ready',
          leads: msg.payload.leads,
          totalRows: msg.payload.totalRows,
          warnings: msg.payload.warnings,
          progress: { stage: 'done', rowsProcessed: msg.payload.totalRows, totalRows: msg.payload.totalRows },
        }));
      } else {
        setState((prev) => ({ ...prev, status: 'error', error: msg.payload }));
      }
    };

    worker.onerror = (event) => {
      setState((prev) => ({ ...prev, status: 'error', error: event.message || 'Worker failed' }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const parseFile = useCallback(
    (file: File) => {
      setState({
        ...INITIAL,
        status: 'parsing',
        fileName: file.name,
        allowPii: !IS_PRODUCTION_BUILD,
        progress: { stage: 'reading', rowsProcessed: 0, totalRows: 0 },
      });
      const request: ParseRequest = { file, noPii: IS_PRODUCTION_BUILD };
      workerRef.current?.postMessage(request);
    },
    [],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, parseFile, reset };
}
