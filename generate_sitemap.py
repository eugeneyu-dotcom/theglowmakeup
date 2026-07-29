# -*- coding: utf-8 -*-
"""產生 sitemap.xml（靜態頁 + 每個子分類的美妝看板/精選評比頁 + 每個商品頁）。

⚠️ SITE_URL 目前是佔位網域，正式上線前必須換成真實網域再重跑。
用法：/usr/bin/python3 generate_sitemap.py
"""
import json
import os
from urllib.parse import quote
from xml.sax.saxutils import escape

BASE = os.path.dirname(os.path.abspath(__file__))
SITE_URL = "https://REPLACE-WITH-REAL-DOMAIN.example"  # 上線前務必替換成真實網域

STATIC_PAGES = [
    "index.html", "news.html", "skincare-blog.html",
    "board-landing.html", "review-landing.html", "review-base.html",
]


def main():
    data = json.load(open(os.path.join(BASE, "site-data.json"), encoding="utf-8"))
    sd = data.get("subcategoryDetails", {})
    articles = json.load(open(os.path.join(BASE, "articles.json"), encoding="utf-8")).get("articles", [])

    urls = [f"{SITE_URL}/{p}" for p in STATIC_PAGES]
    for a in articles:
        if a.get("content"):  # 只收有完整內文的文章頁，純連去 skincare-blog.html 的舊文章不用另建網址
            urls.append(f"{SITE_URL}/article.html?id={quote(a['id'])}")
    seen_items = set()
    for sub, det in sd.items():
        if not isinstance(det, dict):
            continue
        sub_q = quote(sub)
        urls.append(f"{SITE_URL}/detail.html?sub={sub_q}&from=board")
        urls.append(f"{SITE_URL}/detail.html?sub={sub_q}&from=review")
        for it in det.get("items", []):
            name = (it.get("name") or "").strip()
            if not name or name in seen_items:
                continue
            seen_items.add(name)
            urls.append(f"{SITE_URL}/item-detail.html?item={quote(name)}&from=board")

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        lines.append(f"  <url><loc>{escape(u)}</loc></url>")
    lines.append("</urlset>")

    out_path = os.path.join(BASE, "sitemap.xml")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"✅ sitemap.xml 已產生，共 {len(urls)} 個網址")
    print(f"⚠️  網域目前是佔位字串 {SITE_URL}，正式網域確定後請改 SITE_URL 重跑此腳本")


if __name__ == "__main__":
    main()
