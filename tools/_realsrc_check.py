"""真实源快速自检（不依赖 HTTP）"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import serve as sv
sv.load()

print("=== search 成都 (netease) ===")
rows = sv.remote_search("netease", "成都")
print("  count=", len(rows) if rows else 0)
if rows:
    print("  first:", rows[0])

print("\n=== url 436514312 (netease) ===")
u = sv.remote_get_url("netease", "436514312")
print("  url=", u[:120] if u else "(empty)")

print("\n=== pic 436514312 (netease) ===")
p = sv.remote_get_pic("netease", "436514312")
print("  pic=", p[:120] if p else "(empty)")

print("\n=== playlist 6907557348 (netease) ===")
pl = sv.remote_get_playlist("netease", "6907557348")
print("  is None?", pl is None)
if pl:
    print("  keys=", list(pl.keys()))
    print("  name=", pl["name"], "| tracks=", len(pl["tracks"]))
    print("  track0=", pl["tracks"][0])

print("\n=== userlist UID=1 (网易云官方) ===")
ul = sv.remote_get_userlist("1")
print("  is None?", ul is None)
if ul:
    print("  code=", ul.get("code"), "| count=", len(ul.get("playlist", [])))
    if ul.get("playlist"):
        print("  first pl=", ul["playlist"][0])

print("\n=== userlist UID=473618504 ===")
ul = sv.remote_get_userlist("473618504")
print("  is None?", ul is None)
if ul:
    print("  code=", ul.get("code"), "| count=", len(ul.get("playlist", [])))
    if ul.get("playlist"):
        for p in ul["playlist"][:3]:
            print("    -", p["id"], p["name"], "| cover=", p["coverImgUrl"][:60])

print("\n=== super search 成都 source=all ===")
all_rows = sv.handle("search", "all", "成都", "", "", 20, 1, "")
print("  total=", len(all_rows))
if all_rows:
    src_counts = {}
    for r in all_rows:
        src_counts[r["source"]] = src_counts.get(r["source"], 0) + 1
    print("  by source:", src_counts)
    print("  sample first:", all_rows[0])