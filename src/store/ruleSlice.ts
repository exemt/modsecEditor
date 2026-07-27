import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { parseModsec } from '../modsec/parser';
import type { ParsedDocument } from '../modsec/types';
import type { AppThunk } from './index';

/** Максимальная глубина истории отмены. */
const HISTORY_LIMIT = 200;
/** Окно коалесинга набора текста в один шаг истории (мс). */
const COALESCE_MS = 500;

export interface RuleState {
  /** «Сырой» текст правила — единственный источник правды. */
  source: string;
  /** Результат разбора `source`, синхронизируется через thunk `applyRuleSource`. */
  parsed: ParsedDocument | null;
  /** Сообщение об ошибке разбора, если парсер неожиданно упал. */
  parseError: string | null;
  /** Стек прошлых версий текста для отмены. */
  past: string[];
  /** Стек отменённых версий для повтора. */
  future: string[];
}

const initialState: RuleState = {
  source: '',
  parsed: null,
  parseError: null,
  past: [],
  future: [],
};

interface CommitPayload {
  source: string;
  parsed: ParsedDocument | null;
  parseError: string | null;
  /** Положить прежний текст в историю (шаг undo). */
  pushHistory: boolean;
}

/** Пере-парсит текст и записывает результат/ошибку в состояние. */
function reparse(state: RuleState, source: string): void {
  state.source = source;
  try {
    state.parsed = parseModsec(source);
    state.parseError = null;
  } catch (error) {
    state.parseError = error instanceof Error ? error.message : String(error);
  }
}

const ruleSlice = createSlice({
  name: 'rule',
  initialState,
  reducers: {
    /**
     * Применяет новый текст: обновляет `source`/`parsed`/`parseError` и, если
     * запрошено, кладёт прежний текст в стек отмены. При ошибке разбора
     * прежняя объектная модель сохраняется (канвас не «моргает» на невалидном
     * промежуточном вводе).
     */
    commit(state, action: PayloadAction<CommitPayload>) {
      const { source, parsed, parseError, pushHistory } = action.payload;
      if (pushHistory && state.source !== source) {
        state.past.push(state.source);
        if (state.past.length > HISTORY_LIMIT) state.past.shift();
        state.future = [];
      }
      state.source = source;
      if (parseError !== null) {
        state.parseError = parseError;
      } else {
        state.parsed = parsed;
        state.parseError = null;
      }
    },
    undo(state) {
      const prev = state.past.pop();
      if (prev === undefined) return;
      state.future.unshift(state.source);
      reparse(state, prev);
    },
    redo(state) {
      const next = state.future.shift();
      if (next === undefined) return;
      state.past.push(state.source);
      reparse(state, next);
    },
  },
});

export const { commit, undo, redo } = ruleSlice.actions;
export const ruleReducer = ruleSlice.reducer;

/** Режим влияния изменения на историю отмены. */
export type HistoryMode = 'coalesce' | 'push' | 'skip';

let lastCommitAt = 0;

/**
 * Единая точка изменения правила: раскладывает текст в объектную модель и
 * коммитит результат. `mode` управляет историей:
 *  - `push` — всегда отдельный шаг undo (структурные правки канваса);
 *  - `skip` — без истории (первичная загрузка);
 *  - `coalesce` — набор текста склеивается в один шаг в пределах окна.
 */
export const applyRuleSource =
  (source: string, mode: HistoryMode = 'coalesce'): AppThunk =>
  (dispatch) => {
    const now = Date.now();
    let pushHistory: boolean;
    if (mode === 'skip') pushHistory = false;
    else if (mode === 'push') pushHistory = true;
    else pushHistory = now - lastCommitAt > COALESCE_MS;
    lastCommitAt = now;

    let parsed: ParsedDocument | null = null;
    let parseError: string | null = null;
    try {
      parsed = parseModsec(source);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    dispatch(commit({ source, parsed, parseError, pushHistory }));
  };
