"""
評分管線：整合 SKILL_商品評比.md 的方法論到自動化流程。

分工原則：
- 需要「語言理解」的步驟（商品身份核對、業配偵測、子款識別、情緒強度標記、可信度判斷）交給 Claude，
  每個產品一次 API call，回傳結構化 JSON（逐則評論的標記）。
- 屬於「公式」的步驟（情緒換算分、可信度權重、核心指標加權、兩極化偵測、加總平均）
  在 Python 端用固定公式計算，確保分數可重現、可追蹤。

對應 SKILL_商品評比.md 的步驟：
  Step 0 商品身份鑑定 + 子款識別  -> Claude 標記 product_match + sub_variant
  Step 2 業配文偵測               -> Claude 標記 is_ad + ad_reason
  Step 3 情緒/可信度標記           -> Claude 標記 sentiment（逐指標）與 credibility（逐則）
  Step 4 指標評分計算              -> Python：情緒換算分 x 可信度權重 -> 加權平均；核心指標加權；兩極化偵測

子款自動分離（MIN_VARIANT_REVIEWS = 3）：
  若 Claude 判斷某則評論明確在談某特定子款（如「金砖版」「持妝版」），且該子款累積達到
  MIN_VARIANT_REVIEWS 則評論，則獨立計分輸出；評論不足的子款合併回「通用」分數。
"""

import os, sys, json, csv, re, time
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

# 注意：anthropic 僅在「API 備援路徑」需要，改為惰性載入，
# 讓 agent 兩段式（--prepare / --compute）在沒有 anthropic 的環境也能跑。
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-haiku-4-5-20251001"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _find_items_csv():
    for name in ("Items.csv", " Items.csv"):
        p = os.path.join(BASE_DIR, "csv", name)
        if os.path.exists(p):
            return p
    return os.path.join(BASE_DIR, "csv", "Items.csv")


ITEMS_CSV = _find_items_csv()
INDICATOR_CSV = os.path.join(BASE_DIR, "csv", "Indicator.csv")
# 優先使用 route_reviews.py 產出的「已歸位」評論（帶 item_id）；沒有才退回 cleaned。
ROUTED_JSON = os.path.join(BASE_DIR, "routed_reviews.json")
CLEANED_JSON = os.path.join(BASE_DIR, "cleaned_reviews.json")
REVIEWS_JSON = ROUTED_JSON if os.path.exists(ROUTED_JSON) else CLEANED_JSON
OUTPUT_CSV = os.path.join(BASE_DIR, "csv", "AI_Scores.csv")
WEIGHTS_STATE_FILE = os.path.join(BASE_DIR, "csv", "indicator_weights.json")

# Agent 兩段式模式（不需 ANTHROPIC_API_KEY）：
#   1) --prepare  Python 把待標記的評論整理成 score_requests.json
#   2) 由 Claude Code（agent）讀 request、產生 score_responses.json（逐則標記）
#   3) --compute  Python 讀 response 只做算分
LLM_IO_DIR = os.path.join(BASE_DIR, "llm_io")
SCORE_REQ = os.path.join(LLM_IO_DIR, "score_requests.json")
SCORE_RESP = os.path.join(LLM_IO_DIR, "score_responses.json")


def _product_key(brand, item_name):
    return f"{brand}||{item_name}"

MAX_REVIEWS_PER_PRODUCT = 30
MIN_VARIANT_REVIEWS = 3    # 子款至少需幾則評論才獨立計分
IMAGE_REVIEW_LIKES_BOOST = 15  # 圖上評測型貼文排序加分（非強制入榜，讚數太低仍可能被擠出）

CORE_TOP_N = 3
EMA_ALPHA = 0.3
CORE_WEIGHT = 1.3

# ==========================================
# SKILL_商品評比.md Step 4.1 情緒換算分
# ==========================================
# 校準對應台灣使用者的直覺分級（見 CLAUDE.md 評分分級）：
#   4.5+ 優秀 / 4.0-4.5 不錯可用 / 3.5-4.0 普通 / 3.0-3.5 負面居多 / 2-3 幾乎只有負面 / <2 完全不推薦
SENTIMENT_SCORE = {
    "+++": 5.0, "++": 4.3, "+": 3.8, "~": 3.5,
    "-": 3.1, "--": 2.4, "---": 1.2,
}
STRONG_SENTIMENTS = {"+++", "---"}

