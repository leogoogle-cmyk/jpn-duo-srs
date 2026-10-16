# JpnDuoSRS · 日語 JLPT 間隔重複學習 App

一款 Duolingo 風格、可離線運作的日語 JLPT 學習 PWA。目前收錄 N5 範例題庫，以 SM-2 間隔重複演算法安排複習，並針對 iPhone Safari／加入主畫面的使用情境做了底層最佳化。

> React 19 · TypeScript · Vite · Tailwind CSS · vite-plugin-pwa · Capacitor Preferences

---

## 功能

- **關卡地圖**：依 XP 解鎖的 RPG 路線圖，返回地圖時 XP 以數字滾動動畫累加。
- **兩種題型**：看單字選中文意思（四選一，附振假名與重音標示）、依中文排出日文語塊。
- **SM-2 間隔重複**：快速答對 5 分、慢速答對 3 分、答錯 0 分，自動排定下次複習日。
- **XP 與愛心**：完美秒殺 +50 XP、勉強答對 +30 XP；答錯或逾時扣一顆愛心。
- **日文發音**：使用系統內建日文語音朗讀，不需網路。

---

## 技術亮點

### 1. GPU 合成的倒數計時條

限時倒數條不使用 `setInterval` 逐毫秒更新 React state，而是交給一段 CSS 動畫：

```css
@keyframes srsTimerShrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
```

- 只動 `transform`，瀏覽器在合成層（compositor）處理，不觸發版面重排，React 在倒數期間零次重新渲染。
- 動畫結束時以 `onAnimationEnd` 通知狀態機進入 `TIMEOUT`。
- 作答後改為 `animation-play-state: paused`，倒數條凍結在作答當下。

### 2. 防禦 iOS 背景暫停動畫

iPhone 在 App 切到背景或鎖屏時，會暫停 CSS 動畫與計時器。如果只依賴動畫，使用者切出去再回來，倒數條會停在原處，等於多送了時間。本專案用三層保護：

| 層級 | 機制 |
|---|---|
| 第一層 | 倒數條掛載時計算「已經過的時間」，以**負值 `animation-delay`** 從該進度開始播放。App 回到前景時（`visibilitychange`）重新掛載倒數條，立即跳到正確的剩餘時間。 |
| 第二層 | 每題只排**一個**備援 `setTimeout`（非 `setInterval`），在動畫事件遺失時補判逾時。 |
| 第三層 | 狀態機以**截止時間戳**判定：截止後才送達的作答一律視為逾時。 |

三個來源可能同時觸發逾時，但狀態機只接受第一個，不會重複扣分。

### 3. 辨別聯合型別狀態機

關卡生命週期由純函式 `quizReducer` 管理：

```
IDLE ─開始─▶ PLAYING ─檢查─▶ ANSWER_SUBMITTED ─┐
                └──逾時──▶ TIMEOUT ────────────┴─繼續─▶ PLAYING … ▶ FINISHED
```

- `QuizState` 本身是辨別聯合型別：`pending`（本題結果）只存在於 `ANSWER_SUBMITTED` 與 `TIMEOUT`，在其他狀態讀取會編譯錯誤。
- 雙擊「檢查」、逾時後才送出的作答、未到期的逾時事件，都會被 reducer 拒絕。
- 題型以 `kind` 欄位區分，所有分派都用 `switch` 加 `assertNever` 完全窮舉；日後新增題型（例如 N3 LINE 拼圖、N1 限時長文）若有地方漏處理，會在編譯期報錯。
- **逾時不推進 SRS 排程**：SM-2 數據維持不變，只累加 `timeouts` 次數。

### 4. iOS 手勢與安全區域

