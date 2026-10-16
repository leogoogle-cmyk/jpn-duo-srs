// src/hooks/useSRS.tsx
// ---------------------------------------------------------------------------
// SRS 狀態管理：Context + Provider + useSRS hook
// 持久化採 @capacitor/preferences（非同步，iOS / Web 通用）。
// 註：檔名為 .tsx，因內含 JSX（SRSProvider）。
// ---------------------------------------------------------------------------
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Preferences } from '@capacitor/preferences';
import type { Card, ReviewLog, SRSProgress } from '../core/types';
import { applyReview, createInitialProgress, isDue } from '../core/srsEngine';

const STORAGE_KEY = 'jlpt-n5-srs:progress:v1';
const MAX_LOGS = 200;

interface SRSState {
  cards: Card[];
  progressMap: Record<string, SRSProgress>;
  queue: string[];
  currentCard: Card | null;
  dueCount: number;
  isLoaded: boolean;
  logs: ReviewLog[];
}

interface SRSActions {
  /** 提交一次作答評分（0/3/5），觸發 SM-2 並流轉至下一題 */
  submitAnswer: (grade: number) => void;
  /** 手動重算今日佇列 */
  reloadQueue: () => void;
  /** 重置全部進度 */
  resetProgress: () => void;
}

export interface SRSContextValue extends SRSState, SRSActions {}

const SRSContext = createContext<SRSContextValue | null>(null);

// --------------------- 非同步持久化（@capacitor/preferences）---------------------
async function loadProgress(): Promise<Record<string, SRSProgress>> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, SRSProgress>;
    }
    return {};
  } catch (err) {
    console.warn('[useSRS] 讀取進度失敗，將以空進度啟動：', err);
    return {};
  }
}

async function saveProgress(map: Record<string, SRSProgress>): Promise<void> {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(map) });
  } catch (err) {
    console.warn('[useSRS] 儲存進度失敗：', err);
  }
}

interface SRSProviderProps {
  cards: Card[];
  children: ReactNode;
}

export function SRSProvider({ cards, children }: SRSProviderProps) {
  const [progressMap, setProgressMap] = useState<Record<string, SRSProgress>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // (1) 初次載入（僅執行一次）
  useEffect(() => {
    let alive = true;
    loadProgress()
      .then((stored) => {
        if (alive) setProgressMap(stored);
      })
      .finally(() => {
        if (alive) setIsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // (2) 補齊每張卡的進度（cards 變動時；新卡立即到期）
  useEffect(() => {
    if (!isLoaded) return;
    setProgressMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const card of cards) {
        if (!next[card.id]) {
          next[card.id] = createInitialProgress(card.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cards, isLoaded]);

  // (3) 持久化（載入完成後才寫，避免覆蓋既有資料）
  useEffect(() => {
    if (!isLoaded) return;
    void saveProgress(progressMap);
  }, [progressMap, isLoaded]);

  // (4) 依進度重算今日佇列
  const reloadQueue = useCallback(() => {
    const now = Date.now();
    const due = cards
      .filter((card) => {
        const p = progressMap[card.id];
        return p ? isDue(p, now) : true;
      })
      .sort(
        (a, b) =>
          (progressMap[a.id]?.nextReviewDate ?? 0) - (progressMap[b.id]?.nextReviewDate ?? 0),
      )
      .map((card) => card.id);
    setQueue(due);
  }, [cards, progressMap]);

  useEffect(() => {
    reloadQueue();
  }, [reloadQueue]);

  // (5) 提交作答：套用 SM-2，更新進度與紀錄（currentCard 會自動換到下一張）
  const submitAnswer = useCallback(
    (grade: number) => {
      const currentId = queue[0];
      if (!currentId) return;

      const existing = progressMap[currentId] ?? createInitialProgress(currentId);
      const updated = applyReview(existing, grade);

      setProgressMap((prev) => ({ ...prev, [currentId]: updated }));

      const entry: ReviewLog = {
        cardId: currentId,
        grade,
        reviewedAt: Date.now(),
        prevInterval: existing.interval,
        nextInterval: updated.interval,
        prevEaseFactor: existing.easeFactor,
        nextEaseFactor: updated.easeFactor,
      };
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    },
    [queue, progressMap],
  );

  // (6) 重置
  const resetProgress = useCallback(() => {
    const fresh: Record<string, SRSProgress> = {};
    for (const card of cards) {
      fresh[card.id] = createInitialProgress(card.id);
    }
    setProgressMap(fresh);
    setLogs([]);
  }, [cards]);

  const currentCard = useMemo(() => {
    const id = queue[0];
    if (!id) return null;
    return cards.find((c) => c.id === id) ?? null;
  }, [queue, cards]);

  const value = useMemo<SRSContextValue>(
    () => ({
      cards,
      progressMap,
      queue,
      currentCard,
      dueCount: queue.length,
      isLoaded,
      logs,
      submitAnswer,
      reloadQueue,
      resetProgress,
    }),
    [cards, progressMap, queue, currentCard, isLoaded, logs, submitAnswer, reloadQueue, resetProgress],
  );

  return <SRSContext.Provider value={value}>{children}</SRSContext.Provider>;
}

/** 取用 SRS Context；必須在 <SRSProvider> 內使用 */
export function useSRS(): SRSContextValue {
  const ctx = useContext(SRSContext);
  if (!ctx) {
    throw new Error('useSRS 必須在 <SRSProvider> 內使用');
  }
  return ctx;
}
