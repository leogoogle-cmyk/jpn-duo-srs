// src/components/HomeMapView.tsx
// ---------------------------------------------------------------------------
// 多鄰國風格的「關卡進度地圖」：垂直滾動、RPG 解鎖路線圓圈。
// 點擊已解鎖的圓圈 → 彈出 Popover → START → 以 onStart 回呼切換到 LessonView。
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';

/** 單一關卡節點 */
export interface LevelNode {
  id: string;
  title: string;
  subtitle: string;
  /** 圓圈內顯示的漢字 / 符號 */
  glyph: string;
  /** 解鎖所需 XP 門檻 */
  requiredXp: number;
  /** 主題色：綠（#58cc02）或黃（#ffc800） */
  tone: 'green' | 'yellow';
}

interface HomeMapViewProps {
  /** 目前總 XP（來自 App 狀態） */
  xp: number;
  /** 可選：XP 動畫起點（通常是進入關卡前的 XP） */
  xpAnimateFrom?: number;
  /** 目前金幣 / 寶石數 */
  gems: number;
  /** 點擊 START 時的回呼，帶出該關卡 id */
  onStart: (levelId: string) => void;
  /** 可選：自訂關卡清單，預設為 3~5 關 N5 主題 */
  levels?: LevelNode[];
}

/** 預設關卡：xp 達到 requiredXp 即解鎖（形成多巴胺回饋節奏） */
export const DEFAULT_LEVELS: LevelNode[] = [
  { id: 'level-1', title: '五十音基礎', subtitle: '平假名 · 片假名', glyph: 'あ', requiredXp: 0, tone: 'green' },
  { id: 'level-2', title: '超商問候', subtitle: '問候語 · 自我介紹', glyph: 'こ', requiredXp: 100, tone: 'green' },
  { id: 'level-3', title: '餐廳點餐', subtitle: '食物 · 數字', glyph: '食', requiredXp: 300, tone: 'yellow' },
  { id: 'level-4', title: '交通移動', subtitle: '車站 · 方向', glyph: '駅', requiredXp: 600, tone: 'green' },
  { id: 'level-5', title: '時間與日期', subtitle: '時間 · 日曆', glyph: '時', requiredXp: 1000, tone: 'yellow' },
];

/** 條件式 className 拼接 */
const cx = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ');

/** XP 星號圖示 */
function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-5 w-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M12 2l3 6.5 7 .6-5.3 4.6L18.3 21 12 17.3 5.7 21l1.6-7.3L2 9.1l7-.6z" />
    </svg>
  );
}

/** 寶石圖示 */
function GemIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-5 w-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M6 3h12l3 5-9 13L3 8z" />
    </svg>
  );
}

/** 鎖頭圖示（未解鎖關卡） */
function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-9 w-9', className)} fill="currentColor" aria-hidden="true">
      <path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z" />
    </svg>
  );
}

/**
 * 數字滾動（count-up）動畫：XP 增加時平滑跳動（以 requestAnimationFrame）。
 * from：掛載時的起始顯示值。地圖在關卡期間會被卸載，返回時以「進關前的 XP」為起點，
 *       才能看到數字從舊值滾動到新值。
 */
function AnimatedNumber({ value, from, duration = 900 }: { value: number; from?: number; duration?: number }) {
  const [display, setDisplay] = useState<number>(from ?? value);
  const displayRef = useRef<number>(from ?? value);
  displayRef.current = display;

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) {
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span>{display}</span>;
}

