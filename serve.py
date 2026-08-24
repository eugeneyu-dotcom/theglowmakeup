#!/usr/bin/env python3
"""Glow Makeup 前端安全預覽伺服器。

取代 `python3 -m http.server` —— 那個會把整個專案根目錄（含 .env、爬蟲腳本、
原始評論 JSON、小紅書 HTML、csv/）全部對外服務。這支只放行前端真正需要的檔案，
其餘一律回 404，並預設只綁 127.0.0.1（不對區網開放）。

放行清單：
  - 根目錄的 .html/.htm/.css/.js/.map/.ico 與常見圖片、字型檔
  - 根目錄的 site-data.json、scores-data.json、articles.json、new-products.json（僅這幾個 JSON）
  - assets/ 底下的圖片、字型

擋掉：.env、任何 dotfile/dotdir、*.py、其他 *.json（routed/cleaned/standardized/
     indicator_weights/threads_session…）、*.csv、小紅書美妝貼文/、llm_io/、
     *_files/、csv/、__pycache__、以及目錄列表。

用法： /usr/bin/python3 serve.py [port]    # 預設 8777
"""
import http.server
import os
import posixpath
import sys
from urllib.parse import unquote


ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777

SAFE_EXT = {".html", ".htm", ".css", ".js", ".map", ".ico",
            ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
            ".woff", ".woff2", ".ttf"}
ALLOW_JSON = {"site-data.json", "scores-data.json", "articles.json", "new-products.json"}   # 可對外的前端資料 JSON
ALLOW_DIRS = {"assets"}                                # 唯一可對外的子資料夾
ALLOW_ROOT_FILES = {"robots.txt", "sitemap.xml"}       # 無副檔名白名單、根目錄放行的特例檔


def allowed(relpath):
    """回傳可服務的相對路徑；不可服務則回 None。"""
    if relpath in ("", "/"):
        return "index.html"
    parts = [p for p in relpath.split("/") if p]
    if any(p.startswith(".") for p in parts):      # .env / .git / 任何 dotfile
        return None
    name = parts[-1]
    ext = os.path.splitext(name)[1].lower()
    if len(parts) > 1:                              # 子資料夾：只放行 assets/ 內的靜態檔
        return relpath if (parts[0] in ALLOW_DIRS and ext in SAFE_EXT) else None
    if name in ALLOW_ROOT_FILES:
        return relpath
    if ext == ".json":                             # 根目錄 JSON：只放行白名單
        return relpath if name in ALLOW_JSON else None
    return relpath if ext in SAFE_EXT else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def _gate(self):
        p = unquote(self.path.split("?", 1)[0].split("#", 1)[0])
        p = posixpath.normpath(p).lstrip("/")
        return allowed(p)

    def send_head(self):
        if self._gate() is None:
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def end_headers(self):
        # 預覽用：一律不快取，避免改了 html/json 後瀏覽器還顯示舊版
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    os.chdir(ROOT)
    httpd = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    print("[secure] Glow Makeup preview: http://127.0.0.1:%d" % PORT)
    print("   Only frontend files served; .env / scripts / raw data all 404.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
