import os, json, csv, time, urllib.request
from datetime import datetime
from serpapi import GoogleSearch

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SERPER_KEY = os.environ.get("SERPER_KEY", "")   # serper.dev 備援
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# SerpAPI 額度用盡後就整輪切到 Serper，不再浪費請求打 SerpAPI
_serpapi_exhausted = False
JSON_FILE_PATH = os.path.join(BASE_DIR, "standardized_reviews.json")

COL_BRAND    = "Brand"
COL_TW_NAME  = "Items（台灣官網商品名）"
COL_CN_NAME  = "Items（中國官網商品名）"
COL_ALT_NAME = "Another name（別稱）"
COL_LAST_UPDATE  = "Last Update"
COL_UPDATE_FLAG  = "Update This Time"

# 每個關鍵字搜尋時附加的評價語境，取得更精準的使用者心得
# 註：原為 ["心得", "評價", "Dcard 評價", "PTT 評價"]，因 SerpAPI 免費配額有限暫縮為 2 個以涵蓋全部品項
REVIEW_SUFFIXES = ["心得", "評價"]


def _find_items_csv():
    for name in ("Items.csv", " Items.csv"):
        p = os.path.join(BASE_DIR, "csv", name)
        if os.path.exists(p):
            return p
    return os.path.join(BASE_DIR, "csv", "Items.csv")


def _strip_spf(name):
    return name.split("SPF")[0].strip()


def _build_keywords(brand, tw_name, cn_name, alt_name):
    """同 scrape_threads.py 的多關鍵字策略。"""
    keywords, seen = [], set()
    def _add(kw):
        kw = kw.strip()
        if kw and kw not in seen:
            seen.add(kw); keywords.append(kw)
    # 以別稱為主要關鍵字（口語暱稱命中率高、噪音少），過長官網全名放最後
    if alt_name:
        _add(f"{brand} {alt_name}")
    if cn_name and cn_name != tw_name:
        _add(_strip_spf(cn_name))
    if tw_name:
        _add(f"{brand} {_strip_spf(tw_name)}")
    return keywords


def _standardize(query, item, source, url_key, title_key="title", snippet_key="snippet"):
    snippet = (item.get(snippet_key, "") or "").replace("\n", " ").strip()
    if not snippet:
        return None
    return {
        "platform": source,
        "search_keyword": query,
        "url": item.get(url_key, ""),
        "title": item.get(title_key, ""),
        "content": snippet,
        "likes": 0, "comments_count": 0, "shares": 0, "saves": 0,
        "author": f"{source} Snippet",
        "scraped_at": datetime.now().isoformat(),
    }


def scrape_serpapi_keyword(keyword, suffix, max_results=5):
    """用 SerpApi 搜尋。回傳 (posts, exhausted)。exhausted=True 代表本月額度用盡。"""
    query = f"{keyword} {suffix}".strip()
    params = {
        "engine": "google", "q": query, "location": "Taiwan",
        "hl": "zh-tw", "gl": "tw", "google_domain": "google.com.tw",
        "num": max_results * 2, "api_key": SERPAPI_KEY,
    }
    try:
        results = GoogleSearch(params).get_dict()
    except Exception as e:
        print(f"  ❌ SerpApi 例外: {e}")
        return [], False
    if "error" in results:
        err = str(results["error"])
        exhausted = any(w in err.lower() for w in
                        ("run out", "ran out", "exceeded", "limit", "no searches"))
        print(f"  ❌ SerpApi 錯誤: {err}")
        return [], exhausted

    posts = []
    for item in results.get("organic_results", []):
        p = _standardize(query, item, "Google", "link")
        if p:
            posts.append(p)
        if len(posts) >= max_results:
            break
    return posts, False


def scrape_serper_keyword(keyword, suffix, max_results=5):
    """用 serper.dev 搜尋（SerpAPI 額度用盡時的備援）。回傳標準化 list。"""
    query = f"{keyword} {suffix}".strip()
    body = json.dumps({"q": query, "location": "Taiwan", "gl": "tw",
                       "hl": "zh-tw", "num": max_results * 2}).encode()
    req = urllib.request.Request(
        "https://google.serper.dev/search", data=body,
        headers={"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"})
    try:
        results = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception as e:
        print(f"  ❌ Serper 例外: {e}")
        return []

    posts = []
    for item in results.get("organic", []):
        p = _standardize(query, item, "Google (Serper)", "link")
        if p:
            posts.append(p)
        if len(posts) >= max_results:
            break
    return posts


