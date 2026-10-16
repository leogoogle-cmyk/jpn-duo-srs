# 🚀 DEPLOY.md — JpnDuoSRS 部署與維運黃金標準

> 本文件記錄本專案從「本機 → GitHub → Vercel → iPhone」的完整部署流程、
> 快取控制查核點，以及未來開發新 App 時可直接沿用的標準步驟。

- **Repo**：`https://github.com/leogoogle-cmyk/jpn-duo-srs`
- **預設分支**：`main`
- **部署目標**：Vercel（靜態託管，HTTPS）
- **離線機制**：`vite-plugin-pwa`（Workbox generated service worker）

---

## 0. 前置需求

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 20（開發機為 v24）| 建置 Vite |
| npm | ≥ 10 | 安裝依賴 |
| Git | 任意近期版本 | 版控 |
| macOS + Xcode | 選用 | 僅在需要 `npx cap add ios` 打包原生 App 時 |

```bash
npm install
```

---

## 1. 首次部署：本機 → GitHub

```powershell
cd 'C:\Users\leolu\OneDrive\Desktop\實驗室\AI\Claude\App\frontend'

# 1) 初始化版控（若尚未初始化）
git init

# 2) 設定身分（一次即可）
git config user.name  "你的名字"
git config user.email "你的信箱"

# 3) 提交
git add .
git commit -m "feat: initial release"

# 4) 綁定遠端（務必填「完整」網址：https://github.com/<帳號>/<repo>.git）
git remote add origin https://github.com/leogoogle-cmyk/jpn-duo-srs.git
git branch -M main

# 5) 推送
git push -u origin main
```

> ⚠️ **常見錯誤**：`git remote add origin https://github.com` 是**不完整**的網址，
> 會導致 push 失敗。一定要帶上 `/<帳號>/<repo>.git`。

---

## 2. 覆蓋遠端：處理 unrelated histories（`--force`）

### 症狀
GitHub 建立 repo 時若勾了 **Add a README / .gitignore / license**，遠端會先有一筆
`Initial commit`。此時本機與遠端的歷史**不相關（unrelated histories）**，直接 push 會被拒絕：

```
! [rejected]  main -> main (fetch first)
error: failed to push some refs ... (non-fast-forward)
```

### 解法 A：強制覆蓋（本專案採用）
遠端那筆 `Initial commit` 只是自動產生的 1 行 README，**可安全覆蓋**：

```powershell
git push -u origin main --force
```

### 解法 B：保留遠端歷史並合併
```powershell
git pull origin main --allow-unrelated-histories --no-rebase
# 手動解決衝突 → git add . → git commit
git push -u origin main
```

> 🔴 **`--force` 風險提示**
> `--force` 會**永久覆蓋遠端該分支的歷史**。若該分支有他人（或你自己）已推送的提交，
> 會被消除。**務必先確認** `git ls-remote origin` 中遠端沒有你需要的提交再執行。
> 較安全的替代是 `--force-with-lease`：若遠端在你上次 fetch 後被別人更新，它會拒絕推送。
>
> ```powershell
> git push -u origin main --force-with-lease
> ```

### 推送前自我檢查
```powershell
git status                 # 工作目錄應為 clean
git log --oneline          # 確認提交內容
git ls-remote origin       # 檢視遠端 refs，確認沒有要保留的提交
```

---

## 3. Vercel 導入查核清單

