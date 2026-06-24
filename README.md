# 噗存 部署指南

完整部署大概需要 20 分鐘，全部免費。

---

## 需要的帳號

- [Cloudflare 帳號](https://dash.cloudflare.com/sign-up)（免費）
- [GitHub 帳號](https://github.com)（免費）
- [Plurk 開發者帳號](https://www.plurk.com/API/Apps)（已有噗浪帳號即可）

---

## 第一步：申請 Plurk App Key

1. 前往 https://www.plurk.com/API/Apps
2. 點「Sign Up For API Key」
3. 填寫 App 名稱（例如：噗存備份工具）、簡短說明
4. 取得 **App Key**（Consumer Key），記下來備用
5. 公開噗文不需要 OAuth，App Key 就夠了

---

## 第二步：建立 Cloudflare KV 命名空間

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左側選單 → **Workers & Pages** → **KV**
3. 點「Create a namespace」
4. 名稱輸入：`PLURK_ARCHIVE`
5. 建立後記下 **Namespace ID**

---

## 第三步：部署 Cloudflare Worker

### 3-1 安裝 Wrangler（Cloudflare CLI）

```bash
npm install -g wrangler
wrangler login   # 會開啟瀏覽器登入 Cloudflare
```

### 3-2 編輯 wrangler.toml

開啟 `worker/wrangler.toml`，把下面兩個地方換成你的值：

```toml
[[kv_namespaces]]
binding = "PLURK_ARCHIVE"
id = "貼上你的 Namespace ID"
```

### 3-3 設定 App Key 環境變數

```bash
cd worker
wrangler secret put PLURK_APP_KEY
# 輸入你的 Plurk App Key，按 Enter
```

### 3-4 部署 Worker

```bash
wrangler deploy
```

部署成功後會顯示 Worker 的網址，例如：
```
https://plurk-archive-worker.你的帳號.workers.dev
```

**記下這個網址。**

---

## 第四步：設定前端並部署到 GitHub Pages

### 4-1 編輯前端設定

開啟 `frontend/index.html`，找到這一行：

```javascript
const WORKER_URL = 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev';
```

換成你在上一步得到的 Worker 網址。

### 4-2 建立 GitHub Repository

1. 在 GitHub 建立新的 **public** repository（例如：`plurk-archive`）
2. 把 `frontend/` 資料夾的內容 push 上去：

```bash
cd frontend
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的帳號/plurk-archive.git
git push -u origin main
```

### 4-3 開啟 GitHub Pages

1. 進入你的 repository → **Settings** → **Pages**
2. Source 選「Deploy from a branch」
3. Branch 選「main」，資料夾選「/ (root)」
4. 儲存後幾分鐘內就會生效

你的網站網址會是：
```
https://你的帳號.github.io/plurk-archive/
```

---

## 使用方式

1. 打開你的網站
2. 貼上噗浪貼文網址（例如：`https://www.plurk.com/p/abc123`）
3. 點「存檔」
4. 頁面會顯示存檔內容，並產生分享連結
5. 把連結分享給任何人，他們打開就能看到存檔
6. 噗文還沒被刪除時，可以點「更新留言」補抓新回噗
7. 即使原噗被刪除，存檔連結依然有效

---

## 免費額度說明

| 服務 | 免費額度 | 備註 |
|---|---|---|
| Cloudflare Workers | 每天 10 萬次請求 | 非常夠用 |
| Cloudflare KV | 1 GB 儲存、每天 10 萬次讀取 | 純文字很小，可存大量貼文 |
| GitHub Pages | 無限制 | 靜態頁面免費 |

---

## 注意事項

- **只支援公開噗文**：私密噗或好友限定噗需要 OAuth，這個版本不支援
- **圖片只存連結**：如果噗主刪除圖片，圖片會失效，但文字永久保存
- **回噗的頭貼**：頭貼連結可能隨時間失效，這是 Plurk 平台限制

---

## 常見問題

**Q: 存檔時出現「找不到此噗文」？**
A: 噗文可能是私密或好友限定。目前只支援公開噗文。

**Q: Worker 回傳 CORS 錯誤？**
A: 確認 `wrangler.toml` 的 KV namespace ID 正確，且 Worker 已成功部署。

**Q: 可以自訂網域嗎？**
A: 可以。在 GitHub Pages 設定 Custom domain，或在 Cloudflare Pages 設定。
