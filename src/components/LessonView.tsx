// src/components/LessonView.tsx
// ---------------------------------------------------------------------------
// Duolingo 風格的複習關卡：useQuizEngine（狀態機）+ useSRS（SM-2 大腦）+ iOS 外殼。
//
// iOS 重點：
// - IDLE 預熱畫面：按下「開始」才計時、才朗讀，繞過 iOS「音訊必須由使用者手勢觸發」的限制
// - 倒數條：純 CSS @keyframes srsTimerShrink（transform: scaleX，GPU 合成）+ onAnimationEnd
//   以負的 animation-delay 從「實際已經過的時間」接著播放；App 從背景回來時重新掛載即可對時
// - 安全區域：頂部 env(safe-area-inset-top)、底部 env(safe-area-inset-bottom)
//   需搭配 index.html 的 viewport-fit=cover
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationEvent, ReactNode } from 'react';
import { useSRS } from '../hooks/useSRS';
import { useQuizEngine } from '../hooks/useQuizEngine';
import {
  MAX_LESSON_SIZE,
  TIME_LIMIT_SECONDS,
  assertNever,
  buildLessonQuestions,
  describeCorrectAnswer,
  speechTextFor,
  type QuizAnswer,
  type QuizAttempt,
  type QuizQuestion,
  type SentenceTilesQuestion,
  type WordMeaningQuestion,
} from '../types/quiz';

// ===========================================================================
// 型別與常數
// ===========================================================================
interface LessonViewProps {
  /** 離開關卡時呼叫，回傳「本次關卡已提交的總 XP」 */
  onExit?: (earnedXp: number) => void;
}

interface FuriganaSegment {
  text: string;
  ruby?: string;
}

const INITIAL_LIVES = 5;

// ===========================================================================
// 工具函式
// ===========================================================================
/** 條件式 className 拼接 */
const cx = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ');

/** iOS WebKit 需要 touchstart 監聽器，:active 樣式才會在實機觸發 */
const noopTouch = (): void => undefined;

const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々]/;
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
    if (isKanji(word.charAt(i))) {
      let end = i;
      while (end < word.length && isKanji(word.charAt(end))) {
        end += 1;
      }
      const kanjiText = word.slice(i, end);

      let nextKanaIndex = end;
      while (nextKanaIndex < word.length && !isKana(word.charAt(nextKanaIndex))) {
        nextKanaIndex += 1;
      }
      const boundaryKana = nextKanaIndex < word.length ? word.charAt(nextKanaIndex) : '';

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
      const ch = word.charAt(i);
      segments.push({ text: ch });
      if (reading.charAt(r) === ch) {
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

/** 以系統日文語音朗讀（離線可用；第一次必須在使用者手勢內呼叫） */
function speakJapanese(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* 部分 WebView 不支援語音合成，忽略即可 */
  }
}

// ===========================================================================
// 小元件
// ===========================================================================
function HeartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-5 w-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M12 21s-6.7-4.35-9.33-8.02C.9 10.6 1.9 6.5 5.2 5.5c2-.6 4 .2 5.2 1.9 1.2-1.7 3.2-2.5 5.2-1.9 3.3 1 4.3 5.1 2.53 7.48C18.7 16.65 12 21 12 21z" />
    </svg>
  );
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-6 w-6', className)} fill="currentColor" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
    </svg>
  );
}

