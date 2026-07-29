# Glow Up — 美妝內容農場 AI 評分管線

## 專案概述

**目標**：針對約 430 個美妝品項，從 Threads、Google、小紅書三個來源自動抓取用戶評論，並用 Claude AI 逐指標評分，最終輸出可供內容排版使用的評分 CSV。

**核心設計理念**（見 `SKILL_商品評比.md`）：
- LLM 只做「語言理解」（商品身份核對、業配偵測、子款識別、情緒標記、可信度判斷）
- Python 做「計算」（情緒換算分 × 可信度權重 → 加權平均；EMA 核心指標；兩極化偵測）
- 這樣分數可重現、可追蹤，不會因 LLM 自行心算而每次不同

---

## 目前資料狀態（2026-07-27）

| 項目 | 數字 |
|------|------|
| `standardized_reviews.json` 總筆數 | 約 14,357 筆 |
| `cleaned_reviews.json`（去廣告後）| 約 14,162 筆 |
| 已有真實綜合分的品項 | 215 個（`scores-data.json`），涵蓋 43 個子分類 |
| 總商品數 | 430 個 |

> 這個表格會持續過時，數字僅供參考量級；要看當下實際狀態，直接讀
> `scores-data.json`（`len()`）或 `csv/AI_Scores.csv` 的 `Subcategories` 欄位去重數量最準。

**評論來源分布**（`standardized_reviews.json` 全體，非僅已評分品項）：
Threads 約 57%、小紅書約 37%、Google（含 Dcard/IG/General）約 6%。
⚠️ 但前台「真實網友心得」卡片目前 100% 來自小紅書——這是 `build_scores_data.py` 的
`pick_testimonials()` 只從 `routed_reviews.json` 裡「有 `item_id`」的評論選，而只有小紅書
會經過路由（`route_reviews.py`/`route_xhs_programmatic.py` 都只處理小紅書），Threads/Google
的評論就算內容再好也進不了候選池。如果要讓心得卡片的來源比例更真實反映實際資料組成，
需要把 Threads/Google 裡已標記 `product_match: match` 的評論也納入 `pick_testimonials()` 的
候選池，而不是只看有沒有 `item_id`。

---

## 資料夾結構

```
Glow Up/
├── .env                        ← 所有 API Key（不要 commit）
├── CLAUDE.md                   ← 本檔案
├── SKILL_商品評比.md            ← 評分方法論（必讀）
├── csv/
│   ├── Items.csv               ← 430 個品項清單，含 "Update This Time" 旗標欄
│   ├── Indicator.csv           ← 各子分類的評估指標
│   ├── AI_Scores.csv           ← Claude 評分輸出（含 Variant 欄）
│   ├── AI_Scores_gemini_backup.csv ← Gemini 舊版備份，供比對
│   └── indicator_weights.json  ← 動態核心指標 EMA 狀態
├── standardized_reviews.json   ← 所有原始爬蟲資料（統一格式）
├── cleaned_reviews.json        ← 過濾廣告後的乾淨資料
├── threads_session.json        ← Threads 登入 session（勿刪）
├── 小紅書美妝貼文/
│   └── 粉底液/                 ← 已有 10 個品牌的小紅書 HTML 資料夾
├── scrape_threads.py           ← Threads playwright 爬蟲（主力）
├── test_google.py              ← Google SerpAPI 爬蟲
├── test_xhs.py                 ← 小紅書 Apify 爬蟲（備用）
├── clean_data.py               ← 廣告過濾（送 Claude 評分前先跑）
└── score_reviews.py            ← Claude 評分主程式
```

---

## 工作流程

> ⚠️ **Python 版本**：Claude 相關腳本（`route_reviews.py`、`score_reviews.py`）必須用
> **`/usr/bin/python3`（3.9）** 跑，因為 `anthropic` SDK 不支援 PATH 上預設的 anaconda
> Python 3.6。系統 3.9 已內建 `anthropic` 與 `python-dotenv`，不需額外安裝。
> 爬蟲/清洗腳本用哪個 python 都可以。

