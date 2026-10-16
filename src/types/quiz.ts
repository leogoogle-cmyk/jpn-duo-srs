// src/types/quiz.ts
// ---------------------------------------------------------------------------
// 題型、答案、關卡狀態的辨別聯合型別（Discriminated Unions）與純函式。
//
// 新增題型（例如 N3 LINE 拼圖、N1 限時長文）時：
//   1. 新增 interface 並加入 QuizQuestion
//   2. 新增答案 interface 並加入 QuizAnswer
//   3. TIME_LIMIT_SECONDS、isAnswerCorrect、describeCorrectAnswer、
//      LessonView 的 QuestionBody 若漏處理，編譯期就會報錯
// ---------------------------------------------------------------------------
import type { Card, JlptLevel, ReviewGrade } from '../core/types';

/* ===========================================================================
 * 題型
 * ======================================================================== */

interface QuizQuestionBase {
  /** 題目 ID（每關唯一） */
  id: string;
  /** 對應的 SRS 卡片 ID */
  cardId: string;
  level: JlptLevel;
  /** 時限（秒）；null = 不限時 */
  timeLimitSeconds: number | null;
}

/** 題型 A：看單字選中文意思（四選一） */
export interface WordMeaningQuestion extends QuizQuestionBase {
  kind: 'WORD_MEANING';
  word: string;
  reading: string;
  romaji?: string;
  pitchAccent?: string;
  options: readonly string[];
  correctIndex: number;
}

/** 題型 B：依中文意思排出日文語塊 */
export interface SentenceTilesQuestion extends QuizQuestionBase {
  kind: 'SENTENCE_TILES';
  /** 中文意思（題目） */
  meaning: string;
  /** 正確日文句子 */
  sentence: string;
  reading: string;
  /** 已洗牌的語塊 */
  tiles: readonly string[];
  /** 正確順序的語塊 */
  answerTiles: readonly string[];
}

export type QuizQuestion = WordMeaningQuestion | SentenceTilesQuestion;
export type QuizKind = QuizQuestion['kind'];

/* ===========================================================================
 * 答案
 * ======================================================================== */

export interface WordMeaningAnswer {
  kind: 'WORD_MEANING';
  optionIndex: number;
}

export interface SentenceTilesAnswer {
  kind: 'SENTENCE_TILES';
  /** 使用者排列順序（tiles 的索引） */
  tileIndexes: readonly number[];
}

export type QuizAnswer = WordMeaningAnswer | SentenceTilesAnswer;

/** 依題型取得對應答案型別，例如 AnswerFor<'WORD_MEANING'> */
export type AnswerFor<K extends QuizKind> = Extract<QuizAnswer, { kind: K }>;

/* ===========================================================================
 * 作答紀錄與關卡狀態
 * ======================================================================== */

/** perfect = 快速答對、passed = 答對但慢、incorrect = 答錯、timeout = 逾時 */
export type AttemptOutcome = 'perfect' | 'passed' | 'incorrect' | 'timeout';

export interface QuizAttempt {
  questionId: string;
  cardId: string;
  kind: QuizKind;
  outcome: AttemptOutcome;
  /** SM-2 評分；逾時為 null（不推進排程） */
  grade: ReviewGrade | null;
  /** 本題獲得的 XP */
  xp: number;
  /** 逾時為 null */
  answer: QuizAnswer | null;
  /** 答題耗時（毫秒），限時題以時限為上限 */
  responseTimeMs: number;
  /** 作答時間（epoch ms） */
  answeredAt: number;
}

export type FinishReason = 'completed' | 'out_of_hearts';

interface SessionBase {
  questions: readonly QuizQuestion[];
  hearts: number;
  maxHearts: number;
  /** 已按 CONTINUE 提交的紀錄 */
  results: readonly QuizAttempt[];
}

interface ActiveBase extends SessionBase {
  index: number;
  /** 本題開始時間（epoch ms） */
  startedAt: number;
  /** 截止時間（epoch ms）；null = 不限時 */
  deadline: number | null;
}

