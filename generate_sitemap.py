# -*- coding: utf-8 -*-
"""產生 sitemap.xml（靜態頁 + 每個子分類的美妝看板/精選評比頁 + 每個商品頁）。

用法：/usr/bin/python3 generate_sitemap.py
"""
import csv
import datetime
import json
import os
import re
from urllib.parse import quote
from xml.sax.saxutils import escape

BASE = os.path.dirname(os.path.abspath(__file__))
SITE_URL = "https://www.theglowmakeup.org"  # 正式網域：實測 apex（無 www）會 308 導到 www，www 才是最終網址
                                             # （2026-09-10 修正：舊註解寫反了，實際導向跟舊版剛好相反）

STATIC_PAGES = [
    "news.html", "skincare-blog.html",
    "board-landing.html", "review-landing.html", "review-base.html",
]


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_date(value):
    """只接受 YYYY-MM-DD，不合格就回 None（寧可不寫 lastmod，也不要寫錯的）。"""
    value = (value or "").strip()
    return value if DATE_RE.match(value) else None


def file_date(*names):
    """檔案 mtime 當 lastmod，多個檔案取最新；檔案不存在就略過。"""
    stamps = [os.path.getmtime(os.path.join(BASE, n))
              for n in names if os.path.exists(os.path.join(BASE, n))]
    if not stamps:
        return None
    return datetime.date.fromtimestamp(max(stamps)).isoformat()


def item_dates():
    """Items.csv 的 Last Update → {台灣官網商品名: 最新日期}。

    刻意用 Items.csv 的欄位而不是 scores-data.json 的檔案 mtime：
    重跑 build_scores_data.py 會把整份 json 重寫一遍，用 mtime 會讓 300 個商品頁
    每次都看起來「同時更新」，那種不可靠的 lastmod Google 會直接忽略掉。
    """
    path = os.path.join(BASE, "csv", "Items.csv")
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            name = (row.get("Items（台灣官網商品名）") or "").strip()
            date = clean_date(row.get("Last Update"))
            if name and date and date > out.get(name, ""):
                out[name] = date  # 同名不同品牌取較新的那筆
    return out


def main():
    data = json.load(open(os.path.join(BASE, "site-data.json"), encoding="utf-8"))
    sd = data.get("subcategoryDetails", {})
    articles = json.load(open(os.path.join(BASE, "articles.json"), encoding="utf-8")).get("articles", [])

    # 根網址用 "/" 而不是 "/index.html"——兩者是同一頁，Google 會挑一個當標準網址，
    # 之前 sitemap 送 index.html 反而跟 Google 自己選的標準網址（根網址）對不上，被判定重複。
    # lastmod 是 Google 目前實際會拿來排爬取排程的訊號（sitemap ping 端點已在 2023 停用、
    # Indexing API 只支援徵才與直播頁），所以每個網址盡量附上；查不到真實日期就不寫。
    item_lastmod = item_dates()

    urls = [(f"{SITE_URL}/", file_date("index.html", "site-data.json"))]
    urls += [(f"{SITE_URL}/{p}", file_date(p)) for p in STATIC_PAGES]
    for a in articles:
        if a.get("content"):  # 只收有完整內文的文章頁，純連去 skincare-blog.html 的舊文章不用另建網址
            urls.append((f"{SITE_URL}/article.html?id={quote(a['id'])}", clean_date(a.get("date"))))
    seen_items = set()
    for sub, det in sd.items():
        if not isinstance(det, dict):
            continue
        sub_q = quote(sub)
        sub_dates = []
        item_urls = []
        for it in det.get("items", []):
            name = (it.get("name") or "").strip()
            if not name or name in seen_items:
                continue
            seen_items.add(name)
            date = item_lastmod.get(name)
            if date:
                sub_dates.append(date)
            item_urls.append((f"{SITE_URL}/item-detail.html?item={quote(name)}&from=board", date))
        # 只送 from=board 這個標準網址進 sitemap，from=review 是同一頁內容的另一種呈現，
        # 靠頁面自己的 canonical 標籤導回 from=board，不要兩個都送進 sitemap 製造重複網頁訊號。
        # 看板頁的 lastmod＝底下商品最新的那筆（商品分數更新，看板頁內容才會變）。
        urls.append((f"{SITE_URL}/detail.html?sub={sub_q}&from=board",
                     max(sub_dates) if sub_dates else None))
        urls.extend(item_urls)

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u, lastmod in urls:
        tail = f"<lastmod>{lastmod}</lastmod>" if lastmod else ""
        lines.append(f"  <url><loc>{escape(u)}</loc>{tail}</url>")
    lines.append("</urlset>")

    out_path = os.path.join(BASE, "sitemap.xml")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    with_date = sum(1 for _, d in urls if d)
    print(f"✅ sitemap.xml 已產生，共 {len(urls)} 個網址（網域：{SITE_URL}）")
    print(f"   其中 {with_date} 個帶 lastmod，{len(urls) - with_date} 個查不到日期（略過不寫）")


if __name__ == "__main__":
    main()
