"""
小紅書「單品牌子資料夾 → item_id」程式化路由（免 LLM）

小紅書貼文已放在 小紅書美妝貼文/{子分類}/{品牌子資料夾}/*.html，品牌明確，
不需 LLM 拆分即可精準歸位。本腳本讀 cleaned_reviews.json，把指定子分類資料夾裡
的小紅書貼文，依「品牌子資料夾開頭品牌 → Items.csv 同子分類該品牌列」補上 item_id，
產出 routed 記錄（schema 同 route_reviews.py 輸出），append 進 routed_reviews.json
（依 routed_from_url 去重，不重複加入）。

「多品項XXX評比」等非單一品牌資料夾 → 跳過（需多品項拆分，交給 route_reviews.py）。

用法：
  python3 route_xhs_programmatic.py 眉筆 眼線筆 睫毛膏 防曬乳 唇膏 打亮
"""

import os, sys, json, csv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ITEMS_CSV = os.path.join(BASE_DIR, "csv", "Items.csv")
CLEANED = os.path.join(BASE_DIR, "cleaned_reviews.json")
ROUTED = os.path.join(BASE_DIR, "routed_reviews.json")

FOLDER_TO_SUBCAT = {
    "眉筆": "眉筆", "眼線筆": "眼線筆", "睫毛膏": "睫毛膏",
    "防曬乳": "防曬乳", "唇膏": "唇膏", "打亮": "打亮/修容",
    "眼影": "眼影/眼影盤",
    "唇釉": "唇釉", "唇蜜": "唇蜜", "護唇膏": "護唇膏",
    "面霜": "面霜", "面膜": "面膜", "粉底刷": "粉底刷", "腮紅刷": "腮紅刷",
    "眼影刷": "眼影刷", "打亮修容刷": "打亮修容刷", "海綿粉撲": "海綿粉撲",
    "精華液": "精華液", "眼霜": "眼霜",
}

# 品牌 → 可能出現在子資料夾開頭的別名（比對用，全部轉大寫比對）
BRAND_ALIASES = {
    "植村秀": ["植村秀", "SHU UEMURA"],
    "資生堂": ["資生堂", "SHISEIDO"],
    "M.A.C": ["MAC", "M.A.C", "魅可"],
    "YSL": ["YSL", "聖羅蘭", "圣罗兰"],
    "DIOR": ["DIOR", "迪奧", "迪奥"],
    "CHANEL": ["CHANEL", "香奈兒", "香奈儿"],
    "MAKE UP FOREVER": ["MAKE UP FOREVER", "MAKEUP FOREVER", "玫珂菲", "MUF", "MKAE UP FOREVER"],
    "雅詩蘭黛": ["雅詩蘭黛", "雅诗兰黛", "ESTEE", "ESTÉE", "DOUBLE WEAR"],
    "蘭蔻": ["蘭蔻", "兰蔻", "LANCOME", "LANCÔME"],
    "Bobbi Brown": ["BOBBI BROWN", "BOBBI", "芭比波朗", "芭比布朗"],
}


def load_subcat_brand_ids():
    """回傳 {subcat: [(brand, id, item_name), ...]}。"""
    with open(ITEMS_CSV, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    id_field = list(rows[0].keys())[0]
    tw_field = "Items（台灣官網商品名）"
    out = {}
    for r in rows:
        sub = r.get("Subcategories", "")
        out.setdefault(sub, []).append((r.get("Brand", ""), r.get(id_field, ""), r.get(tw_field, "")))
    return out


def match_brand(product_folder, brand_rows):
    """product_folder 開頭比對品牌別名，回傳 (id, brand, item_name) 或 None。"""
    pf = product_folder.upper()
    for brand, iid, item_name in brand_rows:
        for alias in BRAND_ALIASES.get(brand, [brand]):
            if pf.startswith(alias.upper()):
                return iid, brand, item_name
    return None


def run(folders):
    subcat_brand_ids = load_subcat_brand_ids()
    with open(CLEANED, "r", encoding="utf-8") as f:
        cleaned = json.load(f)
    with open(ROUTED, "r", encoding="utf-8") as f:
        routed = json.load(f)

    already = {r.get("routed_from_url") for r in routed if r.get("routed_from_url")}
    already |= {r.get("url") for r in routed if r.get("url")}

    added = 0
    skipped_multi = 0
    unmatched = []
    for rec in cleaned:
        url = rec.get("url") or ""
        if not url.startswith("xhs://"):
            continue
        parts = url[len("xhs://"):].split("/")
        if len(parts) < 3:
            continue
        folder, product = parts[0], parts[1]
        if folder not in folders:
            continue
        subcat = FOLDER_TO_SUBCAT.get(folder)
        if not subcat:
            continue
        base_url = url
        if base_url in already:
            continue
        # 多品項評比等非單一品牌 → 跳過（交給多品項拆分）
        if product.startswith("多品項") or "評比" in product:
            skipped_multi += 1
            continue
        m = match_brand(product, subcat_brand_ids.get(subcat, []))
        if not m:
            unmatched.append(f"{folder}/{product}")
            continue
        iid, brand, item_name = m
        new = dict(rec)
        new["item_id"] = str(iid)
        new["routed_from_url"] = base_url
        new["routed_item"] = f"{brand} {item_name}".strip()
        new["url"] = base_url + "#p0"
        routed.append(new)
        already.add(base_url)
        added += 1

    with open(ROUTED, "w", encoding="utf-8") as f:
        json.dump(routed, f, ensure_ascii=False, indent=4)

    print(f"✅ 程式化路由完成：新增 {added} 筆帶 item_id 的小紅書記錄")
    print(f"   跳過多品項資料夾 {skipped_multi} 筆（需多品項拆分）")
    if unmatched:
        uniq = sorted(set(unmatched))
        print(f"   ⚠️ 品牌未匹配 {len(uniq)} 個資料夾：")
        for u in uniq:
            print(f"       {u}")
    print(f"   routed_reviews.json 現有 {len(routed)} 筆")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run(set(args) if args else set(FOLDER_TO_SUBCAT.keys()))
