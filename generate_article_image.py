"""
Maxora 生圖 API 小工具 — 給文章封面圖用。

用法：
    /usr/bin/python3 generate_article_image.py "<英文 prompt>" <輸出路徑，例如 assets/articles/foo.webp> [--size 1:1] [--negative_prompt "text, logo, watermark"]

憑證讀自本目錄 .env 的 CF_ID / CF_SECRET（Cloudflare Access service token，
不是一般 API Key，別跟其他站台的憑證搞混）。詳細參數說明、非同步模式、錯誤碼
見 .claude/skills/glowup-article-images/SKILL.md 與其中引用的 API-USAGE.md。
"""
import argparse
import base64
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

MAXORA_BASE_URL = "https://image.aidsagent.net"


def generate_image(prompt, size="1:1", fmt="webp", user="glowup-articles", cfg=None, negative_prompt=None, seed=None):
    cf_id = os.environ.get("CF_ID", "")
    cf_secret = os.environ.get("CF_SECRET", "")
    if not cf_id or not cf_secret:
        raise SystemExit("缺少 Maxora 憑證：.env 裡沒有 CF_ID / CF_SECRET")

    body = {"prompt": prompt, "size": size, "format": fmt, "user": user}
    if cfg is not None:
        body["cfg"] = cfg
    if negative_prompt:
        body["negative_prompt"] = negative_prompt
    if seed is not None:
        body["seed"] = seed

    resp = requests.post(
        f"{MAXORA_BASE_URL}/v1/images/generations",
        headers={
            "CF-Access-Client-Id": cf_id,
            "CF-Access-Client-Secret": cf_secret,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=120,
    )
    if resp.status_code != 200:
        raise SystemExit(f"Maxora API HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json().get("data") or []
    if not data or "b64_json" not in data[0]:
        raise SystemExit(f"回應裡沒有圖片資料：{resp.text[:300]}")

    return base64.b64decode(data[0]["b64_json"])


def main():
    parser = argparse.ArgumentParser(description="呼叫 Maxora 生圖 API，存成檔案")
    parser.add_argument("prompt", help="英文 prompt，效果最佳")
    parser.add_argument("output", help="輸出檔案路徑，例如 assets/articles/xxx.webp")
    parser.add_argument("--size", default="1:1", help="1:1 / 16:9 / 9:16 或自訂 寬x高（預設 1:1，跟 Glow Up 現有文章封面圖一致）")
    parser.add_argument("--format", default="webp", choices=["webp", "png", "jpeg"])
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--negative_prompt", default=None, help="要排除的元素，例如 'text, logo, watermark, letters' 可降低瓶身出現亂碼假字的機率")
    args = parser.parse_args()

    image_bytes = generate_image(
        args.prompt, size=args.size, fmt=args.format, seed=args.seed, negative_prompt=args.negative_prompt
    )

    out_path = args.output
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(image_bytes)
    print(f"已存檔：{out_path}（{len(image_bytes)} bytes）")


if __name__ == "__main__":
    main()
