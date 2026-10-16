// src/components/LessonView.tsx
// ---------------------------------------------------------------------------
// Duolingo 風格的複習關卡主畫面：把 useSRS 的 SRS 大腦接上 iOS 互動 UI。
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSRS } from '../hooks/useSRS';

// ===========================================================================
// 型別
// ===========================================================================
interface LessonViewProps {
  /** 離開關卡時呼叫，回傳「本次關卡賺得的總 XP」 */
  onExit?: (earnedXp: number) => void;
}

interface FuriganaSegment {
  text: string;
  ruby?: string;
}

interface Tile {
  id: number;
  text: string;
}

interface McOption {
  text: string;
  correct: boolean;
}

interface QuizResult {
  correct: boolean;
  timedOut: boolean;
  grade: number;
  /** 本次作答對應的 XP */
  xp: number;
}

type Phase = 'answering' | 'result';

// ===========================================================================
// 常數
// ===========================================================================
const INITIAL_LIVES = 5;
const OPTION_COUNT = 4;

/**
 * 超時分數：0 = 完全答錯 / 超時（不推進 SM-2 排程）。
 * SM-2 中只有 grade >= 3 才會推進複習排程，故超時設 0。
 */
const TIMEOUT_GRADE = 0;

/** 在此毫秒數內答對視為「完美秒殺」(grade 5)，否則「勉強答對」(grade 3) */
const QUICK_ANSWER_MS = 7000;

/** SM-2 評分 → XP：完美 50、勉強 30、答錯 / 超時 0 */
function gradeToXp(grade: number): number {
  if (grade >= 5) return 50;
  if (grade >= 3) return 30;
  return 0;
}

// ===========================================================================
// 工具函式
// ===========================================================================
/** 條件式 className 拼接 */
const cx = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ');

const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々]/;
const isKanji = (ch: string): boolean => KANJI_RE.test(ch);
const isKana = (ch: string): boolean => /[぀-ゟ゠-ヿ]/.test(ch);

/**
 * 由「單字 + 讀音」自動切出振假名區段（以正則判定漢字 / 假名）。
 * 例：buildFurigana('食べる', 'たべる') -> [{text:'食',ruby:'た'},{text:'べる'}]
 */
export function buildFurigana(word: string, reading: string): FuriganaSegment[] {
  if (!reading || word === reading) {
    return [{ text: word }];
  }

  const segments: FuriganaSegment[] = [];
  let r = 0;
  let i = 0;

  while (i < word.length) {
    if (isKanji(word[i])) {
      let end = i;
      while (end < word.length && isKanji(word[end])) {
        end += 1;
      }
      const kanjiText = word.slice(i, end);

      let nextKanaIndex = end;
      while (nextKanaIndex < word.length && !isKana(word[nextKanaIndex])) {
        nextKanaIndex += 1;
      }
      const boundaryKana = nextKanaIndex < word.length ? word[nextKanaIndex] : '';

      let rubyEnd: number;
      if (boundaryKana) {
        const found = reading.indexOf(boundaryKana, r);
        rubyEnd = found === -1 ? reading.length : found;
      } else {
        rubyEnd = reading.length;
      }

      const ruby = reading.slice(r, rubyEnd);
      segments.push(ruby ? { text: kanjiText, ruby } : { text: kanjiText });
      r = rubyEnd;
      i = end;
    } else {
      const ch = word[i];
      segments.push({ text: ch });
      if (reading[r] === ch) {
        r += 1;
      } else {
        const found = reading.indexOf(ch, r);
        if (found !== -1) {
          r = found + 1;
        }
      }
      i += 1;
    }
  }

  return segments;
}

/** 常見助詞（單字元），切句時獨立成塊 */
const KANA_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'へ', 'の', 'や', 'か', 'ね', 'よ', 'さ', 'な', 'ぞ', 'ぜ', 'わ',
]);

/** 常見助動詞 / 語尾（多字元），需在助詞之前優先比對 */
const SENTENCE_AUXILIARIES = ['ませんでした', 'ましょう', 'ません', 'でした', 'ください', 'です', 'ます'];

