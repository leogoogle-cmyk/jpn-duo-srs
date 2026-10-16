// src/hooks/useQuizEngine.ts
// ---------------------------------------------------------------------------
// 關卡狀態機：純函式 quizReducer + 計時保護 hook。
//
//   IDLE ──START──▶ PLAYING ──SUBMIT──▶ ANSWER_SUBMITTED ─┐
//                      └─────TIMEOUT──▶ TIMEOUT ──────────┴─CONTINUE─▶ PLAYING …… ▶ FINISHED
//
// ANSWER_SUBMITTED 與 TIMEOUT 為互斥分支：每題只會進入其中一個。
// 狀態機不知道題型細節，只依 currentQuestion.timeLimitSeconds 是否為 null 決定是否計時。
// 儲存交給呼叫端（onCommit），讓狀態機維持可測試的純邏輯。
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  assertNever,
  getTimeLimitMs,
  gradeFor,
  isAnswerCorrect,
  xpForGrade,
  type AttemptOutcome,
  type QuizAction,
  type QuizAnswer,
  type QuizAttempt,
  type QuizQuestion,
  type QuizState,
} from '../types/quiz';

/** CSS 動畫結束可能比截止時間早幾毫秒觸發，容許此誤差 */
export const TIMEOUT_TOLERANCE_MS = 150;
/** 備援計時器在截止後多久補判逾時（動畫事件遺失時才會用到） */
const FALLBACK_GRACE_MS = 400;

/* ===========================================================================
 * 純函式 Reducer
 * ======================================================================== */

export function createInitialQuizState(maxHearts = 5): QuizState {
  return { status: 'IDLE', questions: [], hearts: maxHearts, maxHearts, results: [] };
}

interface Session {
  questions: readonly QuizQuestion[];
  hearts: number;
  maxHearts: number;
  results: readonly QuizAttempt[];
}

/** 只保留共用欄位，避免把上一個狀態的 pending 帶進下一個狀態 */
function pickSession(state: Session): Session {
  return {
    questions: state.questions,
    hearts: state.hearts,
    maxHearts: state.maxHearts,
    results: state.results,
  };
}

function enterQuestion(session: Session, index: number, now: number): QuizState {
  const question = session.questions[index];
  if (question === undefined) {
    return { ...pickSession(session), status: 'FINISHED', reason: 'completed', nextIndex: index };
  }
  const limit = getTimeLimitMs(question);
  return {
    ...pickSession(session),
    status: 'PLAYING',
    index,
    startedAt: now,
    deadline: limit === null ? null : now + limit,
  };
}

function makeAttempt(
  question: QuizQuestion,
  answer: QuizAnswer | null,
  startedAt: number,
  now: number,
): QuizAttempt {
  const limit = getTimeLimitMs(question);
  const elapsed = Math.max(0, now - startedAt);
  const responseTimeMs = limit === null ? elapsed : Math.min(elapsed, limit);

  if (answer === null) {
    return {
      questionId: question.id,
      cardId: question.cardId,
      kind: question.kind,
      outcome: 'timeout',
      grade: null,
      xp: 0,
      answer: null,
      responseTimeMs,
      answeredAt: now,
    };
  }

  const grade = gradeFor(isAnswerCorrect(question, answer), responseTimeMs);
  const outcome: AttemptOutcome = grade === 5 ? 'perfect' : grade === 3 ? 'passed' : 'incorrect';
  return {
    questionId: question.id,
    cardId: question.cardId,
    kind: question.kind,
    outcome,
    grade,
    xp: xpForGrade(grade),
    answer,
    responseTimeMs,
    answeredAt: now,
  };
}

type PlayingState = Extract<QuizState, { status: 'PLAYING' }>;