```bash
# Step 1：在 Items.csv 把想更新的品項 "Update This Time" 欄填 "yes"

# Step 2：跑爬蟲（Threads + Google）；小紅書是半手工，HTML 存進
#         小紅書美妝貼文/{子分類}/{品牌資料夾}/ 後用 parse_xhs.py 匯入
python3 scrape_threads.py
python3 test_google.py
python3 parse_xhs.py 子分類A 子分類B      # 或 --all 匯入所有尚未匯入的資料夾

# Step 2.5：圖上心得補救（小紅書用「完整網頁」存檔、Threads 截圖型貼文皆可能發生，
#           每次匯入新資料都應該檢查一次，見下方「圖上心得補救」章節）

# Step 3：清洗廣告
python3 clean_data.py

# Step 4：多品項拆分與歸位路由（agent 兩段式，Claude Code 本身就是 LLM，不需 API key）
/usr/bin/python3 route_reviews.py --prepare --subcat 子分類A,子分類B
#   → 由 Claude Code 讀 llm_io/route_requests.json、逐則拆分比對目錄，
#     寫出 llm_io/route_responses.json
/usr/bin/python3 route_reviews.py --compute
#   → 產出 routed_reviews.json + csv/候選新品.csv
#
#   小紅書單一品牌資料夾（非「多品項XXX評比」）可以跳過 LLM 拆分，直接用程式化路由更快：
/usr/bin/python3 route_xhs_programmatic.py 子分類A 子分類B
#   → 依資料夾品牌名直接比對 Items.csv 補上 item_id，append 進 routed_reviews.json
#     （依 url 去重，可重複執行）。多品項/評比類資料夾會被跳過，仍需交給 route_reviews.py。

# Step 5：審核 csv/候選新品.csv → 確認要收的新品，手動補進 Items.csv，再重跑 Step 4

# Step 6：評分（agent 兩段式，同樣不需 API key）
/usr/bin/python3 score_reviews.py --prepare --subcat 子分類A,子分類B
#   → 由 Claude Code 讀 llm_io/score_requests.json、逐則標記，
#     寫出 llm_io/score_responses.json
/usr/bin/python3 score_reviews.py --compute        # ⚠️ 見下方警告
```

> ⚠️ **`score_reviews.py --compute` 務必確認 `llm_io/score_responses.json` 涵蓋的子分類範圍**：
> `--compute` 這一步**沒有 `--subcat` 參數**，永遠會重算 CSV 裡全部品項（目前 430 個）。
> 若 `score_responses.json` 只包含本輪新標記的子分類（例如只跑了 7 個新子分類的 `--prepare`），
> 其餘沒被標記到的品項會被當成「無資料」，把它們原本的真實分數**直接覆蓋成空白**，
> 這是實際發生過一次的資料遺失事故（2026-07-21，靠 Time Machine 本機快照復原）。
> **正確做法**：跑 `--compute` 前，先把 `score_responses.json` 與「上一版 `csv/AI_Scores.csv`
> 裡所有子分類」合併好（只覆蓋本輪重新標記的子分類，其餘子分類的既有標記原樣保留在
> `score_responses.json` 裡一起送進 `--compute`），或是跑完後立刻比對新舊 `AI_Scores.csv`
> 的子分類清單有沒有無故消失，發現不對馬上停手排查，不要接著跑
> `build_scores_data.py`（那會把錯誤傳播到前台 `scores-data.json`）。

### 多品項拆分與歸位（route_reviews.py）
一篇貼文常同時講多款商品。`route_reviews.py` 用 Claude 把每則貼文拆成「各品項片段」，
比對完整商品目錄後：
- **對應到現有品項** → 展開成獨立評論、帶 `item_id` 寫入 `routed_reviews.json`，
  評分時精準歸位（不再把 A 商品評論混進 B 商品）。
- **目錄上沒有的新品** → 寫進 `csv/候選新品.csv` **暫存待審**（自動用 Subcategories.csv
  補 Types/Categories），**不自動改 Items.csv、不評分**，人工確認後才收編。

`score_reviews.py` 找不到 `routed_reviews.json` 時會自動退回舊的 `cleaned_reviews.json`
+ keyword 比對，向後相容。

