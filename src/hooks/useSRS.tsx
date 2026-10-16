// src/hooks/useSRS.tsx
// ---------------------------------------------------------------------------
// SRS 狀態管理：Context + Provider + useSRS hook
// 持久化透過 ProgressStore 非同步接口（預設為 @capacitor/preferences 實作）。
// 只寫入有變動的紀錄，未來換成分桶 / IndexedDB / SQLite 實作時可直接受惠。
// 註：檔名為 .tsx，因內含 JSX（SRSProvider）。
// ---------------------------------------------------------------------------
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Card, ReviewLog, SRSProgress } from '../core/types';
import { applyAttemptToSrs, createInitialProgress, isDue, type SrsAttemptOutcome } from '../core/srsEngine';
import { progressStore as defaultProgressStore, type ProgressMap, type ProgressStore } from '../core/progressStore';

const MAX_LOGS = 200;

interface SRSState {
  cards: Card[];
  progressMap: ProgressMap;
  /** 今日到期的卡片 ID（依到期時間排序） */
  queue: string[];
  /** 今日到期的卡片（與 queue 同順序） */
  dueCards: Card[];
  currentCard: Card | null;
  dueCount: number;
  isLoaded: boolean;
  logs: ReviewLog[];
  /** 最近一次寫入失敗的訊息；成功後清除 */
  saveError: string | null;
}

interface SRSActions {
  /**
   * 記錄一次作答：
   * - { kind: 'graded', grade } → SM-2 推進或重置排程
   * - { kind: 'timeout' }       → 排程不變，只累加 timeouts
   */
  recordAttempt: (cardId: string, outcome: SrsAttemptOutcome) => void;
  /** 以目前時間重算今日佇列 */
  reloadQueue: () => void;
  /** 重置全部進度 */
  resetProgress: () => void;
}

export interface SRSContextValue extends SRSState, SRSActions {}

const SRSContext = createContext<SRSContextValue | null>(null);

interface SRSProviderProps {
  cards: Card[];
  children: ReactNode;
  /** 可替換的儲存實作（N1 規模時換成分桶或資料庫實作） */
  store?: ProgressStore;
}

export function SRSProvider({ cards, children, store = defaultProgressStore }: SRSProviderProps) {
  const [progressMap, setProgressMap] = useState<ProgressMap>({});
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 佇列計算的基準時間（作答或手動重算時更新） */
  const [queueClock, setQueueClock] = useState<number>(() => Date.now());

  /** 最新進度的同步副本，讓 action 不必依賴 render 週期 */
  const progressRef = useRef<ProgressMap>({});

  const commit = useCallback((next: ProgressMap) => {
    progressRef.current = next;
    setProgressMap(next);
  }, []);

  const persist = useCallback(
    (records: SRSProgress[]) => {
      if (records.length === 0) return;
      store.upsertMany(records).then(
        () => setSaveError(null),
        (err: unknown) => {
          console.warn('[useSRS] 儲存進度失敗：', err);
          setSaveError(err instanceof Error ? err.message : '進度儲存失敗');
        },
      );
    },
    [store],
  );

  // (1) 初次載入
  useEffect(() => {
    let alive = true;
    store
      .loadAll()
      .catch((err: unknown) => {
        console.warn('[useSRS] 讀取進度失敗，將以空進度啟動：', err);
        return {} as ProgressMap;
      })
      .then((stored) => {
        if (!alive) return;
        commit(stored);
        setQueueClock(Date.now());
        setIsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [store, commit]);

  // (2) 補齊新卡的初始進度（只寫入新增的紀錄）
  useEffect(() => {
    if (!isLoaded) return;
    const now = Date.now();
    const current = progressRef.current;
    const added: SRSProgress[] = [];
    for (const card of cards) {
      if (!current[card.id]) added.push(createInitialProgress(card.id, now));
    }
    if (added.length === 0) return;
    const next: ProgressMap = { ...current };
    for (const record of added) next[record.cardId] = record;
    commit(next);
    persist(added);
  }, [cards, isLoaded, commit, persist]);

  // (3) 今日佇列：依 queueClock 判斷到期，依到期時間排序
  const dueCards = useMemo(
    () =>
      cards
        .filter((card) => {
          const p = progressMap[card.id];
          return p ? isDue(p, queueClock) : true;
        })
        .sort(
          (a, b) =>
            (progressMap[a.id]?.nextReviewDate ?? 0) - (progressMap[b.id]?.nextReviewDate ?? 0),
        ),
    [cards, progressMap, queueClock],
  );
  const queue = useMemo(() => dueCards.map((card) => card.id), [dueCards]);

  const reloadQueue = useCallback(() => {
    setQueueClock(Date.now());
  }, []);

  // (4) 記錄作答
  const recordAttempt = useCallback(
    (cardId: string, outcome: SrsAttemptOutcome) => {
      const now = Date.now();
      const current = progressRef.current;
      const existing = current[cardId] ?? createInitialProgress(cardId, now);
      const updated = applyAttemptToSrs(existing, outcome, now);

      commit({ ...current, [cardId]: updated });
      setQueueClock(now);
      persist([updated]);

      if (outcome.kind === 'graded') {
        const entry: ReviewLog = {
          cardId,
          grade: outcome.grade,
          reviewedAt: now,
          prevInterval: existing.interval,
          nextInterval: updated.interval,
          prevEaseFactor: existing.easeFactor,
          nextEaseFactor: updated.easeFactor,
        };
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
        });
      }
    },
    [commit, persist],
  );

  // (5) 重置
  const resetProgress = useCallback(() => {
    const now = Date.now();
    const fresh: ProgressMap = {};
    for (const card of cards) {
      fresh[card.id] = createInitialProgress(card.id, now);
    }
    commit(fresh);
    setLogs([]);
    setQueueClock(now);
    store.replaceAll(fresh).then(
      () => setSaveError(null),
      (err: unknown) => setSaveError(err instanceof Error ? err.message : '進度重置失敗'),
    );
  }, [cards, commit, store]);

  const currentCard = dueCards[0] ?? null;

  const value = useMemo<SRSContextValue>(
    () => ({
      cards,
      progressMap,
      queue,
      dueCards,
      currentCard,
      dueCount: queue.length,
      isLoaded,
      logs,
      saveError,
      recordAttempt,
      reloadQueue,
      resetProgress,
    }),
    [cards, progressMap, queue, dueCards, currentCard, isLoaded, logs, saveError, recordAttempt, reloadQueue, resetProgress],
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
