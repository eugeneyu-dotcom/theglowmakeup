# -*- coding: utf-8 -*-
"""查爬蟲跑到哪了（不干擾正在執行的爬蟲，純讀檔）。

用法： python3 scrape_status.py

判讀方式：
  - 「待爬品項」歸零 = 全部跑完（爬蟲每抓完一個品項就清掉該列的 yes 旗標）
  - 資料庫最後寫入在 2 分鐘內 = 正常運作
  - 行程還在、但資料庫超過 5 分鐘沒動 → 多半是停在「人工確認」點等你按 Enter，
    去終端機看最後一行是不是 `↩ 按 Enter 繼續...`
"""
import csv, json, os, subprocess, time
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(BASE, "standardized_reviews.json")
ITEMS = os.path.join(BASE, "csv", "Items.csv")


def running(pattern):
    out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True).stdout.split()
    return [p for p in out if p.isdigit()]


def main():
    for name, pat in (("Threads 爬蟲", "scrape_threads.py"), ("Google 爬蟲", "test_google.py")):
        pids = running(pat)
        print(f"{name}：{'✅ 執行中 (PID ' + ', '.join(pids) + ')' if pids else '⏹ 沒在跑'}")

    if os.path.exists(STD):
        with open(STD, encoding="utf-8") as f:
            n = len(json.load(f))
        ago = int(time.time() - os.path.getmtime(STD))
        # 一個品項要跑 3 組關鍵字、每組 3 次搜尋再加節流，正常就要 2-4 分鐘才存一次檔，
        # 門檻訂太低會把「正在跑」誤報成卡住。
        mark = "正常" if ago < 300 else ("可能停在人工確認點" if ago < 900 else "已停很久")
        print(f"資料庫：{n:,} 筆｜最後寫入 {datetime.fromtimestamp(os.path.getmtime(STD)):%H:%M:%S}"
              f"（{ago // 60} 分 {ago % 60} 秒前，{mark}）")

    with open(ITEMS, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    yes = [r for r in rows if str(r.get("Update This Time", "")).strip().lower() == "yes"]
    print(f"待爬品項：剩 {len(yes)} 個" + ("  🎉 全部跑完" if not yes else ""))
    for r in yes:
        print(f"   - {r['Subcategories']:8} {r['Brand']:16} {r['Items（台灣官網商品名）'][:22]}")


if __name__ == "__main__":
    main()
