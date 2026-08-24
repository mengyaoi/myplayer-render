"""8120 实例真实源 HTTP 自检"""
import http.client, urllib.parse, json

def get(path):
    c = http.client.HTTPConnection("127.0.0.1", 8120, timeout=20)
    c.request("GET", path); r = c.getresponse(); b = r.read()
    c.close(); return r.status, b

def post(types, **kw):
    body = urllib.parse.urlencode({"types": types, **kw})
    c = http.client.HTTPConnection("127.0.0.1", 8120, timeout=60)
    c.request("POST", "/api.php?callback=cb1", body=body,
              headers={"Content-Type": "application/x-www-form-urlencoded"})
    r = c.getresponse(); raw = r.read().decode("utf-8", "ignore").strip()
    c.close()
    if raw.startswith("cb1("): raw = raw[len("cb1("):-1]
    return r.status, json.loads(raw)

print("=== 1) 首页存活 ===")
s, _ = get("/"); print("  index HTTP", s)

print("\n=== 2) search netease 成都 ===")
s, raw = get("/api.php?types=search&source=netease&name=%E6%88%90%E9%83%BD&count=3")
arr = json.loads(raw)
print("  HTTP", s, "| len=", len(arr))
for r in arr:
    print("   ", r["name"], "|", "/".join(r["artist"]), "| src=", r["source"], "| id=", r["id"])

print("\n=== 3) url 436514312 (netease) ===")
s, d = post("url", id="436514312", source="netease")
print("  HTTP", s, "| url=", d.get("url", "")[:120])

print("\n=== 4) pic 436514312 (netease) ===")
s, d = post("pic", id="436514312", source="netease")
print("  HTTP", s, "| pic=", d.get("url", "")[:120])

print("\n=== 5) lyric 436514312 (netease, 真实 LRC) ===")
s, d = post("lyric", id="436514312", source="netease")
lrc = d.get("lyric", "")
print("  HTTP", s, "| lrc len=", len(lrc), "| preview=", lrc[:80].replace("\n", " | "))

print("\n=== 6) playlist 6907557348 (netease, 真实歌单) ===")
s, d = post("playlist", id="6907557348", source="netease")
pl = d.get("playlist", {})
print("  HTTP", s, "| name=", pl.get("name"), "| tracks=", len(pl.get("tracks", [])))
if pl.get("tracks"):
    t0 = pl["tracks"][0]
    print("  track0:", t0)

print("\n=== 7) userlist UID=1 (网易云官方) ===")
s, d = post("userlist", uid="1")
print("  HTTP", s, "| code=", d.get("code"), "| count=", len(d.get("playlist", [])))
if d.get("playlist"):
    p0 = d["playlist"][0]
    print("  first:", p0["id"], p0["name"], "| creator=", p0["creator"]["nickname"])

print("\n=== 8) super search 成都 source=all ===")
s, raw = get("/api.php?types=search&source=all&name=%E6%88%90%E9%83%BD&count=20")
arr = json.loads(raw)
print("  HTTP", s, "| len=", len(arr))
srcs = {}
for r in arr:
    srcs[r["source"]] = srcs.get(r["source"], 0) + 1
print("  by source:", srcs)

print("\n=== 9) audio t1.wav (本地静态) ===")
c = http.client.HTTPConnection("127.0.0.1", 8100, timeout=15)
c.request("GET", "/audio/t1.wav"); r = c.getresponse(); b = r.read(); c.close()
print("  HTTP", r.status, "| len=", len(b))