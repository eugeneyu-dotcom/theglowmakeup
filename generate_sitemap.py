# -*- coding: utf-8 -*-
"""產生 sitemap.xml（靜態頁 + 每個子分類的美妝看板/精選評比頁 + 每個商品頁）。

用法：/usr/bin/python3 generate_sitemap.py
"""
import json
import os
from urllib.parse import quote
from xml.sax.saxutils import escape

BASE = os.path.dirname(os.path.abspath(__file__))
SITE_URL = "https://theglowmakeup.org"  # 正式網域（Vercel Domains 設定的自訂網域，www 會 redirect 到這個 apex）

STATIC_PAGES = [
    "news.html", "skincare-blog.html",
    "board-landing.html", "review-landing.html", "review-base.html",
]


def main():
    data = json.load(open(os.path.join(BASE, "site-data.json"), encoding="utf-8"))
    sd = data.get("subcategoryDetails", {})
    articles = json.load(open(os.path.join(BASE, "articles.json"), encoding="utf-8")).get("articles", [])

    # 根網址用 "/" 而不是 "/index.html"——兩者是同一頁，Google 會挑一個當標準網址，
    # 之前 sitemap 送 index.html 反而跟 Google 自己選的標準網址（根網址）對不上，被判定重複。
    urls = [f"{SITE_URL}/"] + [f"{SITE_URL}/{p}" for p in STATIC_PAGES]
    for a in articles:
        if a.get("content"):  # 只收有完整內文的文章頁，純連去 skincare-blog.html 的舊文章不用另建網址
            urls.append(f"{SITE_URL}/article.html?id={quote(a['id'])}")
    seen_items = set()
    for sub, det in sd.items():
        if not isinstance(det, dict):
            continue
        sub_q = quote(sub)
        # 只送 from=board 這個標準網址進 sitemap，from=review 是同一頁內容的另一種呈現，
        # 靠頁面自己的 canonical 標籤導回 from=board，不要兩個都送進 sitemap 製造重複網頁訊號。
        urls.append(f"{SITE_URL}/detail.html?sub={sub_q}&from=board")
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
    print(f"✅ sitemap.xml 已產生，共 {len(urls)} 個網址（網域：{SITE_URL}）")


if __name__ == "__main__":
    main()