# ==========================================
# SKILL_商品評比.md Step 3.4 可信度權重
# ==========================================
CREDIBILITY_WEIGHT = {"high": 1.5, "mid": 1.0, "low": 0.5}
CREDIBILITY_DOWNGRADE = {"high": "mid", "mid": "low", "low": "low"}


# ==========================================
# Claude API 呼叫
# ==========================================

def call_claude(prompt):
    """呼叫 Claude API，回傳解析後的 JSON list。"""
    if not ANTHROPIC_API_KEY or ANTHROPIC_API_KEY == "your_anthropic_api_key_here":
        print("❌ 找不到有效的 ANTHROPIC_API_KEY，請在 .env 中設定。")
        return None

    import anthropic  # 惰性載入：只有真的走 API 備援才需要
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=8192,
            system="你是一個專業的美妝產品分析師。請嚴格按照指示格式輸出純 JSON，不要加任何額外說明或 markdown 標記。",
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # 移除可能殘留的 markdown code fence
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"Claude JSON 解析失敗: {e}")
        print("原始回應前 500 字：", text[:500])
        return None
    except Exception as e:
        print(f"Claude API Error: {e}")
        return None


# ==========================================
# 評論標記 Prompt（Step 0 / 2 / 3 + 子款偵測）
# ==========================================

def build_annotation_prompt(brand, item_name, indicators, reviews):
    reviews_block = "\n".join(
        f'[{i}] (讚數:{r.get("likes", 0)}) {r.get("content", "").replace(chr(10), " ")}'
        for i, r in enumerate(reviews)
    )
    sentiment_keys = "/".join(SENTIMENT_SCORE.keys())

    return f"""你是一個專業的美妝產品分析師，請依照以下規則逐則分析評論。

產品品牌：{brand}
產品名稱：{item_name}
需要評估的指標列表：{", ".join(indicators)}

評論列表（每則前方 [編號] 對應 likes 數）：
{reviews_block}

請對「每一則」評論輸出以下標記：

1. product_match：判斷這則評論是否真的在討論「{brand} {item_name}」這個商品（同品牌但不同系列/色號/規格也算不符）。
   - "match"：明確吻合
   - "uncertain"：只提品牌泛稱，未指明系列或規格
   - "mismatch"：明確在討論不同商品

2. sub_variant：若評論中明確指定了該系列下的「特定子款」（如「金砖版」「持妝版」「果凍粉底液」「泡泡水粉底液」等子型號名稱），請填入最能識別該子款的簡短中文名稱（15字以內）。若評論泛指整體系列、未明確指定子款，或 product_match 為 "mismatch"，請填 ""。

3. is_ad：是否為業配/官方發文（符合任一：標示廣告/業配/合作/sponsored/gifted/PR；提及「感謝品牌提供」「收到試用品」「非自購」；附折扣碼或購買連結；作者自稱品牌大使；發文帳號為品牌官方帳號；或同時符合 3 項以上「通篇無缺點」「大量誇張用語」「過度強調成分技術像照稿念」「公式化結構」「文字過於流暢不像真實使用者」等次要特徵）。
   - true / false，並附 ad_reason 簡述依據

4. credibility：可信度
   - "high"：使用超過 4 週／有圖文佐證／具體前後對比／提到回購或具體用量步驟
   - "mid"：使用 1-4 週／有具體描述但缺佐證
   - "low"：使用未達一週／描述少於 15 字／高度模糊情緒化（如只有「超好用！」）

5. indicators：這則評論實際提到的指標，每個指標標記情緒強度。只對應評論中有明確依據的指標，不可推測。
   情緒強度只能是以下其中一種：{sentiment_keys}
   （+++ 強正向如必買/已回購；++ 中正向如還不錯；+ 弱正向如還行但有保留；~ 純客觀描述無情緒；- 弱負向注意「還好/還行/普普」在美妝語境中屬於弱負向不是中性；-- 中負向如不推薦；--- 強負向如踩雷/退貨/過敏）
   若「雖然...但...」句型，以後半段為主要情緒。

嚴格回傳 JSON 陣列，每個元素對應一則評論，格式：
[
  {{
    "review_index": 0,
    "product_match": "match",
    "sub_variant": "",
    "is_ad": false,
    "ad_reason": "",
    "credibility": "mid",
    "indicators": [{{"indicator": "持妝度", "sentiment": "++"}}]
  }}
]
"""