/** 逾時：0 XP、扣一顆愛心、grade = null（不推進 SRS 排程） */
function toTimeout(state: PlayingState, question: QuizQuestion, now: number): QuizState {
  return {
    ...pickSession(state),
    status: 'TIMEOUT',
    index: state.index,
    startedAt: state.startedAt,
    deadline: state.deadline,
    hearts: Math.max(0, state.hearts - 1),
    pending: makeAttempt(question, null, state.startedAt, now),
  };
}

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'START': {
      if (state.status !== 'IDLE') return state;
      return enterQuestion(
        { questions: action.questions, hearts: state.maxHearts, maxHearts: state.maxHearts, results: [] },
        0,
        action.now,
      );
    }

    case 'SUBMIT': {
      // 只有 PLAYING 接受送出：
      // 雙擊的第二下會落在 ANSWER_SUBMITTED；逾時後的點擊會落在 TIMEOUT —— 兩者都直接拒絕
      if (state.status !== 'PLAYING') return state;
      const question = state.questions[state.index];
      if (question === undefined) return state;

      // 已過截止時間才送達的點擊（例如 App 剛從背景回來）→ 判定逾時
      if (state.deadline !== null && action.now >= state.deadline) {
        return toTimeout(state, question, action.now);
      }

      const pending = makeAttempt(question, action.answer, state.startedAt, action.now);
      return {
        ...pickSession(state),
        status: 'ANSWER_SUBMITTED',
        index: state.index,
        startedAt: state.startedAt,
        deadline: state.deadline,
        hearts: pending.grade === 0 ? Math.max(0, state.hearts - 1) : state.hearts,
        pending,
      };
    }

    case 'TIMEOUT': {
      // 不限時題、非作答中、或尚未到期的 TIMEOUT 一律拒絕（重複觸發也安全）
      if (state.status !== 'PLAYING' || state.deadline === null) return state;
      if (action.now < state.deadline - TIMEOUT_TOLERANCE_MS) return state;
      const question = state.questions[state.index];
      if (question === undefined) return state;
      return toTimeout(state, question, action.now);
    }

    case 'CONTINUE': {
      if (state.status !== 'ANSWER_SUBMITTED' && state.status !== 'TIMEOUT') return state;
      const session: Session = { ...pickSession(state), results: [...state.results, state.pending] };
      if (session.hearts <= 0) {
        return { ...session, status: 'FINISHED', reason: 'out_of_hearts', nextIndex: state.index + 1 };
      }
      return enterQuestion(session, state.index + 1, action.now);
    }

    case 'REFILL_HEARTS': {
      // 只有「愛心用完」且還有題目時才能補充並繼續
      if (state.status !== 'FINISHED' || state.reason !== 'out_of_hearts') return state;
      if (state.nextIndex >= state.questions.length) return state;
      return enterQuestion({ ...pickSession(state), hearts: state.maxHearts }, state.nextIndex, action.now);
    }

    case 'RESET':
      return createInitialQuizState(state.maxHearts);

    default:
      return assertNever(action);
  }
}

/* ===========================================================================
 * Hook
 * ======================================================================== */

export interface ActiveTimer {
  questionId: string;
  durationMs: number;
  startedAt: number;
  deadline: number;
}

export interface UseQuizEngineOptions {
  maxHearts?: number;
  /** 按下 CONTINUE 時呼叫一次：把作答結果交給 SRS / 儲存層 */
  onCommit: (attempt: QuizAttempt) => void;
  /** 時鐘來源（測試時可注入） */
  now?: () => number;
}

export interface QuizEngine {
  state: QuizState;
  currentQuestion: QuizQuestion | null;
  /** 0–1 */
  progress: number;
  /** 已提交（按過 CONTINUE）的 XP 總和 */
  earnedXp: number;
  timer: ActiveTimer | null;
  /** App 回到前景時遞增；作為倒數條的 key，讓動畫依實際經過時間重新對時 */
  timerEpoch: number;
  start: (questions: readonly QuizQuestion[]) => void;
  submit: (answer: QuizAnswer) => void;
  /** 交給倒數條的 onAnimationEnd */
  notifyTimerEnd: () => void;
  /** CONTINUE：提交本題結果並前進 */
  continueLesson: () => void;
  refillHearts: () => void;
  reset: () => void;
}

