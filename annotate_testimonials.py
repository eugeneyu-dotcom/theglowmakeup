# -*- coding: utf-8 -*-
"""心得卡片專用的評論標記工具（不碰分數）。

背景：前台「真實網友心得」卡片只收 routed_reviews.json 裡有 item_id 的評論，而只有
小紅書會經過路由，所以 Threads/Google 的評論進不了候選池——即使那些品項的分數本來
就是用 Threads 評論算出來的（見 CLAUDE.md）。

為什麼不直接重跑 score_reviews.py：那 75 個缺卡片的品項都已經有分數了，重跑不會多出
任何一則評論（Threads 本來就在算分池裡），只會因為 LLM 二次判讀而讓已發布的分數漂移。
這支工具只補「這則評論是不是真的在講這個商品」的標記，完全不碰 csv/AI_Scores.csv。

用法（兩段式，跟評分管線一致）：
    /usr/bin/python3 annotate_testimonials.py --prepare --subcat 唇蜜,護唇膏
      → 產出 llm_io/testimonial_requests.json
    （由 Claude Code 讀該檔逐則判讀，寫出 llm_io/testimonial_responses.json）
    /usr/bin/python3 annotate_testimonials.py --merge
      → 併進 llm_io/review_annotations.json（依 url 合併，不覆蓋其他品項）
    /usr/bin/python3 build_scores_data.py
"""
import argparse, csv, json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ITEMS = os.path.join(BASE, "csv", "Items.csv")
ROUTED = os.path.join(BASE, "routed_reviews.json")
SCORES = os.path.join(BASE, "scores-data.json")
LLM_IO = os.path.join(BASE, "llm_io")
REQ = os.path.join(LLM_IO, "testimonial_requests.json")
RESP = os.path.join(LLM_IO, "testimonial_responses.json")
STORE = os.path.join(LLM_IO, "review_annotations.json")

MAX_CANDIDATES = 12      # 每個品項最多送幾則去判讀（只需挑出 3 則，不必全看）
GOOGLE_SUFFIXES = (" Dcard 評價", " PTT 評價", " Dcard", " PTT", " IG", " 心得", " 評價")


def _strip_spf(n):
    return (n or "").split("SPF")[0].strip()


def build_search_keywords(brand, tw, cn, alt):
    """與 scrape_threads.py 的 _build_keywords() 一致；兩邊改動要同步。"""
    kws, seen = [], set()

    def add(kw):
        kw = (kw or "").strip()
        if kw and kw not in seen:
            seen.add(kw)
            kws.append(kw)

    if alt:
        add("%s %s" % (brand, alt))
    if cn and cn != tw:
        add(_strip_spf(cn))
    if tw:
        add("%s %s" % (brand, _strip_spf(tw)))
    return kws


def normalize_keyword(kw):
    kw = (kw or "").strip()
    for suf in GOOGLE_SUFFIXES:
        if kw.endswith(suf):
            kw = kw[: -len(suf)].strip()
    return kw


def _non_hashtag_len(c):
    return len(re.sub(r"#[^\s#]+", "", c or "").strip())


def usable_as_testimonial(c):
    """與 build_scores_data.py 的 pick_testimonials() 門檻一致：太短/太長/純標籤的先濾掉，
    免得送去判讀了才發現根本不能用。"""
    c = (c or "").strip()
    return 30 <= len(c) <= 400 and "【圖片內文】" not in c and _non_hashtag_len(c) >= 25


_STOPWORDS = set("系列 版 限量 新款 全新 升級 專櫃 官方 正品 推薦".split())


