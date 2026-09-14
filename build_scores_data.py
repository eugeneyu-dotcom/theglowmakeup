"""
產生前端用的 scores-data.json：
- 每個「有綜合評分」的品項 → 真實 AI_Scores 分數（綜合分 + 各指標分 + mentions）
- 附上該品項「最有可信力的一則評論」：優先小紅書、內容足夠長、讚數高，帳號馬賽克
前端 detail.html 讀此檔，取代原本用名稱雜湊假造的分數。
用法：/usr/bin/python3 build_scores_data.py
"""
import csv, io, json, os, re

try:
    import opencc
    _S2T = opencc.OpenCC("s2twp")  # 簡體轉繁體（台灣慣用詞＋用字，例如「唇」不轉成「脣」）
except ImportError:
    _S2T = None
    print("⚠️ 找不到 opencc，小紅書評論將不會簡轉繁（pip install opencc-python-reimplemented）")

BASE = os.path.dirname(os.path.abspath(__file__))
AI = os.path.join(BASE, "csv", "AI_Scores.csv")
ITEMS = os.path.join(BASE, "csv", "Items.csv")
ROUTED = os.path.join(BASE, "routed_reviews.json")
OUT = os.path.join(BASE, "scores-data.json")
# score_reviews.py --compute 累積下來的「評論層級 LLM 標記」（以評論 url 為鍵）。
# Threads/Google 的評論沒有 item_id（只有小紅書會經過路由），過去因此完全進不了
# 心得卡片候選池；但它們的 search_keyword 就是爬蟲當初鎖定的品項，可以精準回推。
# 回推只解決「是哪個商品」，不解決「這則真的在講這個商品嗎」——實測 27,051 則
# Threads 裡有大量代購貼文、蝦皮導購、品牌行銷稿，以及講到別家商品只把本商品當
# 對照組的貼文。因此一律要求該則評論在這份標記檔裡被判為 product_match=match
# 且非業配，才准進候選池。沒有標記的一律不收（寧缺勿濫）。
ANNOTATIONS = os.path.join(BASE, "llm_io", "review_annotations.json")

# 小紅書自家表情貼圖標籤，例如 [生气R] [哭惹R] [doge]（結尾是 R/H 的方括號標籤才視為表情，
# 避免誤刪像 [品牌]、[商品] 這種作者自己寫的真實內容）
_BRACKET_EMOJI_RE = re.compile(r"\[[^\[\]]*?[RH]\]|\[doge\]", re.IGNORECASE)
# 常見 unicode 表情符號／裝飾符號區塊（刻意不含箭頭區塊，因為 → 常被拿來表達「所以/導致」的實際文意）
_UNICODE_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U0001F000-\U0001F0FF"
    "\U00002600-\U000027BF"
    "\U0001F100-\U0001F1FF"  # 含 Enclosed Alphanumeric Supplement（🆕🆒🆓🆗🆙🆚等）與 regional indicator
    "\U0000FE0F"
    "]+"
)


# OpenCC 對簡體「干」字常誤轉成「幹」（髒話語感的「做」），美妝語境幾乎都該是「乾」（乾燥/乾淨）。
# 例如「混干皮」「秒干」被轉成「混幹皮」「秒幹」，讀起來像髒話，需要修正。
# 先保護少數合法的「幹」用詞，其餘一律視為誤轉，改回「乾」。
_GAN_WHITELIST = ["幹嘛", "幹麻", "幹部", "樹幹", "軀幹", "骨幹", "主幹", "才幹", "幹勁", "幹練", "幹活", "幹員", "幹線", "幹事"]


def _fix_gan(text):
    if "幹" not in text:
        return text
    placeholders = {}
    for i, w in enumerate(_GAN_WHITELIST):
        if w in text:
            ph = f"\x00{i}\x00"
            text = text.replace(w, ph)
            placeholders[ph] = w
    text = text.replace("幹", "乾")
    for ph, w in placeholders.items():
        text = text.replace(ph, w)
    return text


def clean_xhs_text(text):
    """小紅書心得專用清理：簡體轉繁體（台灣用字）＋ 移除表情符號標籤，方便閱讀。"""
    if _S2T:
        text = _S2T.convert(text)
        text = _fix_gan(text)
    text = _BRACKET_EMOJI_RE.sub("", text)
    text = _UNICODE_EMOJI_RE.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def mask_author(name):
    name = (name or "").strip()
    if not name:
        return "匿名用戶"
    # 拉丁文保留前2字、中文保留前1字，其餘遮蔽
    keep = 2 if re.match(r"^[A-Za-z0-9_.]+$", name[:2]) else 1
    if len(name) <= keep:
        return name + "***"
    return name[:keep] + "*" * min(3, len(name) - keep)


def platform_label(p):
    p = p or ""
    if "小紅書" in p or "Xiaohongshu" in p:
        return "小紅書"
    if "Threads" in p:
        return "Threads"
    if "Google" in p:
        return "Google"
    return p or "網路社群"


