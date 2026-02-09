import { useState, useCallback, useRef } from 'react';
import type { HistoryItem } from '../../../types';
import { STORAGE_KEYS } from '../../../utils/storage';
import { APP_CONFIG } from '../../../config';
import { logger } from '../../../services';

const STORAGE_KEY = STORAGE_KEYS.HISTORY;
const MAX_HISTORY_ITEMS = APP_CONFIG.MAX_HISTORY_ITEMS;

const loadHistoryFromStorage = (): { history: HistoryItem[]; legacyNonSermon: HistoryItem[] } => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { history: [], legacyNonSermon: [] };
    }

    const parsed = JSON.parse(saved) as HistoryItem[];
    const legacyNonSermon: HistoryItem[] = [];
    const history: HistoryItem[] = [];

    parsed.forEach((item) => {
      if (item.isSermon === false) {
        legacyNonSermon.push(item);
      } else {
        history.push(item);
      }
    });

    return { history, legacyNonSermon };
  } catch {
    return { history: [], legacyNonSermon: [] };
  }
};

const saveHistoryToStorage = (
  history: HistoryItem[],
  legacyNonSermon: HistoryItem[]
): void => {
  try {
    const trimmed = history.slice(0, MAX_HISTORY_ITEMS);
    const combined = [...legacyNonSermon, ...trimmed];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(combined));
  } catch (e) {
    logger.error('Failed to save history:', e);
  }
};

interface UseHistoryReturn {
  history: HistoryItem[];
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  toggleHistory: () => void;
  addHistoryItem: (item: HistoryItem) => void;
  updateHistoryItem: (itemId: string, updates: Partial<HistoryItem>) => void;
  clearHistory: () => void;
  selectHistoryItem: (item: HistoryItem, onSelect: (item: HistoryItem) => void) => void;
  removeHistoryItem: (itemId: string) => void;
}

export function useHistory(): UseHistoryReturn {
  const { history: initialHistory, legacyNonSermon } = loadHistoryFromStorage();
  const legacyNonSermonRef = useRef<HistoryItem[]>(legacyNonSermon);
  const legacyLogRef = useRef(false);
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  if (!legacyLogRef.current && legacyNonSermonRef.current.length > 0) {
    logger.info('Hiding legacy non-sermon history items', {
      hiddenCount: legacyNonSermonRef.current.length,
    });
    legacyLogRef.current = true;
  }

  const persistHistory = useCallback(
    (items: HistoryItem[]): void => {
      saveHistoryToStorage(items, legacyNonSermonRef.current);
    },
    []
  );

  const toggleHistory = useCallback((): void => {
    setShowHistory((prev) => !prev);
  }, []);

  const addHistoryItem = useCallback((item: HistoryItem): void => {
    setHistory((prev) => {
      const newHistory = [item, ...prev];
      persistHistory(newHistory);
      return newHistory;
    });
  }, [persistHistory]);

  const updateHistoryItem = useCallback((itemId: string, updates: Partial<HistoryItem>): void => {
    setHistory((prev) => {
      const updated = prev.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item
      );
      persistHistory(updated);
      return updated;
    });
  }, [persistHistory]);

  const clearHistory = useCallback((): void => {
    setHistory([]);
    legacyNonSermonRef.current = [];
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const removeHistoryItem = useCallback((itemId: string): void => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.id !== itemId);
      persistHistory(updated);
      return updated;
    });
  }, [persistHistory]);

  const selectHistoryItem = useCallback(
    (item: HistoryItem, onSelect: (item: HistoryItem) => void): void => {
      onSelect(item);
      setShowHistory(false);
    },
    []
  );

  return {
    history,
    showHistory,
    setShowHistory,
    toggleHistory,
    addHistoryItem,
    updateHistoryItem,
    clearHistory,
    removeHistoryItem,
    selectHistoryItem,
  };
}