# ==========================================
# 評分計算
# ==========================================

def detect_polarization(sentiments):
    """SKILL Step 4.2：30% 以上強正向同時 30% 以上強負向 → 兩極化。"""
    if not sentiments:
        return False
    total = len(sentiments)
    return (sum(1 for s in sentiments if s == "+++") / total >= 0.3 and
            sum(1 for s in sentiments if s == "---") / total >= 0.3)


def consensus_modifier(sentiments):
    """SKILL Step 4.1③ 共識度修正係數：依正向評論占比（不含 ~ 純客觀描述）修正加權平均分。
    正向 = +/++/+++。占比 ≥90% ×1.15／70-89% ×1.05／50-69% ×0.95／<50% ×0.85。
    沒有帶方向性情緒（全部是 ~）時不修正，回傳 1.0。"""
    directional = [s for s in sentiments if s != "~"]
    if not directional:
        return 1.0
    positive_ratio = sum(1 for s in directional if s in ("+", "++", "+++")) / len(directional)
    if positive_ratio >= 0.9:
        return 1.15
    if positive_ratio >= 0.7:
        return 1.05
    if positive_ratio >= 0.5:
        return 0.95
    return 0.85


def score_indicator(entries):
    """SKILL Step 4.1：指標得分 = Σ(情緒換算分 x 可信度權重) / Σ(可信度權重)，
    再乘上 Step 4.1③ 共識度修正係數，四捨五入前夾在 [1.0, 5.0]。"""
    weighted_sum = weight_sum = 0.0
    sentiments = []
    for sentiment, credibility in entries:
        score = SENTIMENT_SCORE.get(sentiment)
        weight = CREDIBILITY_WEIGHT.get(credibility, 1.0)
        if score is None:
            continue
        weighted_sum += score * weight
        weight_sum += weight
        sentiments.append(sentiment)
    if weight_sum == 0:
        return None, False, len(entries)
    base = weighted_sum / weight_sum
    final = base * consensus_modifier(sentiments)
    final = max(1.0, min(5.0, final))
    return round(final, 2), detect_polarization(sentiments), len(entries)


def _score_annotations_to_results(annotations, target_indicators, reviews):
    """標記列表 → (indicator_results, excluded_ad, excluded_mismatch, per_indicator_entries)。"""
    excluded_ad = excluded_mismatch = 0
    per_indicator_entries = {ind: [] for ind in target_indicators}
    per_indicator_mentions = {ind: 0 for ind in target_indicators}

    for ann in annotations:
        idx = ann.get("review_index")
        if idx is None or idx >= len(reviews):
            continue
        if ann.get("is_ad"):
            excluded_ad += 1
            continue
        match = ann.get("product_match", "match")
        if match == "mismatch":
            excluded_mismatch += 1
            continue
        credibility = ann.get("credibility", "mid")
        if match == "uncertain":
            credibility = CREDIBILITY_DOWNGRADE.get(credibility, "low")
        for ind_entry in ann.get("indicators", []):
            indicator = ind_entry.get("indicator")
            sentiment = ind_entry.get("sentiment")
            if indicator not in per_indicator_entries or sentiment not in SENTIMENT_SCORE:
                continue
            # SKILL Step 3.4 負評可信度特別規則：強負評（退貨/過敏等具體後果）不得因描述簡短
            # 就被 LLM 標成低可信度而被稀釋，至少floor在 mid。
            entry_credibility = "mid" if (sentiment == "---" and credibility == "low") else credibility
            per_indicator_entries[indicator].append((sentiment, entry_credibility))
            per_indicator_mentions[indicator] += 1

    results = []
    for indicator in target_indicators:
        entries = per_indicator_entries[indicator]
        mentions = per_indicator_mentions[indicator]
        if mentions == 0:
            results.append({"Indicator": indicator, "Score": "", "Mentions": 0,
                            "Polarization": False, "Reason": "資料不足，評論中未提及此指標"})
            continue
        score, polarized, count = score_indicator(entries)
        reason = ""
        if count <= 2:
            sentiments_in = [s for s, _ in entries]
            reason = ("⚠️ 樣本僅 2 則且評論分歧，參考性有限"
                      if len(set(sentiments_in)) > 1 else "⚠️ 樣本僅 2 則，參考性有限")
        if polarized:
            reason = (reason + " 🔀 兩極分化").strip()
        results.append({"Indicator": indicator, "Score": score, "Mentions": mentions,
                        "Polarization": polarized, "Reason": reason})

    return results, excluded_ad, excluded_mismatch, per_indicator_entries


