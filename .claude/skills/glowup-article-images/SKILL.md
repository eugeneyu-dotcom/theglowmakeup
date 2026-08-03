---
name: glowup-article-images
description: "產生 Glow Up 保養專欄文章的封面圖（assets/articles/*.webp）。務必在使用者提到「文章配圖」「封面圖」「生圖」「幫這篇文章配一張圖」，或新增文章卻沒有 image 欄位時觸發，引導 Claude Code 用專案自己的 Maxora 生圖工具產生跟現有文章一致風格的圖，而不是因為找不到圖片生成工具就卡住或叫使用者自己想辦法。"
---

# Glow Up 文章封面圖生成

這個專案有自己的生圖 API 可以用（**Maxora**），憑證跟一支小工具都已經放在專案裡了，
**不需要任何額外的 MCP 圖片生成工具**——過去發生過「Claude Code 換了 session/帳號後
找不到生圖工具，就以為這個能力不見了」的情況，其實只是沒人把用法寫進專案本身。

## 憑證在哪裡

`.env` 裡的 `CF_ID` / `CF_SECRET`（Cloudflare Access service token，不是一般 API Key）。
如果 `.env` 裡這兩個值是空的，去 `/Users/eugeneyu/Desktop/Content Farm/Old_Content_Farm/.env`
抄一份過來（同一組憑證，這個專案借用 Old_Content_Farm 原本申請的額度）。
完整 API 說明（非同步模式、多圖合成、參數表、錯誤碼）在
`/Users/eugeneyu/Desktop/Content Farm/Old_Content_Farm/API-USAGE.md`。

## 怎麼用

專案根目錄已經有 `generate_article_image.py`，直接呼叫（**用 `/usr/bin/python3`**，
因為 anaconda 預設的 python3 沒裝 `python-dotenv`；`requests`/`dotenv` 兩個套件
`/usr/bin/python3` 都已經有，不需要額外安裝）：

```bash
/usr/bin/python3 generate_article_image.py "<英文 prompt>" assets/articles/<article-id>.webp
```

- 輸出檔名慣例：跟文章 `id` 同名（`assets/articles/<id>.webp`），也可以取更描述性的名字
  （現有文章有兩種都有，例如 `serum-am-pm-guide` 這篇的圖檔其實叫
  `serum-am-pm-skincare.webp`，只要 `articles.json` 的 `image` 欄位指對就好）。
- 預設 `--size 1:1`（1024×1024），跟目前所有文章封面圖尺寸一致，不要改。
- 生一張大約需要 10~30 秒（同步阻塞），不需要用非同步模式。

## Prompt 怎麼寫（風格要跟現有文章封面圖一致）

看過現有 `assets/articles/*.webp`（例如 `serum-am-pm-skincare.webp`）之後歸納出的規則：

- **英文 prompt**，效果比中文好。
- **主題是產品本身的意象合成圖**，不是人物、不是品牌商標、不是任何真實品牌的包裝設計——
  瓶罐/管子/盒子上的字樣要嘛留白、要嘛是無法辨識的假字，**絕對不要寫出真實品牌名稱**
  （這個網站評比的是各品牌真實商品，封面圖只是文章主題的意象圖，扯上特定品牌會有商標
  疑慮，也會誤導讀者以為那罐圖就是某品牌產品）。
- 攝影風格關鍵字：`professional studio product photography`、`soft shadows`、
  `minimalist flatlay` 或 `clean pastel background`，色調盡量落在暖白/裸粉/淺藍這種跟
  網站主色 `#f2a7b5`（粉色）搭的清爽色系。
- 用 2~4 個同類商品並排或稍微錯落的構圖（呼應文章「比較 N 款」的性質），不要只放單一
  瓶罐（除非文章主題就是單一產品類型且不強調比較）。
- 範例（乳液文章用過、效果不錯）：
  `"professional studio product photography, three generic unbranded lotion pump
  bottles in soft cream and white tones, minimalist skincare flatlay, soft shadows,
  blank unreadable labels, clean pastel background"`

## 完成後

1. 用 Read 工具打開產生的圖，目視確認沒有變形的手指/文字、沒有意外冒出可辨識的真實
   品牌標誌（生圖模型偶爾會學到品牌識別度很高的瓶型或字體，抽到的話重生一張）。
2. 把路徑填進 `articles.json` 該篇文章的 `image` 欄位。
3. 照 `glowup-article-seo-links` skill 的收尾步驟：bump `articles.json` 版本號、
   開瀏覽器確認圖片有正常顯示，再 commit + push。