def distinctive_tokens(name, cn, alt):
    """能辨識「是這一支」的詞：別稱優先，官網名切出的片段次之。

    實測（2026-09-14）發現：靠讚數排序會把爆紅但與商品無關的貼文推到最前面
    （搜「香奈兒去角質霜」撈到 17 萬讚的婆媳故事），真正可用的心得幾乎都是
    內容裡直接寫出商品專屬名稱的那幾則。所以排序要先看有沒有命中專屬詞。
    """
    toks = set()
    for a in re.split(r"[／/、,，]", alt or ""):
        a = a.strip()
        if len(a) >= 2:
            toks.add(a)
    for nm in (name, cn):
        nm = re.sub(r"[【】()（）]", " ", _strip_spf(nm or ""))
        for chunk in nm.split():
            if len(chunk) >= 3:
                toks.add(chunk.strip())
        if len(nm.strip()) >= 4:
            toks.add(nm.strip())
    return set(t for t in toks if t and t not in _STOPWORDS)


def load_items():
    with open(ITEMS, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())
    idf, twf, cnf, altf = fields[0], fields[5], fields[6], fields[7]
    meta, kw_buckets = {}, {}
    for r in rows:
        iid = str(r.get(idf, "")).strip()
        if not iid:
            continue
        meta[iid] = {
            "brand": r.get("Brand", "").strip(),
            "name": r.get(twf, "").strip(),
            "subcat": r.get("Subcategories", "").strip(),
            "alt": (r.get(altf) or "").strip(),
            "cn": (r.get(cnf) or "").strip(),
        }
        meta[iid]["tokens"] = distinctive_tokens(meta[iid]["name"], meta[iid]["cn"],
                                                 meta[iid]["alt"])
        for kw in build_search_keywords(meta[iid]["brand"], meta[iid]["name"],
                                        meta[iid]["cn"], meta[iid]["alt"]):
            kw_buckets.setdefault(kw, set()).add(iid)
    # 一個關鍵字對到多個品項就不可靠，直接捨棄
    kw_to_iid = dict((k, next(iter(v))) for k, v in kw_buckets.items() if len(v) == 1)
    return meta, kw_to_iid


def _likes(v):
    try:
        return int(v or 0)
    except (ValueError, TypeError):
        return 0


