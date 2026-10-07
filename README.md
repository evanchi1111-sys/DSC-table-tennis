# 🏓 桌球雙打賽即時計分

桌球雙打單循環賽的計分網站：主辦單位輸入比分，選手用手機即時看到賽程、比分與排名。

- 兩個組別：競賽組、歡樂成長組
- 自動產生單循環賽程（單數隊自動輪空），三局兩勝或五局三勝
- 每局記錄實際得分（例如 11:8），勝方自動判定
- 同分自動判定名次：勝場數 → 兩隊同分看對戰勝負；三隊以上同分只計算彼此之間的對戰，依序比 場數勝率 → 局數勝率 → 分數勝率 → 抽籤
- 選手可選「我的隊伍」，看到自己的下一場
- 對戰表（交叉表）、賽事進度
- 匯出 Excel、列印成績
- 主辦帳號密碼登入，寫入權限由資料庫規則把關

純 HTML / JavaScript，不需要安裝或編譯，放上 GitHub Pages 就能用。資料庫、登入與即時同步使用 [Supabase](https://supabase.com)（免費方案即可）。

> 想先看看？網址後面加上 `?demo` 就是示範模式（資料只存在瀏覽器分頁裡，主辦密碼 `demo1234`）。

---

## 第一次設定

### 1. 建立 Supabase 專案
1. 到 <https://supabase.com> 註冊（可用 GitHub 帳號登入），按 **New project**。
2. 名稱隨意，Region 選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，設定資料庫密碼（自己保存，網站用不到）。

### 2. 建立資料表與安全規則
1. 左側 **SQL Editor** → **New query**。
2. 把 [`supabase/setup.sql`](supabase/setup.sql) 全部內容貼上 → **Run**。

### 3. 建立主辦帳號、關閉公開註冊
1. 左側 **Authentication** → **Users** → **Add user** → **Create new user**。
   - Email：`organizer@dsc-table-tennis.app`（要和 `setup.sql`、`js/config.js` 一致）
   - Password：自己設定（至少 6 個字元）
   - 勾選 **Auto Confirm User**
2. **Authentication** → **Sign In / Providers**（或 Settings）→ 關閉 **Allow new users to sign up**。

> 即使沒關閉註冊，其他人註冊的帳號也不在主辦名單內，仍然無法修改資料；關閉只是多一層保險。

### 4. 填入連線設定
1. **Project Settings** → **API**（或 **Data API** / **API Keys**），複製：
   - Project URL
   - `anon` `public` key（或 `sb_publishable_` 開頭的 key）
2. 填到 [`js/config.js`](js/config.js) 的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`。

⚠️ 不要貼上 `service_role` / secret key。anon key 本來就是公開的，安全由資料庫規則把關。

### 5. 上線（GitHub Pages）
倉庫 **Settings** → **Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)` → Save。
網址會是 `https://<帳號>.github.io/<倉庫名稱>/`，把它傳給選手即可。

---

## 比賽當天流程
1. 右上角「主辦登入」。
2. 「名單」分頁新增隊伍或批次匯入，確認組別。
3. 選擇賽制（三局兩勝／五局三勝）→「產生賽程並開賽」。
4. 「賽程」分頁點比賽卡片，輸入每局兩隊得分 → 儲存。打到一半也可以先存，選手會看到「進行中」。
5. 若有隊伍戰績完全相同，「排名」分頁會出現「抽籤」欄位，抽籤後填入順位。
6. 賽後「匯出 Excel」或「列印成績」。

## 檔案說明
| 檔案 | 用途 |
|---|---|
| `index.html` | 網頁入口 |
| `css/style.css` | 版面樣式（支援手機、深色模式、列印） |
| `js/config.js` | Supabase 連線設定、主辦帳號 |
| `js/app.js` | 畫面與操作 |
| `js/backend.js` | 資料存取（Supabase／示範模式） |
| `js/scheduler.js` | 單循環賽程 |
| `js/ranking.js` | 排名與同分判定 |
| `js/export.js` | 匯出 Excel、列印 |
| `supabase/setup.sql` | 資料表、安全規則、即時同步設定 |