def compute_product_scores_with_variants(brand, item_name, target_indicators, reviews, annotations=None):
    """依子款分組計分。

    標記來源：若傳入 annotations（agent 兩段式模式的 score_responses）則直接使用；
    否則退回呼叫 Claude API（需 ANTHROPIC_API_KEY）。

    回傳 dict: {sub_variant_name: (indicator_results, excluded_ad, excluded_mismatch, per_indicator_entries)}
    sub_variant_name 為 "" 表示通用/未指定子款的評論。
    """
    if annotations is not None:
        all_annotations = annotations
    else:
        prompt = build_annotation_prompt(brand, item_name, target_indicators, reviews)
        all_annotations = call_claude(prompt)

    if not all_annotations or not isinstance(all_annotations, list):
        empty = [{"Indicator": ind, "Score": "", "Mentions": 0, "Polarization": False,
                  "Reason": "Claude 回傳為空或格式錯誤"} for ind in target_indicators]
        return {"": (empty, 0, 0, {ind: [] for ind in target_indicators})}

    # 依 sub_variant 分組
    variant_anns = {}
    for ann in all_annotations:
        sv = (ann.get("sub_variant") or "").strip()
        variant_anns.setdefault(sv, []).append(ann)

    # 子款需達 MIN_VARIANT_REVIEWS 才獨立計分；不足的歸入通用
    scored_variants = {}
    overflow = []
    for sv, anns in variant_anns.items():
        if sv and len(anns) >= MIN_VARIANT_REVIEWS:
            scored_variants[sv] = list(anns)
        elif sv:
            overflow.extend(anns)

    general_anns = variant_anns.get("", []) + overflow
    if general_anns:
        scored_variants[""] = general_anns

    if len(scored_variants) > 1:
        detected = [sv for sv in scored_variants if sv]
        print(f"  🔍 偵測到 {len(detected)} 個子款，分別計分：{', '.join(detected)}"
              f"（通用: {len(scored_variants.get('', []))} 則評論）")

    results = {}
    for sv, anns in scored_variants.items():
        ind_results, ex_ad, ex_mis, per_ind = _score_annotations_to_results(
            anns, target_indicators, reviews
        )
        results[sv] = (ind_results, ex_ad, ex_mis, per_ind)
    return results


# ==========================================
# 動態核心指標（EMA）
# ==========================================

