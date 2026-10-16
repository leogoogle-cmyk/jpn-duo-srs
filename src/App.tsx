import { useCallback, useEffect, useState } from 'react';
import { SRSProvider } from './hooks/useSRS';
import { N5_SEED_CARDS } from './core/n5Seed';
import LessonView from './components/LessonView';
import HomeMapView from './components/HomeMapView';

const XP_KEY = 'jlpt-n5-srs:xp:v1';
const GEM_KEY = 'jlpt-n5-srs:gems:v1';

/** 從 localStorage 讀取數字（失敗時回退預設值） */
function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

type Screen = 'home' | 'lesson';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [xp, setXp] = useState<number>(() => readNumber(XP_KEY, 0));
  const [gems] = useState<number>(() => readNumber(GEM_KEY, 5));
  // 進入關卡前的 XP：返回地圖時 XP 從這個值滾動到新總分
  const [xpBeforeLesson, setXpBeforeLesson] = useState<number | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(XP_KEY, String(xp));
    } catch {
      /* 忽略私密模式下的寫入失敗 */
    }
  }, [xp]);

  useEffect(() => {
    try {
      localStorage.setItem(GEM_KEY, String(gems));
    } catch {
      /* 忽略私密模式下的寫入失敗 */
    }
  }, [gems]);

  // 點擊關卡 START：切換到 LessonView（XP 於離開關卡時結算）
  const handleStart = useCallback(
    (_levelId: string) => {
      setXpBeforeLesson(xp);
      setScreen('lesson');
    },
    [xp],
  );

  // 離開關卡：把本關賺得的 XP 累加到總分（HomeMapView 會以數字滾動呈現）
  const handleExit = useCallback((earnedXp: number) => {
    setXp((value) => value + earnedXp);
    setScreen('home');
  }, []);

  return (
    <SRSProvider cards={N5_SEED_CARDS}>
      {screen === 'home' ? (
        <HomeMapView xp={xp} xpAnimateFrom={xpBeforeLesson} gems={gems} onStart={handleStart} />
      ) : (
        <LessonView onExit={handleExit} />
      )}
    </SRSProvider>
  );
}