/** 標點與空白（正則） */
const PUNCTUATION_RE = /[。、．，！？!?…「」『』（）()・　 ]/;

/**
 * 自動切詞備援（僅在卡片未提供 tiles 時使用）。
 * 以正則判定標點，並依助詞 / 語尾規則切成語塊。
 */
function tokenizeSentence(sentence: string): string[] {
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

    const ch = sentence[i];
    if (PUNCTUATION_RE.test(ch)) {
      flush();
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (KANA_PARTICLES.has(ch)) {
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

/** Fisher-Yates 洗牌（回傳新陣列，不改動輸入） */
function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ===========================================================================
// 子元件
// ===========================================================================
function HeartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-5 w-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M12 21s-6.7-4.35-9.33-8.02C.9 10.6 1.9 6.5 5.2 5.5c2-.6 4 .2 5.2 1.9 1.2-1.7 3.2-2.5 5.2-1.9 3.3 1 4.3 5.1 2.53 7.48C18.7 16.65 12 21 12 21z" />
    </svg>
  );
}

/** 重音型圈號（直接顯示字串，例如 '⓪'、'①'） */
function PitchAccentBadge({ value, className }: { value?: string; className?: string }) {
  if (!value) {
    return null;
  }
  return (
    <sup className={cx('text-[0.55rem] font-semibold leading-none text-neutral-400', className)}>
      {value}
    </sup>
  );
}

/** 使用 <ruby> / <rt> 渲染漢字振假名 */
function Furigana({ word, reading, className }: { word: string; reading: string; className?: string }) {
  const segments = useMemo(() => buildFurigana(word, reading), [word, reading]);
  return (
    <span className={className}>
      {segments.map((seg, index) =>
        seg.ruby ? (
          <ruby key={seg.text + '-' + index}>
            {seg.text}
            <rt className="text-[0.4em] font-normal text-sky-600">{seg.ruby}</rt>
          </ruby>
        ) : (
          <span key={seg.text + '-' + index}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

// ===========================================================================
// 主元件
// ===========================================================================
export default function LessonView({ onExit }: LessonViewProps) {
  const { cards, currentCard, dueCount, submitAnswer, isLoaded } = useSRS();

  const [sessionTotal, setSessionTotal] = useState(0);
  const [lives, setLives] = useState(INITIAL_LIVES);

  const [phase, setPhase] = useState<Phase>('answering');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [placedIds, setPlacedIds] = useState<number[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);

  // 本題開始時間（用於判斷「完美秒殺」或「勉強答對」）
  const startedAtRef = useRef<number>(Date.now());
  // 本次關卡累積的 XP（離開時回傳給 App）
  const sessionXpRef = useRef<number>(0);

  const card = currentCard;
  const isWordType = card?.type === 'word';

  // sessionTotal：本次會話一開始的待複習總數
  useEffect(() => {
    if (card && sessionTotal === 0) {
      setSessionTotal(dueCount);
    }
  }, [card, dueCount, sessionTotal]);

  // 換題時重置題目層狀態，並重設本題計時起點
  useEffect(() => {
    setPhase('answering');
    setSelectedIndex(null);
    setPlacedIds([]);
    setResult(null);
    startedAtRef.current = Date.now();
  }, [card?.id]);

  // 題型 A：四選一選項（含 3 個干擾項）
  const mcOptions = useMemo<McOption[]>(() => {
    if (!card || card.type !== 'word') {
      return [];
    }
    const uniqueMeanings = Array.from(
      new Set(cards.filter((c) => c.id !== card.id && c.meaning !== card.meaning).map((c) => c.meaning)),
    );
    const distractors = shuffle(uniqueMeanings).slice(0, OPTION_COUNT - 1);
    const options: McOption[] = [
      { text: card.meaning, correct: true },
      ...distractors.map((text) => ({ text, correct: false })),
    ];
    return shuffle(options);
  }, [card, cards]);

  // 題型 B：語塊拼圖
  const sentenceTiles = useMemo<Tile[]>(() => {
    if (!card || card.type !== 'sentence') {
      return [];
    }
    const raw = card.tiles && card.tiles.length > 0 ? card.tiles : tokenizeSentence(card.word);
    return raw.map((text, id) => ({ id, text }));
  }, [card]);

  const tileById = useMemo(
    () => new Map(sentenceTiles.map((tile) => [tile.id, tile])),
    [sentenceTiles],
  );

  const shuffledTileOrder = useMemo<number[]>(
    () => shuffle(sentenceTiles.map((tile) => tile.id)),
    [sentenceTiles],
  );

  const placedTiles = useMemo<Tile[]>(
    () => placedIds.map((id) => tileById.get(id)).filter((tile): tile is Tile => tile !== undefined),
    [placedIds, tileById],
  );

  const remainingTiles = useMemo<Tile[]>(
    () =>
      shuffledTileOrder
        .filter((id) => !placedIds.includes(id))
        .map((id) => tileById.get(id))
        .filter((tile): tile is Tile => tile !== undefined),
    [shuffledTileOrder, placedIds, tileById],
  );

  // 進度條百分比 = 已完成 / 總題數
  const completed = Math.max(0, sessionTotal - dueCount);
  const progressPct = sessionTotal > 0 ? Math.min(100, (completed / sessionTotal) * 100) : 0;

  const canCheck =
    phase === 'answering' &&
    card !== null &&
    (isWordType
      ? selectedIndex !== null
      : sentenceTiles.length > 0 && placedIds.length === sentenceTiles.length);

  const handleCheck = useCallback(() => {
    if (!card || phase !== 'answering') {
      return;
    }

    let correct = false;
    if (isWordType) {
      if (selectedIndex === null) {
        return;
      }
      correct = mcOptions[selectedIndex]?.correct === true;
    } else {
      if (sentenceTiles.length === 0 || placedIds.length !== sentenceTiles.length) {
        return;
      }
      const built = placedIds.map((id) => tileById.get(id)?.text ?? '').join('');
      const original = sentenceTiles.map((tile) => tile.text).join('');
      correct = built === original;
    }

    // 依作答時間決定評分：答對且夠快 = 5（完美）、答對但慢 = 3（勉強）、答錯 = 0
    const elapsed = Date.now() - startedAtRef.current;
    const grade = correct ? (elapsed <= QUICK_ANSWER_MS ? 5 : 3) : 0;
    setResult({ correct, timedOut: false, grade, xp: gradeToXp(grade) });
    setPhase('result');
    if (!correct) {
      setLives((prev) => Math.max(0, prev - 1));
    }
  }, [card, phase, isWordType, selectedIndex, mcOptions, sentenceTiles, placedIds, tileById]);

  // 逾時：由 CSS 動畫結束事件觸發（不逐毫秒 setInterval）
  const handleTimeout = useCallback(() => {
    if (phase !== 'answering' || !card) {
      return;
    }
    setResult({ correct: false, timedOut: true, grade: TIMEOUT_GRADE, xp: gradeToXp(TIMEOUT_GRADE) });
    setPhase('result');
    setLives((prev) => Math.max(0, prev - 1));
  }, [phase, card]);

  // 繼續：正式把分數交給 useSRS 的 submitAnswer
  const handleContinue = useCallback(() => {
    if (!result) {
      return;
    }
    submitAnswer(result.grade);
    sessionXpRef.current += result.xp;
    setPhase('answering');
    setSelectedIndex(null);
    setPlacedIds([]);
    setResult(null);
  }, [result, submitAnswer]);

  const refillHearts = useCallback(() => setLives(INITIAL_LIVES), []);

  // 離開關卡：把本次賺得的 XP 交回 App
  const finish = useCallback(() => {
    onExit?.(sessionXpRef.current);
  }, [onExit]);

  const correctAnswerMain = isWordType ? card?.meaning ?? '' : card?.word ?? '';
  const correctAnswerSub = isWordType
    ? (card?.word ?? '') + '（' + (card?.reading ?? '') + '）'
    : (card?.reading ?? '') + '．' + (card?.meaning ?? '');

  // =========================================================================
  // 早退分支（皆在所有 hook 之後）
  // =========================================================================
  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-neutral-400">
        載入中…
      </div>
    );
  }

  if (lives === 0 && phase === 'answering') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-white px-6 text-center">
        <HeartIcon className="h-16 w-16 text-red-500" />
        <h1 className="text-2xl font-extrabold text-neutral-800">愛心用完了！</h1>
        <p className="max-w-xs text-neutral-500">別擔心，犯錯正是學習的一部分。補充愛心後繼續挑戰。</p>
        <button
          type="button"
          onClick={refillHearts}
          className="w-full max-w-xs rounded-2xl border-b-4 border-green-600 bg-green-500 py-4 text-lg font-extrabold text-white active:translate-y-[2px] active:border-b-2"
        >
          補充愛心 ❤ {INITIAL_LIVES}
        </button>
        <button type="button" onClick={finish} className="text-sm font-semibold text-neutral-400 underline">
          離開
        </button>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <span className="text-6xl">🎉</span>
        <h1 className="text-2xl font-extrabold text-neutral-800">今日複習完成！</h1>
        <p className="text-neutral-500">你已完成 {completed} 張卡片的複習，明天見。</p>
        <button
          type="button"
          onClick={finish}
          className="mt-2 w-full max-w-xs rounded-2xl border-b-4 border-green-600 bg-green-500 py-4 text-lg font-extrabold text-white active:translate-y-[2px] active:border-b-2"
        >
          返回
        </button>
      </div>
    );
  }

  // =========================================================================
  // 主要畫面
  // =========================================================================
  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      {/* 頂部導覽列（避開瀏海） */}
      <header className="flex items-center gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={finish}
          aria-label="關閉"
          className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Duolingo 綠色發光進度條 */}
        <div className="h-4 flex-1 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.85)] transition-all duration-500 ease-out"
            style={{ width: progressPct + '%' }}
          />
        </div>

        {/* 紅愛心與生命值 */}
        <div className="flex shrink-0 items-center gap-1 text-red-500">
          <HeartIcon />
          <span className="text-base font-extrabold">{lives}</span>
        </div>
      </header>

      {/* 限時倒數條（純 CSS 動畫，GPU 合成） */}
      {phase === 'answering' && (
        <div className="mx-4 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            key={card.id}
            className="h-full w-full origin-left rounded-full bg-red-500 animate-srsTimerShrink"
            onAnimationEnd={handleTimeout}
          />
        </div>
      )}

      {/* 題目區 */}
      <main className="flex-1 overflow-y-auto px-4 pb-56">
        {isWordType ? (
          <section>
            <h2 className="mt-5 text-center text-xs font-bold uppercase tracking-widest text-neutral-400">
              請選出正確的中文意思
            </h2>

            <div className="mt-8 flex flex-col items-center">
              <div className="flex items-start justify-center">
                <Furigana word={card.word} reading={card.reading} className="text-4xl font-bold text-neutral-800" />
                <PitchAccentBadge value={card.pitchAccent} className="ml-1 mt-1" />
              </div>
              <p className="mt-2 text-sm text-neutral-400">{card.romaji}</p>
            </div>

            <div className="mx-auto mt-10 grid max-w-md grid-cols-1 gap-3">
              {mcOptions.map((option, index) => {
                const selected = selectedIndex === index;
                return (
                  <button
                    key={option.text + '-' + index}
                    type="button"
                    disabled={phase === 'result'}
                    onClick={() => setSelectedIndex(index)}
                    className={cx(
                      'w-full rounded-2xl border-2 border-b-4 px-5 py-4 text-left text-lg font-semibold transition-all duration-150',
                      selected
                        ? 'translate-y-[2px] border-sky-500 border-b-sky-600 bg-sky-50 text-sky-700'
                        : 'border-neutral-200 border-b-neutral-300 bg-white text-neutral-800 active:translate-y-[2px]',
                    )}
                  >
                    {option.text}
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <section>
            <h2 className="mt-5 text-center text-xs font-bold uppercase tracking-widest text-neutral-400">
              請排出正確的句子
            </h2>

            <div className="mt-6 text-center">
              <p className="text-2xl font-bold text-neutral-800">{card.meaning}</p>
              <p className="mt-1 text-sm text-neutral-400">（依中文意思排出正確的日文語序）</p>
            </div>

            {/* 置字空格區 */}
            <div className="mt-8 min-h-[4.5rem] rounded-2xl border-2 border-dashed border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {placedTiles.map((tile) => (
                  <button
                    key={'placed-' + tile.id}
                    type="button"
                    disabled={phase === 'result'}
                    onClick={() => setPlacedIds((ids) => ids.filter((id) => id !== tile.id))}
                    className="rounded-xl border-2 border-b-4 border-sky-300 border-b-sky-400 bg-white px-4 py-2 text-lg font-semibold text-neutral-800 animate-srsPop active:translate-y-[2px]"
                  >
                    {tile.text}
                  </button>
                ))}
                {placedTiles.length === 0 && (
                  <span className="px-2 py-2 text-sm text-neutral-300">點下方字卡放入此處</span>
                )}
              </div>
            </div>

            {/* 下方碎字語塊 */}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {remainingTiles.map((tile) => (
                <button
                  key={'tile-' + tile.id}
                  type="button"
                  disabled={phase === 'result'}
                  onClick={() => setPlacedIds((ids) => [...ids, tile.id])}
                  className="rounded-xl border-2 border-b-4 border-neutral-200 border-b-neutral-300 bg-white px-4 py-3 text-lg font-semibold text-neutral-800 transition-all duration-150 active:translate-y-[2px]"
                >
                  {tile.text}
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* 底部固定區（避開 Home Indicator） */}
      <div className="fixed bottom-0 left-0 w-full">
        {phase === 'answering' ? (
          <div className="border-t border-neutral-200 bg-white px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
            <button
              type="button"
              disabled={!canCheck}
              onClick={handleCheck}
              className={cx(
                'w-full rounded-2xl border-b-4 py-4 text-center text-lg font-extrabold uppercase tracking-widest transition-all duration-150',
                canCheck
                  ? 'border-green-600 bg-green-500 text-white active:translate-y-[2px] active:border-b-2'
                  : 'cursor-not-allowed border-neutral-300 bg-neutral-200 text-neutral-400',
              )}
            >
              檢查答案 Check
            </button>
          </div>
        ) : (
          result && (
            <div
              className={cx(
                'w-full px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 animate-srsSlideUp',
                result.correct ? 'bg-green-100' : 'bg-red-100',
              )}
            >
              {result.correct ? (
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-2xl font-black text-white">
                    ✓
                  </span>
                  <span className="text-2xl font-extrabold text-green-700">
                    {result.grade >= 5 ? '太棒了！' : '勉強答對！'}
                  </span>
                  <span className="ml-auto text-lg font-extrabold text-green-600">
                    +{result.xp} XP
                  </span>
                </div>
              ) : (
                <div className="mb-4">
                  <p className="text-lg font-extrabold text-red-600">
                    {result.timedOut ? '時間到！' : '正確解答：'}
                  </p>
                  <p className="mt-1 text-xl font-bold text-red-700">{correctAnswerMain}</p>
                  <p className="mt-0.5 text-sm text-red-500">{correctAnswerSub}</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleContinue}
                className={cx(
                  'w-full rounded-2xl border-b-4 py-4 text-center text-lg font-extrabold uppercase tracking-widest text-white active:translate-y-[2px] active:border-b-2',
                  result.correct ? 'border-green-600 bg-green-500' : 'border-red-600 bg-red-500',
                )}
              >
                繼續 Continue
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
