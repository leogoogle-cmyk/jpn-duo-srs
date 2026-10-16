// tailwind.config.js（Tailwind v3）
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // 關鍵影格：字卡彈入 / 底部滑入 / 倒數條收縮
      keyframes: {
        srsPop: {
          from: { transform: 'scale(0.85)', opacity: '0.4' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        srsSlideUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        srsTimerShrink: {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
      },
      // 對應 animate-srsPop / animate-srsSlideUp / animate-srsTimerShrink
      animation: {
        srsPop: 'srsPop 180ms ease-out',
        srsSlideUp: 'srsSlideUp 260ms ease-out',
        srsTimerShrink: 'srsTimerShrink 15s linear forwards',
      },
    },
  },
  plugins: [],
};