- **預熱畫面**：進入關卡先停在 `IDLE`，按下「開始」才計時並朗讀第一題。iOS 規定音訊必須由使用者手勢觸發，這一步讓後續題目可以自動朗讀。
- **安全區域**：頂部 `env(safe-area-inset-top)`、底部 `env(safe-area-inset-bottom)`，搭配 `index.html` 的 `viewport-fit=cover`，避開瀏海與 Home Indicator。
- **觸控回饋**：按鈕掛 `touchstart` 監聽，讓 `active:translate-y-[2px]` 在 iOS 實機生效。

### 5. 離線 PWA

- `vite-plugin-pwa`（Workbox `generateSW`）在建置時預先快取所有 JS、CSS、HTML 與圖示，首次載入後即可離線使用。
- 導覽請求一律退回 `index.html`，`registerType: 'autoUpdate'` 讓新版本自動更新。
- Service Worker 只在 HTTPS（或 `localhost`）下啟用，因此正式使用請部署到 HTTPS，例如 Vercel。

### 6. 可替換的儲存層

學習進度透過 `ProgressStore` 非同步接口存取：

- 預設實作使用 `@capacitor/preferences`：在 iOS 原生殼中是 `UserDefaults`，在瀏覽器／PWA 中退回 `localStorage`。
- 寫入依序排隊、連續寫入自動合併，讀取時逐筆驗證資料，損毀的紀錄會被略過。
- 只傳入有變動的卡片。題庫擴充到 N1 規模（約 1 萬張）時，換成分桶、IndexedDB 或 SQLite 實作即可，其他程式不需修改。

---

## 快速開始

需求：Node.js 20 以上。

```powershell
npm install
npm run dev -- --host   # 開發伺服器；--host 讓同一 Wi-Fi 的手機可以連線
npm run build           # 型別檢查 + 產生 dist/（含 Service Worker）
npm run preview         # 預覽建置結果
```

> 用 iPhone 透過區網 IP（`http://192.168.x.x:5173`）開啟時，因為不是 HTTPS，Service Worker 不會啟用，離線功能要部署到 HTTPS 後才能完整測試。

### 部署到 Vercel

1. 將專案推上 GitHub。
2. 在 Vercel 匯入該 repo，Framework 選 **Vite**，Build Command 為 `npm run build`，Output Directory 為 `dist`。
3. 部署完成後，用 iPhone Safari 開啟網址 → 分享 → **加入主畫面**。

---

## 專案結構

```
src/
├── App.tsx                    # 畫面切換（地圖 ↔ 關卡）與 XP 累計
├── components/
│   ├── HomeMapView.tsx        # 關卡地圖、XP 數字滾動動畫
│   └── LessonView.tsx         # 關卡外殼、倒數條、題型畫面、結果卡片
├── hooks/
│   ├── useQuizEngine.ts       # 關卡狀態機（quizReducer）與計時保護
│   └── useSRS.tsx             # SRS Context：載入、佇列、記錄作答
├── types/
│   └── quiz.ts                # 題型／答案／狀態的辨別聯合型別、評分與 XP
└── core/
    ├── types.ts               # Card、SRSProgress 資料模型
    ├── srsEngine.ts           # SM-2 演算法、applyAttemptToSrs
    ├── progressStore.ts       # ProgressStore 接口與 Preferences 實作
    └── n5Seed.ts              # N5 範例題庫
```

## 新增題目

在 `src/core/n5Seed.ts` 加入卡片即可，`id` 必須穩定唯一（進度以 `id` 對應）：

```ts
{ id: 'n5-word-0011', word: '本', reading: 'ほん', meaning: '書', romaji: 'hon', type: 'word', pitchAccent: '①', level: 'N5' },
{ id: 'n5-sentence-0004', word: '本を読みます。', reading: 'ほんをよみます。', meaning: '讀書。', type: 'sentence', tiles: ['本', 'を', '読み', 'ます', '。'], level: 'N5' },
```

> 重音標示為東京標準語參考值，正式內容請以辭典校對。

---

## 授權

尚未指定授權條款。公開到 GitHub 前，請先選擇授權（例如 MIT）並新增 `LICENSE` 檔案。
