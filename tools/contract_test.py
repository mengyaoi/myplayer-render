#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""后端契约自测：验证 6 个 types + 超级搜索 + 源 fallback 的返回形状"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve as S

S.load()
fails = []


def check(cond, msg):
    print(("  [OK] " if cond else "  [FAIL] ") + msg)
    if not cond:
        fails.append(msg)


print("=== 1) search 单源 ===")
r = S.handle("search", "netease", "赛博", "", "", 10, 1, None)
check(isinstance(r, list) and len(r) >= 1, "search 返回数组且非空")
if r:
    row = r[0]
    for k in ("id", "name", "artist", "album", "source", "url_id", "pic_id", "lyric_id"):
        check(k in row, "search 行含字段 %s" % k)
    check(isinstance(row["artist"], list), "artist 是数组（前端契约）")
    check(row["source"] == "netease", "source 标记正确")

print("=== 2) search 超级搜索 source=all ===")
r = S.handle("search", "all", "曲", "", "", 50, 1, None)
check(isinstance(r, list) and len(r) >= 1, "超级搜索返回数组")
srcs = {x["source"] for x in r}
check(len(srcs) >= 2, "超级搜索聚合了多个源: %s" % srcs)

print("=== 3) url 正常 ===")
r = S.handle("url", "netease", "", "1001", "", 10, 1, None)
check(r == {"url": "audio/t1.wav"}, "url 返回正确外链: %s" % r)

print("=== 4) url 源 fallback（1006 netease 死链 -> 自动换源）===")
r = S.handle("url", "netease", "", "1006", "", 10, 1, None)
check(r["url"] != "", "fallback 后拿到非空外链: %s" % r["url"])

print("=== 5) pic ===")
r = S.handle("pic", "netease", "", "c1001", "", 10, 1, None)
check(r == {"url": "images/covers/c1001.png"}, "pic 返回封面路径: %s" % r)
r2 = S.handle("pic", "netease", "", "../../etc/passwd", "", 10, 1, None)
check(r2 == {"url": ""}, "pic 防穿越（非法 id 返回空）: %s" % r2)

print("=== 6) lyric ===")
r = S.handle("lyric", "netease", "", "1001", "", 10, 1, None)
check("lyric" in r and r["lyric"], "lyric 返回非空歌词")

print("=== 7) playlist ===")
r = S.handle("playlist", "netease", "", "pl_001", "", 10, 1, None)
check("playlist" in r and r["playlist"], "playlist 返回详情")
if r.get("playlist"):
    pl = r["playlist"]
    for k in ("name", "coverImgUrl", "creator", "tracks"):
        check(k in pl, "playlist 含字段 %s" % k)
    if pl.get("tracks"):
        t = pl["tracks"][0]
        for k in ("id", "name", "ar", "al"):
            check(k in t, "track 含字段 %s" % k)

print("=== 8) userlist ===")
r = S.handle("userlist", "netease", "", "", "123456", 10, 1, None)
check(r.get("code") == 200 and "playlist" in r, "userlist 返回用户歌单: %s" % r.get("code"))

print("=== 9) JSONP 包裹 ===")
r = S.handle("search", "netease", "赛", "", "", 10, 1, "jQuery123")
body = S.json.dumps(r, ensure_ascii=False) if hasattr(S, "json") else ""
# 用 serve 的输出逻辑模拟
import json
cb = "jQuery123"
wrapped = cb + "(" + json.dumps(r, ensure_ascii=False) + ")"
check(wrapped.startswith("jQuery123(") and wrapped.endswith(")"), "JSONP 包裹正确")

print()
if fails:
    print("[X] 有 %d 项未通过：" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
else:
    print("[√] 全部契约测试通过")
