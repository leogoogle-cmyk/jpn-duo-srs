// src/core/types.ts
// ---------------------------------------------------------------------------
// 資料模型定義：JLPT N5–N1 卡片 (Card) 與 SRS 學習進度 (SRSProgress)
// ---------------------------------------------------------------------------

/** 卡片類型：單字 / 句子 */
export type CardType = 'word' | 'sentence';

/** JLPT 級別（目前聚焦 N5，保留欄位以便擴充至 N1） */
export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

/** JLPT 學習卡片 */
export interface Card {
  /** 穩定唯一 ID，例如 "n5-word-0001"（務必穩定，否則進度會對不上） */
  id: string;
  /** 日文原文（單字或句子） */
  word: string;
  /** 假名讀音 */
  reading: string;
  /** 詞義（繁體中文為主） */
  meaning: string;
  /** 卡片類型：單字 / 句子 */
  type: CardType;
  /** 選配：東京標準語重音型，直接以圈號字串表示，例如 '⓪'、'①'、'②' */
  pitchAccent?: string;
  /** 選配：句子題型的語塊（word bank）。省略時 UI 以規則自動切詞 */
  tiles?: string[];
  /** 選配：羅馬拼音 */
  romaji?: string;
  /** 選配：JLPT 級別 */
  level?: JlptLevel;
  /** 選配：標籤，例如 ['動詞', '五段'] */
  tags?: string[];
  /** 選配：例句 */
  example?: string;
}

/** SRS 學習進度（一張 Card 對應一筆） */
export interface SRSProgress {
  /** 對應 Card.id */
  cardId: string;
  /** 下次複習時間（Unix epoch 毫秒；數字方便排序與 JSON 序列化） */
  nextReviewDate: number;
  /** 當前複習間隔（天） */
  interval: number;
  /** 難易度因子 EF（下限 1.3，預設 2.5） */
  easeFactor: number;
  /** 連續答對次數（答錯歸零） */
  repetitions: number;
  /** 選配：最後複習時間（epoch 毫秒） */
  lastReviewedAt?: number;
  /** 選配：累計複習次數 */
  totalReviews?: number;
  /** 選配：累計逾時次數（逾時不推進排程，只累加此欄位） */
  timeouts?: number;
}

/** 提交給 SRS 的評分：0 完全答錯/超時、3 勉強答對、5 完美秒殺 */
export type ReviewGrade = 0 | 3 | 5;

/** 單次複習紀錄（統計 / 除錯用） */
export interface ReviewLog {
  cardId: string;
  grade: number;
  reviewedAt: number;
  prevInterval: number;
  nextInterval: number;
  prevEaseFactor: number;
  nextEaseFactor: number;
}
