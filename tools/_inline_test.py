#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, json, threading, time, http.server, http.client, urllib.parse
import importlib.util

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sv", os.path.join("tools", "serve.py"))
sv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sv)
sv.load()

srv = http.server.HTTPServer(("127.0.0.1", 8099), sv.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.6)


def post(types, **kw):
    # 修正：types 必须放进 body
    body = urllib.parse.urlencode({"types": types, **kw})
    c = http.client.HTTPConnection("127.0.0.1", 8099, timeout=8)
    c.request("POST", "/api.php?callback=cb_x", body=body,
              headers={"Content-Type": "application/x-www-form-urlencoded"})
    r = c.getresponse()
    raw = r.read().decode("utf-8").strip()
    c.close()
    if raw.startswith("cb_x("):
        raw = raw[len("cb_x("):-1]
    return r.status, json.loads(raw)


print("=== playlist id=pl_001 (POST) ===")
st, d = post("playlist", id="pl_001")
pl = d.get("playlist")
print("  null?", pl is None, "| name=", (pl or {}).get("name"),
      "| tracks=", len(pl.get("tracks", [])) if pl else "NA")

print("=== playlist id=3778678 兜底 (POST) ===")
st, d = post("playlist", id="3778678")
pl = d.get("playlist")
print("  null?", pl is None, "| name=", (pl or {}).get("name"),
      "| tracks=", len(pl.get("tracks", [])) if pl else "NA")

print("=== userlist uid=123456 (POST) ===")
st, d = post("userlist", uid="123456")
print("  code=", d.get("code"), "| len=", len(d.get("playlist", [])),
      "| first=", (d.get("playlist") or [{}])[0].get("name"))

print("=== playlist pl_001 完整结构（前端对齐校验）===")
st, d = post("playlist", id="pl_001")
pl = d["playlist"]
print("  name=", pl["name"])
print("  coverImgUrl=", pl["coverImgUrl"])
print("  creator.nickname=", pl["creator"]["nickname"])
print("  track[0]=", json.dumps(pl["tracks"][0], ensure_ascii=False))
print("  track[0].ar[0].name=", pl["tracks"][0]["ar"][0]["name"])
print("  track[0].al.picUrl=", pl["tracks"][0]["al"]["picUrl"])

print("=== search 曲 (GET) ===")
c = http.client.HTTPConnection("127.0.0.1", 8099, timeout=8)
c.request("GET", "/api.php?types=search&source=netease&name=%E6%9B%B2&count=5")
r = c.getresponse()
arr = json.loads(r.read())
c.close()
print("  len=", len(arr), "| 首条 name=", (arr[0] if arr else {}).get("name"),
      "| 每项有 name?", all("name" in x for x in arr))

srv.shutdown()
print("\n[OK] 同进程 HTTP 验证全部通过")
