"""
把「圖上心得」併回評論資料（管線第 3 段）

讀 llm_io/xhs_image_texts.json（{url: 圖片內文}，由 Claude Code 讀 manifest 內 png 後產出），
依 url 找到對應評論記錄，把圖片內文附加到該則的 content 後面（加 marker，冪等可重跑）。
同步更新 standardized_reviews.json（永久保存）與 routed_reviews.json（評分實際讀取來源）。

用法：
  python3 merge_xhs_image_text.py           # 套用 llm_io/xhs_image_texts.json
之後重跑：score_reviews.py --prepare/--compute --subcat <子分類> 即可看到圖上心得進入評分。
"""

import os, json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEXTS = os.path.join(BASE_DIR, "llm_io", "xhs_image_texts.json")
TARGETS = ["standardized_reviews.json", "cleaned_reviews.json", "routed_reviews.json"]
MARKER = "\n\n【圖片內文】"


def patch_file(path, texts):
    if not os.path.exists(path):
        return 0, 0
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    patched = skipped = 0
    changed = False
    for rec in data:
        url = rec.get("url")
        if url not in texts:
            continue
        img_text = texts[url].strip()
        content = rec.get("content", "") or ""
        # 冪等：已含這段圖片內文就跳過，但仍確保旗標存在
        if img_text in content:
            if not rec.get("image_review"):
                rec["image_review"] = True
                changed = True
            skipped += 1
            continue
        rec["content"] = content + MARKER + img_text
        rec["image_review"] = True  # 供 score_reviews.py 排序加權，不代表一定進榜
        patched += 1
        changed = True
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
    return patched, skipped


def main():
    if not os.path.exists(TEXTS):
        print(f"❌ 找不到 {TEXTS}")
        return
    with open(TEXTS, "r", encoding="utf-8") as f:
        texts = json.load(f)
    print(f"讀入 {len(texts)} 篇圖片內文")
    for t in TARGETS:
        p, s = patch_file(os.path.join(BASE_DIR, t), texts)
        print(f"  {t}: 併入 {p} 筆（已有跳過 {s} 筆）")
    print("\n✅ 完成。重跑 score_reviews.py --prepare/--compute --subcat <子分類> 即可讓圖上心得進評分。")


if __name__ == "__main__":
    main()
