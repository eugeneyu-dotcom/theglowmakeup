# -*- coding: utf-8 -*-
"""文章 FAQ／延伸閱讀統一化：預覽模式（預設不寫入），可指定只處理某些文章。

（2026-11-05 建立；批次進度與使用者的決定見 memory「文章FAQ統一與H2H3設計」。）

統一目標（使用者 2026-11-05 指定）：
  延伸閱讀                      → H2「延伸閱讀」
  FAQ 常見問題                  → H2「FAQ 常見問題」
  Q1. Q2. Q3. …（問題依序編號）  → 每個問題是 H3「Q1. 問題？」，答案是獨立段落

用法：
  python3 normalize_article_faq.py              # 預覽，輸出 llm_io/plan.json（不改 articles.json）
  python3 normalize_article_faq.py --apply ids  # 只對列出的文章寫入（逗號分隔），temp + os.replace
  --keep-titles                                 # 保留主題式 FAQ 標題（預設一律改成「FAQ 常見問題」）
寫入後要升 articles.json 與 script.js 的 ?v= 版號；凍結名單內的文章會直接拒絕寫入。
"""
import html as H
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
SCR = os.path.join(BASE, "llm_io")   # 預覽輸出放這裡（llm_io 已在 .gitignore）
os.makedirs(SCR, exist_ok=True)
ART = os.path.join(BASE, "articles.json")

FROZEN = {  # 測試／對照凍結到約 12/1（glowup-article-seo-links skill 的保護名單）
    "cleansing-balm-emulsify-guide", "cleansing-product-types-guide", "concealer-stick-vs-liquid",
    "cushion-foundation-guide", "cleansing-oil-emulsify", "mask-review-2026", "cleansing-balm-review-2026",
    "eyebrow-golden-ratio", "waterproof-summer-makeup", "sunburn-mask-guide",
    "lip-gloss-comparison-2026", "eyeshadow-palette-guide-2026", "lipstick-glossy-matte-guide",
    "perfume-concentration-guide", "setting-powder-usage-guide-2026",
}

H2_CLS = "text-2xl font-black mt-10 mb-4 text-[#2d2d2d]"
H3_CLS = "text-xl font-black mt-8 mb-3 text-[#2d2d2d]"
FAQ_RE = re.compile(r"FAQ|常見問題", re.I)
PREFIX = re.compile(r"^\s*(?:Q\s*\d*\s*[\.．、:：]|\d+\s*[\.．、:：]|問\s*[:：])\s*")
QLIKE = re.compile(r"^\s*(?:Q\s*\d*\s*[\.．、:：]|\d+\s*[\.．、:：]|問\s*[:：])")
HEAD = re.compile(r"<h([1-6])\b([^>]*)>(.*?)</h\1>", re.S | re.I)


STRONG_WRAP = re.compile(r"^\s*<strong>(.*)</strong>\s*$", re.S | re.I)


def clean_question(inner):
    """問題文字：拆掉整段外層的 <strong>（標題本身已是粗體），再拿掉開頭的 Q／數字前綴。
    內部連結等其他標籤原樣保留。"""
    inner = inner.strip()
    m = STRONG_WRAP.match(inner)
    if m:
        inner = m.group(1).strip()
    return PREFIX.sub("", inner, count=1).strip()


