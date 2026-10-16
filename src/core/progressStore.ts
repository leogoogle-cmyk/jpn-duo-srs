// src/core/progressStore.ts
// ---------------------------------------------------------------------------
// SRS 進度儲存層：非同步接口 + @capacitor/preferences 實作
//
// 為什麼要抽出接口：
//   現行實作把全部進度存成一個 JSON key。N5 幾百張卡沒有問題，
//   擴充到 N1（約 1 萬張）時，每次存檔重寫整份資料會造成 iOS I/O 壓力。
//   屆時只要另寫一個 ProgressStore 實作（例如分桶 Preferences、IndexedDB、
//   @capacitor-community/sqlite），在 <SRSProvider store={...}> 換掉即可，
//   useSRS 與畫面元件都不需要修改。
// ---------------------------------------------------------------------------
import { Preferences } from '@capacitor/preferences';
import type { SRSProgress } from './types';

/** cardId → 進度 */
export type ProgressMap = Record<string, SRSProgress>;

/** 進度儲存層的非同步接口 */
export interface ProgressStore {
  /** 讀取全部進度（回傳複本） */
  loadAll(): Promise<ProgressMap>;
  /** 新增或更新多筆進度：只傳入有變動的紀錄，實作可只寫入受影響的部分 */
  upsertMany(records: readonly SRSProgress[]): Promise<void>;
  /** 以給定進度取代全部資料（重置用） */
  replaceAll(map: ProgressMap): Promise<void>;
  /** 等待所有排隊中的寫入完成（例如 App 進入背景前呼叫） */
  flush(): Promise<void>;
}

/** 沿用既有的儲存 key，升級後舊進度不會遺失 */
export const DEFAULT_PROGRESS_KEY = 'jlpt-n5-srs:progress:v1';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isOptionalNumber = (value: unknown): boolean => value === undefined || isFiniteNumber(value);

/** 執行期驗證：損毀或欄位不符的紀錄會被略過，不會讓 App 崩潰 */
export function isSRSProgress(value: unknown): value is SRSProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['cardId'] === 'string' &&
    isFiniteNumber(record['nextReviewDate']) &&
    isFiniteNumber(record['interval']) &&
    isFiniteNumber(record['easeFactor']) &&
    isFiniteNumber(record['repetitions']) &&
    isOptionalNumber(record['lastReviewedAt']) &&
    isOptionalNumber(record['totalReviews']) &&
    isOptionalNumber(record['timeouts'])
  );
}

/**
 * 以 @capacitor/preferences 實作的進度儲存。
 * - iOS 原生殼：UserDefaults；瀏覽器 / PWA：自動退回 localStorage
 * - 記憶體快取：讀取只在第一次走 bridge
 * - 寫入佇列：所有寫入依序執行，不會互相覆蓋
 * - 寫入合併：連續多次 upsert 只要資料已寫出，後續排隊的寫入會直接略過
 */
export function createPreferencesProgressStore(key: string = DEFAULT_PROGRESS_KEY): ProgressStore {
  let cache: ProgressMap | null = null;
  let loading: Promise<ProgressMap> | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let dirty = false;

  const load = (): Promise<ProgressMap> => {
    if (cache !== null) return Promise.resolve(cache);
    if (loading === null) {
      loading = (async (): Promise<ProgressMap> => {
        const { value } = await Preferences.get({ key });
        const out: ProgressMap = {};
        if (value) {
          try {
            const parsed: unknown = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              for (const [cardId, entry] of Object.entries(parsed as Record<string, unknown>)) {
                if (isSRSProgress(entry) && entry.cardId === cardId) out[cardId] = entry;
              }
            }
          } catch (err) {
            console.warn('[progressStore] 進度資料損毀，將以空進度啟動：', err);
          }
        }
        cache = out;
        return out;
      })().catch((err: unknown) => {
        loading = null; // 允許下次重試
        throw err;
      });
    }
    return loading;
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = writeChain.then(task);
    writeChain = run.catch(() => undefined); // 單次失敗不阻斷後續寫入
    return run;
  };

  const writeIfDirty = (): Promise<void> =>
    enqueue(async () => {
      if (!dirty || cache === null) return;
      dirty = false;
      try {
        await Preferences.set({ key, value: JSON.stringify(cache) });
      } catch (err) {
        dirty = true; // 下次寫入時重試
        throw err;
      }
    });

  return {
    async loadAll(): Promise<ProgressMap> {
      const map = await load();
      const copy: ProgressMap = {};
      for (const [cardId, record] of Object.entries(map)) copy[cardId] = { ...record };
      return copy;
    },

    async upsertMany(records: readonly SRSProgress[]): Promise<void> {
      if (records.length === 0) return;
      const map = await load();
      for (const record of records) {
        if (!isSRSProgress(record)) {
          throw new Error(`[progressStore] 無效的進度紀錄：${JSON.stringify(record)}`);
        }
        map[record.cardId] = { ...record };
      }
      dirty = true;
      await writeIfDirty();
    },

    async replaceAll(next: ProgressMap): Promise<void> {
      await load();
      const copy: ProgressMap = {};
      for (const [cardId, record] of Object.entries(next)) {
        if (isSRSProgress(record) && record.cardId === cardId) copy[cardId] = { ...record };
      }
      cache = copy;
      dirty = true;
      await writeIfDirty();
    },

    flush(): Promise<void> {
      return writeChain;
    },
  };
}

/** App 預設使用的儲存實例 */
export const progressStore: ProgressStore = createPreferencesProgressStore();