小紅書目前是半手工：下載 HTML → 放進 `小紅書美妝貼文/{子分類}/{品牌資料夾}/` → 用 `parse_xhs.py` 匯入（見上方 Step 2）。

> ⚠️ **`route_reviews.py --compute` 曾經會把「其他子分類」先前路由好的 `item_id` 整批洗掉**
> （2026-07-28 資料遺失事故：跑面膜/面霜的 `--compute` 後，粉底液等其餘子分類的 `item_id`
> 全部消失，導致前台真實網友心得卡片全部顯示無資料，`build_scores_data.py` 重建
> `scores-data.json` 時連帶洗掉手動補寫的 `reviewSummary`）。已修正成合併寫入（本輪標記的
> rid 覆蓋，其餘 rid 沿用舊 `routed_reviews.json` 已路由的版本），細節與更完整的踩坑記錄見
> `.claude/skills/glowup-review-pipeline/SKILL.md` 的「已知地雷」第 6、7 條。**但清理專案
> 檔案時千萬不要因為「只留最新一份」就把 `routed_reviews.backup_*.json` 全刪光**——這是這類
> 事故唯一的救命索，建議每次跑 `--compute` 前先 `cp routed_reviews.json
> routed_reviews.json.bak_<說明>`。

### 圖上心得補救（每次匯入新資料都要檢查一次）
有些貼文的心得文字是「寫在圖片裡」而不是貼文本文（尤其小紅書長圖文、Threads 截圖轉發），
爬蟲/parse_xhs.py 抓不到這種文字，會讓該則評論看起來內容很短甚至空白，實際上圖片裡才是真正的心得。
這種情況在 Threads 和小紅書都出現過，**不是一次性問題**，只要有新資料就該檢查一次：

- **小紅書**：前提是貼文用瀏覽器「完整網頁」存檔（而非單一 HTML），該篇旁邊會多一個
  `{檔名}_files/` 資料夾、內含小紅書 CDN 原圖。三段式流程：
  1. `python3 extract_xhs_images.py 子分類A 子分類B`（或 `--all`）
     → 掃有 `_files/` 的貼文，濾掉頭像/icon，把內容大圖轉成 png，
       產出 `llm_io/xhs_image_manifest.json`
  2. 由 Claude Code 逐張 Read manifest 內的 png，把圖上文字抄出來，
     寫成 `llm_io/xhs_image_texts.json`（格式：`{url: 圖片內文}`）
  3. `python3 merge_xhs_image_text.py`
     → 把圖片內文接回 `standardized_reviews.json` / `cleaned_reviews.json` / `routed_reviews.json`
       的 `content` 欄位（冪等、可重跑，會標記 `image_review: true`）
  4. 重跑 `score_reviews.py --prepare/--compute --subcat <子分類>`，圖上心得才會真正進評分。
- **Threads**：目前沒有對應的自動抽取工具（Threads 沒有「完整網頁存檔含原圖資料夾」這個
  管道可以掃）。若發現某則 Threads 評論內容異常短/空白但明顯附了截圖，先手動打開原始連結，
  把圖片裡的文字抄進該筆記錄的 `content` 欄位即可，格式比照 `merge_xhs_image_text.py` 的
  `【圖片內文】` marker 寫法，維持一致性。這是已知的工具缺口，未來若量大到需要自動化，
  可以參考小紅書那套三段式流程另外做一個 Threads 版本。

---

## 關鍵技術決策

### Claude vs Gemini
- **已從 Gemini 換成 Claude Haiku 4.5**（`score_reviews.py`）
- 原因：Gemini 非確定性高（M.A.C 眼線液跑三次：4.6 → 0 → 4.7），指令遵守較不穩定
- Gemini 舊版評分已備份到 `csv/AI_Scores_gemini_backup.csv`

### 子款自動分離（新功能）
- Claude 標記每則評論的 `sub_variant`（如「金砖版」「持妝版」）
- 同一子款累積 ≥ 3 則 → 獨立計分，CSV 新增 `Variant` 欄
- 解決了 CHANEL 香奈兒原生美肌底妝系列評分被混雜拉低的問題
  （金砖/奢華精粹：遮瑕力差；持妝版：持妝佳；混在一起導致 1.77/1.65 的異常低分）

