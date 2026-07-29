import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_JSON = os.path.join(BASE_DIR, "standardized_reviews.json")
OUTPUT_JSON = os.path.join(BASE_DIR, "cleaned_reviews.json")

# 🚫 網址黑名單 (只要網址包含這些字，直接殺掉)
BANNED_URL_KEYWORDS = [
    "shopee.tw", "momo.com", "pchome.com", "watsons.com", 
    "cosmed.com", "urcosme.com/products", "cosme.net.tw/products",
    "buy.yahoo.com", "mall.", "shop.", "store."
]

# 🚫 內文黑名單 (只要內文出現這些「強烈促銷/業配」字眼，直接殺掉)
BANNED_CONTENT_KEYWORDS = [
    "前往購買", "線上哪裡買", "店鋪查詢", "官方網站", "購物車",
    "加入會員", "輸入折扣碼", "專屬優惠", "下單連結", "立即選購",
    "買一送一", "限時特價", "抽獎活動", "邀稿", "品牌合作"
]

def clean_reviews():
    if not os.path.exists(INPUT_JSON):
        print(f"❌ 找不到 {INPUT_JSON}！")
        return

    with open(INPUT_JSON, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    print(f"📥 讀取原始資料共 {len(raw_data)} 筆...")
    cleaned_data = []
    ad_count = 0

    for item in raw_data:
        url = item.get("url", "").lower()
        content = item.get("content", "")
        
        # 1. 檢查網址是否在黑名單
        is_ad = any(banned_word in url for banned_word in BANNED_URL_KEYWORDS)
        
        # 2. 檢查內文是否包含強烈促銷字眼
        if not is_ad:
            is_ad = any(banned_word in content for banned_word in BANNED_CONTENT_KEYWORDS)
            
        # 3. 額外防護：如果內文太短 (小於 10 個字)，對於 LLM 評分沒有意義，也濾掉
        if len(content.strip()) < 10:
            is_ad = True

        if is_ad:
            ad_count += 1
        else:
            cleaned_data.append(item)

    # 輸出乾淨的資料
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=4)

    print(f"🗑️ 成功過濾了 {ad_count} 筆廣告或無效內容！")
    print(f"✨ 剩下的 {len(cleaned_data)} 筆真實用戶評價已儲存至 {OUTPUT_JSON}。")

if __name__ == "__main__":
    clean_reviews()