/** 重音型圈號（直接顯示字串，例如 '⓪'、'①'） */
function PitchAccentBadge({ value, className }: { value?: string; className?: string }) {
  if (!value) {
    return null;
  }
  return (
    <sup className={cx('text-[0.55rem] font-semibold leading-none text-neutral-400', className)}>{value}</sup>
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

/** 3D 大按鈕 */
function BigButton({
  tone,
  disabled = false,
  onClick,
  children,
}: {
  tone: 'green' | 'red';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onTouchStart={noopTouch}
      className={cx(
        'w-full rounded-2xl border-b-4 py-4 text-center text-lg font-extrabold uppercase tracking-widest',
        'touch-manipulation transition-all duration-150 [-webkit-tap-highlight-color:transparent]',
        disabled
          ? 'cursor-not-allowed border-neutral-300 bg-neutral-200 text-neutral-400'
          : tone === 'green'
            ? 'border-green-600 bg-green-500 text-white active:translate-y-[2px] active:border-b-2'
            : 'border-red-600 bg-red-500 text-white active:translate-y-[2px] active:border-b-2',
      )}
    >
      {children}
    </button>
  );
}

// ===========================================================================
// GPU 倒數條（第一層計時保護）
// ===========================================================================
interface TimerBarProps {
  durationMs: number;
  startedAt: number;
  running: boolean;
  onExpire: () => void;
}

/**
 * - 掛載時計算「已經過的時間」，以負的 animation-delay 從該進度開始播放
 * - 父層以 key={題目ID:timerEpoch} 掛載；App 回到前景時 timerEpoch 遞增 → 重新掛載 → 重新對時
 * - 作答後 animation-play-state: paused，畫面凍結在作答當下
 * - React 不逐幀更新任何 state
 */
function TimerBar({ durationMs, startedAt, running, onExpire }: TimerBarProps) {
  const [elapsedAtMount] = useState(() => Math.min(durationMs, Math.max(0, Date.now() - startedAt)));

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>): void => {
    if (event.animationName === 'srsTimerShrink') onExpire();
  };

  return (
    <div
      role="timer"
      aria-label={`限時 ${Math.round(durationMs / 1000)} 秒`}
      className="mx-4 h-2 overflow-hidden rounded-full bg-neutral-100"
    >
      <div
        className="h-full w-full origin-left rounded-full bg-red-500 will-change-transform"
        style={{
          animationName: 'srsTimerShrink',
          animationDuration: `${durationMs}ms`,
          animationTimingFunction: 'linear',
          animationFillMode: 'forwards',
          animationDelay: `-${elapsedAtMount}ms`,
          animationPlayState: running ? 'running' : 'paused',
        }}
        onAnimationEnd={handleAnimationEnd}
      />
    </div>
  );
}

// ===========================================================================
// 題型畫面
// ===========================================================================
interface BodyProps<Q extends QuizQuestion> {
  question: Q;
  draft: QuizAnswer | null;
  locked: boolean;
  onChange: (answer: QuizAnswer | null) => void;
}

function WordMeaningBody({ question, draft, locked, onChange }: BodyProps<WordMeaningQuestion>) {
  const selected = draft?.kind === 'WORD_MEANING' ? draft.optionIndex : null;

  return (
    <section>
      <h2 className="mt-5 text-center text-xs font-bold uppercase tracking-widest text-neutral-400">
        請選出正確的中文意思
      </h2>

      <div className="mt-8 flex flex-col items-center">
        <div className="flex items-start justify-center gap-2">
          <Furigana word={question.word} reading={question.reading} className="text-4xl font-bold text-neutral-800" />
          <PitchAccentBadge value={question.pitchAccent} className="mt-1" />
          <button
            type="button"
            onClick={() => speakJapanese(question.reading || question.word)}
            onTouchStart={noopTouch}
            aria-label="朗讀"
            className="ml-1 mt-1 flex h-10 w-10 items-center justify-center rounded-xl border-2 border-b-4 border-sky-200 text-sky-500 active:translate-y-[2px] active:border-b-2"
          >
            <SpeakerIcon />
          </button>
        </div>
        {question.romaji && <p className="mt-2 text-sm text-neutral-400">{question.romaji}</p>}
      </div>

      <div className="mx-auto mt-10 grid max-w-md grid-cols-1 gap-3">
        {question.options.map((option, index) => {
          const isSelected = selected === index;
          const isCorrect = index === question.correctIndex;
          return (
            <button
              key={question.id + '-' + index}
              type="button"
              disabled={locked}
              onClick={() => onChange({ kind: 'WORD_MEANING', optionIndex: index })}
              onTouchStart={noopTouch}
              className={cx(
                'w-full rounded-2xl border-2 border-b-4 px-5 py-4 text-left text-lg font-semibold transition-all duration-150',
                locked && isCorrect
                  ? 'border-green-500 border-b-green-600 bg-green-50 text-green-700'
                  : locked && isSelected
                    ? 'border-red-400 border-b-red-500 bg-red-50 text-red-600'
                    : isSelected
                      ? 'translate-y-[2px] border-sky-500 border-b-sky-600 bg-sky-50 text-sky-700'
                      : 'border-neutral-200 border-b-neutral-300 bg-white text-neutral-800 active:translate-y-[2px]',
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SentenceTilesBody({ question, draft, locked, onChange }: BodyProps<SentenceTilesQuestion>) {
  const placed: readonly number[] = draft?.kind === 'SENTENCE_TILES' ? draft.tileIndexes : [];
  const placedSet = new Set(placed);

  const place = (tileIndex: number): void => {
    onChange({ kind: 'SENTENCE_TILES', tileIndexes: [...placed, tileIndex] });
  };
  const removeAt = (position: number): void => {
    const next = placed.filter((_, i) => i !== position);
    onChange(next.length === 0 ? null : { kind: 'SENTENCE_TILES', tileIndexes: next });
  };

  return (
    <section>
      <h2 className="mt-5 text-center text-xs font-bold uppercase tracking-widest text-neutral-400">
        請排出正確的句子
      </h2>

      <div className="mt-6 text-center">
        <p className="text-2xl font-bold text-neutral-800">{question.meaning}</p>
        <p className="mt-1 text-sm text-neutral-400">（依中文意思排出正確的日文語序）</p>
      </div>

      {/* 置字空格區 */}
      <div className="mt-8 min-h-[4.5rem] rounded-2xl border-2 border-dashed border-neutral-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {placed.map((tileIndex, position) => (
            <button
              key={'placed-' + position + '-' + tileIndex}
              type="button"
              disabled={locked}
              onClick={() => removeAt(position)}
              onTouchStart={noopTouch}
              className="animate-srsPop rounded-xl border-2 border-b-4 border-sky-300 border-b-sky-400 bg-white px-4 py-2 text-lg font-semibold text-neutral-800 active:translate-y-[2px]"
            >
              {question.tiles[tileIndex]}
            </button>
          ))}
          {placed.length === 0 && <span className="px-2 py-2 text-sm text-neutral-300">點下方字卡放入此處</span>}
        </div>
      </div>

      {/* 下方碎字語塊 */}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {question.tiles.map((tile, tileIndex) => {
          const used = placedSet.has(tileIndex);
          return (
            <button
              key={'tile-' + tileIndex}
              type="button"
              disabled={locked || used}
              onClick={() => place(tileIndex)}
              onTouchStart={noopTouch}
              className={cx(
                'rounded-xl border-2 border-b-4 px-4 py-3 text-lg font-semibold transition-all duration-150',
                used
                  ? 'border-neutral-200 border-b-neutral-200 bg-neutral-200 text-transparent'
                  : 'border-neutral-200 border-b-neutral-300 bg-white text-neutral-800 active:translate-y-[2px]',
              )}
            >
              {tile}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 題型分派：完全窮舉，新增題型未處理時編譯期報錯 */
function QuestionBody({ question, draft, locked, onChange }: BodyProps<QuizQuestion>) {
  switch (question.kind) {
    case 'WORD_MEANING':
      return <WordMeaningBody question={question} draft={draft} locked={locked} onChange={onChange} />;
    case 'SENTENCE_TILES':
      return <SentenceTilesBody question={question} draft={draft} locked={locked} onChange={onChange} />;
    default:
      return assertNever(question);
  }
}

/** 草稿是否已可檢查 */
function isDraftComplete(question: QuizQuestion, draft: QuizAnswer | null): boolean {
  if (draft === null) return false;
  switch (question.kind) {
    case 'WORD_MEANING':
      return draft.kind === 'WORD_MEANING';
    case 'SENTENCE_TILES':
      return draft.kind === 'SENTENCE_TILES' && draft.tileIndexes.length === question.tiles.length;
    default:
      return assertNever(question);
  }
}

// ===========================================================================
// 結果卡片（由下往上滑出）
// ===========================================================================
function ResultSheet({
  attempt,
  question,
  onContinue,
}: {
  attempt: QuizAttempt;
  question: QuizQuestion;
  onContinue: () => void;
}) {
  const correct = attempt.outcome === 'perfect' || attempt.outcome === 'passed';
  const answer = describeCorrectAnswer(question);

  return (
    <div
      role="status"
      className={cx(
        'w-full animate-srsSlideUp px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5',
        correct ? 'bg-green-100' : 'bg-red-100',
      )}
    >
      {correct ? (
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-12 w-12 animate-srsPop items-center justify-center rounded-full bg-green-500 text-2xl font-black text-white">
            ✓
          </span>
          <span className="text-2xl font-extrabold text-green-700">
            {attempt.outcome === 'perfect' ? '太棒了！' : '勉強答對！'}
          </span>
          <span className="ml-auto text-lg font-extrabold text-green-600">+{attempt.xp} XP</span>
        </div>
      ) : (
        <div className="mb-4">
          <p className="text-lg font-extrabold text-red-600">
            {attempt.outcome === 'timeout' ? '時間到！正確解答：' : '正確解答：'}
          </p>
          <p className="mt-1 text-xl font-bold text-red-700">{answer.main}</p>
          <p className="mt-0.5 text-sm text-red-500">{answer.sub}</p>
        </div>
      )}

      <BigButton tone={correct ? 'green' : 'red'} onClick={onContinue}>
        繼續 Continue
      </BigButton>
    </div>
  );
}

// ===========================================================================
// 主元件
// ===========================================================================
export default function LessonView({ onExit }: LessonViewProps) {
  const { cards, dueCards, isLoaded, recordAttempt, saveError } = useSRS();

  // CONTINUE 時把結果交給 SRS：逾時不推進排程，其餘交給 SM-2
  const handleCommit = useCallback(
    (attempt: QuizAttempt) => {
      recordAttempt(
        attempt.cardId,
        attempt.grade === null ? { kind: 'timeout' } : { kind: 'graded', grade: attempt.grade },
      );
    },
    [recordAttempt],
  );

  const engine = useQuizEngine({ maxHearts: INITIAL_LIVES, onCommit: handleCommit });
  const { state, currentQuestion, timer } = engine;

  // 草稿綁定題目 ID：換題時自動失效
  const [draft, setDraft] = useState<{ questionId: string; answer: QuizAnswer } | null>(null);
  const currentDraft =
    currentQuestion !== null && draft !== null && draft.questionId === currentQuestion.id ? draft.answer : null;

  const handleDraftChange = useCallback(
    (answer: QuizAnswer | null) => {
      if (currentQuestion === null) return;
      setDraft(answer === null ? null : { questionId: currentQuestion.id, answer });
    },
    [currentQuestion],
  );

  // 新題目出現時自動朗讀（第一題已在「開始」手勢內朗讀，iOS 語音此後即已解鎖）
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== 'PLAYING' || currentQuestion === null) return;
    if (currentQuestion.kind !== 'WORD_MEANING') return;
    if (spokenRef.current === currentQuestion.id) return;
    spokenRef.current = currentQuestion.id;
    speakJapanese(speechTextFor(currentQuestion));
  }, [state.status, currentQuestion]);

  // IDLE：按下「開始」→ 建立題目快照、開始計時、在手勢內朗讀第一題
  const handleStart = useCallback(() => {
    const questions = buildLessonQuestions(dueCards, cards);
    const first = questions[0];
    if (first !== undefined && first.kind === 'WORD_MEANING') {
      spokenRef.current = first.id;
      speakJapanese(speechTextFor(first));
    }
    engine.start(questions);
  }, [dueCards, cards, engine]);

  const handleCheck = useCallback(() => {
    if (currentQuestion !== null && currentDraft !== null && isDraftComplete(currentQuestion, currentDraft)) {
      engine.submit(currentDraft);
    }
  }, [currentQuestion, currentDraft, engine]);

  // 離開關卡：只回傳已按 CONTINUE 提交的 XP
  const finish = useCallback(() => {
    onExit?.(engine.earnedXp);
  }, [onExit, engine.earnedXp]);

  // =========================================================================
  // 載入中
  // =========================================================================
  if (!isLoaded) {
    return <div className="flex min-h-screen items-center justify-center bg-white text-neutral-400">載入中…</div>;
  }

  // =========================================================================
  // IDLE：預熱畫面
  // =========================================================================
  if (state.status === 'IDLE') {
    if (dueCards.length === 0) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
          <span className="text-6xl">🎉</span>
          <h1 className="text-2xl font-extrabold text-neutral-800">今天沒有待複習的卡片</h1>
          <p className="text-neutral-500">所有卡片都還沒到期，明天再來吧。</p>
          <div className="mt-2 w-full max-w-xs">
            <BigButton tone="green" onClick={finish}>
              返回
            </BigButton>
          </div>
        </div>
      );
    }

    const count = Math.min(dueCards.length, MAX_LESSON_SIZE);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-white px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] text-center">
        <span className="flex h-24 w-24 animate-srsPop items-center justify-center rounded-full border-b-[6px] border-[#46a302] bg-[#58cc02] text-5xl font-black text-white">
          あ
        </span>
        <h1 className="text-3xl font-extrabold text-neutral-800">準備好了嗎？</h1>
        <p className="max-w-xs text-neutral-500">
          本關共 {count} 題，每題限時 {TIME_LIMIT_SECONDS.WORD_MEANING ?? 0} 秒。按下開始後才會開始計時與朗讀發音。
        </p>
        <div className="w-full max-w-xs">
          <BigButton tone="green" onClick={handleStart}>
            開始 Start
          </BigButton>
        </div>
        <button type="button" onClick={finish} className="text-sm font-semibold text-neutral-400 underline">
          返回地圖
        </button>
      </div>
    );
  }

  // =========================================================================
  // FINISHED：完成 / 愛心用完
  // =========================================================================
  if (state.status === 'FINISHED') {
    const correctCount = state.results.filter((r) => r.outcome === 'perfect' || r.outcome === 'passed').length;

    if (state.reason === 'out_of_hearts') {
      const canRefill = state.nextIndex < state.questions.length;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-white px-6 text-center">
          <HeartIcon className="h-16 w-16 animate-srsPop text-red-500" />
          <h1 className="text-2xl font-extrabold text-neutral-800">愛心用完了！</h1>
          <p className="max-w-xs text-neutral-500">
            別擔心，犯錯正是學習的一部分。目前已獲得 {engine.earnedXp} XP。
          </p>
          {canRefill && (
            <div className="w-full max-w-xs">
              <BigButton tone="green" onClick={engine.refillHearts}>
                補充愛心 ❤ {INITIAL_LIVES}
              </BigButton>
            </div>
          )}
          <button type="button" onClick={finish} className="text-sm font-semibold text-neutral-400 underline">
            帶著 {engine.earnedXp} XP 離開
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <span className="animate-srsPop text-6xl">🎉</span>
        <h1 className="text-2xl font-extrabold text-neutral-800">今日複習完成！</h1>
        <p className="text-neutral-500">
          答對 {correctCount} / {state.results.length} 題
        </p>
        <p className="text-3xl font-extrabold text-amber-500">+{engine.earnedXp} XP</p>
        <div className="mt-2 w-full max-w-xs">
          <BigButton tone="green" onClick={finish}>
            返回地圖
          </BigButton>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 作答中（PLAYING / ANSWER_SUBMITTED / TIMEOUT）
  // =========================================================================
  if (currentQuestion === null) {
    return null;
  }

  const locked = state.status !== 'PLAYING';
  const progressPct = Math.min(100, engine.progress * 100);

  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      {/* 頂部導覽列（避開瀏海） */}
      <header className="flex items-center gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={finish}
          onTouchStart={noopTouch}
          aria-label="關閉"
          className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Duolingo 綠色發光進度條（width + transition-all duration-500） */}
        <div className="h-4 flex-1 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.85)] transition-all duration-500 ease-out"
            style={{ width: progressPct + '%' }}
          />
        </div>

        {/* 紅愛心與生命值（數字變動時彈跳） */}
        <div
          key={state.hearts}
          className="flex shrink-0 animate-srsPop items-center gap-1 text-red-500"
          aria-label={`剩餘 ${state.hearts} 顆愛心`}
        >
          <HeartIcon />
          <span className="text-base font-extrabold">{state.hearts}</span>
        </div>
      </header>

      {/* 限時倒數條：key 含 timerEpoch，App 回到前景時重新掛載並對時 */}
      {timer !== null && (
        <TimerBar
          key={timer.questionId + ':' + engine.timerEpoch}
          durationMs={timer.durationMs}
          startedAt={timer.startedAt}
          running={state.status === 'PLAYING'}
          onExpire={engine.notifyTimerEnd}
        />
      )}

      {/* 題目區 */}
      <main className="flex-1 overflow-y-auto px-4 pb-56">
        {saveError !== null && (
          <p role="alert" className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
            進度未能寫入手機：{saveError}
          </p>
        )}
        <QuestionBody
          key={currentQuestion.id}
          question={currentQuestion}
          draft={currentDraft}
          locked={locked}
          onChange={handleDraftChange}
        />
      </main>

      {/* 底部固定區（避開 Home Indicator） */}
      <div className="fixed bottom-0 left-0 w-full">
        {state.status === 'PLAYING' ? (
          <div className="border-t border-neutral-200 bg-white px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
            <BigButton
              tone="green"
              disabled={!isDraftComplete(currentQuestion, currentDraft)}
              onClick={handleCheck}
            >
              檢查答案 Check
            </BigButton>
          </div>
        ) : (
          <ResultSheet
            key={state.pending.questionId}
            attempt={state.pending}
            question={currentQuestion}
            onContinue={engine.continueLesson}
          />
        )}
      </div>
    </div>
  );
}