def load_weights_state():
    if os.path.exists(WEIGHTS_STATE_FILE):
        try:
            with open(WEIGHTS_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_weights_state(state):
    with open(WEIGHTS_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def update_core_indicators(subcat, target_indicators, agg_mentions, agg_strong, total_valid_reviews, state):
    subcat_state = state.setdefault(subcat, {})
    denom = max(total_valid_reviews, 1)
    importance_by_indicator = {}
    for indicator in target_indicators:
        mentions = agg_mentions.get(indicator, 0)
        mention_rate = mentions / denom
        extremity = (agg_strong.get(indicator, 0) / mentions) if mentions else 0.0
        raw_importance = 0.5 * mention_rate + 0.5 * extremity
        previous = subcat_state.get(indicator, {}).get("importance")
        smoothed = (raw_importance if previous is None
                    else EMA_ALPHA * raw_importance + (1 - EMA_ALPHA) * previous)
        importance_by_indicator[indicator] = smoothed
        subcat_state[indicator] = {
            "importance": round(smoothed, 4),
            "raw_importance_last_run": round(raw_importance, 4),
            "mentions_last_run": mentions,
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    ranked = sorted(importance_by_indicator.items(), key=lambda kv: kv[1], reverse=True)
    return {ind for ind, _ in ranked[:CORE_TOP_N] if importance_by_indicator[ind] > 0}


# ==========================================
# 主程式
# ==========================================

def _parse_subcat_arg():
    """--subcat 粉底液,遮瑕膏  → {'粉底液','遮瑕膏'}；未給則 None（處理全部）。"""
    if "--subcat" in sys.argv:
        try:
            raw = sys.argv[sys.argv.index("--subcat") + 1]
            return {s.strip() for s in raw.split(",") if s.strip()}
        except IndexError:
            pass
    return None


def main():
    prepare_mode = "--prepare" in sys.argv
    target_subcats = _parse_subcat_arg()

    # --cleaned：強制讀 cleaned_reviews.json（未經路由的完整資料），
    # 用於評分「沒有小紅書、不需路由」的子分類（否則會誤讀舊的 routed_reviews.json）。
    reviews_json = CLEANED_JSON if "--cleaned" in sys.argv else REVIEWS_JSON

    if not os.path.exists(ITEMS_CSV) or not os.path.exists(INDICATOR_CSV) or not os.path.exists(reviews_json):
        print("❌ 找不到所需的 CSV 或 JSON 檔案，請確認路徑。")
        return

    # 標記來源優先序：agent 產生的 score_responses.json（免 API）> Claude API。
    precomputed = None
    if os.path.exists(SCORE_RESP):
        with open(SCORE_RESP, "r", encoding="utf-8") as f:
            precomputed = json.load(f)

    if not prepare_mode and precomputed is None and (
            not ANTHROPIC_API_KEY or ANTHROPIC_API_KEY == "your_anthropic_api_key_here"):
        print("❌ 沒有可用的標記來源。請二選一：")
        print("   (A) agent 兩段式：先跑 `--prepare`，由 Claude Code 產生 llm_io/score_responses.json，再跑 `--compute`")
        print("   (B) 在 .env 設定 ANTHROPIC_API_KEY 後直接執行")
        return

    if prepare_mode:
        print("🧾 --prepare 模式：整理待標記評論，不評分、不呼叫 API")
    elif precomputed is not None:
        print(f"📥 使用 agent 標記結果 {SCORE_RESP}（{len(precomputed)} 個品項）計算分數")
    else:
        print(f"📥 讀取資料...（使用 Claude API：{CLAUDE_MODEL}）")

    indicators_map = {}
    with open(INDICATOR_CSV, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            subcat = row.get("Subcategories", "").strip()
            indicator = row.get("Indicator", "").strip()
            if subcat and indicator:
                indicators_map.setdefault(subcat, [])
                if indicator not in indicators_map[subcat]:
                    indicators_map[subcat].append(indicator)

    items_list = []
    with open(ITEMS_CSV, "r", encoding="utf-8") as f:
        items_list = list(csv.DictReader(f))

    with open(reviews_json, "r", encoding="utf-8") as f:
        reviews = json.load(f)
    print(f"   評論來源：{os.path.basename(reviews_json)}（{len(reviews)} 筆）")

    # 已被 route_reviews.py 歸位的評論帶 item_id，直接依 item_id 精準分組；
    # 其餘（未經路由的舊資料）維持原本的 search_keyword 比對，向後相容。
    id_field = list(items_list[0].keys())[0] if items_list else " "
    reviews_by_item_id = {}
    reviews_by_keyword = {}
    for r in reviews:
        iid = str(r.get("item_id", "")).strip()
        if iid:
            reviews_by_item_id.setdefault(iid, []).append(r)
            continue
        kw = r.get("search_keyword", "").replace(" IG", "").replace(" Dcard", "").strip()
        reviews_by_keyword.setdefault(kw, []).append(r)

    items_by_subcat = {}
    for row in items_list:
        subcat = row.get("Subcategories", "").strip()
        items_by_subcat.setdefault(subcat, []).append(row)

    weights_state = load_weights_state()
    results = []
    requests_out = []   # --prepare 模式：待 agent 標記的評論
    total_products = sum(len(v) for v in items_by_subcat.values())
    processed = 0

    for subcat, subcat_items in items_by_subcat.items():
        if target_subcats is not None and subcat not in target_subcats:
            processed += len(subcat_items)
            continue
        target_indicators = indicators_map.get(subcat, [])
        if not target_indicators:
            processed += len(subcat_items)
            continue

        print(f"\n{'='*50}\n📂 子分類：{subcat}（{len(subcat_items)} 個產品）\n{'='*50}")

        product_cache = []
        agg_mentions = {ind: 0 for ind in target_indicators}
        agg_strong = {ind: 0 for ind in target_indicators}
        total_valid_reviews = 0

        for row in subcat_items:
            processed += 1
            brand     = row.get("Brand", "").strip()
            item_name = (row.get("Items（台灣官網商品名）") or row.get("Items") or "").strip()
            cn_name   = row.get("Items（中國官網商品名）", "").strip()
            alt_name  = row.get("Another name（別稱）", "").strip()

            if not brand or not item_name:
                continue

            def _strip_spf(n):
                return n.split("SPF")[0].strip()

            product_keywords = {f"{brand} {_strip_spf(item_name)}"}
            if cn_name and cn_name != item_name:
                product_keywords.add(_strip_spf(cn_name))
            if alt_name:
                product_keywords.add(f"{brand} {alt_name}")
                product_keywords.add(alt_name)

            matched_reviews = []
            seen_match_urls = set()
            # 1) 優先納入已由 route_reviews.py 精準歸位到此品項的評論
            row_id = str(row.get(id_field, "")).strip()
            for r in reviews_by_item_id.get(row_id, []):
                url = r.get("url")
                if url and url not in seen_match_urls:
                    seen_match_urls.add(url)
                    matched_reviews.append(r)
            # 2) 再用 search_keyword 比對未經路由的舊資料
            for kw, revs in reviews_by_keyword.items():
                if any(pk in kw or kw in pk for pk in product_keywords):
                    for r in revs:
                        url = r.get("url")
                        if url and url not in seen_match_urls:
                            seen_match_urls.add(url)
                            matched_reviews.append(r)

            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            if not matched_reviews:
                product_cache.append({
                    "brand": brand, "item_name": item_name, "timestamp": timestamp,
                    "variants": {"": ([{"Indicator": ind, "Score": "", "Mentions": 0,
                                        "Polarization": False, "Reason": "尚未有足夠的爬蟲評論資料"}
                                       for ind in target_indicators], 0, 0, {})},
                })
                continue

            seen_urls = set()
            unique_reviews = []
            for r in matched_reviews:
                url = r.get("url")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    unique_reviews.append(r)
            # 排序原則：已由 route_reviews 精準歸位（帶 item_id）的「相關」評論優先，
            # 其次才用讚數。避免高讚但不相關的 keyword 噪音把乾淨的 routed 評論擠出上限。
            # 圖上評測型貼文（image_review）讚數加權：給一點排序優勢，但不強制入榜——
            # 讚數太低代表本來就不太有代表性，仍可能被更高讚的評論擠出上限。
            def _sort_likes(r):
                base = r.get("likes", 0) or 0
                if r.get("image_review"):
                    base += IMAGE_REVIEW_LIKES_BOOST
                return base

            unique_reviews = sorted(
                unique_reviews,
                key=lambda x: (0 if str(x.get("item_id", "")).strip() else 1, -_sort_likes(x)),
            )[:MAX_REVIEWS_PER_PRODUCT]

            if prepare_mode:
                requests_out.append({
                    "key": _product_key(brand, item_name),
                    "brand": brand, "item_name": item_name, "subcategory": subcat,
                    "indicators": target_indicators,
                    "reviews": [{"index": i, "likes": r.get("likes", 0),
                                 "content": (r.get("content", "") or "").replace(chr(10), " ")}
                                for i, r in enumerate(unique_reviews)],
                })
                continue

            print(f"[{processed}/{total_products}] 🔄 正在評估: {brand} {item_name}（{len(unique_reviews)} 筆評論, {len(target_indicators)} 項指標）...")

            if precomputed is not None:
                product_key = _product_key(brand, item_name)
                if product_key not in precomputed:
                    # 這個品項本輪根本沒有被標記（key 不存在，跟「標記了但陣列是空的」不同）：
                    # 代表 score_responses.json 這次沒有涵蓋到它，通常是因為 --compute 沒加
                    # --subcat、卻只用了部分子分類的標記結果。直接跳過、不產生任何列，讓下面
                    # 合併輸出時保留 CSV 裡它原本的真實分數，避免整批洗成「資料不足」
                    # （2026-07-21 事故：忘記加 --subcat 導致 151 個已評分品項被清空)。
                    processed += 1
                    continue
                # agent 模式：品項有標記但陣列為空，代表這輪標記後判定沒有一則有效評論
                annotations = precomputed.get(product_key) or []
            else:
                annotations = None
            variant_results = compute_product_scores_with_variants(
                brand, item_name, target_indicators, unique_reviews, annotations=annotations
            )

            # 累計子分類 EMA 統計（所有子款合計，因為 EMA 是子分類層級的）
            total_ex_ad = total_ex_mis = 0
            for sv, (ind_results, ex_ad, ex_mis, per_ind) in variant_results.items():
                total_ex_ad += ex_ad
                total_ex_mis += ex_mis
                for indicator, entries in per_ind.items():
                    agg_mentions[indicator] += len(entries)
                    agg_strong[indicator] += sum(1 for s, _ in entries if s in STRONG_SENTIMENTS)
            total_valid_reviews += len(unique_reviews) - total_ex_ad - total_ex_mis

            product_cache.append({
                "brand": brand, "item_name": item_name, "timestamp": timestamp,
                "variants": variant_results,
                "total_reviews": len(unique_reviews),
                "total_ex_ad": total_ex_ad,
                "total_ex_mis": total_ex_mis,
            })
            if precomputed is None:
                time.sleep(2)   # 只有真的打 API 才需要節流

        # 第二階段：算核心指標再組裝輸出
        core_indicators = update_core_indicators(
            subcat, target_indicators, agg_mentions, agg_strong, total_valid_reviews, weights_state
        )
        print(f"⭐ [{subcat}] 本輪核心指標（×{CORE_WEIGHT}）：{', '.join(core_indicators) if core_indicators else '（尚無足夠資料）'}")

        for product in product_cache:
            brand      = product["brand"]
            item_name  = product["item_name"]
            timestamp  = product["timestamp"]
            total_r    = product.get("total_reviews", 0)
            total_ex_a = product.get("total_ex_ad", 0)
            total_ex_m = product.get("total_ex_mis", 0)
            has_variants = any(sv != "" for sv in product["variants"])

            for sv, (indicator_results, ex_ad, ex_mis, _) in product["variants"].items():
                valid_count = len([ann for ann in indicator_results if ann.get("Score") != ""])
                variant_review_count = total_r  # approximate
                sample_warning = ""

                # 如果是被拆分的子款，每個子款有效評論數是 sum(Mentions) 的近似
                effective_mentions = sum(r.get("Mentions", 0) for r in indicator_results)
                if effective_mentions > 0 and effective_mentions < 5:
                    sample_warning = " ⚠️ 有效評論樣本較少，結果僅供參考"

                variant_label = f" [{sv}]" if sv else ("" if not has_variants else " [通用]")

                for r in indicator_results:
                    core = r["Indicator"] in core_indicators
                    reason = r.get("Reason", "")
                    if sample_warning and r.get("Score") != "":
                        reason = (reason + sample_warning).strip()
                    results.append({
                        "Brand": brand,
                        "Items": item_name,
                        "Variant": sv,
                        "Subcategories": subcat,
                        "Indicator": r["Indicator"],
                        "Score": r["Score"],
                        "Mentions": r["Mentions"],
                        "CoreIndicator": core,
                        "Polarization": r.get("Polarization", False),
                        "Reason": reason or (f"核心指標 ×{CORE_WEIGHT}" if core else ""),
                        "Evaluated_At": timestamp,
                    })

                valid_scores = [r for r in indicator_results if isinstance(r.get("Score"), (int, float))]
                if valid_scores:
                    # SKILL Step 4.4 雙軌加權：軌道一固定核心指標 ×1.3（跨品牌比較基準）；
                    # 軌道二依本品項評論實際提及次數，前兩名再疊乘 ×1.2，反映這款商品網友
                    # 真正在乎的重點，兩軌可疊加（最高 ×1.56）。
                    top_mentioned = {r["Indicator"] for r in sorted(
                        valid_scores, key=lambda r: -r.get("Mentions", 0)
                    )[:2] if r.get("Mentions", 0) > 0}

                    def _final_weight(r):
                        w = CORE_WEIGHT if r["Indicator"] in core_indicators else 1.0
                        if r["Indicator"] in top_mentioned:
                            w *= 1.2
                        return w

                    weighted_sum = sum(r["Score"] * _final_weight(r) for r in valid_scores)
                    weight_sum = sum(_final_weight(r) for r in valid_scores)
                    composite = round(weighted_sum / weight_sum, 1) if weight_sum else ""
                    results.append({
                        "Brand": brand,
                        "Items": item_name,
                        "Variant": sv,
                        "Subcategories": subcat,
                        "Indicator": "綜合評分",
                        "Score": composite,
                        "Mentions": "",
                        "CoreIndicator": "",
                        "Polarization": "",
                        "Reason": f"排除 {ex_ad} 則業配/疑似業配、{ex_mis} 則商品不符",
                        "Evaluated_At": timestamp,
                    })

    if prepare_mode:
        os.makedirs(LLM_IO_DIR, exist_ok=True)
        with open(SCORE_REQ, "w", encoding="utf-8") as f:
            json.dump(requests_out, f, ensure_ascii=False, indent=2)
        total_reviews = sum(len(r["reviews"]) for r in requests_out)
        print(f"\n🧾 已輸出 {len(requests_out)} 個待標記品項（共 {total_reviews} 則評論）至 {SCORE_REQ}")
        print("   下一步：由 Claude Code 讀取此檔、逐則標記，寫出 llm_io/score_responses.json，")
        print("   再執行 `/usr/bin/python3 score_reviews.py --compute` 完成算分。")
        return

    save_weights_state(weights_state)

    fieldnames = ["Brand", "Items", "Variant", "Subcategories", "Indicator", "Score",
                  "Mentions", "CoreIndicator", "Polarization", "Reason", "Evaluated_At"]

    # 合併輸出：本輪重算的 (Brand, Items) 取代舊列，其餘子分類/品項的既有分數原樣保留，
    # 避免只跑部分 --subcat 時把其他子分類的分數洗掉。
    rescored_keys = {(r["Brand"], r["Items"]) for r in results}
    merged_rows = []
    if os.path.exists(OUTPUT_CSV):
        with open(OUTPUT_CSV, "r", encoding="utf-8") as f:
            for old in csv.DictReader(f):
                if (old.get("Brand", ""), old.get("Items", "")) in rescored_keys:
                    continue  # 這個品項本輪已重算，丟棄舊列
                merged_rows.append({k: old.get(k, "") for k in fieldnames})
    kept = len(merged_rows)
    merged_rows.extend(results)

    with open(OUTPUT_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged_rows)

    print(f"\n🎉 評分完成！本輪重算 {len(results)} 筆、保留其他既有 {kept} 筆，"
          f"合計 {len(merged_rows)} 筆，儲存至 {OUTPUT_CSV}")
    print(f"📌 各子分類核心指標權重已更新至 {WEIGHTS_STATE_FILE}")
    print(f"🔍 Gemini 備份版本在 csv/AI_Scores_gemini_backup.csv，可直接比對。")


if __name__ == "__main__":
    main()