/**
 * 關卡狀態本身就是辨別聯合型別：
 * pending 只存在於 ANSWER_SUBMITTED 與 TIMEOUT，
 * 在 IDLE / PLAYING / FINISHED 讀取 state.pending 會直接編譯錯誤。
 */
export type QuizState =
  | (SessionBase & { status: 'IDLE' })
  | (ActiveBase & { status: 'PLAYING' })
  | (ActiveBase & { status: 'ANSWER_SUBMITTED'; pending: QuizAttempt })
  | (ActiveBase & { status: 'TIMEOUT'; pending: QuizAttempt })
  | (SessionBase & { status: 'FINISHED'; reason: FinishReason; nextIndex: number });

export type QuizStatus = QuizState['status'];

export type QuizAction =
  | { type: 'START'; questions: readonly QuizQuestion[]; now: number }
  | { type: 'SUBMIT'; answer: QuizAnswer; now: number }
  | { type: 'TIMEOUT'; now: number }
  | { type: 'CONTINUE'; now: number }
  | { type: 'REFILL_HEARTS'; now: number }
  | { type: 'RESET' };

/* ===========================================================================
 * 常數
 * ======================================================================== */

/** 各題型時限（秒）；Record<QuizKind, …> 確保新增題型時必須設定 */
export const TIME_LIMIT_SECONDS: Record<QuizKind, number | null> = {
  WORD_MEANING: 15,
  SENTENCE_TILES: 15,
};

/** 在此毫秒數內答對視為「完美秒殺」(grade 5)，否則「勉強答對」(grade 3) */
export const QUICK_ANSWER_MS = 7000;

/** 每關最多題數 */
export const MAX_LESSON_SIZE = 20;

const OPTION_COUNT = 4;

/* ===========================================================================
 * 純函式
 * ======================================================================== */

/** 窮舉檢查：若有分支未處理，傳入值不是 never，編譯期即報錯 */
export function assertNever(x: never): never {
  throw new Error(`未處理的辨別聯合成員：${JSON.stringify(x)}`);
}

/** 題目時限（毫秒）；null = 不限時 */
export function getTimeLimitMs(question: QuizQuestion): number | null {
  const seconds = question.timeLimitSeconds;
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

/** 判斷答案是否正確（題型與答案種類不符時一律錯誤） */
export function isAnswerCorrect(question: QuizQuestion, answer: QuizAnswer): boolean {
  switch (question.kind) {
    case 'WORD_MEANING':
      return answer.kind === 'WORD_MEANING' && answer.optionIndex === question.correctIndex;
    case 'SENTENCE_TILES': {
      if (answer.kind !== 'SENTENCE_TILES') return false;
      const indexes = answer.tileIndexes;
      if (indexes.length !== question.tiles.length) return false;
      if (new Set(indexes).size !== indexes.length) return false;
      const built: string[] = [];
      for (const index of indexes) {
        const tile = question.tiles[index];
        if (tile === undefined) return false;
        built.push(tile);
      }
      // 以串接後的文字比對：語塊重複或切法不同時仍能正確判定
      return built.join('') === question.answerTiles.join('');
    }
    default:
      return assertNever(question);
  }
}

/** 答對 + 耗時 → SM-2 評分：快速 5、慢 3、答錯 0 */
export function gradeFor(correct: boolean, responseTimeMs: number): ReviewGrade {
  if (!correct) return 0;
  return responseTimeMs <= QUICK_ANSWER_MS ? 5 : 3;
}

/** 評分 → XP：完美 50、勉強 30、答錯或逾時 0 */
export function xpForGrade(grade: ReviewGrade | null): number {
  if (grade === 5) return 50;
  if (grade === 3) return 30;
  return 0;
}

/** 結果卡片上顯示的正確答案 */
export function describeCorrectAnswer(question: QuizQuestion): { main: string; sub: string } {
  switch (question.kind) {
    case 'WORD_MEANING':
      return {
        main: question.options[question.correctIndex] ?? '',
        sub: `${question.word}（${question.reading}）`,
      };
    case 'SENTENCE_TILES':
      return { main: question.sentence, sub: `${question.reading}．${question.meaning}` };
    default:
      return assertNever(question);
  }
}

/** 題目要朗讀的日文（讀音） */
export function speechTextFor(question: QuizQuestion): string {
  switch (question.kind) {
    case 'WORD_MEANING':
      return question.reading || question.word;
    case 'SENTENCE_TILES':
      return question.reading || question.sentence;
    default:
      return assertNever(question);
  }
}

/* ===========================================================================
 * 題目產生（Card → QuizQuestion）
 * ======================================================================== */

/** Fisher-Yates 洗牌（回傳新陣列，不改動輸入） */
export function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a === undefined || b === undefined) continue;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