### Threads 爬蟲策略
- 雙模式搜尋：`serp_type=default`（最相關）+ `serp_type=recent`（最新）
- 每個品項多關鍵字：台灣官網名 + 中國官網名 + 別稱（別稱）
- Session 持久化：`threads_session.json`（過期時跑 `python3 scrape_threads.py --login`）
- Anti-detection：playwright-stealth、隨機 UA/viewport、隨機 scroll

### Google 補充策略
- SerpAPI + 四種語境後綴：`["心得", "評價", "Dcard 評價", "PTT 評價"]`
- 地區設定台灣，精準抓取繁中用戶評論

### 核心指標（×1.3 加權）
- 動態計算，不寫死：用 EMA（α=0.3）追蹤同子分類裡用戶最在乎的指標
- 狀態保存在 `csv/indicator_weights.json`

### 評分分級（台灣使用者直覺版，2026-07-07 校準）
情緒換算分（`score_reviews.py` 的 `SENTIMENT_SCORE`）已校準對應以下分級：

| 綜合分 | 分級 | 情緒錨點 |
|--------|------|----------|
| **4.5+** | 優秀 | `+++` 必買/回購/人生愛用（=5.0）|
| **4.0–4.5** | 不錯，可以用 | `++` 還不錯（=4.3）|
| **3.5–4.0** | 普通，特定人群可用 | `+` 還行有保留（=3.8）；`~` 客觀（=3.5）|
| **3.0–3.5** | 負面評價居多 | `-` 普普/還好（=3.1）|
| **2.0–3.0** | 幾乎只有負面 | `--` 不推薦（=2.4）|
| **<2.0** | 完全不推薦 | `---` 踩雷/退貨/過敏（=1.2）|

注意：綜合分是所有有效評論的加權平均，**4.5+ 是高門檻**（需評論幾乎一面倒回購/必買）。
主流大牌多為理性測評，落在 3.8–4.2「不錯可用」很正常，不代表不好。
`+++` 專門保留給明確「回購/人生/封神」等狂熱評論，勿浮濫。

---

## API Keys（存放在 .env）

```
ANTHROPIC_API_KEY=  ← 舊版 API 路徑用；agent 兩段式評分不需要
SERPAPI_KEY=        ← Google 搜尋爬蟲（主要來源，Free Plan 250/月）
SERPER_KEY=         ← serper.dev，SerpAPI 額度用盡時的備援搜尋來源
GEMINI_API_KEY=     ← 舊版，已停用
APIFY_TOKEN=        ← Threads/XHS Apify actor
XHS_COOKIE=         ← 小紅書 session（定期更新）
```

**Google 搜尋備援**：`test_google.py` 主用 SerpAPI；偵測到本月額度用盡（error 含 run out/exceeded/limit）就整輪自動切換到 Serper（serper.dev），產出的評論 `platform` 標為 `Google (Serper)`，其餘欄位與 SerpAPI 一致、照原流程清洗評分。

---

## 已知問題 / 待辦

1. **ANTHROPIC_API_KEY 未設定**：需在 `.env` 填入才能跑 `score_reviews.py`
2. **CHANEL 系列粒度**：`小紅書美妝貼文/粉底液/Chanel香奈兒原生美肌底妝系列/` 目前混合多款，靠新的子款自動分離功能處理，但小紅書原始資料還沒以子款分資料夾
3. **最低樣本門檻**：Bobbi Brown 隔離霜等只有 1 則有效評論卻顯示 5.0 分，尚未實作最低 N 則才輸出分數的過濾
4. **批量更新**：目前只有約 21/430 個品項有評分，大批量更新需要在 Items.csv 標記 yes 再逐批跑
5. **小紅書擴充**：粉底液以外的子分類還沒有小紅書資料

---

## 已評分品項（Gemini 版本，Claude 版尚待跑）

粉底液（10）、遮瑕膏（2）、化妝水（3）、乳液（2）、唇膏（1）、唇蜜（1）、護唇膏（1）、眼線筆（1）
