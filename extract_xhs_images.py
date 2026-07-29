"""
小紅書「完整網頁（含圖片）」存檔的圖片抽取器（管線第 1 段）

同事改用瀏覽器「完整網頁」存檔後，每篇貼文旁會多一個 `{檔名}_files/` 資料夾，
內含小紅書 CDN 原圖（webp/jpg，內容大圖多為 640×8xx）。舊法（單一 HTML）沒有圖。

本腳本掃指定子分類資料夾，對每篇有 `_files` 的貼文：
  1. 找出內容大圖（寬 ≥ MIN_W，濾掉頭像/icon/UI 縮圖）
  2. 依 CDN 圖片 id 去重（同圖不同 rendition 只留最大）
  3. sips 轉成 png，放到 llm_io/xhs_images/{safe_key}/imgN.png
  4. 產出 llm_io/xhs_image_manifest.json（url → png 清單），供下一段「讀圖」用

用法：
  python3 extract_xhs_images.py 定妝噴霧
  python3 extract_xhs_images.py 定妝噴霧 唇膏
  python3 extract_xhs_images.py --all
"""

import os, sys, json, re, subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
XHS_ROOT = os.path.join(BASE_DIR, "小紅書美妝貼文")
OUT_DIR = os.path.join(BASE_DIR, "llm_io", "xhs_images")
MANIFEST = os.path.join(BASE_DIR, "llm_io", "xhs_image_manifest.json")

MIN_W = 600          # 內容大圖門檻（頭像 60/80、banner 480 都被濾掉）
MAX_IMGS = 12        # 每篇最多取幾張（輪播通常 ≤ 9）


def _is_image(path):
    """用 file 判斷是否為 JPEG / WebP 影像。"""
    try:
        t = subprocess.check_output(["file", "-b", path], stderr=subprocess.DEVNULL).decode("utf-8", "ignore")
    except Exception:
        return False
    return ("JPEG image" in t) or ("Web/P image" in t) or ("PNG image" in t)


def _pixel_width(path):
    """sips 讀寬度；讀不到回 0。"""
    try:
        out = subprocess.check_output(["sips", "-g", "pixelWidth", path],
                                      stderr=subprocess.DEVNULL).decode("utf-8", "ignore")
        m = re.search(r"pixelWidth:\s*(\d+)", out)
        return int(m.group(1)) if m else 0
    except Exception:
        return 0


def _cdn_id(fname):
    """CDN 圖片 id：取 '!' 前段、去掉結尾 (1) 之類，同圖不同 rendition 會同 id。"""
    base = fname.split("!")[0]
    base = re.sub(r"\(\d+\)$", "", base)
    return base


def _safe_key(url):
    return re.sub(r"[^0-9A-Za-z一-鿿]+", "_", url).strip("_")


def extract_post(html_path, url):
    """回傳該貼文轉好的 png 路徑清單（可能為空）。"""
    files_dir = os.path.splitext(html_path)[0] + "_files"
    if not os.path.isdir(files_dir):
        return []

    # 收集候選內容大圖，依 CDN id 去重（留寬度最大的 rendition）
    best = {}   # cdn_id -> (width, filepath)
    for fn in os.listdir(files_dir):
        fp = os.path.join(files_dir, fn)
        if not os.path.isfile(fp) or fn.endswith((".js", ".css", ".json", ".woff", ".woff2", ".svg")):
            continue
        if not _is_image(fp):
            continue
        w = _pixel_width(fp)
        if w < MIN_W:
            continue
        cid = _cdn_id(fn)
        if cid not in best or w > best[cid][0]:
            best[cid] = (w, fp)

    if not best:
        return []

    # 依寬度由大到小，最多 MAX_IMGS 張，轉 png
    chosen = sorted(best.values(), key=lambda x: -x[0])[:MAX_IMGS]
    dest = os.path.join(OUT_DIR, _safe_key(url))
    os.makedirs(dest, exist_ok=True)
    pngs = []
    for i, (w, fp) in enumerate(chosen, 1):
        out_png = os.path.join(dest, f"img{i}.png")
        try:
            subprocess.check_call(["sips", "-s", "format", "png", fp, "--out", out_png],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pngs.append(out_png)
        except Exception:
            pass
    return pngs


def run(folders):
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = []
    for folder in folders:
        fdir = os.path.join(XHS_ROOT, folder)
        if not os.path.isdir(fdir):
            print(f"⚠️ 跳過（找不到）：{folder}")
            continue
        n_posts = n_imgs = 0
        for product in sorted(os.listdir(fdir)):
            pdir = os.path.join(fdir, product)
            if not os.path.isdir(pdir):
                continue
            for fname in sorted(os.listdir(pdir)):
                if not fname.lower().endswith(".html"):
                    continue
                url = f"xhs://{folder}/{product}/{fname}"
                pngs = extract_post(os.path.join(pdir, fname), url)
                if not pngs:
                    continue
                manifest.append({
                    "url": url, "folder": folder, "product": product,
                    "html": fname, "images": pngs, "n_images": len(pngs),
                })
                n_posts += 1
                n_imgs += len(pngs)
        print(f"  📂 {folder}: {n_posts} 篇有圖，共 {n_imgs} 張內容大圖")

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\n✅ manifest 寫入 {MANIFEST}（{len(manifest)} 篇）")
    print("   下一步：由 Claude Code 逐張 Read manifest 內的 png，抽出圖上心得 → llm_io/xhs_image_texts.json")


def main():
    if "--all" in sys.argv:
        folders = [d for d in os.listdir(XHS_ROOT) if os.path.isdir(os.path.join(XHS_ROOT, d))]
    else:
        folders = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not folders:
        print(__doc__)
        return
    run(folders)


if __name__ == "__main__":
    main()
