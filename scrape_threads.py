"""
自建 Threads 爬蟲，取代 Apify 的付費 actor。

背景：Threads 的搜尋功能需要登入態，登入態會週期性過期——這是平台本身的限制，
不是 Apify 寫得不好。自己做不會讓「過期」這件事消失，但換來：
  - 過期時自己能直接看到卡在哪一步（被導回登入頁、被要求驗證），不是黑盒子等對方修
  - 不用付 Apify 的使用量費用，也沒有他們的用量上限

登入態管理採用「半自動」：
  1. 第一次（或過期後）執行 `python scrape_threads.py --login`，會跳出瀏覽器視窗，
     你用「專門註冊的導入帳號」手動登入一次（含可能的驗證碼/兩步驗證）。
  2. 登入成功後，腳本把瀏覽器的 session 存到 THREADS_SESSION_FILE，之後每次執行
     爬蟲都重複使用這個 session，不需要每次都登入。
  3. 之後跑爬蟲時，如果偵測到被導回登入頁（session 過期），腳本會印出明確提示，
     請你重新執行 --login，不會默默失敗或抓到空結果。

注意：
  - DOM 選擇器（CSS selector）是依目前 threads.net 的網頁結構寫的，Threads 改版時
    很可能需要調整。第一次使用務必用 --debug（非 headless）模式跑一次，肉眼確認
    抓到的內容是對的，再排程跑 headless。
  - 請使用「專門用於抓取的導入帳號」，不要用個人或品牌主帳號，降低被限流/被封的風險。
  - 自動化操作他人網站有 ToS 風險，請控制好抓取頻率（內建節流），不要短時間大量請求。

安裝需求：
  pip install playwright
  playwright install chromium
"""

import argparse
import csv
import json
import os
import random
import re
import sys
import time
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_FILE_PATH = os.path.join(BASE_DIR, "standardized_reviews.json")
THREADS_SESSION_FILE = os.path.join(BASE_DIR, "threads_session.json")

# Items.csv 可能因試算表存檔而帶前置空白，自動偵測兩種檔名
def _find_items_csv():
    for name in ("Items.csv", " Items.csv"):
        p = os.path.join(BASE_DIR, "csv", name)
        if os.path.exists(p):
            return p
    return os.path.join(BASE_DIR, "csv", "Items.csv")

CSV_FILE_PATH = _find_items_csv()

# Items.csv 欄位名稱（新版 CSV 結構）
COL_BRAND    = "Brand"
COL_TW_NAME  = "Items（台灣官網商品名）"
COL_CN_NAME  = "Items（中國官網商品名）"
COL_ALT_NAME = "Another name（別稱）"
COL_LAST_UPDATE  = "Last Update"
COL_UPDATE_FLAG  = "Update This Time"

THREADS_LOGIN_URL = "https://www.threads.net/login"
THREADS_SEARCH_BASE = "https://www.threads.net/search?q={query}&serp_type={serp_type}"

REQUEST_DELAY_SECONDS = 8  # 節流：每次搜尋之間至少間隔這麼多秒
SCROLL_ROUNDS = 6          # 搜尋頁是無限滾動，要往下滾幾次才有足夠的貼文

# 兩種排序模式：最相關（default）+ 最新（recent），各跑一次後合併去重
SEARCH_MODES = [
    ("default", "最相關"),
    ("recent",  "最新"),
]

# ── 反偵測設定 ──────────────────────────────────────────────────────────────
# 常見真實瀏覽器 UA（定期更新以跟上 Chrome 版本）
_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
]

_VIEWPORTS = [
    {"width": 1440, "height": 900},
    {"width": 1280, "height": 800},
    {"width": 1920, "height": 1080},
    {"width": 1366, "height": 768},
    {"width": 1536, "height": 864},
]

# 每處理幾個「產品」後跳出真實瀏覽器讓使用者確認一次（0 = 不觸發定時確認）
MANUAL_CHECK_INTERVAL = 8