1. [vercel.com](https://vercel.com) → **Add New → Project** → **Import Git Repository** → 選 `jpn-duo-srs`。
2. **Framework Preset**：應自動顯示 **Vite**（若沒有，手動選 Vite）。
3. **Build & Output Settings**：
   - Build Command：`npm run build`（= `tsc -b && vite build`）
   - Output Directory：`dist`
   - Install Command：`npm install`
4. **Environment Variables**：本專案**不需要**任何環境變數。
5. 按 **Deploy**，等待 30–60 秒 → 取得 `https://<專案>.vercel.app`（HTTPS）。
6. 之後每次 `git push` 到 `main`，Vercel 會**自動重新部署**（CI/CD）。

> 為什麼一定要 HTTPS？iOS 的 Service Worker **只在 `https://` 或 `localhost` 生效**。
> 用 IP 或 `file://` 開啟，加入主畫面後不會離線快取。

---

## 4. `vercel.json` 快取控制查核點

部署後務必確認回應標頭正確（瀏覽器 DevTools → Network，或）：

```powershell
curl.exe -sI https://<專案>.vercel.app/sw.js
curl.exe -sI https://<專案>.vercel.app/assets/<任一檔案>.js
```

| 路徑 | 期望 `Cache-Control` | 原因 |
|---|---|---|
| `/sw.js` | `no-cache, no-store, must-revalidate` | Service Worker **絕不能被快取**，否則使用者永遠拿不到新版離線邏輯 |
| `/registerSW.js` | `no-cache, ...` | 同上 |
| `/manifest.webmanifest` | `no-cache` | 圖示 / 名稱更新要即時反映 |
| `/assets/*`（含 hash 檔名）| `public, max-age=31536000, immutable` | 檔名含內容雜湊，內容永不變 → 可長期快取 |
| 其他 | `nosniff`、`Referrer-Policy` | 基礎安全標頭 |

> 若 `sw.js` 被標成可快取，PWA 更新會「卡死」在舊版——這是離線 App 最常見的災難級設定錯誤。

---

## 5. PWA 更新與快取重新載入機制

本專案 `vite.config.ts` 使用：

```ts
VitePWA({
  registerType: 'autoUpdate',   // 新版 SW 自動安裝並接管（skipWaiting + clientsClaim）
  workbox: { cleanupOutdatedCaches: true, navigateFallback: 'index.html' },
})
```

**使用者如何拿到新版本？**
1. 你 `git push` → Vercel 部署新版（`sw.js` 內容改變）。
2. 使用者下次開啟 App，瀏覽器因 `sw.js` 為 `no-cache` 而取得新 SW。
3. `autoUpdate` 讓新 SW 直接接管，**下次導覽**即載入新資源。

**iOS 上「沒更新」時的處理**（iOS 會把 PWA 保留在記憶體，SW 不一定立刻換）：
- 從 App 切換器**完全關閉**該 PWA，再重新開啟（最有效）。
- 或在 Safari：**設定 → Safari → 進階 → 網站資料** → 移除該網站資料後重新加入主畫面。
- 開發驗證時：DevTools → Application → Service Workers → 勾 **Update on reload**。

**本機測試離線**：
```bash
npm run build
npm run preview -- --host     # 用手機連同區網 IP 測試（仍建議用 HTTPS tunnel / Vercel 驗證）
```

---

## 6. 常見錯誤排除

| 症狀 | 原因 | 解法 |
|---|---|---|
| `rejected ... (non-fast-forward)` | 遠端有 Initial commit（unrelated histories）| 見 §2：`--force` 或合併 |
| `remote: Repository not found` | remote 網址錯 / 無權限 | `git remote set-url origin https://github.com/<帳號>/<repo>.git` |
| push 卡住要你輸入密碼 | 未設定憑證 | 用 Git Credential Manager 登入，或改用 PAT |
| Vercel build 失敗 `tsc` 報錯 | 型別錯誤 | 本機先跑 `npm run build` 綠燈再推 |
| 加入主畫面後圖示是網頁截圖 | 缺 apple-touch-icon / manifest icons | 確認 `public/pwa-192x192.png`、`pwa-512x512.png` 存在，且 `index.html` 有 `apple-touch-icon` |
| 斷網後白屏 | SW 未註冊（非 HTTPS）或 precache 失敗 | 改用 HTTPS；確認 `dist/sw.js` 有 precache 清單 |
| 一直出現 CRLF 警告 | 換行不一致 | 本專案已有 `.gitattributes`（`* text=auto eol=lf`）|

---

## 7. 部署後驗證清單（Smoke Test）

- [ ] Vercel 部署成功，網址可開啟且為 HTTPS
- [ ] `curl -sI .../sw.js` 顯示 `no-cache`
- [ ] DevTools → Application → Manifest 顯示「あ」圖示、`standalone`
- [ ] Application → Service Workers 顯示 **activated and is running**
- [ ] 斷網（飛航模式）重整頁面仍能進入地圖與答題
- [ ] iPhone Safari → 加入主畫面 → 圖示正確、開啟為全螢幕（無 Safari 網址列）
- [ ] 答題過關 → 返回地圖可見 XP 數字滾動、關卡解鎖

---

## 8. 未來開發「第二個 App」的黃金步驟

```powershell
# A. 建專案
npm create vite@latest my-app -- --template react-ts
cd my-app; npm install
npm install -D tailwindcss@^3 postcss autoprefixer vite-plugin-pwa

# B. 通用設定（複製本專案的）
#    - .gitattributes（* text=auto eol=lf）
#    - .gitignore（node_modules / dist / dev-dist）
#    - vercel.json（sw.js no-cache、assets immutable、cleanUrls）
#    - vite.config.ts 的 VitePWA 區塊
#    - index.html 的 viewport-fit=cover + apple-touch-icon

# C. 版控與部署
git init; git add .; git commit -m "feat: initial release"
git remote add origin https://github.com/<帳號>/<repo>.git
git branch -M main
git push -u origin main --force   # 僅在遠端只有自動 Initial commit 時使用
# → Vercel Import → Deploy
```
