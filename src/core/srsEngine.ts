// src/core/srsEngine.ts
// ---------------------------------------------------------------------------
// SRS 核心演算法：經典 SM-2 (SuperMemo 2)
// ---------------------------------------------------------------------------
import type { SRSProgress } from './types';

/** SM-2 預設難易度因子 */
export const DEFAULT_EASE_FACTOR = 2.5;
/** SM-2 難易度因子下限 */
export const MIN_EASE_FACTOR = 1.3;
/** 一天的毫秒數 */
export const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** calculateSM2 的回傳值 */
export interface SM2Result {
  interval: number;
  easeFactor: number;
  repetitions: number;
}

/** 四捨五入到指定小數位（避免 EF 浮點誤差累積） */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 正規化為 0~5 整數；非有限數字一律視為 0（完全答錯） */
export function normalizeGrade(grade: number): number {
  if (!Number.isFinite(grade)) return 0;
  return Math.min(5, Math.max(0, Math.round(grade)));
}

/**
 * 經典 SM-2 演算法。
 * @param grade           本次評分 (0~5)。對齊 Duolingo 使用 0 / 3 / 5。
 * @param prevInterval    先前的複習間隔（天）
 * @param prevEaseFactor  先前的難易度因子 EF
 * @param prevRepetitions 先前的連續答對次數
 * @returns 更新後的 { interval, easeFactor, repetitions }
 */
export function calculateSM2(
  grade: number,
  prevInterval: number,
  prevEaseFactor: number,
  prevRepetitions: number,
): SM2Result {
  const q = normalizeGrade(grade);

  // 1. 更新 EF（經典 SM-2：不論答對或答錯都更新）
  let easeFactor = prevEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < MIN_EASE_FACTOR) {
    easeFactor = MIN_EASE_FACTOR;
  }
  easeFactor = roundTo(easeFactor, 4);

  // 2. 更新 interval / repetitions
  let interval: number;
  let repetitions: number;

  if (q < 3) {
    // 答錯（含超時）：進度歸零，明天重來
    repetitions = 0;
    interval = 1;
  } else {
    if (prevRepetitions === 0) {
      interval = 1;
    } else if (prevRepetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(prevInterval * easeFactor);
    }
    if (interval < 1) {
      interval = 1;
    }
    repetitions = prevRepetitions + 1;
  }

  return { interval, easeFactor, repetitions };
}

/** 依間隔天數計算下次複習時間（epoch 毫秒） */
export function computeNextReviewDate(intervalDays: number, from: number = Date.now()): number {
  return from + intervalDays * DAY_IN_MS;
}

/** 建立新卡初始進度（nextReviewDate = now，代表立即可複習） */
export function createInitialProgress(cardId: string, now: number = Date.now()): SRSProgress {
  return {
    cardId,
    nextReviewDate: now,
    interval: 0,
    easeFactor: DEFAULT_EASE_FACTOR,
    repetitions: 0,
    totalReviews: 0,
  };
}

/** 判斷某筆進度是否已到期（nextReviewDate <= now） */
export function isDue(progress: SRSProgress, now: number = Date.now()): boolean {
  return progress.nextReviewDate <= now;
}

/** 一次作答結果：已評分（0 / 3 / 5）或逾時 */
export type SrsAttemptOutcome =
  | { kind: 'graded'; grade: number }
  | { kind: 'timeout' };

/**
 * 依作答結果更新進度（純函式）。
 * - graded：交給 SM-2（applyReview）推進或重置排程
 * - timeout：SM-2 數據（interval / easeFactor / repetitions / nextReviewDate）完全不變，
 *            只將 timeouts 加 1，並記錄最後作答時間
 */
export function applyAttemptToSrs(
  progress: SRSProgress,
  outcome: SrsAttemptOutcome,
  now: number = Date.now(),
): SRSProgress {
  switch (outcome.kind) {
    case 'graded':
      return applyReview(progress, outcome.grade, now);
    case 'timeout':
      return {
        ...progress,
        timeouts: (progress.timeouts ?? 0) + 1,
        lastReviewedAt: now,
      };
    default: {
      const unreachable: never = outcome;
      throw new Error(`未處理的作答結果：${JSON.stringify(unreachable)}`);
    }
  }
}

/** 高階封裝：對一份進度套用一次評分，回傳更新後的進度（純函式） */
export function applyReview(progress: SRSProgress, grade: number, now: number = Date.now()): SRSProgress {
  const { interval, easeFactor, repetitions } = calculateSM2(
    grade,
    progress.interval,
    progress.easeFactor,
    progress.repetitions,
  );

  return {
    ...progress,
    interval,
    easeFactor,
    repetitions,
    nextReviewDate: computeNextReviewDate(interval, now),
    lastReviewedAt: now,
    totalReviews: (progress.totalReviews ?? 0) + 1,
  };
}