# ── 圖片評測貼文偵測（階段1）──────────────────────────────────────────────
# 有些高價值貼文把心得寫在圖片上（比較多款、逐款評分），純文字爬蟲抓不到內文。
# 這裡在爬蟲階段用「caption 訊號」先把候選標記出來，之後再對候選做讀圖（階段2）。
# 訊號一：caption 出現比較/評比關鍵字。訊號二：caption 同時提到 >=2 個美妝品牌。
_REVIEW_KW = re.compile(
    r"評比|评比|PK|pk|排名|總結|总结|老實說|老实说|測評|测评|評測|评测|實測|实测|"
    r"大集合|優缺點|优缺点|對比|对比|一次看|"
    # N款/N盤/N張（比較多款）；數量須 >=2、且排除「第N」序數，避免「一盤/第三瓶」誤判
    r"(?<!第)(?:[2-9]|[0-9]{2,}|[二兩两三四五六七八九十])\s*[款盤盘張张]")

# 常見美妝品牌（含縮寫/中英），每組視為同一品牌以正確計數。可自行增修。
_BRAND_GROUPS = [
    ("植村秀", ["植村秀", "shu uemura", "shuuemura"]), ("資生堂", ["資生堂", "资生堂", "shiseido"]),
    ("MAC", ["m.a.c", "mac"]), ("YSL", ["ysl", "聖羅蘭", "圣罗兰"]),
    ("Dior", ["dior", "迪奧", "迪奥"]), ("Chanel", ["chanel", "香奈兒", "香奈儿"]),
    ("雅詩蘭黛", ["雅詩蘭黛", "雅诗兰黛", "estee lauder", "estée", "小棕瓶"]),
    ("蘭蔻", ["蘭蔻", "兰蔻", "lancome", "lancôme"]),
    ("Bobbi Brown", ["bobbi brown", "芭比波朗", "芭比布朗"]),
    ("MUF", ["make up for ever", "makeup forever", "玫珂菲", "muf"]),
    ("NARS", ["nars"]), ("Valentino", ["valentino", "華倫天奴", "华伦天奴"]),
    ("CDP", ["cle de peau", "clé de peau", "cpb", "肌膚之鑰", "肌肤之钥"]),
    ("Tom Ford", ["tom ford", "湯姆福特", "tf"]), ("Armani", ["armani", "阿瑪尼", "阿玛尼", "ga"]),
    ("雪花秀", ["雪花秀", "sulwhasoo"]), ("SK-II", ["sk-ii", "skii", "sk2", "神仙水"]),
    ("嬌蘭", ["嬌蘭", "娇兰", "guerlain"]), ("La Mer", ["la mer", "海洋拉娜"]),
    ("紀梵希", ["紀梵希", "纪梵希", "givenchy"]), ("Fenty", ["fenty"]),
    ("Hourglass", ["hourglass"]), ("Laura Mercier", ["laura mercier", "羅拉"]),
    ("毛戈平", ["毛戈平", "mgpin"]), ("花西子", ["花西子"]), ("Charlotte Tilbury", ["charlotte tilbury", "ct"]),
]


def _count_brands(text):
    """回傳 caption 提到的『不同品牌』數（每組算一次）。"""
    if not text:
        return 0
    low = text.lower()
    n = 0
    for _canon, toks in _BRAND_GROUPS:
        for t in toks:
            if t.isascii():
                if re.search(r"(?<![a-z])" + re.escape(t) + r"(?![a-z])", low):
                    n += 1
                    break
            elif t in text:
                n += 1
                break
    return n


def _detect_image_review(content, has_image):
    """判斷是否為『圖片評測候選』：有圖 且（比較關鍵字 或 提到>=2品牌）。"""
    if not has_image:
        return False
    c = content or ""
    return bool(_REVIEW_KW.search(c)) or _count_brands(c) >= 2


def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        print("❌ 找不到 playwright，請先安裝：\n   pip install playwright\n   playwright install chromium")
        sys.exit(1)


