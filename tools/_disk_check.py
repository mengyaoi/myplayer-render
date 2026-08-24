"""直接 import 当前 serve.py 测试 remote_search 不经 HTTP"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import serve as sv
sv.load()

# 1) remote_search
print("remote_search netease 成都:")
r = sv.remote_search("netease", "成都")
print("  len=", len(r) if r else "None/empty")
if r:
    print("  first:", r[0])

# 2) remote_get_url
print("\nremote_get_url netease 436514312:")
u = sv.remote_get_url("netease", "436514312")
print("  url=", u[:80] if u else "(empty)")

# 3) remote_get_playlist
print("\nremote_get_playlist netease 6907557348:")
pl = sv.remote_get_playlist("netease", "6907557348")
print("  name=", pl.get("name") if pl else "None", "| tracks=", len(pl.get("tracks", [])) if pl else 0)

# 4) remote_get_lrc
print("\nremote_get_lrc netease 436514312:")
lrc = sv.remote_get_lrc("netease", "436514312")
print("  lrc len=", len(lrc))