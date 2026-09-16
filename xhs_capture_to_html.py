# -*- coding: utf-8 -*-
"""把 xhs_capture_server.py 收到的 JSONL 轉成 parse_xhs.py 讀得懂的 HTML 檔。

瀏覽器抓取（Claude in Chrome）→ xhs_capture_server.py → llm_io/xhs_capture/<slug>.jsonl
→ 本工具 → 小紅書美妝貼文/<子分類>/<品項資料夾>/<prefix><n>.html
→ 照原流程 python3 parse_xhs.py <子分類>

刻意產出 HTML 而不是直接寫 standardized_reviews.json，是為了跟手動存檔的資料
走完全同一條路（同樣的 xhs:// url 慣例、同樣的去重、同樣的清洗評分），
不必為了新來源在管線裡多開一條分支。

用法：
  /usr/bin/python3 xhs_capture_to_html.py --slug NARS4色眼彩盤 \
      --subcat 眼影/眼影盤 --folder "NARS 4色眼彩盤" --prefix NARS眼影
  # 加 --dry-run 只看會產生什麼、不寫檔
"""
import argparse, glob, hashlib, json, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CAP_DIR = os.path.join(BASE, "llm_io", "xhs_capture")
XHS_ROOT = os.path.join(BASE, "小紅書美妝貼文")

PAGE = """<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>{title}</title>
<!-- captured-from: {url} -->
<!-- captured-keyword: {kw} -->
<!-- captured-date: {date} -->
</head><body>
<div class="note-container">
  <div class="title">{title}</div>
  <div class="author-wrapper"><span class="username">{nick}</span></div>
  <div class="note-text">{body}</div>
  <div class="interact"><span class="like-wrapper"><span class="count">{likes}</span></span></div>
</div>
</body></html>
"""


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def norm(text):
    """比對用的正規化內容：去空白、去表情符號標記，避免同一篇因細節差異被當新貼文。"""
    t = re.sub(r"\[[^\]]{1,12}R\]", "", text or "")
    return re.sub(r"\s+", "", t)


def existing_fingerprints(folder_dir):
    """掃資料夾裡既有的 HTML（含手動存檔的），回傳 內容指紋 與 已用過的編號。"""
    prints, nums = set(), set()
    for path in glob.glob(os.path.join(folder_dir, "*.html")):
        raw = open(path, "r", encoding="utf-8", errors="ignore").read()
        m = re.search(r'class="note-text"[^>]*>(.*?)</div>', raw, re.S) or \
            re.search(r'class="desc"[^>]*>(.*?)</div>', raw, re.S)
        if m:
            body = re.sub(r"<[^>]+>", "", m.group(1))
            if len(norm(body)) >= 20:
                prints.add(norm(body)[:120])
        m = re.search(r"(\d+)\.html$", os.path.basename(path))
        if m:
            nums.add(int(m.group(1)))
    return prints, nums


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True, help="llm_io/xhs_capture/<slug>.jsonl")
    ap.add_argument("--subcat", required=True, help="小紅書美妝貼文 底下的子分類資料夾名")
    ap.add_argument("--folder", required=True, help="品項資料夾名（對應 Items.csv 的品牌+品名）")
    ap.add_argument("--prefix", required=True, help="檔名前綴，例如 NARS眼影 → NARS眼影1.html")
    ap.add_argument("--min-len", type=int, default=60, help="內容低於這個字數就跳過")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    src = os.path.join(CAP_DIR, a.slug + ".jsonl")
    if not os.path.exists(src):
        sys.exit("❌ 找不到 %s" % src)

    notes = []
    with open(src, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                notes.append(json.loads(line))

    out_dir = os.path.join(XHS_ROOT, a.subcat, a.folder)
    prints, nums = existing_fingerprints(out_dir) if os.path.isdir(out_dir) else (set(), set())
    print("📂 %s（既有 %d 篇）" % (out_dir.replace(BASE + os.sep, ""), len(nums)))

    seen_ids = set()
    written = skipped_dup = skipped_short = 0
    n = max(nums) if nums else 0
    for note in notes:
        body = (note.get("body") or "").strip()
        if len(norm(body)) < a.min_len:
            skipped_short += 1
            continue
        fp = norm(body)[:120]
        if fp in prints or note.get("id") in seen_ids:
            skipped_dup += 1
            continue
        prints.add(fp)
        seen_ids.add(note.get("id"))
        n += 1
        fname = "%s%d.html" % (a.prefix, n)
        html = PAGE.format(
            title=esc(note.get("title") or ""),
            nick=esc(note.get("nick") or ""),
            body=esc(body).replace("\n", "<br>"),
            likes=esc(str(note.get("likes") or "0")),
            url=esc(note.get("url") or ("https://www.xiaohongshu.com/explore/" + (note.get("id") or ""))),
            kw=esc(note.get("kw") or ""),
            date=esc(note.get("date") or ""),
        )
        if a.dry_run:
            print("  [dry] %s ← %s…" % (fname, body[:34].replace("\n", " ")))
        else:
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
                f.write(html)
        written += 1

    print("\n✅ 寫入 %d 篇（重複略過 %d、太短略過 %d）" % (written, skipped_dup, skipped_short))
    if not a.dry_run and written:
        print("   下一步：python3 parse_xhs.py %s && python3 clean_data.py" % a.subcat)


if __name__ == "__main__":
    main()