def do_prepare(subcats, include_scored):
    meta, kw_to_iid = load_items()
    with open(SCORES, encoding="utf-8") as f:
        scores = json.load(f)
    store = {}
    if os.path.exists(STORE):
        with open(STORE, encoding="utf-8") as f:
            store = json.load(f)
    with open(ROUTED, encoding="utf-8") as f:
        routed = json.load(f)

    out = {}
    for r in routed:
        plat = r.get("platform") or ""
        if "小紅書" in plat or "Xiaohongshu" in plat:
            continue                       # 小紅書走 item_id，本來就進得了候選池
        if str(r.get("item_id") or "").strip():
            continue
        url = (r.get("url") or "").strip()
        if not url or not usable_as_testimonial(r.get("content")):
            continue
        iid = kw_to_iid.get(normalize_keyword(r.get("search_keyword")))
        if not iid:
            continue
        m = meta[iid]
        key = "%s||%s" % (m["brand"], m["name"])
        if key not in scores:
            continue                       # 沒有分數的品項前台不會顯示，不用標
        if subcats and m["subcat"] not in subcats:
            continue
        if not include_scored and scores[key].get("testimonials"):
            continue                       # 已經有卡片了，預設跳過
        if url in store.get(key, {}):
            continue                       # 標過了，不重複送
        bucket = out.setdefault(key, {
            "brand": m["brand"], "item_name": m["name"], "subcategory": m["subcat"],
            "product_aliases": [a for a in (m["alt"], m["cn"]) if a],
            "reviews": [], "_seen_urls": set(), "_seen_text": set(),
        })
        content = (r.get("content") or "").replace("\n", " ")
        # routed_reviews.json 目前有大量同 url／同內容的重複列（2026-09-14 查出
        # 36,985 筆裡有 23,542 筆是 1,399 個 url 的重複），不去重會把判讀名額吃光
        if url in bucket["_seen_urls"] or content[:40] in bucket["_seen_text"]:
            continue
        bucket["_seen_urls"].add(url)
        bucket["_seen_text"].add(content[:40])
        bucket["reviews"].append({
            "url": url, "platform": plat, "likes": _likes(r.get("likes")),
            "content": content,
            "_hits": sorted((t for t in m["tokens"] if t in content), key=len, reverse=True)[:3],
        })

    for key in out:
        out[key].pop("_seen_urls", None)
        out[key].pop("_seen_text", None)
        out[key]["reviews"] = sorted(
            out[key]["reviews"],
            key=lambda x: (0 if x["_hits"] else 1, -x["likes"]),
        )[:MAX_CANDIDATES]
        # 一則都沒命中專屬詞的品項，幾乎不可能有可用心得，先標記出來
        out[key]["has_named_mention"] = any(r["_hits"] for r in out[key]["reviews"])

    os.makedirs(LLM_IO, exist_ok=True)
    with open(REQ, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    total = sum(len(v["reviews"]) for v in out.values())
    named = sum(1 for v in out.values() if v["has_named_mention"])
    print("🧾 待判讀：%d 個品項 / %d 則 → %s" % (len(out), total, REQ))
    print("   其中 %d 個品項有評論直接寫出商品名（另 %d 個沒有，可用機率極低）"
          % (named, len(out) - named))
    if total:
        print("   估計成本約 %.1f 萬 token（實測約 115 token/則）" % (total * 115 / 10000.0))
    print("   下一步：由 Claude Code 逐則判讀，寫出 %s" % RESP)
    print('   格式：{"品牌||商品名": [{"url": "...", "product_match": "match|mismatch|uncertain",')
    print('                          "is_ad": false, "credibility": "high|mid|low"}]}')
    print("   判準：內容必須確實在講「這個」商品（講別家只把本商品當對照組＝mismatch），")
    print("         代購/導購/品牌行銷稿＝is_ad true。只有 match 且非業配才會被前台採用。")


def do_merge():
    if not os.path.exists(RESP):
        raise SystemExit("找不到 %s，請先完成判讀" % RESP)
    with open(RESP, encoding="utf-8") as f:
        resp = json.load(f)
    store = {}
    if os.path.exists(STORE):
        with open(STORE, encoding="utf-8") as f:
            store = json.load(f)

    n_ok = n_no = 0
    for key, anns in resp.items():
        if not isinstance(anns, list):
            continue
        bucket = store.setdefault(key, {})
        for a in anns:
            url = (a.get("url") or "").strip()
            if not url:
                continue
            match = a.get("product_match", "uncertain")
            is_ad = bool(a.get("is_ad"))
            bucket[url] = {
                "product_match": match,
                "is_ad": is_ad,
                "credibility": a.get("credibility", "mid"),
                "sub_variant": "",
                "source": "annotate_testimonials",
            }
            if match == "match" and not is_ad:
                n_ok += 1
            else:
                n_no += 1

    with open(STORE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=1)
    print("✅ 已併入 %s" % STORE)
    print("   本次新增可用 %d 則、排除 %d 則；標記檔共 %d 個品項 / %d 則"
          % (n_ok, n_no, len(store), sum(len(v) for v in store.values())))
    print("   下一步：/usr/bin/python3 build_scores_data.py")


def main():
    ap = argparse.ArgumentParser(description="心得卡片專用評論標記（不影響分數）")
    ap.add_argument("--prepare", action="store_true", help="產出待判讀清單")
    ap.add_argument("--merge", action="store_true", help="把判讀結果併進 review_annotations.json")
    ap.add_argument("--subcat", default="", help="限定子分類，逗號分隔；省略＝全部")
    ap.add_argument("--include-scored", action="store_true",
                    help="連「已經有卡片」的品項也一起處理（預設只補缺的）")
    args = ap.parse_args()

    if args.prepare == args.merge:
        raise SystemExit("請擇一：--prepare 或 --merge")
    if args.prepare:
        subs = set(s.strip() for s in args.subcat.split(",") if s.strip())
        do_prepare(subs, args.include_scored)
    else:
        do_merge()


if __name__ == "__main__":
    main()
