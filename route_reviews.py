"""
多品項拆分與歸位路由（route_reviews）— agent 兩段式，免 API key

問題背景：
  一篇貼文（尤其小紅書）常同時討論多款/多色號/多版本商品。舊流程用 search_keyword
  把整篇綁到單一品項，導致 A 商品的評論混入 B 商品的分數，或整段內容被直接丟棄。

分工（符合 SKILL「LLM 做語言理解、Python 做計算」原則）：
  - LLM = Claude Code（agent 本身）：讀貼文 → 拆成「各品項片段」→ 比對商品目錄，
    判斷每段對應哪個現有 item（matched_item_id）或是目錄上沒有的新品（null）。
  - Python：把有對應的片段展開成獨立評論記錄（帶 item_id）寫入 routed_reviews.json，
    交給 score_reviews.py 精準歸位；認不到的新品寫入 csv/候選新品.csv 暫存待審。

兩段式流程（不需 ANTHROPIC_API_KEY）：
  1) python3 route_reviews.py --prepare --subcat 粉底液,遮瑕膏
        → 產出 llm_io/route_requests.json（含商品目錄 + 待拆分貼文）
  2) 由 Claude Code 讀 request、逐則拆分並比對目錄，寫出 llm_io/route_responses.json
  3) python3 route_reviews.py --compute
        → 產出 routed_reviews.json（完整，本輪有標記的 rid 覆蓋，其餘 rid 合併沿用舊
          routed_reviews.json 裡先前已路由的版本，從未處理過的才退回原樣通過）
          + csv/候選新品.csv

未指定 --subcat 時，預設只拆分小紅書貼文（多品項問題最集中之處）；其餘來源原樣通過。
rid = 該則評論在 cleaned_reviews.json 的索引（prepare 與 compute 之間該檔不可變動）。
"""

import os, sys, json, csv, re
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _find_items_csv():
    for name in ("Items.csv", " Items.csv"):
        p = os.path.join(BASE_DIR, "csv", name)
        if os.path.exists(p):
            return p
    return os.path.join(BASE_DIR, "csv", "Items.csv")


ITEMS_CSV = _find_items_csv()
SUBCAT_CSV = os.path.join(BASE_DIR, "csv", "Subcategories.csv")
CLEANED_JSON = os.path.join(BASE_DIR, "cleaned_reviews.json")
ROUTED_JSON = os.path.join(BASE_DIR, "routed_reviews.json")
CANDIDATE_CSV = os.path.join(BASE_DIR, "csv", "候選新品.csv")

LLM_IO_DIR = os.path.join(BASE_DIR, "llm_io")
ROUTE_REQ = os.path.join(LLM_IO_DIR, "route_requests.json")
ROUTE_RESP = os.path.join(LLM_IO_DIR, "route_responses.json")

# 小紅書資料夾名 → Items.csv 子分類正式名（兩者用詞不同）
FOLDER_TO_SUBCAT = {
    "粉底液": "粉底液", "遮瑕": "遮瑕膏", "唇膏": "唇膏",
    "打亮": "打亮/修容", "眼影": "眼影/眼影盤", "腮紅": "腮紅",
    "妝前乳": "妝前乳", "定妝噴霧": "定妝噴霧", "氣墊粉餅": "氣墊粉餅", "蜜粉": "蜜粉",
    "卸妝棉": "卸妝棉", "卸妝水": "卸妝水", "卸妝油": "卸妝油", "卸妝膏": "卸妝膏",
    "去角質": "去角質", "洗面乳": "洗面乳", "眼唇卸妝液": "眼唇卸妝液",
    "化妝水": "化妝水", "乳液": "乳液", "面膜": "面膜", "面霜": "面霜",
    "精華液": "精華液", "眼霜": "眼霜", "粉底刷": "粉底刷", "腮紅刷": "腮紅刷",
    "眼影刷": "眼影刷", "打亮修容刷": "打亮修容刷", "海綿粉撲": "海綿粉撲",
}


