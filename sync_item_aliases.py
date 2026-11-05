# -*- coding: utf-8 -*-
"""把 Items.csv 的「別稱」同步成 site-data.json 每個商品的 aka 欄位（繁體、最多 2 個）。

用途：殘酷擂台的商品選擇器要讓化妝新手看得懂是哪一款，別稱（例如「粉水／調皮水」「極光洗面」）
比官方長品名更好認。別稱的原始來源是 csv/Items.csv 的「Another name（別稱）」欄，多半是簡體，
這裡用 OpenCC（台灣用字）轉繁體。

規則：
  - 以 (子分類, 品牌, 台灣品名) 對應；site-data.json 裡沒有的商品略過
  - 用 / 分隔、去空白、轉繁體、去重；跟品名完全相同的丟掉；最多留 2 個
  - 沒有別稱的商品不寫 aka 欄位（已有的 aka 會被移除，確保跟 Items.csv 一致）

用法：python3 sync_item_aliases.py   （改了 Items.csv 的別稱，或 site-data.json 新增商品後各跑一次）
改完 site-data.json 要記得升 ?v= 版號（check_cache_version.py 會擋）。
"""
import csv
import json
import os
import re
import sys

import build_scores_data as B

BASE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(BASE, "site-data.json")
MAX_AKA = 2


def load_aliases():
    out = {}
    with open(B.ITEMS, encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    for r in rows[1:]:
        if len(r) < 8:
            continue
        sub, brand, name, alt = r[3].strip(), r[4].strip(), r[5].strip(), r[7].strip()
        if not alt:
            continue
        res = []
        for a in re.split(r"[/／]", alt):
            a = a.strip()
            if B._S2T:
                a = B._S2T.convert(a)
            if a and a != name and a not in res:
                res.append(a)
        if res:
            out[(sub, brand, name)] = res[:MAX_AKA]
    return out


def main():
    raw = open(SITE, "rb").read().decode("utf-8")
    data = json.loads(raw)
    aliases = load_aliases()
    n_set = n_removed = 0
    for sub, d in data.get("subcategoryDetails", {}).items():
        for it in d.get("items", []):
            aka = aliases.get((sub, it.get("brand"), it.get("name")))
            if aka:
                if it.get("aka") != aka:
                    it["aka"] = aka
                    n_set += 1
            elif "aka" in it:
                del it["aka"]
                n_removed += 1
    out = json.dumps(data, ensure_ascii=False, indent=1)
    tmp = SITE + ".tmp"
    with open(tmp, "wb") as f:
        f.write(out.encode("utf-8"))
    os.replace(tmp, SITE)
    total = sum(1 for d in data["subcategoryDetails"].values() for it in d["items"] if it.get("aka"))
    print(f"✅ aka：新寫入／更新 {n_set}、移除 {n_removed}，目前共 {total} 個商品有別稱")
    return 0


if __name__ == "__main__":
    sys.exit(main())