export function useQuizEngine({ maxHearts = 5, onCommit, now = Date.now }: UseQuizEngineOptions): QuizEngine {
  const [state, dispatch] = useReducer(quizReducer, maxHearts, createInitialQuizState);
  const [timerEpoch, setTimerEpoch] = useState(0);

  const stateRef = useRef<QuizState>(state);
  const nowRef = useRef(now);
  const onCommitRef = useRef(onCommit);
  useLayoutEffect(() => {
    stateRef.current = state;
    nowRef.current = now;
    onCommitRef.current = onCommit;
  });

  /*
   * 計時保護（第二、三層）：
   * 第一層是倒數條的 onAnimationEnd。
   * 這裡只排「一個」備援 setTimeout（不是 setInterval），處理 iOS 在背景時遺失動畫事件；
   * App 回到前景時：已過截止 → 立即補判逾時；未過 → 遞增 timerEpoch 讓倒數條重新對時。
   */
  const playingDeadline = state.status === 'PLAYING' ? state.deadline : null;
  useEffect(() => {
    if (playingDeadline === null) return undefined;
    const fire = (): void => {
      dispatch({ type: 'TIMEOUT', now: nowRef.current() });
    };
    const timeoutId = window.setTimeout(
      fire,
      Math.max(0, playingDeadline - nowRef.current()) + FALLBACK_GRACE_MS,
    );
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (nowRef.current() >= playingDeadline) fire();
      else setTimerEpoch((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playingDeadline]);

  const start = useCallback((questions: readonly QuizQuestion[]) => {
    dispatch({ type: 'START', questions, now: nowRef.current() });
  }, []);

  const submit = useCallback((answer: QuizAnswer) => {
    dispatch({ type: 'SUBMIT', answer, now: nowRef.current() });
  }, []);

  const notifyTimerEnd = useCallback(() => {
    dispatch({ type: 'TIMEOUT', now: nowRef.current() });
  }, []);

  /* 同一筆作答只提交一次（防止 CONTINUE 連點造成重複寫入） */
  const committedRef = useRef<WeakSet<QuizAttempt>>(new WeakSet());
  const continueLesson = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'ANSWER_SUBMITTED' && current.status !== 'TIMEOUT') return;
    const attempt = current.pending;
    if (committedRef.current.has(attempt)) return;
    committedRef.current.add(attempt);
    onCommitRef.current(attempt);
    dispatch({ type: 'CONTINUE', now: nowRef.current() });
  }, []);

  const refillHearts = useCallback(() => {
    dispatch({ type: 'REFILL_HEARTS', now: nowRef.current() });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const isActive =
    state.status === 'PLAYING' || state.status === 'ANSWER_SUBMITTED' || state.status === 'TIMEOUT';
  const currentQuestion = isActive ? state.questions[state.index] ?? null : null;

  let timer: ActiveTimer | null = null;
  if (isActive && currentQuestion !== null && state.deadline !== null) {
    timer = {
      questionId: currentQuestion.id,
      durationMs: state.deadline - state.startedAt,
      startedAt: state.startedAt,
      deadline: state.deadline,
    };
  }

  const earnedXp = useMemo(() => state.results.reduce((sum, r) => sum + r.xp, 0), [state.results]);

  const total = state.questions.length;
  const answered =
    state.results.length + (state.status === 'ANSWER_SUBMITTED' || state.status === 'TIMEOUT' ? 1 : 0);
  const progress =
    state.status === 'FINISHED' && state.reason === 'completed' ? 1 : total === 0 ? 0 : answered / total;

  return {
    state,
    currentQuestion,
    progress,
    earnedXp,
    timer,
    timerEpoch,
    start,
    submit,
    notifyTimerEnd,
    continueLesson,
    refillHearts,
    reset,
  };
}
