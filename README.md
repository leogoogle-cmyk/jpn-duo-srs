<div align="center">

# 🟢 JpnDuoSRS

### 日語 N5–N1 多鄰國風格 SRS 離線學習 App

以 **Vite + React (TypeScript) + Tailwind CSS + Capacitor** 打造，
可在 iPhone 加入主畫面、**開飛航模式也能玩**的日檢間隔重複（Spaced Repetition）App。

![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF?logo=capacitor&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-offline--ready-5A0FC8?logo=pwa&logoColor=white)

</div>

---

## ✨ 四大架構特色

### 1. 遊戲化多巴胺回饋
- 結合 **SM-2 間隔重複** 與 **動態 XP**：完美秒殺 **+50 XP**、勉強答對 **+30 XP**、答錯 / 逾時 **+0**。
- `HomeMapView` 的 **3D 圓形關卡地圖**（多鄰國綠 `#58cc02`）：未解鎖顯示鎖頭，解鎖後彈出「開始」Popover。
- 過關返回地圖時，總 XP 以 `requestAnimationFrame` 平滑**數字滾動**（`AnimatedNumber`）。

### 2. 高效能 GPU 加速倒數計時器
- 倒數條為純 CSS `@keyframes srsTimerShrink`（`transform: scaleX`），走 **GPU 合成**、不觸發重排。
- **零 `setInterval`**：以 `onAnimationEnd` 作為主要逾時訊號，僅用單一 `setTimeout` 作備援。

### 3. iOS 背景喚醒防禦
- iPhone 鎖屏 / 切換 App 時 CSS 動畫會被瀏覽器暫停。本專案以**負值 `animation-delay`** 依「實際經過時間」重新對時。
- 回到前景若已過截止時間，立即補判逾時（`visibilitychange` + `timerEpoch`），修復「鎖屏後計時器停擺、時間判定失準」的 WebView 底層問題。

### 4. 100% 離線單機版
- 進度以 `@capacitor/preferences` 持久化（iOS 原生為 UserDefaults，PWA 自動退回 localStorage）。
- Workbox PWA 將所有 JS / CSS / HTML / 圖示 **precache**；加入主畫面後飛航模式仍可完整暢玩。
- 儲存層抽為 `ProgressStore` 介面，未來擴充到 N1（約萬張卡）可無痛換成 IndexedDB / SQLite。

---

## 🧱 技術棧

| 層 | 技術 |
|---|---|
| 建置 | Vite 8 · TypeScript 6 |
| 前端 | React 19 · Tailwind CSS v3 |
| 狀態 | 純函式 `quizReducer`（discriminated unions）+ React Hooks |
| 演算法 | SM-2（`core/srsEngine.ts`）|
| 儲存 | `@capacitor/preferences`（`ProgressStore` 介面）|
| 離線 | `vite-plugin-pwa` 2（Workbox）|
| 打包 | Capacitor 8（iOS）|

---

## 📂 專案結構

```text
src/
├─ core/
│  ├─ types.ts          # Card / SRSProgress / ReviewGrade
│  ├─ srsEngine.ts      # SM-2：calculateSM2 / applyReview
│  ├─ progressStore.ts  # 儲存介面 + @capacitor/preferences 實作
│  └─ n5Seed.ts         # N5 種子題庫
├─ types/
│  └─ quiz.ts           # 題型 / 答案 / 關卡狀態的辨別聯合型別 + 純函式
├─ hooks/
│  ├─ useSRS.tsx        # SRS Context Provider（複習佇列）
│  └─ useQuizEngine.ts  # 關卡狀態機 + 三層計時保護
├─ components/
│  ├─ HomeMapView.tsx   # 3D 關卡地圖 + XP 數字滾動
│  └─ LessonView.tsx    # 關卡畫面（題型、倒數條、結果卡）
├─ App.tsx
└─ main.tsx
```

---

## 🚀 快速開始

```bash
npm install
npm run dev          # http://localhost:5173
```

打包與本機預覽：

```bash
npm run build
npm run preview
```

---

## ☁️ 一鍵部署到 Vercel（1 · 2 · 3 步）

1. 推上 GitHub：`git push -u origin main`
2. Vercel → **Add New → Project** → 匯入此 repo（Framework Preset 會自動偵測 **Vite**）
3. 按 **Deploy**，取得 `https://<你的專案>.vercel.app` 的 HTTPS 網址

`vercel.json` 已設定：`sw.js` 不快取、`/assets/*` 一年長快取、`cleanUrls: true`。

---

## 📱 在 iPhone 安裝（免上架）

Safari 開啟部署網址 → **分享** → **加入主畫面** → 桌面出現綠色「あ」圖示；之後開**飛航模式**仍可離線暢玩。
（iOS 的 PWA 需透過 **HTTPS** 網址才會註冊 Service Worker。）

---

## 🧪 品質保證

- `npm run build` = `tsc -b && vite build`，型別零錯誤即產出。
- 題型以 **discriminated unions** 建模，並以 `assertNever` 做窮舉檢查——新增題型若漏處理分支，**編譯期就會報錯**。
- `quizReducer` 為純函式、可注入時鐘（`now`），易於單元測試。

## 📄 授權

僅供學習與個人使用。App 圖示由專案自動產生；日語重音與語義內容上線前請以權威辭典校對。
