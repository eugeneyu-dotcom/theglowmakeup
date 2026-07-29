import os
import json
import csv
import time
from datetime import datetime
# pyrefly: ignore [missing-import]
from apify_client import ApifyClient

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

# ==========================================
# 1. 全域設定區
# ==========================================
APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
MY_COOKIE = os.environ.get("XHS_COOKIE", "")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE_PATH = os.path.join(BASE_DIR, "csv", "Items.csv") 
JSON_FILE_PATH = os.path.join(BASE_DIR, "standardized_reviews.json")


# ==========================================
# 2. 小紅書爬蟲核心模組 (參數更新版)
# ==========================================
# 🎯 這裡將預設的 sort_by 更新為 "popularity_descending"
def scrape_xiaohongshu(api_token, cookie, keyword, max_results=7, sort_by="popularity_descending", min_likes=10):
    client = ApifyClient(api_token)
    actor_id = "svGBZz6n79YbeA3uS"
    
    print(f"▶ [XHS] 啟動小紅書爬蟲，關鍵字: {keyword} (排序: {sort_by}, 最低讚數: {min_likes})")
    
    step1_input = {
        "mode": "search",
        "searchQuery": keyword,
        "maxResults": max_results, 
        "sortBy": sort_by,             
        "filterByMinLikes": min_likes, 
        "filterByType": "all",
        "proxyConfiguration": {"useApifyProxy": True},
        "concurrency": 1,
        "cookieString": cookie
    }
    
    try:
        run1 = client.actor(actor_id).call(run_input=step1_input)
        search_results = list(client.dataset(run1["defaultDatasetId"]).iterate_items())
    except Exception as e:
        print(f"❌ [XHS] 第一階段搜尋發生錯誤: {e}")
        return []
        
    post_urls = [item.get("postUrl") for item in search_results if item.get("postUrl")]
    
    if not post_urls:
        print("⚠️ [XHS] 找不到符合條件的貼文網址！請確認 Cookie 狀態。")
        return []
        
    print(f"✅ [XHS] 獲取 {len(post_urls)} 篇熱門貼文網址，準備進入內頁...")

    step2_input = {
        "mode": "post_details", 
        "postUrls": post_urls, 
        "includeComments": False, 
        "proxyConfiguration": {"useApifyProxy": True},
        "concurrency": 1,
        "cookieString": cookie
    }

    try:
        run2 = client.actor(actor_id).call(run_input=step2_input)
        detail_results = list(client.dataset(run2["defaultDatasetId"]).iterate_items())
    except Exception as e:
        print(f"❌ [XHS] 第二階段內文抓取發生錯誤: {e}")
        return []
        
    standardized_data = []
    for item in detail_results:
        content = item.get('content', '') or item.get('desc', '') or item.get('note_content', '')
        clean_content = str(content).replace('\n', ' ').strip()
        
        if not clean_content:
            continue
            
        post_data = {
            "platform": "Xiaohongshu",
            "search_keyword": keyword,
            "url": item.get('postUrl', ''),
            "title": item.get('title', '無標題'),
            "content": clean_content,
            "likes": item.get('likes', 0),
            "comments_count": item.get('comments', 0),
            "shares": item.get('shares', 0),
            "saves": item.get('saves', 0),
            "author": item.get('authorName', 'Unknown'),
            "scraped_at": datetime.now().isoformat()
        }
        standardized_data.append(post_data)
        
    standardized_data = sorted(standardized_data, key=lambda x: x['likes'], reverse=True)
    return standardized_data


# ==========================================
# 3. 資料管線模組 (Pipeline Module)
# ==========================================
def run_incremental_pipeline(api_token, cookie, csv_path, json_path):
    all_results = []
    
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as rf:
                all_results = json.load(rf)
            print(f"📥 成功載入既有 JSON 資料庫，共 {len(all_results)} 筆。")
        except:
            all_results = []

    print(f"📂 準備掃描 CSV 產品清單: {csv_path}")
    
    try:
        csv_rows = []
        with open(csv_path, newline='', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            fieldnames = reader.fieldnames 
            for row in reader:
                csv_rows.append(row)
                
        today_str = datetime.now().strftime("%Y-%m-%d")
        processed_count = 0
        
        for row in csv_rows:
            brand = row.get('Brand', '').strip()
            item_name = row.get('Items', '').strip()
            update_this_time = str(row.get('Update This Time', '')).strip().lower()
            
            if update_this_time == 'yes' and brand and item_name:
                short_item_name = item_name.split("SPF")[0].strip()
                keyword = f"{brand} {short_item_name}"
                
                print(f"\n" + "="*50)
                print(f"🎯 [增量更新] 偵測到標記，開始爬取小紅書: {keyword}")
                print("="*50)
                
                xhs_results = scrape_xiaohongshu(api_token, cookie, keyword)
                
                if xhs_results:
                    all_results.extend(xhs_results)
                    print(f"✅ [XHS] 產品 [{keyword}] 處理完成！獲取 {len(xhs_results)} 筆高互動貼文。")
                    
                row['Last Update'] = today_str       
                row['Update This Time'] = ''         
                processed_count += 1
                
                print("⏳ 進入冷卻時間，暫停 10 秒鐘...")
                time.sleep(10)
                
        if processed_count > 0:
            with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(csv_rows)
            print(f"\n📝 已成功將 {processed_count} 筆產品狀態寫回 CSV！")
        else:
            print("\n👀 掃描完畢，沒有發現任何標記為 'yes' 的產品需要更新。")
                    
    except FileNotFoundError:
        print(f"❌ 錯誤：找不到產品清單，請確認 {csv_path} 是否存在。")
        return
        
    if all_results and processed_count > 0:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=4)
        print(f"🎉 【小紅書增量更新自動化完成】 目前資料庫累積：{len(all_results)} 筆。")


# ==========================================
# 4. 主程式啟動區 (Entry Point)
# ==========================================
if __name__ == "__main__":
    run_incremental_pipeline(
        api_token=APIFY_TOKEN, 
        cookie=MY_COOKIE, 
        csv_path=CSV_FILE_PATH, 
        json_path=JSON_FILE_PATH
    )