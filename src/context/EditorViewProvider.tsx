import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorViewContext } from './editorViewContext';
import type { EditorTab, EditorViewValue, RevealRequest } from './editorViewContext';

/** Хранит выбранную вкладку и просьбы перевести взгляд на строку. */
export function EditorViewProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<EditorTab>('text');
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const seq = useRef(0);

  const revealLine = useCallback((line: number) => {
    seq.current += 1;
    setTab('text');
    setReveal({ line, seq: seq.current });
  }, []);

  const value = useMemo<EditorViewValue>(
    () => ({ tab, setTab, revealLine, reveal }),
    [tab, revealLine, reveal],
  );

  return <EditorViewContext.Provider value={value}>{children}</EditorViewContext.Provider>;
}
