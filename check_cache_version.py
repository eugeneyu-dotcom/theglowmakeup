#!/usr/bin/env python3
"""提交前檢查：改了帶快取版號的檔案，就必須同時把所有引用處的 ?v= 一起改。

為什麼需要這個（2026-10-14 實際事故）：
同一天對 articles.json 改了三次，但版號只在第一次 bump。結果在第一次與第三次之間
造訪過站的回訪者，瀏覽器快取裡拿到的是第一次那版 articles.json，後兩次的新文章
完全不會出現，而且不會自動更新——因為網址一模一樣。

容易誤解的點：**版號不是「這批改動 bump 一次就好」，而是要跟「最後一次」改那個
檔案的 commit 一起走**。中間時間窗內到訪的人會被釘在舊版。

另一個已知陷阱（見 memory「theglowmakeup.org網址與內外連規則」）：
script.js 被 10 支根目錄 HTML 引用，漏掉任何一支，那一頁就看不到更新。

用法：
    python3 check_cache_version.py          # 檢查 staged 內容（pre-commit hook 用）
    python3 check_cache_version.py --worktree  # 檢查工作區現況，不限 staged

安裝成 git hook：
    printf '#!/bin/sh\\nexec python3 check_cache_version.py\\n' > .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
真的要略過（例如只改註解）：git commit --no-verify
"""

import re
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent

# 會被加上 ?v= 的資產。鍵是檔名，值由程式掃描出「誰引用了它」。
VERSIONED = [
    "articles.json", "scores-data.json", "site-data.json", "new-products.json",
    "ingredients-data.json", "ingredient_warnings.json", "script.js", "styles.css",
]

# 這些路徑不是正式站台內容，掃描時跳過
SKIP_DIRS = (".claude/", "node_modules/", ".git/")


def run(args):
    return subprocess.run(args, capture_output=True, text=True, cwd=BASE).stdout


def staged_files():
    out = run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    return [f for f in out.splitlines() if f and not f.startswith(SKIP_DIRS)]


def source_files():
    """所有可能寫著 ?v= 的檔案（版控內的 html / js）。"""
    out = run(["git", "ls-files", "*.html", "*.js"])
    return [f for f in out.splitlines() if f and not f.startswith(SKIP_DIRS)]


def versions_in(text, asset):
    """回傳 text 裡所有 `<asset>?v=NN` 的版號。"""
    return re.findall(re.escape(asset) + r"\?v=(\d+)", text)


def read_staged(path):
    out = subprocess.run(["git", "show", f":{path}"], capture_output=True, cwd=BASE)
    return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else None


def read_head(path):
    out = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, cwd=BASE)
    return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else None


def read_worktree(path):
    p = BASE / path
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else None


def main():
    use_worktree = "--worktree" in sys.argv
    reader = read_worktree if use_worktree else read_staged

    changed = staged_files()
    if use_worktree:
        out = run(["git", "diff", "--name-only", "HEAD"])
        changed = [f for f in out.splitlines() if f and not f.startswith(SKIP_DIRS)]

    # 本輪改到、而且是「有版號的資產」的檔案
    touched = [a for a in VERSIONED if a in changed]
    if not touched:
        return 0

    problems = []
    for asset in touched:
        for src in source_files():
            head_text = read_head(src)
            if head_text is None:
                continue
            old = versions_in(head_text, asset)
            if not old:
                continue  # 這支檔案沒有引用這個資產
            new_text = reader(src)
            if new_text is None:
                continue
            new = versions_in(new_text, asset)
            if old == new:
                problems.append((asset, src, old[0] if old else "?"))

    if problems:
        print("\n✗ 快取版號沒跟上，提交被擋下\n")
        by_asset = {}
        for asset, src, ver in problems:
            by_asset.setdefault(asset, []).append((src, ver))
        for asset, rows in by_asset.items():
            print(f"  {asset} 這次有改動，但下列檔案的 ?v= 還停在舊值：")
            for src, ver in rows:
                print(f"    - {src}（{asset}?v={ver}）")
            print()
        print("  回訪者的瀏覽器會繼續用快取裡的舊版，看不到這次的改動。")
        print("  版號要跟「最後一次」改該檔案的 commit 一起走，不是整批 bump 一次。\n")
        print("  修法：把上列每一處的 ?v= 都 +1，重新 git add 後再 commit。")
        print("  確定不需要（例如只改了註解）：git commit --no-verify\n")
        return 1

    print(f"✓ 快取版號檢查通過（{', '.join(touched)}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
