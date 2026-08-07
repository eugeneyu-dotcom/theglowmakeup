# Glow Up（theglowmakeup.org）交接說明

> 寫給接手維護這個專案的人。這份文件涵蓋「怎麼拿到存取權」「東西放在哪」「怎麼運作」
> 「有哪些已知問題跟待辦」。技術細節（資料管線、指令）都在 [CLAUDE.md](CLAUDE.md)，
> 這份文件是交接用的總覽，不重複寫技術細節。

---

## 1. 這是什麼

Glow Up 是一個美妝內容網站（**theglowmakeup.org**），從 Threads、Google、小紅書
三個來源抓真實用戶評論，用 Claude AI 逐項指標評分，產出可比較的商品評比、真實網友
心得摘要，以及保養/彩妝知識文章。目前約 430 個品項、215 個已評分、28 篇專欄文章。

- **技術棧**：純 HTML/CSS/JS 靜態網站（Tailwind CDN，無 build step）+ 一套離線
  Python 資料管線（爬蟲 → 清洗 → 歸位 → 評分）。兩者完全分離：資料管線在本機跑，
  跑完的結果（`scores-data.json`、`site-data.json`、`articles.json`）才是網站真正讀的東西。
- **必讀**：[CLAUDE.md](CLAUDE.md)（工作流程、資料夾結構、已知地雷）跟
  [SKILL_商品評比.md](SKILL_商品評比.md)（評分方法論——為什麼分數要 LLM 標記 + Python
  算，而不是讓 LLM 自己心算）。

---

## 2. 部署現況（已確認存活，2026-08-06）

- **正式網域**：https://theglowmakeup.org（`www` 是正式版，根網域 308 轉址過去）。
- **GitHub**：`https://github.com/eugeneyu-dotcom/theglowmakeup`（**2026-08-06 改為 Public**，
  原因見下方說明）。只放網站會直接讀取的檔案（html/js/css/json/py 腳本/assets 圖片），約 38MB。
- **Vercel**：接 GitHub，推到 `main` 就自動部署，不需要手動操作。剛才驗證過
  正式站的 `script.js?v=42` 跟本機最新 commit 完全一致，自動部署正常運作。
- **DNS**：已指到 Vercel（A/CNAME 記錄），沒有另外用 nameserver 託管。

### 為什麼 repo 是 Public（跟一開始的規劃不一樣）

一開始把這個 repo 設成 Private，跟 `Old_Content_Farm` 那 4 個站台（GitHub repo 是 Public）
不一樣。結果同事的帳號 push 進來後，Vercel 寄信說「不是 team 成員，不會自動部署」——
這是 Vercel Hobby（免費）方案的實際限制：**Public repo 的話，任何有協作者權限的人 push
都會自動觸發部署；但 Private repo 只有專案擁有者本人或真正的 Vercel team 成員（要付費
升級 Pro 才能加）push 才會觸發部署，光有 GitHub 協作者權限不夠**。

所以改成 Public，做法才跟 `Old_Content_Farm` 一致，同事只要有 GitHub 協作者權限，
push 完 Vercel 就會自動部署，不需要額外開 Vercel 權限、也不用升級付費方案。改成 Public
前已經確認過 repo 裡沒有任何真實憑證值（`.env`、session token 都不在 git 裡，程式碼裡
只有環境變數「名稱」，沒有值）。

### 需要交接的帳號存取權（我這邊沒辦法直接開，要你自己去後台加）

| 平台 | 需要做什麼 |
|---|---|
| GitHub (`eugeneyu-dotcom/theglowmakeup`) | Settings → Collaborators，加對方帳號（**唯一必要的一項**） |
| Vercel 專案 | 不需要加，除非同事要直接管理環境變數、自訂網域設定，或要自己看部署 log／手動 rollback |
| 網域註冊商（theglowmakeup.org） | 視需要加共同管理，或至少確保交接人知道到期日/續約方式 |

| 平台 | 需要做什麼 |
|---|---|
| GitHub (`eugeneyu-dotcom/theglowmakeup`) | Settings → Collaborators，加對方帳號（**唯一必要的一項**） |
| Vercel 專案 | 不需要加，除非同事要直接管理環境變數、自訂網域設定，或要自己看部署 log／手動 rollback |
| 網域註冊商（theglowmakeup.org） | 視需要加共同管理，或至少確保交接人知道到期日/續約方式 |

---

## 3. API 金鑰與登入憑證（`.env`，**不在 git 裡**）

`.env` 放在專案根目錄，**絕對不要進 git**（已 gitignore）。裡面有：

| 變數 | 用途 | 額度/備註 |
|---|---|---|
| `SERPAPI_KEY` | Google 搜尋爬蟲主要來源 | Free plan 250 次/月 |
| `SERPER_KEY` | SerpAPI 額度用盡時的備援 | — |
| `GEMINI_API_KEY` | 舊版評分用，**已停用**（現在用 Claude Code 本身當 LLM，不需要 API key） | — |
| `APIFY_TOKEN` | Threads / 小紅書 Apify actor | — |
| `XHS_COOKIE` | 小紅書 session，**會過期要定期更新** | — |
| `CF_ID` / `CF_SECRET` | Maxora 生圖 API（文章封面圖），Cloudflare Access service token，跟一般 API Key 不同 | 詳見 `.claude/skills/glowup-article-images/SKILL.md` |
| `ANTHROPIC_API_KEY` | 舊版路徑用，agent 兩段式評分不需要 | — |

**這個檔案我沒有透過任何自動化管道傳送出去**——請你自己決定怎麼安全交接（密碼管理工具、
當面口頭交接等），不要用 email/即時通不加密傳輸。`threads_session.json`（Threads 登入
session，也在 gitignore 裡）同理，過期的話要跑 `python3 scrape_threads.py --login` 重新登入。