def search_keyword(keyword, suffix, max_results=5):
    """主用 SerpAPI，額度用盡（或未設 key）時自動改用 Serper 備援。"""
    global _serpapi_exhausted
    if not _serpapi_exhausted and SERPAPI_KEY:
        posts, exhausted = scrape_serpapi_keyword(keyword, suffix, max_results)
        if not exhausted:
            return posts               # 成功（含正常的空結果）就用 SerpAPI
        _serpapi_exhausted = True
        print("  ⚠️ SerpAPI 本月額度用盡，本輪之後改用 Serper 備援。")
    if SERPER_KEY:
        return scrape_serper_keyword(keyword, suffix, max_results)
    print("  ⚠️ SerpAPI 用盡且未設定 SERPER_KEY，此關鍵字略過。")
    return []


def run_incremental_pipeline(api_key, csv_path=None, json_path=None):
    if csv_path is None:
        csv_path = _find_items_csv()
    if json_path is None:
        json_path = JSON_FILE_PATH

    # 載入現有資料庫
    all_results = []
    existing_urls = set()
    if os.path.exists(json_path):
        try:
            with open(json_path, encoding="utf-8") as f:
                all_results = json.load(f)
            existing_urls = {r.get("url", "") for r in all_results}
            print(f"📥 載入既有資料庫，共 {len(all_results)} 筆。")
        except Exception:
            pass

    # 讀 CSV
    try:
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            csv_rows = list(reader)
    except FileNotFoundError:
        print(f"❌ 找不到 {csv_path}")
        return

    today_str = datetime.now().strftime("%Y-%m-%d")
    processed_count = 0

    for row in csv_rows:
        brand    = row.get(COL_BRAND, "").strip()
        tw_name  = row.get(COL_TW_NAME, "").strip()
        cn_name  = row.get(COL_CN_NAME, "").strip()
        alt_name = row.get(COL_ALT_NAME, "").strip()
        flag     = str(row.get(COL_UPDATE_FLAG, "")).strip().lower()

        if flag != "yes" or not brand or not tw_name:
            continue

        keywords = _build_keywords(brand, tw_name, cn_name, alt_name)
        print(f"\n{'='*52}")
        print(f"🎯 {brand} {tw_name[:35]}")
        print(f"   關鍵字: {keywords}")
        print("=" * 52)

        product_new = {}   # url → post，本產品的新貼文（去重）

        for kw in keywords:
            for suffix in REVIEW_SUFFIXES:
                query = f"{kw} {suffix}"
                print(f"  ▶ {query}")
                posts = search_keyword(kw, suffix, max_results=5)
                new_count = 0
                for p in posts:
                    url = p.get("url", "")
                    if url and url not in existing_urls and url not in product_new:
                        product_new[url] = p
                        new_count += 1
                print(f"    → {len(posts)} 筆，新增 {new_count} 筆（去重後）")
                time.sleep(0.8)   # 避免觸發 SerpApi 頻率限制
            time.sleep(0.5)

        print(f"📦 本產品合計新增 {len(product_new)} 篇")
        all_results.extend(product_new.values())
        existing_urls.update(product_new.keys())

        row[COL_LAST_UPDATE] = today_str
        row[COL_UPDATE_FLAG] = ""
        processed_count += 1

        # 每個產品即時存檔
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=4)
        print(f"💾 已存檔（資料庫累積 {len(all_results)} 筆）")

        time.sleep(1)

    if processed_count > 0:
        print(f"\n🎉 Google 增量更新完成，處理 {processed_count} 個產品。")
    else:
        print("\n👀 沒有標記為 yes 的產品需要更新。")


if __name__ == "__main__":
    print(f"🔎 搜尋來源：SerpAPI={'✅' if SERPAPI_KEY else '❌'}"
          f"（主要）｜Serper={'✅' if SERPER_KEY else '❌'}（備援）")
    if not SERPAPI_KEY and not SERPER_KEY:
        print("❌ 未設定任何搜尋 API key（SERPAPI_KEY / SERPER_KEY），無法執行。")
    else:
        run_incremental_pipeline(api_key=SERPAPI_KEY)
