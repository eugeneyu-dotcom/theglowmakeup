# -*- coding: utf-8 -*-
"""產出首頁「網友怎麼說」（news.html）用的心得候選池 voices-pool.json。

為什麼要另外一份：scores-data.json 每個品項只存 3 則代表心得（pick_testimonials 的 n=3），
全站符合「網友怎麼說」語氣篩選的只剩 6 則，每月輪替只是換順序。這支腳本用同一批已路由的評論、
同樣的清洗與檢核（簡轉繁、業配／不符標記、字數、不含 # 標籤堆疊），多留一些給前端輪替。

篩選條件跟 script.js renderNewsVoices() 原本的一樣（語氣正面、不含廣告式字眼、字數），
放在建置階段做，前端只負責依日期輪替，不在瀏覽器裡再過濾。
「這則在講這個商品」的判斷比原本嚴：商品名／別稱要出現，或已被標成 product_match=match。

跑法（評分更新、build_scores_data.py 重建 scores-data.json 之後各跑一次）：
    python3 build_voices_pool.py
"""
import csv
import json
import os
import re
import sys

import build_scores_data as B

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "voices-pool.json")

# 品項門檻：跟 script.js 的 RANKING_MIN_MENTIONS / 「綜合分 3.8 以上」一致
MIN_COMPOSITE = 3.8
MIN_MENTIONS = 20
# 單一品項最多留幾則，避免某個品項佔掉整個池
MAX_PER_ITEM = 6

# 以下兩組正規表示式要跟 script.js renderNewsVoices() 裡的 NEG / POS 保持一致
NEG = re.compile(r"不回購|不推薦|不建議|踩雷|雷品|失望|惡心|欠我|一般般|粉質算一般|不愛|不喜歡|無功無過|過敏|退貨|難用|不好用|不太|沒什麼效果|沒啥效果|拔乾|搓泥|卡粉|平替|有沒有|代購|正品|現貨|下單|私訊|私聊|團購|預購|限時|優惠|來啦")
POS = re.compile(r"回購|好用|喜歡|很愛|巨愛|大愛|推薦|驚豔|驚為|不錯|很好|滿意|舒服|細膩|寶藏|好聞|治癒|本命")


def core_name(name):
    return re.sub(r"[^\w一-鿿]", "", (name or "").lower())


def mentions_item(text, names):
    """商品名或別稱（任一連續四字）出現在前 50 字內，否則節錄會變成在講別款。

    跟 script.js 原本的規則不同：那邊「只提品牌」也算，每個品項只挑 1 則還撐得住；
    候選池擴大後，只提品牌的貼文常常是在講同品牌的別款（資生堂時光琉璃洗面奶掛在極上御藏潔膚皂 N 底下），
    所以池裡一律要求提到商品名／別稱，或已被 review_annotations.json 標成 product_match=match。
    """
    lx = text.lower()
    for nm in names:
        cn = core_name(nm)
        for i in range(0, max(0, len(cn) - 3)):
            h = lx.find(cn[i:i + 4])
            if 0 <= h <= 50:
                return True
    return False


def load_item_names():
    """{(brand, 台灣商品名): [商品名, 中國商品名, 別稱…]}，簡體一律轉成繁體再比對。"""
    out = {}
    with open(B.ITEMS, encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    for r in rows[1:]:
        if len(r) < 8:
            continue
        brand, tw, cn, alt = r[4].strip(), r[5].strip(), r[6].strip(), r[7].strip()
        names = [x.strip() for x in [tw, cn] + alt.split("/") if x.strip()]
        if B._S2T:
            names = [B._S2T.convert(x) for x in names]
        out[(brand, tw)] = names
    return out


def qualifies(t, names, ann_texts):
    text = t.get("text") or ""
    if not (40 <= len(text) <= 300 and "#" not in text and POS.search(text) and not NEG.search(text)):
        return False
    return text in ann_texts or mentions_item(text, names)


def main():
    with open(B.OUT, encoding="utf-8") as f:
        scores = json.load(f)
    item_ids = B.load_item_ids()
    item_names = load_item_names()
    with open(B.ROUTED, encoding="utf-8") as f:
        routed = json.load(f)
    ann_store = B.load_annotations()
    kw_to_iid = B.load_keyword_to_item_id()

    by_item_id, unrouted = {}, {}
    for r in routed:
        iid = str(r.get("item_id", "")).strip()
        if iid:
            by_item_id.setdefault(iid, []).append(r)
        elif ann_store:
            guess = kw_to_iid.get(B._normalize_keyword(r.get("search_keyword")))
            if guess:
                unrouted.setdefault(guess, []).append(r)

    out, n_items = [], 0
    for key, e in scores.items():
        if e.get("composite") is None or e["composite"] < MIN_COMPOSITE or (e.get("mentions") or 0) < MIN_MENTIONS:
            continue
        iid = item_ids.get((e["brand"], e["name"]))
        if not iid:
            continue
        # 跟 build_scores_data.main() 同樣的來源：已路由的小紅書（擋掉已標記的業配／不符），
        # 加上有 product_match 標記背書的 Threads/Google
        pool = [r for r in by_item_id.get(iid, [])
                if not B.annotation_rejects_testimonial(ann_store, e["brand"], e["name"], r.get("url"))]
        seen = set()
        for r in unrouted.get(iid, []):
            url = (r.get("url") or "").strip()
            if url in seen:
                continue
            if B.annotation_allows_testimonial(ann_store, e["brand"], e["name"], url):
                seen.add(url)
                pool.append(r)
        if not pool:
            continue
        # 已被標成「確實在講這個商品、非業配」的心得，不要求字面比對商品名
        ann_pool = [r for r in pool
                    if B.annotation_allows_testimonial(ann_store, e["brand"], e["name"], r.get("url"))]
        ann_texts = {t["text"] for t in B.pick_testimonials(ann_pool, n=60, keep_non_xhs=10)} if ann_pool else set()
        # n 取大一點：pick_testimonials 會先依平台／字數／讚數排序再去重，這裡要的是「過了篩選的全部」
        cands = B.pick_testimonials(pool, n=60, keep_non_xhs=10)
        names = item_names.get((e["brand"], e["name"]), [e["name"]])
        ok = [t for t in cands if qualifies(t, names, ann_texts)][:MAX_PER_ITEM]
        if not ok:
            continue
        n_items += 1
        for t in ok:
            out.append({"brand": e["brand"], "name": e["name"], "subcat": e["subcat"],
                        "platform": t.get("platform"), "likes": t.get("likes", 0),
                        "text": t["text"]})

    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    subs = {x["subcat"] for x in out}
    print(f"✅ voices-pool.json：{len(out)} 則心得，來自 {n_items} 個品項、{len(subs)} 個子分類")
    return 0


if __name__ == "__main__":
    sys.exit(main())