---

## 4. 本機資料夾現況（3.7GB，git 只有其中 38MB）

| 項目 | 大小 | 在 git 嗎 | 說明 |
|---|---|---|---|
| 網站本身（html/js/css/`assets/`/`csv/`部分/py腳本） | ~38MB | ✅ | 部署來源 |
| `standardized_reviews.json`／`cleaned_reviews.json`／`routed_reviews.json` | ~54MB | ❌ | 資料管線當前狀態，**要繼續跑評分需要這幾份** |
| `llm_io/`（不含 `xhs_images/`） | ~6MB | ❌ | Claude Code agent 兩段式標記的 request/response 檔 |
| `llm_io/xhs_images/` | 142MB | ❌ | 圖上心得補救流程的暫存圖，已合併進評論文字，理論上用不到了 |
| `小紅書美妝貼文/` | **3.4GB** | ❌ | 小紅書原始 HTML 存檔（含圖），體積最大的部分 |
| 各種 `*.bak_*`／`*.backup_*` | 82MB | ❌ | 過去幾次資料事故的復原快照，事故已排除，**建議不用交接**，本機保留即可 |

### 已經幫你打包好的部分

同目錄下的 `glow-up-handoff-package.zip` 包含：
`standardized_reviews.json`、`cleaned_reviews.json`、`routed_reviews.json`（當前版本，
非備份）、`csv/`（含未進 git 的 `候選新品.csv`／`缺圖清單.csv`）、`llm_io/`（不含
`xhs_images/`）、`threads_session.json`、`SKILL_商品評比.md`、
`PRD_Virtual_Try_On_Popular_Shades.md`、`問卷/`、`GA/`、本檔案。

### 沒有打包、需要你自己另外傳的部分

- **`小紅書美妝貼文/`（3.4GB）**——太大沒辦法透過打包/聊天傳送，需要外接硬碟或雲端
  空間直接複製整個資料夾。如果交接對象不需要回頭查小紅書原始存檔（例如只是要繼續
  跑新一批評分、不會回頭核對舊資料），這份可以先不急著轉移。
- **`.env`**——見上一節，另外用安全管道交接。
- 各種 `.bak_*`／`.backup_*`——建議略過，見上表。

---

## 5. 已知問題 / 待辦（摘自 CLAUDE.md，交接對象應該知道）

1. **真實網友心得卡片目前 100% 來自小紅書**，Threads/Google 評論就算內容再好也進不了候選池
   （`build_scores_data.py` 的 `pick_testimonials()` 只從有 `item_id` 的評論選，只有小紅書
   會經過路由）。要修的話見 CLAUDE.md 開頭那段說明。
2. **最低樣本門檻未實作**：極少評論量的商品可能顯示異常高分（例如曾發生 1 則評論卻
   5.0 分的案例）。
3. **CHANEL 系列粒度**：小紅書原始資料還沒依子款分資料夾，混合多款評論在一起。
4. **批量更新**：目前約 21+/430 個品項有評分，大批量更新要在 `Items.csv` 標記 `yes`
   再逐批跑。
5. **小紅書資料擴充**：粉底液以外的子分類小紅書資料還很少。
6. **未來功能規劃**：`PRD_Virtual_Try_On_Popular_Shades.md` 是虛擬試妝 AI + 熱門色號
   功能的產品需求文件，尚未開發，作為未來 AI 開發工具的指引留存。

### `route_reviews.py --compute` / `score_reviews.py --compute` 的資料遺失地雷

這兩個指令都曾經造成過真實的資料遺失事故（細節見 CLAUDE.md 對應章節與
`.claude/skills/glowup-review-pipeline/SKILL.md` 的「已知地雷」）。**核心規則：
`score_reviews.py --compute` 沒有 `--subcat` 參數，永遠會重算全部品項**，如果
`score_responses.json` 只包含本輪新標記的子分類，其他子分類會被當成無資料、
分數被洗掉。跑之前務必先合併好、或跑完立刻比對新舊 CSV 有沒有子分類無故消失。

---

## 6. 額外的備份系統（目前尚未加入這個專案）

使用者另外維護一個 Bitbucket 「總管」repo（`eugeneyu-bitbucket/`），把多個專案的
**程式碼**（不含任何圖片/影片）額外備份到 Bitbucket 當異地備份。**目前 Glow Up
還沒有加入這套備份**（討論過但先不執行）。如果之後要加，只要在
`eugeneyu-bitbucket/projects.txt` 加一行 `glow-up=/絕對路徑/Glow Up`，跑
`./sync-all.sh` 即可，腳本會自動排除所有圖片檔（Glow Up 的 git repo 裡程式碼+資料
只有 2.4MB，圖片約 36MB，都會被自動濾掉，遠低於 Bitbucket 免費額度 1GB）。

---

## 7. 有 Claude Code 的話，怎麼快速上手

這個專案的 `.claude/skills/` 裡有幫接手者（不管是人還是 Claude Code）加速的技能：

- `glowup-review-pipeline`——完整走一次「抓取 → 圖上心得補救 → 清洗 → 路由 → 評分」六步驟。
- `glowup-article-seo-links`——新文章／既有文章的內外部連結怎麼判斷、怎麼加。
- `glowup-article-images`——文章封面圖怎麼用 Maxora 生圖 API 產生（憑證位置、prompt 風格）。

`CLAUDE.md` 本身就是設計給 Claude Code 讀的專案說明，接手的人第一次打開這個專案時，
不管是自己讀還是叫 Claude Code 讀，都應該從那份開始。