def load_item_ids():
    """(brand, 台灣官網名) -> item_id"""
    out = {}
    with open(ITEMS, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    id_field = list(rows[0].keys())[0]
    for r in rows:
        key = (r.get("Brand", "").strip(), r.get("Items（台灣官網商品名）", "").strip())
        if key[1]:
            out[key] = str(r.get(id_field, "")).strip()
    return out


def _strip_spf(n):
    return (n or "").split("SPF")[0].strip()


def build_search_keywords(brand, tw_name, cn_name, alt_name):
    """複製 scrape_threads.py 的 _build_keywords()：爬蟲當初就是用這些字串去搜的，
    所以 search_keyword 可以反推回品項。兩邊若改動需同步。"""
    kws, seen = [], set()

    def add(kw):
        kw = (kw or "").strip()
        if kw and kw not in seen:
            seen.add(kw)
            kws.append(kw)

    if alt_name:
        add(f"{brand} {alt_name}")
    if cn_name and cn_name != tw_name:
        add(_strip_spf(cn_name))
    if tw_name:
        add(f"{brand} {_strip_spf(tw_name)}")
    return kws


# test_google.py 搜尋時加的語境後綴，比對前要去掉（score_reviews.py 也做同樣處理）
_GOOGLE_SUFFIXES = (" Dcard 評價", " PTT 評價", " Dcard", " PTT", " IG", " 心得", " 評價")


def _normalize_keyword(kw):
    kw = (kw or "").strip()
    for suf in _GOOGLE_SUFFIXES:
        if kw.endswith(suf):
            kw = kw[: -len(suf)].strip()
    return kw


def load_keyword_to_item_id():
    """search_keyword -> item_id；一個關鍵字對到多個品項時視為不可靠，直接捨棄。"""
    with open(ITEMS, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())
    id_f, tw_f, cn_f, alt_f = fields[0], fields[5], fields[6], fields[7]
    buckets = {}
    for r in rows:
        iid = str(r.get(id_f, "")).strip()
        if not iid:
            continue
        for kw in build_search_keywords(r.get("Brand", "").strip(), r.get(tw_f, "").strip(),
                                        (r.get(cn_f) or "").strip(), (r.get(alt_f) or "").strip()):
            buckets.setdefault(kw, set()).add(iid)
    return {kw: next(iter(v)) for kw, v in buckets.items() if len(v) == 1}


def load_annotations():
    if not os.path.exists(ANNOTATIONS):
        return {}
    try:
        with open(ANNOTATIONS, encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return {}


def annotation_allows_testimonial(ann_store, brand, item_name, url):
    """只有被 LLM（或人工核對）判為「確實在講這個商品、且不是業配」的才准當心得。"""
    bucket = ann_store.get(f"{brand}||{item_name}")
    if not bucket:
        return False
    a = bucket.get((url or "").strip())
    if not a:
        return False
    return a.get("product_match") == "match" and not a.get("is_ad")


# Google 搜尋摘要的殘留雜訊：Dcard 的圖片佔位符 megapx、摘要被截斷的尾巴「...」、
# 以及開頭重複貼上的標題片段。這些是抓取格式造成的，不是網友真的寫的字。
_GOOGLE_NOISE_RE = re.compile(r"\bmegapx\b\.?", re.IGNORECASE)


def clean_google_text(text):
    text = _GOOGLE_NOISE_RE.sub(" ", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    text = re.sub(r"[.。]?\s*\.{3,}\s*$", "…", text)     # 結尾的 ... → …
    text = re.sub(r"^[\s.、,，]+", "", text)
    return text.strip()


def _non_hashtag_len(c):
    """去掉 #標籤 後的實質文字長度（判斷是不是純標籤貼文）。"""
    stripped = re.sub(r"#[^\s#]+", "", c)
    return len(stripped.strip())


def _clean_likes(v):
    """讚數 sanitize：落在 2015~2030 的多半是年份被誤讀，歸零。"""
    try:
        v = int(v or 0)
    except (ValueError, TypeError):
        return 0
    if 2015 <= v <= 2030:
        return 0
    return max(0, v)


def pick_testimonials(reviews, n=3):
    """從一個品項的 routed 評論裡挑最多 n 則有代表性的評論（供產品頁 1~3 則展示，增加可信度）：
    實質文字足夠、非純標籤、優先小紅書、讚數高；依內容前綴去重避免同則重複貼文洗版。"""
    def ok(r):
        c = (r.get("content") or "").strip()
        if len(c) < 30 or len(c) > 400:
            return False
        if "【圖片內文】" in c:
            return False
        if _non_hashtag_len(c) < 25:   # 幾乎都是 #標籤 的貼文跳過
            return False
        return True

    cands = [r for r in reviews if ok(r)]
    if not cands:
        cands = [r for r in reviews if (r.get("content") or "").strip()]
    if not cands:
        return []

    def rank(r):
        plat = r.get("platform") or ""
        is_xhs = 1 if ("小紅書" in plat) else 0
        c = (r.get("content") or "")
        substantial = 1 if _non_hashtag_len(c) >= 40 else 0
        return (is_xhs, substantial, _clean_likes(r.get("likes")))

    ranked = sorted(cands, key=rank, reverse=True)
    out = []
    seen_prefix = set()
    for r in ranked:
        text = (r.get("content") or "").strip().replace("\n", " ")
        plat_raw = r.get("platform") or ""
        if "小紅書" in plat_raw:
            text = clean_xhs_text(text)
        elif "Google" in plat_raw:
            text = clean_google_text(text)
        prefix = text[:40]
        if prefix in seen_prefix:
            continue
        seen_prefix.add(prefix)
        if len(text) > 120:
            text = text[:118] + "…"
        out.append({
            "platform": platform_label(r.get("platform")),
            "author": mask_author(r.get("author")),
            "likes": _clean_likes(r.get("likes")),
            "text": text,
        })
        if len(out) >= n:
            break
    return out


def main():
    item_ids = load_item_ids()

    # 這份檔案每次都是從 AI_Scores.csv 重新算出來的，但 reviewSummary（網友評價匯總）是
    # 人工/agent 額外補寫、不是從 CSV 算出來的欄位，重建時如果不先讀舊檔就會被整個蓋掉
    # （2026-07-28 資料遺失事故：面膜/面霜 rebuild 把粉底液 9 個品項的 reviewSummary 全洗掉）。
    # 修正：重建前先讀舊 scores-data.json，把 reviewSummary 原樣帶過去。
    old_summaries = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            old_data = json.load(f)
        for k, v in old_data.items():
            if v.get("reviewSummary"):
                old_summaries[k] = v["reviewSummary"]

    # 分組 routed 評論 by item_id
    with open(ROUTED, encoding="utf-8") as f:
        routed = json.load(f)
    by_item_id = {}
    # 沒有 item_id 的 Threads/Google 評論：用 search_keyword 回推品項，先放旁邊，
    # 等下確認有 LLM 標記背書才併進候選池（見 annotation_allows_testimonial）。
    kw_to_iid = load_keyword_to_item_id()
    ann_store = load_annotations()
    by_item_id_unrouted = {}
    for r in routed:
        iid = str(r.get("item_id", "")).strip()
        if iid:
            by_item_id.setdefault(iid, []).append(r)
            continue
        if not ann_store:
            continue
        guess = kw_to_iid.get(_normalize_keyword(r.get("search_keyword")))
        if guess:
            by_item_id_unrouted.setdefault(guess, []).append(r)

    # 讀 AI_Scores
    with open(AI, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    data = {}
    for r in rows:
        brand = r.get("Brand", "").strip()
        name = r.get("Items", "").strip()
        ind = r.get("Indicator", "").strip()
        score = r.get("Score", "").strip()
        if not brand or not name or not score:
            continue
        key = f"{brand}||{name}"
        entry = data.setdefault(key, {
            "brand": brand, "name": name,
            "subcat": r.get("Subcategories", "").strip(),
            "composite": None, "indicators": {}, "mentions": 0,
            "testimonial": None, "testimonials": [],
            **({"reviewSummary": old_summaries[key]} if key in old_summaries else {}),
        })
        try:
            val = float(score)
        except ValueError:
            continue
        if ind == "綜合評分":
            entry["composite"] = val
        else:
            entry["indicators"][ind] = val
            # mentions 累計各指標被提及次數，作為「這個分數有多少評論撐著」的證據量。
            # 綜合評分列本身沒有 Mentions，所以只能從各指標列加總。
            try:
                entry["mentions"] += int(float(r.get("Mentions", 0) or 0))
            except ValueError:
                pass

    # 只保留有綜合評分的品項，並補上代表評論
    out = {}
    n_test = 0
    n_extra = n_extra_items = 0
    for key, e in data.items():
        if e["composite"] is None:
            continue
        iid = item_ids.get((e["brand"], e["name"]))
        pool = list(by_item_id.get(iid, [])) if iid else []
        if iid:
            # routed_reviews.json 目前同一則貼文有多列重複（同 url），這裡順手去重，
            # 免得統計數字把重複列也算成不同評論
            extra, seen_extra = [], set()
            for r in by_item_id_unrouted.get(iid, []):
                url = (r.get("url") or "").strip()
                if url in seen_extra:
                    continue
                if annotation_allows_testimonial(ann_store, e["brand"], e["name"], url):
                    seen_extra.add(url)
                    extra.append(r)
            if extra:
                pool.extend(extra)
                n_extra_items += 1
                n_extra += len(extra)
        if pool:
            ts = pick_testimonials(pool)
            if ts:
                e["testimonials"] = ts
                e["testimonial"] = ts[0]   # 向下相容：舊版單篇欄位仍保留給 Cruel Battle 等用途
                n_test += 1
        out[key] = e

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"✅ scores-data.json：{len(out)} 個品項有真實綜合分，其中 {n_test} 個附上代表評論")
    if n_extra:
        print(f"   ↳ 其中 {n_extra} 則來自 Threads/Google（{n_extra_items} 個品項），"
              f"皆通過 review_annotations.json 的 product_match 檢核")
    elif ann_store:
        print("   ↳ Threads/Google 目前沒有任何評論通過標記檢核（標記檔涵蓋範圍還小是正常的）")


if __name__ == "__main__":
    main()