def text_of(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def find_faq(c):
    """回傳 (heading match, 區塊結尾 index)。FAQ 區塊到下一個 h2（不含）為止；FAQ 本身是 h2 時也一樣。"""
    for m in HEAD.finditer(c):
        if m.group(1) in "23" and FAQ_RE.search(text_of(m.group(3))) and len(text_of(m.group(3))) <= 40 + 20:
            nxt = re.search(r"<h2\b", c[m.end():])
            end = m.end() + nxt.start() if nxt else len(c)
            return m, end
    return None, None


def is_keyword_faq_title(t):
    """主題式 FAQ 標題（例如「專櫃防曬乳 FAQ：防曬乳怎麼選常見問題」）——帶主題字，不是通用寫法。"""
    return t not in ("FAQ 常見問題", "常見問題 FAQ", "FAQ常見問題") and len(t) > 10



EXT_RE = re.compile(r"<h2\b[^>]*>\s*(?:<strong>)?\s*延伸閱讀", re.I)


def reorder_ext_before_faq(c):
    """若 FAQ 在延伸閱讀前面，且兩者相鄰（FAQ 區塊結尾就是延伸閱讀標題），把延伸閱讀整塊搬到 FAQ 前面。"""
    fm = None
    for m in HEAD.finditer(c):
        if m.group(1) == "2" and FAQ_RE.search(text_of(m.group(3))):
            fm = m; break
    em = EXT_RE.search(c)
    if not fm or not em:
        return c, None
    fs, es = fm.start(), em.start()
    if es < fs:
        return c, None                      # 已經是 延伸閱讀 → FAQ
    nxt = re.search(r"<h2\b", c[fm.end():])
    fe = fm.end() + nxt.start() if nxt else len(c)
    if fe != es:
        return c, "FAQ 與延伸閱讀之間還有其他區塊，未調整順序"
    nx2 = re.search(r"<h2\b", c[em.end():])
    ee = em.end() + nx2.start() if nx2 else len(c)
    return c[:fs] + c[es:ee] + c[fs:es] + c[ee:], "已把延伸閱讀移到 FAQ 前面"


def normalize(c, keep_keyword_titles=True, reorder=True):
    notes = []
    m, end = find_faq(c)
    if not m:
        return c, ["沒有 FAQ 區塊"], {}
    lvl, attrs, inner = m.group(1), m.group(2), m.group(3)
    title = text_of(inner)
    head_new = m.group(0)
    kw = is_keyword_faq_title(title)
    if kw and keep_keyword_titles:
        notes.append(f"保留主題式標題：{title}")
        # 只有層級不對才修
        if lvl != "2":
            idm = re.search(r'id="([^"]*)"', attrs)
            head_new = f'<h2 class="{H2_CLS}"' + (f' id="{idm.group(1)}"' if idm else "") + f"><strong>{title}</strong></h2>"
            notes.append("H3→H2")
    else:
        idm = re.search(r'id="([^"]*)"', attrs)
        head_new = f'<h2 class="{H2_CLS}"' + (f' id="{idm.group(1)}"' if idm else "") + "><strong>FAQ 常見問題</strong></h2>"
        if title != "FAQ 常見問題":
            notes.append(f"標題「{title}」→「FAQ 常見問題」")
        if lvl != "2":
            notes.append("H3→H2")
    block = c[m.end():end]

    # 問題：粗體段落 或 h3
    n = [0]
    def q_text(raw):
        t = text_of(raw)
        t2 = PREFIX.sub("", t)
        return t2

    def para_to_h3(mm):
        attrs_p, strong, rest = mm.group(1), mm.group(2), mm.group(3)
        st = text_of(strong)
        if not (QLIKE.match(st) or st.endswith(("？", "?"))):
            return mm.group(0)
        n[0] += 1
        # 只拿掉開頭的「Q：」類前綴，問題裡的連結等 HTML 標籤要原樣保留（內部連結不能掉）
        q = clean_question(strong)
        out = f'<h3 class="{H3_CLS}">Q{n[0]}. {q}</h3>'
        rest = rest.strip()
        if rest:
            out += f"<p{attrs_p}>{rest}</p>"
        return out

    def h3_renumber(mm):
        inner_h3 = mm.group(2)
        t = text_of(inner_h3)
        if not (QLIKE.match(t) or t.endswith(("？", "?"))):
            return mm.group(0)
        n[0] += 1
        q = clean_question(inner_h3)
        return f'<h3{mm.group(1)}>Q{n[0]}. {q}</h3>'

    # 先處理 h3 問題，再處理粗體段落（兩種混用時依出現順序編號：用單一掃描）
    tok = re.compile(r"<h3\b([^>]*)>(.*?)</h3>|<p\b([^>]*)>\s*<strong>(.*?)</strong>\s*(.*?)</p>", re.S | re.I)
    def sub_any(mm):
        if mm.group(2) is not None:   # h3
            fake = type("M", (), {"group": lambda self, i, mm=mm: {0: mm.group(0), 1: mm.group(1), 2: mm.group(2)}[i]})()
            return h3_renumber(fake)
        fake = type("M", (), {"group": lambda self, i, mm=mm: {0: mm.group(0), 1: mm.group(3), 2: mm.group(4), 3: mm.group(5)}[i]})()
        return para_to_h3(fake)
    new_block = tok.sub(sub_any, block)
    if n[0] == 0:
        notes.append("⚠ 沒偵測到問題")
    changed = (head_new != m.group(0)) or (new_block != block)
    c2 = c[:m.start()] + head_new + new_block + c[end:]
    if reorder:
        c2, rnote = reorder_ext_before_faq(c2)
        if rnote:
            notes.append(rnote)
    stats = {"title_changed": head_new != m.group(0), "questions": n[0], "block_changed": new_block != block, "changed": changed or c2 != c}
    return c2, notes, stats


def main():
    A = json.load(open(ART, encoding="utf-8"))
    arts = A["articles"]
    keep_kw = "--keep-titles" in sys.argv
    plan = []
    for a in arts:
        c2, notes, st = normalize(a["content"], keep_keyword_titles=keep_kw)
        plan.append({"id": a["id"], "frozen": a["id"] in FROZEN, "notes": notes, **st})
        a["_new"] = c2
    json.dump(plan, open(os.path.join(SCR, "plan.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({a["id"]: a["_new"] for a in arts}, open(os.path.join(SCR, "plan_content.json"), "w", encoding="utf-8"), ensure_ascii=False)
    if "--apply" in sys.argv:
        ids = set(sys.argv[sys.argv.index("--apply") + 1].split(","))
        raw = open(ART, "rb").read().decode("utf-8")
        n = 0
        for a in arts:
            if a["id"] in ids:
                assert a["id"] not in FROZEN, f"{a['id']} 在凍結名單內"
                a["content"] = a["_new"]; n += 1
            a.pop("_new", None)
        out = json.dumps(A, ensure_ascii=False, indent=2)
        tmp = ART + ".tmp"
        open(tmp, "wb").write(out.encode("utf-8")); os.replace(tmp, ART)
        print(f"✅ 已寫入 {n} 篇")
    else:
        print("預覽完成（未寫入）。plan.json / plan_content.json 在 scratchpad。")


if __name__ == "__main__":
    main()