def _apply_stealth(page):
    """套用反偵測 patch。優先用 playwright-stealth 套件；套件不存在時手動注入 JS。"""
    try:
        from playwright_stealth import stealth_sync
        stealth_sync(page)
        return
    except ImportError:
        pass
    # 手動 fallback：移除 webdriver 標記、補假 plugins / languages
    page.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
        Object.defineProperty(navigator, 'languages', {
            get: () => ['zh-TW','zh','en-US','en']
        });
        window.chrome = {runtime: {}};
        const orig = window.navigator.permissions.query;
        window.navigator.permissions.query = (p) =>
            p.name === 'notifications'
            ? Promise.resolve({state: Notification.permission})
            : orig(p);
    """)


def _detect_challenge(page):
    """偵測 CAPTCHA、人機驗證或異常封鎖頁，回傳 True 表示需要手動介入。"""
    signals = [
        "captcha", "verify", "unusual activity",
        "robot", "automated", "security check",
        "prove you're human", "complete the security check",
    ]
    try:
        body = page.inner_text("body").lower()
        return any(s in body for s in signals)
    except Exception:
        return False


def _manual_takeover(reason="偵測到異常，需要手動操作"):
    """跳出真實（非 headless）瀏覽器，讓使用者手動完成驗證或確認，然後更新 session。
    若 stdin 非互動式終端（如 Claude Code shell），自動跳過不阻塞。"""
    import sys

    print(f"\n{'='*55}")
    print(f"⚠️  {reason}")

    if not sys.stdin.isatty():
        print(f"⚠️  [非互動式終端] 跳過手動介入，繼續爬蟲。")
        print(f"{'='*55}\n")
        return

    _require_playwright()
    from playwright.sync_api import sync_playwright

    print(f"⚠️  即將跳出真實瀏覽器視窗，請手動完成操作（解驗證碼 / 重新登入 / 確認正常等）。")
    print(f"⚠️  完成後回到這個終端機按 Enter 繼續爬蟲。")
    print(f"{'='*55}\n")

    session_kwargs = {}
    if os.path.exists(THREADS_SESSION_FILE):
        session_kwargs["storage_state"] = THREADS_SESSION_FILE

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(**session_kwargs)
        page = ctx.new_page()
        page.goto("https://www.threads.net/")
        input("  ↩  按 Enter 繼續...")
        ctx.storage_state(path=THREADS_SESSION_FILE)
        browser.close()

    print("✅ Session 已更新，繼續爬蟲。\n")


def login_flow():
    """跳出瀏覽器視窗，讓使用者用導入帳號手動登入，登入成功後把 session 存檔。"""
    _require_playwright()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(THREADS_LOGIN_URL)

        print("\n👉 請在跳出的瀏覽器視窗中，用『專門用於抓取的導入帳號』手動登入 Threads。")
        print("   完成登入（看到首頁 Feed）後，回到這個終端機按 Enter 繼續...")
        input()

        # 簡單檢查：登入後網址通常不會再停在 /login
        if "login" in page.url:
            print("⚠️ 看起來還是停在登入頁，請確認是否已經登入成功。仍會嘗試存檔 session。")

        context.storage_state(path=THREADS_SESSION_FILE)
        browser.close()
        print(f"✅ Session 已儲存至 {THREADS_SESSION_FILE}，之後爬蟲會重複使用這份登入態。")


def _is_login_redirect(page):
    """偵測是否被擋住要求登入。Threads 有兩種擋法：
    1. 網址直接被導到 /login
    2. 網址不變（還停在 /search），但畫面被一個「Log in or sign up for Threads」的彈窗蓋住
       （實測發現：直接打搜尋頁網址，登出狀態幾乎都會走第 2 種）
    """
    if "login" in page.url:
        return True
    try:
        if page.get_by_text("Log in or sign up", exact=False).count() > 0:
            return True
    except Exception:
        pass
    return False


def scrape_threads_search(keyword, max_results=5, headless=True):
    """搜尋關鍵字，回傳跟 test_thread.py 相同 schema 的標準化貼文清單。
    對「最相關」與「最新」兩種排序模式各跑一次，合併去重後取 top max_results。
    """
    _require_playwright()
    from playwright.sync_api import sync_playwright

    def _try_scrape(use_session, serp_type="default", mode_label="最相關"):
        """跑一次搜尋；回傳 (posts, status)。
        status: None=成功, 'login'=被要求登入, 'challenge'=人機驗證/異常封鎖。
        """
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)

            ctx_kwargs = {
                "user_agent": random.choice(_USER_AGENTS),
                "viewport":   random.choice(_VIEWPORTS),
            }
            if use_session and os.path.exists(THREADS_SESSION_FILE):
                ctx_kwargs["storage_state"] = THREADS_SESSION_FILE

            context = browser.new_context(**ctx_kwargs)
            page = context.new_page()
            _apply_stealth(page)

            url = f"https://www.threads.net/search?q={keyword}&serp_type={serp_type}"
            auth_label = "登入" if use_session else "登出"
            print(f"  ▷ [{auth_label}・{mode_label}] {keyword}")
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(random.randint(2500, 4500))

            if _is_login_redirect(page):
                browser.close()
                return [], "login"

            if _detect_challenge(page):
                browser.close()
                return [], "challenge"

            # 人性化隨機滾動：每次距離不同，偶爾小幅回滾
            for i in range(SCROLL_ROUNDS):
                page.mouse.wheel(0, random.randint(800, 2500))
                page.wait_for_timeout(random.randint(1200, 2800))
                if random.random() < 0.25:
                    page.mouse.wheel(0, -random.randint(100, 400))
                    page.wait_for_timeout(random.randint(300, 700))

            posts = _scrape_page_posts(page, keyword)
            browser.close()
            return posts, None

    def _merge(*post_lists):
        """多份列表去重合併，以 URL 為 key，先出現的優先保留。"""
        seen = {}
        for lst in post_lists:
            for p in lst:
                seen.setdefault(p["url"], p)
        return list(seen.values())

    print(f"▶ [Threads] 搜尋關鍵字: {keyword}")

    def _scrape_with_retry(use_session, serp_type, mode_label):
        """包一層 challenge 處理：偵測到 challenge 就跳出真實瀏覽器，重試一次。"""
        posts, status = _try_scrape(use_session, serp_type, mode_label)
        if status == "challenge":
            _manual_takeover(f"搜尋「{keyword}」時偵測到人機驗證")
            posts, status = _try_scrape(use_session, serp_type, mode_label)
        return posts, status

    # ── 第一輪：登出狀態試跑「最相關」，看是否被擋 ──
    anon_top, status = _scrape_with_retry(use_session=False, serp_type="default", mode_label="最相關")

    if status == "login":
        print("  ℹ️ 登出被擋，直接動用登入 session")
        anon_posts = []
    else:
        anon_recent, _ = _scrape_with_retry(use_session=False, serp_type="recent", mode_label="最新")
        anon_posts = _merge(anon_top, anon_recent)
        if len(anon_posts) >= max_results:
            result = sorted(anon_posts, key=lambda x: x["likes"], reverse=True)[:max_results]
            print(f"✅ [Threads] [{keyword}] 登出已取得足夠篇數（{len(anon_posts)} 篇）")
            return result

    # ── 第二輪：登入態，跑兩種模式 ──
    if not os.path.exists(THREADS_SESSION_FILE):
        if anon_posts:
            print(f"⚠️ [Threads] 只有登出的 {len(anon_posts)} 篇，且尚未設定 session")
            return anon_posts
        print("❌ [Threads] 無結果且找不到登入 session，請先執行：python scrape_threads.py --login")
        return None

    login_top, status = _scrape_with_retry(use_session=True, serp_type="default", mode_label="最相關")
    if status == "login":
        print("❌ [Threads] 登入 session 已過期。請執行：python scrape_threads.py --login")
        return sorted(anon_posts, key=lambda x: x["likes"], reverse=True)[:max_results] if anon_posts else None

    login_recent, status2 = _scrape_with_retry(use_session=True, serp_type="recent", mode_label="最新")
    if status2 == "login":
        login_recent = []

    all_posts = _merge(anon_posts, login_top, login_recent)
    result = sorted(all_posts, key=lambda x: x["likes"], reverse=True)[:max_results]
    print(f"✅ [Threads] [{keyword}] 完成（最相關 {len(login_top)} + 最新 {len(login_recent)} 篇），最終取 {len(result)} 篇")
    return result


def _scrape_page_posts(page, keyword):
    """從已經載入並滾動完成的搜尋頁面，解析出貼文列表。供登出/登入兩種模式共用。

    ⚠️ Threads 用混淆 class 名稱（無 role/data-testid），改版時請用 --debug 重新確認。
    策略：用 JS 從每個 [dir='auto'] 長文字 span 往上找包含 /post/ 連結的卡片容器，
    比舊版「從 /post/ 連結往下找 div[dir='auto']」更可靠。
    互動數藏在卡片尾端數行，依序為：讚、回覆、轉發、儲存。
    """
    raw_posts = page.evaluate(r"""() => {
        const SKIP_UI = new Set([
            'For you','Search','Messages','Activity','Ghost posts','New thread',
            'Threads Terms','Privacy Policy','Cookies Policy','Translate'
        ]);
        const results = [];
        const seen = new Set();

        for (const span of document.querySelectorAll('[dir="auto"]')) {
            let text = (span.innerText || '').trim();
            // 移除尾端 "Translate" 字樣
            text = text.replace(/\s*\nTranslate\s*$/, '').replace(/\s*Translate\s*$/, '').trim();
            if (text.length < 15 || SKIP_UI.has(text)) continue;
            // 排除純帳號名稱（只有英數、底線、點，沒有空格或中文）
            if (/^[A-Za-z0-9_.]+$/.test(text)) continue;

            // 往上找最近的包含 /post/ 連結的祖先（跳過 /media /like 類型）
            let node = span;
            for (let i = 0; i < 14; i++) {
                node = node.parentElement;
                if (!node) break;
                const links = node.querySelectorAll('a[href*="/post/"]');
                if (links.length === 0) continue;

                let postHref = null;
                for (const a of links) {
                    const h = a.getAttribute('href') || '';
                    if (h.match(/\/@[^/]+\/post\/[^/]+$/) && !seen.has(h)) {
                        postHref = h;
                        break;
                    }
                }
                if (!postHref) break;  // 此容器的連結都已處理過，停止往上

                seen.add(postHref);
                const authorMatch = postHref.match(/\/@([^/]+)\/post\//);
                const author = authorMatch ? authorMatch[1] : 'Unknown';

                // 從卡片尾端抓互動數（讚、回覆、轉發、儲存）
                // 策略：從最後一行往前取「純數字行」，遇到非數字行就停止
                const cardText = node.innerText || '';
                const parseCount = (s) => {
                    if (!s) return 0;
                    const mul = s.slice(-1).toLowerCase() === 'k' ? 1000
                              : s.slice(-1).toLowerCase() === 'm' ? 1000000 : 1;
                    return Math.round(parseFloat(mul > 1 ? s.slice(0,-1) : s) * mul) || 0;
                };
                const lines = cardText.split('\n').map(l => l.trim()).filter(l => l);
                const trailingCounts = [];
                for (let j = lines.length - 1; j >= 0; j--) {
                    if (/^[\d.,]+[KkMm]?$/.test(lines[j])) {
                        trailingCounts.unshift(lines[j]);
                    } else {
                        break;
                    }
                }

                // 卡片內的「內容圖」數量（排除頭像 t51.2885-19），判斷是否為圖片貼文
                let imgc = 0;
                const iseen = new Set();
                for (const im of node.querySelectorAll('img')) {
                    const s = im.currentSrc || im.src || '';
                    if (s.includes('cdninstagram') && !s.includes('t51.2885-19')
                        && (im.naturalWidth >= 120 || im.width >= 120) && !iseen.has(s)) {
                        iseen.add(s); imgc++;
                    }
                }

                results.push({
                    href: postHref,
                    author: author,
                    content: text.replace(/\n/g, ' '),
                    likes: parseCount(trailingCounts[trailingCounts.length - 4] || trailingCounts[0]),
                    replies: parseCount(trailingCounts[trailingCounts.length - 3] || '0'),
                    imgc: imgc,
                });
                break;
            }
        }
        return results;
    }""")

    standardized_data = []
    for p in raw_posts:
        href = p["href"]
        if not href:
            continue
        has_image = p.get("imgc", 0) > 0
        standardized_data.append({
            "platform": "Threads",
            "search_keyword": keyword,
            "url": href if href.startswith("http") else f"https://www.threads.com{href}",
            "title": "無標題 (Threads 貼文)",
            "content": p["content"],
            "likes": p["likes"],
            "comments_count": p["replies"],
            "shares": 0,
            "saves": 0,
            "author": p["author"],
            "scraped_at": datetime.now().isoformat(),
            "has_image": has_image,
            # 階段1 標記：值得之後「讀圖」的圖片評測候選（見 scrape_threads 頂部說明）
            "image_review_candidate": _detect_image_review(p["content"], has_image),
        })

    return standardized_data


def _extract_count(text, unit_hints):
    """從像「1.2K likes」「38 replies」這種文字片段抓出數字，抓不到回 0。（備用）"""
    for hint in unit_hints:
        match = re.search(rf"([\d.,]+\s*[KkMm]?)\s*{re.escape(hint)}", text)
        if not match:
            continue
        raw = match.group(1).replace(",", "").strip()
        multiplier = 1
        if raw[-1] in "Kk":
            multiplier, raw = 1000, raw[:-1]
        elif raw[-1] in "Mm":
            multiplier, raw = 1_000_000, raw[:-1]
        try:
            return int(float(raw) * multiplier)
        except ValueError:
            continue
    return 0


def _build_keywords(brand, tw_name, cn_name, alt_name):
    """為單一產品組出所有搜尋關鍵字，去除 SPF 後綴、重複項。
    - 台灣官網名：加品牌前綴
    - 中國官網名：通常已含中文品牌名，直接用；若沒有則加英文品牌前綴
    - 別稱：口語化暱稱，加品牌前綴搜尋更精準
    """
    def _strip_spf(name):
        return name.split("SPF")[0].strip()

    keywords = []
    seen = set()

    def _add(kw):
        kw = kw.strip()
        if kw and kw not in seen:
            seen.add(kw)
            keywords.append(kw)

    # 以別稱為主要關鍵字：別稱多為口語暱稱（如「小方瓶遮瑕」「六色遮瑕盤」），
    # Threads 搜尋命中率高、噪音少；過長的官網全名放最後（易回傳無關高讚貼文）。
    if alt_name:
        _add(f"{brand} {alt_name}")

    if cn_name and cn_name != tw_name:
        # 中國名通常已含中文品牌，直接搜；若不含品牌才加前綴
        _add(_strip_spf(cn_name))

    if tw_name:
        _add(f"{brand} {_strip_spf(tw_name)}")

    return keywords


def run_incremental_pipeline(csv_path, json_path, headless=True, check_interval=MANUAL_CHECK_INTERVAL,
                             batch_size=5, batch_cooldown=(60, 150)):
    """check_interval: 每處理幾個產品後跳出真實瀏覽器確認一次（0 = 停用定時確認）。
    batch_size: 每處理幾個品項為一批，批次之間做長冷卻（反偵測）。0 = 不分批。
    batch_cooldown: 批次間隨機休息秒數區間。"""
    all_results = []
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as rf:
                all_results = json.load(rf)
            print(f"📥 成功載入既有 JSON 資料庫，共 {len(all_results)} 筆。")
        except Exception:
            all_results = []

    try:
        with open(csv_path, newline="", encoding="utf-8") as csvfile:
            reader = csv.DictReader(csvfile)
            fieldnames = reader.fieldnames
            csv_rows = list(reader)
    except FileNotFoundError:
        print(f"❌ 錯誤：找不到產品清單，請確認 {csv_path} 是否存在。")
        return

    today_str = datetime.now().strftime("%Y-%m-%d")
    processed_count = 0

    # 只取有標記 yes 且資料完整的品項，並「隨機打散順序」降低可被辨識的規律（反偵測）
    flagged = [r for r in csv_rows
               if str(r.get(COL_UPDATE_FLAG, "")).strip().lower() == "yes"
               and r.get(COL_BRAND, "").strip() and r.get(COL_TW_NAME, "").strip()]
    random.shuffle(flagged)
    total_flagged = len(flagged)
    print(f"📋 待爬品項共 {total_flagged} 個（順序已隨機化，每 {batch_size} 個一批）")

    for row in flagged:
        brand    = row.get(COL_BRAND, "").strip()
        tw_name  = row.get(COL_TW_NAME, "").strip()
        cn_name  = row.get(COL_CN_NAME, "").strip()
        alt_name = row.get(COL_ALT_NAME, "").strip()

        # 批次冷卻：每處理 batch_size 個品項後長休息一次，模擬真人間歇、降低偵測風險
        if batch_size > 0 and processed_count > 0 and processed_count % batch_size == 0:
            cd = random.uniform(*batch_cooldown)
            print(f"\n🛑 [批次冷卻] 已完成 {processed_count}/{total_flagged}，休息 {cd:.0f} 秒後續跑...\n")
            time.sleep(cd)

        # 定時手動確認（在每個新產品開始前檢查；背景非互動式會自動略過）
        if check_interval > 0 and processed_count > 0 and processed_count % check_interval == 0:
            _manual_takeover(
                f"定時人工確認（已處理 {processed_count} 個產品）——"
                f"請在瀏覽器確認 Threads 看起來正常，有需要可手動清除通知或驗證。"
            )

        keywords = _build_keywords(brand, tw_name, cn_name, alt_name)
        print(f"\n{'='*52}")
        print(f"🎯 {brand} {tw_name[:35]}")
        print(f"   關鍵字: {keywords}")
        print("=" * 52)

        product_posts = {}
        session_expired = False

        for i, kw in enumerate(keywords):
            results = scrape_threads_search(kw, max_results=10, headless=headless)
            if results is None:
                session_expired = True
                break
            for p in (results or []):
                product_posts.setdefault(p["url"], p)
            if i < len(keywords) - 1:
                delay = random.uniform(REQUEST_DELAY_SECONDS * 0.8, REQUEST_DELAY_SECONDS * 1.5)
                print(f"⏳ 關鍵字間節流 {delay:.1f} 秒...")
                time.sleep(delay)

        if session_expired:
            print("⛔ Session 過期，中止本輪。CSV 狀態不變，下次可直接重跑。")
            break

        if product_posts:
            all_results.extend(product_posts.values())
        print(f"📦 本產品合計 {len(product_posts)} 篇（{len(keywords)} 組關鍵字去重後）")

        row[COL_LAST_UPDATE] = today_str
        row[COL_UPDATE_FLAG] = ""
        processed_count += 1

        # 每個產品完成後立即存檔（incremental save），防止中途中斷丟失資料
        with open(csv_path, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=4)
        print(f"💾 已存檔（累積 {len(all_results)} 筆）")

        delay = random.uniform(REQUEST_DELAY_SECONDS, REQUEST_DELAY_SECONDS * 2)
        print(f"⏳ 產品間節流 {delay:.1f} 秒...")
        time.sleep(delay)

    if processed_count > 0:
        print(f"\n🎉 Threads 增量更新完成，處理 {processed_count} 個產品，資料庫累積 {len(all_results)} 筆。")
    else:
        print("\n👀 掃描完畢，沒有發現任何標記為 'yes' 的產品需要更新。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="自建 Threads 爬蟲")
    parser.add_argument("--login", action="store_true",
                        help="跳出瀏覽器手動登入，存 session")
    parser.add_argument("--debug", action="store_true",
                        help="非 headless 模式，方便肉眼確認選擇器是否抓對")
    parser.add_argument("--check-interval", type=int, default=MANUAL_CHECK_INTERVAL,
                        help=f"每幾個產品跳出真實瀏覽器確認一次（0=停用，預設={MANUAL_CHECK_INTERVAL}）")
    parser.add_argument("--batch-size", type=int, default=5,
                        help="每幾個品項為一批，批次間做長冷卻降低偵測風險（0=不分批，預設=5）")
    args = parser.parse_args()

    if args.login:
        login_flow()
    else:
        run_incremental_pipeline(
            CSV_FILE_PATH, JSON_FILE_PATH,
            headless=not args.debug,
            check_interval=args.check_interval,
            batch_size=args.batch_size,
        )