/** 常見助詞（單字元），切句時獨立成塊 */
const KANA_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'へ', 'の', 'や', 'か', 'ね', 'よ', 'さ', 'な', 'ぞ', 'ぜ', 'わ',
]);

/** 常見助動詞 / 語尾（多字元），需在助詞之前優先比對 */
const SENTENCE_AUXILIARIES = ['ませんでした', 'ましょう', 'ません', 'でした', 'ください', 'です', 'ます'];

/** 標點與空白 */
const PUNCTUATION_RE = /[。、．，！？!?…「」『』（）()・　 ]/;

/** 自動切詞備援（僅在卡片未提供 tiles 時使用） */
export function tokenizeSentence(sentence: string): string[] {
  const tokens: string[] = [];
  let buffer = '';

  const flush = (): void => {
    if (buffer.length > 0) {
      tokens.push(buffer);
      buffer = '';
    }
  };

  let i = 0;
  while (i < sentence.length) {
    const aux = SENTENCE_AUXILIARIES.find((word) => sentence.startsWith(word, i));
    if (aux) {
      flush();
      tokens.push(aux);
      i += aux.length;
      continue;
    }
    const ch = sentence.charAt(i);
    if (PUNCTUATION_RE.test(ch) || KANA_PARTICLES.has(ch)) {
      flush();
      tokens.push(ch);
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();

  return tokens.length > 0 ? tokens : [sentence];
}

/** 單張卡片 → 題目 */
export function buildQuestion(card: Card, allCards: readonly Card[], index: number): QuizQuestion {
  const base = {
    id: `${card.id}#${index}`,
    cardId: card.id,
    level: card.level ?? 'N5',
  };

  if (card.type === 'word') {
    const distractors = shuffle(
      Array.from(
        new Set(
          allCards
            .filter((c) => c.id !== card.id && c.type === 'word' && c.meaning !== card.meaning)
            .map((c) => c.meaning),
        ),
      ),
    ).slice(0, OPTION_COUNT - 1);
    const options = shuffle([card.meaning, ...distractors]);
    return {
      ...base,
      kind: 'WORD_MEANING',
      timeLimitSeconds: TIME_LIMIT_SECONDS.WORD_MEANING,
      word: card.word,
      reading: card.reading,
      romaji: card.romaji,
      pitchAccent: card.pitchAccent,
      options,
      correctIndex: options.indexOf(card.meaning),
    };
  }

  const answerTiles = card.tiles && card.tiles.length > 0 ? [...card.tiles] : tokenizeSentence(card.word);
  return {
    ...base,
    kind: 'SENTENCE_TILES',
    timeLimitSeconds: TIME_LIMIT_SECONDS.SENTENCE_TILES,
    meaning: card.meaning,
    sentence: card.word,
    reading: card.reading,
    tiles: shuffle(answerTiles),
    answerTiles,
  };
}

/** 到期卡片 → 一關的題目快照（開始後題目不會因 SRS 更新而變動） */
export function buildLessonQuestions(
  dueCards: readonly Card[],
  allCards: readonly Card[],
  maxSize: number = MAX_LESSON_SIZE,
): QuizQuestion[] {
  return dueCards.slice(0, maxSize).map((card, index) => buildQuestion(card, allCards, index));
}