// ===========================================================================
// 主元件
// ===========================================================================
export default function HomeMapView({ xp, xpAnimateFrom, gems, onStart, levels = DEFAULT_LEVELS }: HomeMapViewProps) {
  // 目前被點開 Popover 的關卡 id
  const [activeId, setActiveId] = useState<string | null>(null);

  // 依 XP 計算每個節點是否解鎖
  const nodes = useMemo(
    () => levels.map((level, index) => ({ ...level, index, unlocked: xp >= level.requiredXp })),
    [levels, xp],
  );

  return (
    <div className="relative flex min-h-screen flex-col bg-[#f7f7f7]">
      {/* ---------- 頂部固定導覽列（避開瀏海）---------- */}
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between px-4 py-2">
          <h1 className="text-lg font-extrabold text-[#58cc02]">N5 關卡地圖</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-amber-500">
              <StarIcon />
              <span className="font-extrabold">
                <AnimatedNumber value={xp} from={xpAnimateFrom} />
              </span>
            </div>
            <div className="flex items-center gap-1 text-sky-500">
              <GemIcon />
              <span className="font-extrabold">{gems}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- 垂直滾動關卡區 ---------- */}
      <main className="relative flex-1 overflow-y-auto px-4 pb-32 pt-10">
        {/* 裝飾用虛線路徑 */}
        <div className="pointer-events-none absolute inset-y-10 left-1/2 w-1 -translate-x-1/2 border-l-4 border-dashed border-neutral-200" />

        <div className="relative mx-auto flex max-w-md flex-col items-center gap-12">
          {nodes.map((node) => {
            const isActive = activeId === node.id;
            // 以正弦波左右錯位，營造 RPG 路線感
            const offset = Math.round(Math.sin(node.index * 0.9) * 56);
            return (
              <div
                key={node.id}
                className={cx('relative', isActive ? 'z-40' : 'z-10')}
                style={{ transform: 'translateX(' + offset + 'px)' }}
              >
                {/* Popover：僅在已解鎖且被點開時顯示 */}
                {isActive && node.unlocked && (
                  <div className="absolute bottom-full left-1/2 z-40 mb-3 w-64 -translate-x-1/2 rounded-2xl border-2 border-neutral-200 bg-white p-4 text-center shadow-xl">
                    <p className="text-sm font-extrabold text-neutral-700">{node.title}</p>
                    <p className="mt-1 text-sm font-extrabold text-[#58cc02]">每題最高 +50 XP</p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(null);
                        onStart(node.id);
                      }}
                      className="mt-3 w-full rounded-xl border-b-4 border-[#46a302] bg-[#58cc02] py-3 text-base font-extrabold uppercase tracking-wide text-white active:translate-y-[2px] active:border-b-2"
                    >
                      開始 START
                    </button>
                    {/* 小三角 */}
                    <span className="absolute -bottom-[9px] left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-neutral-200 bg-white" />
                  </div>
                )}

                {/* 3D 圓形關卡按鈕 */}
                <button
                  type="button"
                  disabled={!node.unlocked}
                  onClick={() => setActiveId((current) => (current === node.id ? null : node.id))}
                  aria-label={node.title}
                  className={cx(
                    'flex h-24 w-24 items-center justify-center rounded-full border-b-[6px] text-4xl font-black text-white shadow-lg transition-transform',
                    node.unlocked
                      ? node.tone === 'yellow'
                        ? 'border-[#e6a800] bg-[#ffc800] active:translate-y-[3px] active:border-b-[3px]'
                        : 'border-[#46a302] bg-[#58cc02] active:translate-y-[3px] active:border-b-[3px]'
                      : 'border-neutral-400 bg-neutral-300 text-neutral-500',
                    isActive && node.unlocked ? 'scale-105 ring-4 ring-[#58cc02]/30' : '',
                  )}
                >
                  {node.unlocked ? <span>{node.glyph}</span> : <LockIcon />}
                </button>

                {/* 關卡名稱 */}
                <p
                  className={cx(
                    'absolute left-1/2 top-full mt-2 w-40 -translate-x-1/2 text-center text-xs font-bold',
                    node.unlocked ? 'text-neutral-600' : 'text-neutral-400',
                  )}
                >
                  {node.title}
                </p>
              </div>
            );
          })}
        </div>
      </main>

      {/* 點擊半透明背景關閉 Popover */}
      {activeId && (
        <button
          type="button"
          aria-label="關閉"
          onClick={() => setActiveId(null)}
          className="fixed inset-0 z-30 cursor-default bg-black/20"
        />
      )}
    </div>
  );
}
