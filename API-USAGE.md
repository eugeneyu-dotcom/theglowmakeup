# Maxora 生圖 API 使用說明(公網版,發給使用者)

> 你會拿到一對憑證:**Client ID** 與 **Client Secret**。它們等同你的個人鑰匙——
> **不要進 git、不要放前端網頁、不要轉發他人**;外洩請立刻回報管理者撤銷換發。

- **Base URL**:`https://image.aidsagent.net`
- **每個請求都要帶的 header**:
  ```
  CF-Access-Client-Id: <你的 Client ID>
  CF-Access-Client-Secret: <你的 Client Secret>
  Content-Type: application/json
  ```
- **body 一律帶 `"user":"你的名字"`**(例 `"user":"alice"`):伺服器按這個值做公平排隊,
  多人同時用時你的請求才不會被別人的大批任務卡住。
- 回應為 OpenAI Images 格式:`{"data":[{"b64_json":"<圖片 base64>"}]}`,自己解碼存檔。
  **預設回 WebP**(小檔),存檔副檔名用 `.webp`;要 PNG/JPEG 在 body 加 `"format":"png"` / `"jpeg"`。
- (若你人在公司 VPN 內,也可以免憑證直連 `http://192.168.50.11:8800`,其餘用法完全相同。)

---

## 1. 文生圖(txt2img)

```bash
curl -s https://image.aidsagent.net/v1/images/generations \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a neon MAXORA CAFE sign at night, cinematic", "size":"1:1", "user":"alice"}' \
  | python3 -c 'import sys,json,base64;open("out.webp","wb").write(base64.b64decode(json.load(sys.stdin)["data"][0]["b64_json"]))'
```

同步模式(預設):連線會阻塞 10~30 秒直到生完、直接回圖。

## 2. 改圖(單圖編輯)

丟 1 張 base64 圖 + 指令到 `/v1/images/edits`:

```bash
B64=$(base64 -i input.png)
curl -s https://image.aidsagent.net/v1/images/edits \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"在招牌上加上 MAXORA CAFE 字樣\",
       \"model\":\"qwen\",\"mode\":\"multiedit\",
       \"init_images\":[\"$B64\"],\"user\":\"alice\"}" \
  | python3 -c 'import sys,json,base64;open("out.webp","wb").write(base64.b64decode(json.load(sys.stdin)["data"][0]["b64_json"]))'
```

## 3. 多圖合成(海報)

同上,`init_images` 丟 2~3 張(人物 + logo + 道具…),模型會做身份保留的合成重打光。

## 4. 非同步模式(排隊多、或不想卡住連線時)

```bash
# 送出:立刻回 job_id 與排隊位置
curl -s "https://image.aidsagent.net/v1/images/generations?async=1" \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"…","size":"1:1","user":"alice"}'
# → {"job_id":"ab12…","status":"queued","queue_position":1}

# 輪詢(建議每 2~3 秒)
curl -s https://image.aidsagent.net/v1/images/result/ab12… \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET"
# → status: queued(含 queue_position)/ running / done(含 result)/ error

# 還在排隊想取消
curl -s -X DELETE https://image.aidsagent.net/v1/images/result/ab12… \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET"
```

結果只在伺服器記憶體保留 **5 分鐘**,完成後儘快取走。

## Python 範例

```python
import base64, os, requests

BASE = "https://image.aidsagent.net"
HEADERS = {
    "CF-Access-Client-Id": os.environ["CF_ID"],        # 憑證放環境變數/秘密管理,勿寫死
    "CF-Access-Client-Secret": os.environ["CF_SECRET"],
}

r = requests.post(f"{BASE}/v1/images/generations", headers=HEADERS, timeout=120,
                  json={"prompt": "a red apple on a white table", "size": "1:1", "user": "alice"})
r.raise_for_status()
with open("out.webp", "wb") as f:
    f.write(base64.b64decode(r.json()["data"][0]["b64_json"]))
```

---

## 參數一覽(body,JSON)

| 參數 | 用在 | 說明 |
|---|---|---|
| `prompt` | 全部(必填)| 提示詞,英文效果最佳 |
| `user` | 全部(**請必帶**)| 公平排隊的身分,填你的名字 |
| `size` | 全部 | `1:1`(1024²)/`16:9`(1280×720)/`9:16`(720×1280,**預設**)或自訂 `"寬x高"`(寬高建議可被 16 整除、面積 ≤ 1024²)|
| `init_images` | edits | base64 陣列;1 張=編輯、2~3 張=合成 |
| `model` / `mode` | edits | 固定 `"qwen"` / `"multiedit"` |
| `format` | 全部 | `webp`(預設)/ `png` / `jpeg` |
| `cfg` | 全部 | 引導強度,預設 `1.0`(prompt 很字面、負向詞無效);要 prompt/負向詞更聽話設 2~4 |
| `negative_prompt` | 全部 | 負向詞(僅 `cfg>1` 生效);不帶會套伺服器預設的壓字/壓浮水印詞 |
| `seed` | 全部 | 整數,固定可重現;省略隨機 |
| `?async=1` | URL query | 非同步模式(見上)|

## 錯誤碼

| HTTP | 意義 / 該怎麼辦 |
|---|---|
| `200` | 成功 |
| `202` | 非同步已受理(拿 `job_id` 去輪詢)|
| `400` | 請求格式錯(JSON 壞掉、size 格式錯…),看回應的 `detail` |
| `403` | **憑證錯或沒帶**(header 名稱/值檢查一下;仍不行找管理者確認你的 token 還有效)|
| `404` | 輪詢的 `job_id` 不存在或已過期(結果只留 5 分鐘)|
| `502` / `504` | 後端 worker 連不到或該張逾時,稍後重試;一直發生請回報管理者 |