# ==========================================
# 資料載入
# ==========================================

def load_items():
    with open(ITEMS_CSV, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    id_field = list(rows[0].keys())[0] if rows else " "

    def _strip_spf(n):
        return n.split("SPF")[0].strip()

    items_by_id = {}
    for i, row in enumerate(rows):
        rid = (row.get(id_field, "") or "").strip() or str(i + 1)
        brand = (row.get("Brand", "") or "").strip()
        tw = (row.get("Items（台灣官網商品名）") or row.get("Items") or "").strip()
        if not brand or not tw:
            continue
        row["_id"] = rid
        row["_canonical_keyword"] = f"{brand} {_strip_spf(tw)}".strip()
        items_by_id[rid] = row
    return items_by_id


def load_subcat_taxonomy():
    taxonomy = {}
    if os.path.exists(SUBCAT_CSV):
        with open(SUBCAT_CSV, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sub = (row.get("Subcategories", "") or "").strip()
                if sub:
                    taxonomy[sub] = ((row.get("Types", "") or "").strip(),
                                     (row.get("Categories", "") or "").strip())
    return taxonomy


def build_catalog(items_by_id, only_subcats=None):
    """商品目錄（list of dict），給 agent 做歸位比對。可依子分類縮小以聚焦。"""
    cat = []
    for rid, row in items_by_id.items():
        sub = (row.get("Subcategories", "") or "").strip()
        if only_subcats and sub not in only_subcats:
            continue
        cat.append({
            "id": rid,
            "brand": (row.get("Brand", "") or "").strip(),
            "tw_name": (row.get("Items（台灣官網商品名）") or row.get("Items") or "").strip(),
            "cn_name": (row.get("Items（中國官網商品名）", "") or "").strip(),
            "alias": (row.get("Another name（別稱）", "") or "").strip(),
            "subcategory": sub,
        })
    return cat


def _norm(s):
    return re.sub(r"\s+", "", (s or "")).strip().lower()


def xhs_folder(url):
    """xhs://粉底液/品牌/檔名.html → '粉底液'。"""
    m = re.match(r"xhs://([^/]+)/", url or "")
    return m.group(1) if m else ""


# ==========================================
# Step 1：--prepare
# ==========================================

def prepare(target_subcats):
    if not os.path.exists(CLEANED_JSON):
        print(f"❌ 找不到 {CLEANED_JSON}，請先跑 clean_data.py")
        return
    items_by_id = load_items()

    with open(CLEANED_JSON, "r", encoding="utf-8") as f:
        reviews = json.load(f)

    # 目標小紅書資料夾（依 --subcat 反查；未給則全部小紅書資料夾）
    if target_subcats:
        target_folders = {fo for fo, sub in FOLDER_TO_SUBCAT.items() if sub in target_subcats}
    else:
        target_folders = set(FOLDER_TO_SUBCAT.keys())

    to_route = []
    for i, r in enumerate(reviews):
        if (r.get("platform", "") or "").strip() != "小紅書":
            continue  # 目前只拆分小紅書；其餘來源在 compute 時原樣通過
        folder = xhs_folder(r.get("url", ""))
        if folder not in target_folders:
            continue
        to_route.append({
            "rid": i,
            "platform": r.get("platform", ""),
            "folder": folder,
            "likely_subcategory": FOLDER_TO_SUBCAT.get(folder, ""),
            "title": (r.get("title", "") or "").replace(chr(10), " "),
            "content": (r.get("content", "") or "").replace(chr(10), " "),
        })

    catalog = build_catalog(items_by_id, only_subcats=target_subcats)
    payload = {
        "instructions": "對每則 review，拆成它實際討論到的各個商品片段。"
                        "一則只談一個商品就給單一 segment；同時談多個不同商品（不同品牌/系列/品項，"
                        "色號差異不算不同商品）就拆多個 segment，各 segment 的 content 只留與該商品相關的句子。"
                        "每個 segment 比對 catalog：對應到某列填 matched_item_id=該列 id；目錄沒有的新品填 "
                        "matched_item_id=null 並盡量給 brand/product_name/subcategory。與任何美妝商品無關的貼文 segments 給 []。",
        "response_format": {
            "檔名": "llm_io/route_responses.json",
            "格式": '{ "<rid>": {"segments": [{"matched_item_id": <id 或 null>, "brand": "", "product_name": "", "subcategory": "", "content": ""}]} }',
        },
        "subcategory_options": list(FOLDER_TO_SUBCAT.values()),
        "catalog": catalog,
        "reviews": to_route,
    }

    os.makedirs(LLM_IO_DIR, exist_ok=True)
    with open(ROUTE_REQ, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"🧾 --prepare 完成")
    print(f"   目標子分類：{', '.join(sorted(target_subcats)) if target_subcats else '（全部小紅書資料夾）'}")
    print(f"   待拆分小紅書貼文：{len(to_route)} 則｜商品目錄：{len(catalog)} 項")
    print(f"   → {ROUTE_REQ}")
    print(f"   下一步：由 Claude Code 讀取此檔、逐則拆分並比對目錄，寫出 {ROUTE_RESP}，再跑 `--compute`。")


# ==========================================
# Step 3：--compute
# ==========================================

def compute():
    if not os.path.exists(CLEANED_JSON):
        print(f"❌ 找不到 {CLEANED_JSON}")
        return
    if not os.path.exists(ROUTE_RESP):
        print(f"❌ 找不到 {ROUTE_RESP}，請先跑 --prepare 並由 Claude Code 產生標記")
        return

    items_by_id = load_items()
    taxonomy = load_subcat_taxonomy()
    with open(CLEANED_JSON, "r", encoding="utf-8") as f:
        reviews = json.load(f)
    with open(ROUTE_RESP, "r", encoding="utf-8") as f:
        responses = json.load(f)

    # ⚠️ 每次 --compute 只帶著「這一輪 --subcat」的 route_responses.json，若直接用
    # cleaned_reviews.json（未路由的原始資料）當 passthrough 來源，會把之前所有其他
    # 子分類已經路由好的 item_id 全部蓋掉（2026-07-28 資料遺失事故：面膜/面霜 compute()
    # 把粉底液等其餘子分類先前路由的 item_id 整批清空）。
    # 修正：改成在既有 routed_reviews.json 的基礎上合併——本輪有 response 的 rid 才重新
    # 展開覆蓋，其餘 rid 一律沿用舊 routed_reviews.json 裡「已路由」的版本（保留 item_id），
    # 真的從未被任何一輪處理過的 rid 才退回 cleaned_reviews.json 原樣通過。
    old_routed = []
    if os.path.exists(ROUTED_JSON):
        with open(ROUTED_JSON, "r", encoding="utf-8") as f:
            old_routed = json.load(f)
    old_by_rid = {}
    for rec in old_routed:
        url = rec.get("routed_from_url") or rec.get("url") or ""
        rid = url.split("#p")[0]
        old_by_rid.setdefault(rid, []).append(rec)

    routed = []
    candidates = {}
    stats = {"passthrough": 0, "segmented": 0, "matched": 0, "new": 0, "multi": 0, "unrelated": 0}

    for i, orig in enumerate(reviews):
        resp = responses.get(str(i))
        if resp is None:
            preserved = old_by_rid.get(orig.get("url", ""))
            if preserved is not None:
                routed.extend(preserved)   # 之前其他輪已路由過 → 保留舊有 item_id
            else:
                routed.append(orig)        # 從未被任何一輪處理過 → 原樣通過
            stats["passthrough"] += 1
            continue
        segments = resp.get("segments", []) if isinstance(resp, dict) else resp
        if not segments:
            stats["unrelated"] += 1        # 與商品無關 → 丟棄
            continue
        stats["segmented"] += 1
        if len(segments) > 1:
            stats["multi"] += 1

        for seg_n, seg in enumerate(segments):
            content = (seg.get("content") or "").strip() or (orig.get("content") or "")
            mid = seg.get("matched_item_id")
            mid = str(mid).strip() if mid not in (None, "", "null") else ""

            if mid and mid in items_by_id:
                stats["matched"] += 1
                item = items_by_id[mid]
                routed.append({
                    **orig,
                    "url": f'{orig.get("url","")}#p{seg_n}',
                    "content": content,
                    "item_id": mid,
                    "search_keyword": item["_canonical_keyword"],
                    "routed_from_url": orig.get("url", ""),
                    "routed_item": f'{item.get("Brand","")} {item.get("Items（台灣官網商品名）") or item.get("Items","")}',
                })
            else:
                stats["new"] += 1
                brand = (seg.get("brand") or "").strip()
                name = (seg.get("product_name") or "").strip()
                sub = (seg.get("subcategory") or "").strip()
                if not brand and not name:
                    continue
                key = (_norm(brand), _norm(name), sub)
                if key not in candidates:
                    types, cats = taxonomy.get(sub, ("", ""))
                    candidates[key] = {
                        "Types": types, "Categories": cats, "Subcategories": sub,
                        "Brand": brand, "Suggested_Name": name, "Occurrences": 0,
                        "Source_Platform": orig.get("platform", ""),
                        "Source_URL": orig.get("url", ""),
                        "Source_Snippet": content[:120],
                        "Detected_At": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    }
                candidates[key]["Occurrences"] += 1

    with open(ROUTED_JSON, "w", encoding="utf-8") as f:
        json.dump(routed, f, ensure_ascii=False, indent=2)
    _write_candidates(candidates)

    print(f"🎉 --compute 完成")
    print(f"   原樣通過 {stats['passthrough']} 則｜拆分處理 {stats['segmented']} 則"
          f"（其中多品項 {stats['multi']} 則、與商品無關丟棄 {stats['unrelated']} 則）")
    print(f"   片段歸位到現有品項 {stats['matched']} 段、候選新品 {stats['new']} 段")
    print(f"   ✅ 可評分資料：{ROUTED_JSON}（{len(routed)} 筆）")
    print(f"   🆕 候選新品暫存：{CANDIDATE_CSV}（{len(candidates)} 個待審新品，尚未進 Items.csv）")


def _write_candidates(new_candidates):
    fieldnames = ["Types", "Categories", "Subcategories", "Brand", "Suggested_Name",
                  "Occurrences", "Source_Platform", "Source_URL", "Source_Snippet", "Detected_At"]
    merged = {}
    if os.path.exists(CANDIDATE_CSV):
        with open(CANDIDATE_CSV, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                key = (_norm(row.get("Brand")), _norm(row.get("Suggested_Name")),
                       row.get("Subcategories", ""))
                merged[key] = row
    for key, cand in new_candidates.items():
        if key in merged:
            try:
                merged[key]["Occurrences"] = str(
                    int(merged[key].get("Occurrences") or 0) + cand["Occurrences"])
            except ValueError:
                merged[key]["Occurrences"] = str(cand["Occurrences"])
        else:
            cand["Occurrences"] = str(cand["Occurrences"])
            merged[key] = cand
    with open(CANDIDATE_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in merged.values():
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def _parse_subcat_arg():
    if "--subcat" in sys.argv:
        try:
            raw = sys.argv[sys.argv.index("--subcat") + 1]
            return {s.strip() for s in raw.split(",") if s.strip()}
        except IndexError:
            pass
    return None


def main():
    if "--prepare" in sys.argv:
        prepare(_parse_subcat_arg())
    elif "--compute" in sys.argv:
        compute()
    else:
        print("用法：")
        print("  python3 route_reviews.py --prepare [--subcat 粉底液,遮瑕膏]")
        print("  （由 Claude Code 產生 llm_io/route_responses.json 後）")
        print("  python3 route_reviews.py --compute")


if __name__ == "__main__":
    main()
