# -*- coding: utf-8 -*-
"""臨時本機收評論伺服器（小紅書瀏覽器抓取用，抓完即可關）。

Claude in Chrome 在已登入的小紅書分頁裡抓到貼文內容後，直接 POST 到這裡，
資料不必經過對話 context（避免截斷、也快很多）。

用法：
  /usr/bin/python3 xhs_capture_server.py            # 預設 127.0.0.1:8765
  POST http://127.0.0.1:8765/note?slug=<檔名>       # body 為單篇 JSON 或 JSON 陣列
  GET  http://127.0.0.1:8765/ping                   # 連線測試
  GET  http://127.0.0.1:8765/count?slug=<檔名>      # 目前已收幾筆

收到的資料寫進 llm_io/xhs_capture/<slug>.jsonl（依 note id 去重、可重複執行）。
只綁 127.0.0.1、開 CORS 讓 rednote.com / xiaohongshu.com 頁面能 POST。
"""
import http.server, json, os, re, sys, urllib.parse

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "llm_io", "xhs_capture")
os.makedirs(OUT_DIR, exist_ok=True)
SAFE_SLUG = re.compile(r"^[\w一-鿿-]{1,60}$")
REQUIRED = ("id", "body")


def _path(slug):
    return os.path.join(OUT_DIR, slug + ".jsonl")


def _seen_ids(slug):
    p = _path(slug)
    if not os.path.exists(p):
        return set()
    ids = set()
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ids.add(json.loads(line).get("id"))
            except json.JSONDecodeError:
                continue
    return ids


class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        # Chrome Private Network Access：HTTPS 頁面打 127.0.0.1 需要這個才放行
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _reply(self, code, text):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(text.encode("utf-8"))

    def log_message(self, *args):
        pass  # 靜音，避免每篇一行雜訊

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def _slug(self):
        q = urllib.parse.urlparse(self.path).query
        return urllib.parse.parse_qs(q).get("slug", [""])[0]

    def do_GET(self):
        route = urllib.parse.urlparse(self.path).path
        if route == "/count":
            slug = self._slug()
            if not SAFE_SLUG.match(slug):
                return self._reply(400, "bad slug")
            return self._reply(200, str(len(_seen_ids(slug))))
        return self._reply(200, "ok")

    def do_POST(self):
        slug = self._slug()
        if not SAFE_SLUG.match(slug):
            return self._reply(400, "bad slug")
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0:
            return self._reply(400, "empty body")
        try:
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            return self._reply(400, "bad json: %s" % e)

        notes = payload if isinstance(payload, list) else [payload]
        seen = _seen_ids(slug)
        added = skipped = 0
        with open(_path(slug), "a", encoding="utf-8") as f:
            for note in notes:
                if not isinstance(note, dict) or any(not note.get(k) for k in REQUIRED):
                    skipped += 1
                    continue
                if note["id"] in seen:
                    skipped += 1
                    continue
                seen.add(note["id"])
                f.write(json.dumps(note, ensure_ascii=False) + "\n")
                added += 1
        print("  📥 %s：+%d（略過 %d，累計 %d）" % (slug, added, skipped, len(seen)), flush=True)
        return self._reply(200, json.dumps({"added": added, "skipped": skipped, "total": len(seen)}))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = http.server.HTTPServer(("127.0.0.1", port), H)
    print("✅ 收檔中：http://127.0.0.1:%d  →  %s" % (port, OUT_DIR), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 已停止")


if __name__ == "__main__":
    main()
