"""
小紅書 HTML 匯入器（重建版）

把 小紅書美妝貼文/{資料夾}/{品項子資料夾}/*.html（存下來的小紅書貼文詳情頁）
解析成統一格式，附加進 standardized_reviews.json（依 url 去重，不覆蓋既有資料）。

用法：
  python3 parse_xhs.py 遮瑕                # 只匯入「遮瑕」資料夾
  python3 parse_xhs.py 遮瑕 唇膏 腮紅        # 匯入多個資料夾
  python3 parse_xhs.py --all               # 匯入所有尚未匯入的資料夾

匯入後記得重跑：python3 clean_data.py
"""

import os, sys, json, re, html
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
XHS_ROOT = os.path.join(BASE_DIR, "小紅書美妝貼文")
STD_JSON = os.path.join(BASE_DIR, "standardized_reviews.json")


def _clean(text):
    text = re.sub(r"<[^>]+>", "", text or "")
    text = html.unescape(text)
    return re.sub(r"[ \t]*\n[ \t]*", "\n", text).strip()


def _first(html_text, patterns):
    for pat in patterns:
        m = re.search(pat, html_text, re.S)
        if m:
            val = _clean(m.group(1))
            if val:
                return val
    return ""


def parse_html(path):
    raw = open(path, "r", encoding="utf-8", errors="ignore").read()
    title = _first(raw, [r'<[^>]*class="title"[^>]*>(.*?)</'])
    content = _first(raw, [
        r'class="note-text"[^>]*>(.*?)</div>',
        r'class="desc"[^>]*>(.*?)</div>',
        r'class="note-content"[^>]*>(.*?)</div>',
    ])
    author = _first(raw, [r'class="username"[^>]*>(.*?)</', r'class="author"[^>]*>(.*?)</'])
    # 互動數盡量抓，抓不到給 0（非評分關鍵）
    likes = 0
    m = re.search(r'like[^"]*"[^>]*>.*?([\d.]+万?)\s*</', raw, re.S)
    if m:
        v = m.group(1)
        try:
            likes = int(float(v.replace("万", "")) * (10000 if "万" in v else 1))
        except ValueError:
            likes = 0
    if not content and not title:
        return None
    return {"title": title, "content": content or title, "author": author, "likes": likes}


def import_folders(folders):
    if not os.path.isdir(XHS_ROOT):
        print(f"❌ 找不到 {XHS_ROOT}")
        return

    existing = []
    if os.path.exists(STD_JSON):
        with open(STD_JSON, "r", encoding="utf-8") as f:
            existing = json.load(f)
    seen_urls = {r.get("url") for r in existing}
    ts = datetime.now().isoformat()

    added = 0
    for folder in folders:
        fdir = os.path.join(XHS_ROOT, folder)
        if not os.path.isdir(fdir):
            print(f"⚠️ 跳過（找不到資料夾）：{folder}")
            continue
        f_added = 0
        for product in sorted(os.listdir(fdir)):
            pdir = os.path.join(fdir, product)
            if not os.path.isdir(pdir):
                continue
            for fname in sorted(os.listdir(pdir)):
                if not fname.lower().endswith(".html"):
                    continue
                url = f"xhs://{folder}/{product}/{fname}"
                if url in seen_urls:
                    continue
                parsed = parse_html(os.path.join(pdir, fname))
                if not parsed:
                    continue
                existing.append({
                    "platform": "小紅書",
                    "search_keyword": product,
                    "url": url,
                    "title": parsed["title"],
                    "content": parsed["content"],
                    "likes": parsed["likes"],
                    "comments_count": 0, "shares": 0, "saves": 0,
                    "author": parsed["author"],
                    "scraped_at": ts,
                })
                seen_urls.add(url)
                f_added += 1
                added += 1
        print(f"  📂 {folder}: 新增 {f_added} 則")

    with open(STD_JSON, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=4)
    print(f"\n✅ 共新增 {added} 則，standardized_reviews.json 現有 {len(existing)} 則")
    print("   下一步：python3 clean_data.py 重新過濾廣告")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--all" in sys.argv:
        folders = [d for d in os.listdir(XHS_ROOT)
                   if os.path.isdir(os.path.join(XHS_ROOT, d))]
    elif args:
        folders = args
    else:
        print(__doc__)
        return
    import_folders(folders)


if __name__ == "__main__":
    main()
