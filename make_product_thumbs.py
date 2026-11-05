# -*- coding: utf-8 -*-
"""為 site-data.json 引用的商品圖產生縮圖：assets/products/xxx.png → assets/products/thumb/xxx.webp。

為什麼：榜單、「網友怎麼說」等小卡片原本直接載商品原圖（最大 1MB、1080×1080），
在 48～250px 的位置顯示，一頁多載好幾 MB。縮圖版只有原圖的零頭，商品頁大圖仍用原圖。

規則：
  - 長邊縮到 MAX_SIDE（不放大），保留透明；webp quality 80
  - 縮圖已存在且比原圖新就跳過（可重複執行）；--force 全部重做
  - 前端 script.js 的 thumbOf() 依「assets/products/<檔名>.<副檔名> → assets/products/thumb/<檔名>.webp」
    這個命名慣例找縮圖，找不到會退回原圖，所以新增商品忘了跑這支不會壞圖，只是沒有加速。

用法：
    python3 make_product_thumbs.py          # 補缺的
    python3 make_product_thumbs.py --force  # 全部重做
新增商品圖（assets/products/ 有新檔、site-data.json 有引用）之後記得跑一次。
"""
import json
import os
import sys

from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = "assets/products"
THUMB_DIR = os.path.join(BASE, SRC_DIR, "thumb")
MAX_SIDE = 360
QUALITY = 80


def referenced_images():
    with open(os.path.join(BASE, "site-data.json"), encoding="utf-8") as f:
        sd = json.load(f)
    seen = []
    for d in sd.get("subcategoryDetails", {}).values():
        for it in d.get("items", []):
            im = it.get("image") or it.get("img") or ""
            if im.startswith(SRC_DIR + "/") and im.count("/") == 2 and im not in seen:
                seen.append(im)
    return seen


def main():
    force = "--force" in sys.argv
    os.makedirs(THUMB_DIR, exist_ok=True)
    imgs = referenced_images()
    stems = {}
    for p in imgs:
        stem = os.path.splitext(os.path.basename(p))[0]
        if stem in stems and stems[stem] != p:
            print(f"❌ 檔名衝突：{stems[stem]} 與 {p} 的縮圖都會叫 {stem}.webp，請先改名")
            return 1
        stems[stem] = p

    made = skipped = missing = 0
    failed = []
    src_bytes = out_bytes = 0
    for p in imgs:
        src = os.path.join(BASE, p)
        if not os.path.exists(src):
            missing += 1
            print(f"⚠️ 原圖不存在：{p}")
            continue
        stem = os.path.splitext(os.path.basename(p))[0]
        dst = os.path.join(THUMB_DIR, stem + ".webp")
        src_bytes += os.path.getsize(src)
        if not force and os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            skipped += 1
            out_bytes += os.path.getsize(dst)
            continue
        try:
            with Image.open(src) as im:
                im.load()
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA" if "transparency" in im.info or im.mode in ("LA", "PA", "P") else "RGB")
                im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)   # 只縮不放大，保留比例
                tmp = dst + ".tmp"
                im.save(tmp, "WEBP", quality=QUALITY, method=6)
            os.replace(tmp, dst)
        except Exception as err:   # 壞檔只略過、回報；前端找不到縮圖會退回原圖
            failed.append(p)
            print(f"⚠️ 無法產生縮圖：{p}（{err}）")
            continue
        out_bytes += os.path.getsize(dst)
        made += 1

    print(f"✅ 縮圖：新做 {made}、略過 {skipped}、原圖不存在 {missing}、失敗 {len(failed)}（共 {len(imgs)} 張）")
    print(f"   原圖合計 {src_bytes/1e6:.1f}MB → 縮圖合計 {out_bytes/1e6:.1f}MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
