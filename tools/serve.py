#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
音乐播放器后端 - 本地预览 / 契约自测服务器（无 PHP 环境时用）
=================================================================
这是 api.php 的纯 Python 等价实现，逻辑与 player/api.php 完全一致，
仅用于：
  1) 没有 PHP 的机器上临时预览播放器效果；
  2) 开发期契约自测（验证 6 个 types 的返回形状与前端对齐）。
正式部署请用 player/api.php（PHP 版）。两者契约相同。
运行：python tools/serve.py  然后访问 http://127.0.0.1:8000/
环境变量：PORT（默认 8010）
"""
import json, os, re, mimetypes, http.client, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA        = os.path.join(ROOT, "data")
LYRIC_DIR   = os.path.join(DATA, "lyrics")
SOURCES     = ["netease", "tencent", "kugou"]
METING_BASE = os.environ.get("METING_API_URL", "https://meting.mikus.ink")
NETEASE_BASE = "https://music.163.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

SONGS, PLAYLISTS, USERS = [], [], {}


def load():
    global SONGS, PLAYLISTS, USERS
    SONGS, PLAYLISTS, USERS = [], [], {}
    # 文件缺失/损坏时给空兜底，避免整个进程启动即崩（Render 上会导致全站 502）
    try:
        with open(os.path.join(DATA, "songs.json"), encoding="utf-8") as f:
            SONGS = json.load(f).get("songs", [])
    except Exception as e:
        print("[!] 加载 songs.json 失败: %s" % e)
    try:
        with open(os.path.join(DATA, "playlists.json"), encoding="utf-8") as f:
            PLAYLISTS = json.load(f).get("playlists", [])
    except Exception as e:
        print("[!] 加载 playlists.json 失败: %s" % e)
    try:
        with open(os.path.join(DATA, "users.json"), encoding="utf-8") as f:
            USERS = json.load(f)
    except Exception as e:
        print("[!] 加载 users.json 失败: %s" % e)
    print("[*] 本地数据: %d 首歌曲 / %d 个歌单 / %d 个用户" % (len(SONGS), len(PLAYLISTS), len(USERS)))


def find_song(sid):
    for s in SONGS:
        if s["id"] == sid:
            return s
    return None


def map_row(song, source):
    b = song["sources"].get(source) or next(iter(song["sources"].values()))
    return {
        "id": song["id"], "name": song["name"], "artist": song["artist"],
        "album": song["album"], "source": source,
        "url_id": b["url_id"], "pic_id": b["pic_id"], "lyric_id": b["lyric_id"],
    }


def search_local(name, source):
    out = []
    nl = name.lower()
    for s in SONGS:
        if nl in s["name"].lower() or nl in json.dumps(s["artist"], ensure_ascii=False).lower():
            out.append(map_row(s, source))
    return out


def get_url_local(sid, source):
    s = find_song(sid)
    if not s:
        return ""
    b = s["sources"].get(source) or next(iter(s["sources"].values()))
    return b.get("url", "")


def get_playlist_local(pid):
    for pl in PLAYLISTS:
        if pl["id"] == pid:
            return pl
    # 本地 id 显式缺失（可能已被删除）：返回 deleted 标记，前端据此移除该歌单
    if pid and pid.startswith("pl_"):
        return {"deleted": True}
    return PLAYLISTS[0] if PLAYLISTS else None


def get_userlist_local(uid):
    return USERS.get(uid)


# ============== MetingClient（Python 镜像） ==============
# 默认走 api.i-meto.com 的 meting API path（沙盒验证可工作；带 Referer 头）
# P2: Meting 多镜像源（按顺序 fallback）。可用环境变量 METING_API_URL 覆盖（逗号分隔多个）。
_METING_SOURCES = [
    s.strip() for s in os.environ.get(
        "METING_API_URL",
        "https://api.i-meto.com/meting/api,https://mikus.ink/meting/api"
    ).split(",") if s.strip()
]
# 主源（用于 Referer / 默认），取第一个
_met = urllib.parse.urlsplit(_METING_SOURCES[0])
METING_BASE = _met.scheme + "://" + _met.hostname  # 形如 https://api.i-meto.com
DEFAULT_REFERER = os.environ.get("METING_REFERER", METING_BASE + "/")


def _http_get(url, timeout=15, referer=DEFAULT_REFERER):
    """发起 HTTP/HTTPS GET，连接与读取阶段均有超时保护。

    关键：timeout 只管 TCP 连接握手，HTTPResponse.read() 默认走 socket 全局
    超时（即无超时）。Meting 镜像在海外节点常出现「SSL 握手成功但 body 流卡住」，
    必须用 c.sock.settimeout(timeout) 在 getresponse() 之后、read() 之前显式
    给 socket 设超时，否则进程会永久 hang 在 r.read() 上。
    """
    p = urllib.parse.urlsplit(url)
    host = p.hostname
    cls = http.client.HTTPSConnection if p.scheme == "https" else http.client.HTTPConnection
    c = cls(host, timeout=timeout)
    headers = {"User-Agent": UA, "Referer": referer}
    c.request("GET", p.path + ("?" + p.query if p.query else ""), headers=headers)
    r = c.getresponse()
    # 读 body 阶段也必须受超时控制（最可靠方案：直接给底层 socket 设超时）
    if c.sock:
        c.sock.settimeout(timeout)
    body = r.read()
    c.close()
    return r.status, body


def _meting_get_list(server, mtype, mid, limit=30):
    """P2: 遍历所有 Meting 镜像源，任一成功即返回；全部失败返回 []。"""
    q = urllib.parse.urlencode({"server": server, "type": mtype, "id": mid, "limit": limit})
    last_err = None
    for base in _METING_SOURCES:
        try:
            s, b = _http_get(base + "?" + q)
        except Exception as e:
            last_err = e
            continue  # 该源超时/不可达，跳下一个
        if s != 200:
            last_err = "HTTP %d from %s" % (s, base)
            continue
        try:
            arr = json.loads(b)
        except Exception as e:
            last_err = e
            continue
        if isinstance(arr, list) and arr:
            return arr
        last_err = "empty list from %s" % base
    # 全部源失败：返回空，由上层 fallback 到本地歌单
    return []


def _resolve_get_redirect(target_url):
    """对任意 URL 跟 302 最多 5 次，返回最终 URL（失败返回空串）。
    某些 Meting 镜像首次访问会 404（防滥用），自动重试一次。"""
    import time as _t
    print("[resolve] start: %s" % target_url, flush=True)
    p = urllib.parse.urlsplit(target_url)
    host = p.hostname
    url = target_url
    last_status = None
    for attempt in range(6):
        ta = _t.time()
        try:
            c = http.client.HTTPSConnection(host, timeout=15) if p.scheme == "https" else http.client.HTTPConnection(host, timeout=15)
            c.request("GET", p.path + ("?" + p.query if p.query else ""),
                      headers={"User-Agent": UA, "Referer": DEFAULT_REFERER})
            r = c.getresponse()
            if c.sock:
                c.sock.settimeout(15)
            r.read()  # 关连接
            c.close()
            last_status = r.status
            print("[resolve] attempt=%d host=%s status=%s (%.2fs)" % (attempt, host, r.status, _t.time() - ta), flush=True)
            if r.status in (301, 302, 303, 307, 308):
                loc = r.getheader("Location") or r.getheader("location")
                if not loc:
                    return ""
                url2 = urllib.parse.urljoin(url, loc)
                if url2 == url:
                    return ""
                url = url2
                p = urllib.parse.urlsplit(url)
                host = p.hostname
                continue
            # 200：可能是直链 / 或 mp3 body
            if r.status == 200:
                print("[resolve] result: %s" % url, flush=True)
                return url
            # 404：服务端防滥用，等下重试
            if r.status == 404 and attempt < 5:
                _t.sleep(0.6)
                p = urllib.parse.urlsplit(target_url)  # 用原始 URL 重试
                host = p.hostname
                url = target_url
                continue
            return ""
        except Exception as e:
            print("[resolve] attempt=%d host=%s EXCEPTION %s (%.2fs)" % (attempt, host, repr(e), _t.time() - ta), flush=True)
            return ""
    print("[resolve] result(fallback): %s" % (url if last_status == 200 else ""), flush=True)
    return url if last_status == 200 else ""


def _meting_get_lrc(server, mid):
    q = urllib.parse.urlencode({"server": server, "type": "lrc", "id": mid})
    try:
        s, b = _http_get(METING_BASE_URL + "?" + q)
    except Exception:
        return ""
    if s != 200:
        return ""
    try:
        return b.decode("utf-8", errors="ignore")
    except Exception:
        return ""


# ============== NeteaseClient（按 UID 拉用户公开歌单） ==============
def _netease_get_user_playlists(uid, limit=50):
    q = urllib.parse.urlencode({"uid": str(uid), "limit": limit})
    try:
        s, b = _http_get(NETEASE_BASE + "/api/user/playlist?" + q)
    except Exception:
        return []
    if s != 200:
        return []
    try:
        obj = json.loads(b)
    except Exception:
        return []
    if isinstance(obj, dict) and isinstance(obj.get("playlist"), list):
        return obj["playlist"]
    return []


# ============== 真实源（统一接口；与 PHP 版 sources.php 对齐） ==============
def _split_artists(author):
    if not author:
        return [""]
    parts = re.split(r"[\/、,|&]\s*", author)
    parts = [p.strip() for p in parts if p and p.strip()]
    return parts or [author.strip()]


def _extract_id_from_item(item):
    for k in ("url", "lrc", "pic"):
        v = item.get(k, "") or ""
        m = re.search(r"[?&]id=([^&]+)", v)
        if m:
            return m.group(1)
    return ""


def _to_search_row(item, server):
    mid = _extract_id_from_item(item)
    return {
        "id":       mid,
        "name":     item.get("title", "") or "",
        "artist":   _split_artists(item.get("author", "") or ""),
        # album 字段：Meting 不提供专辑名，用 author 作 fallback（前端显示有意义）
        "album":    item.get("author", "") or "",
        "source":   server,
        "url_id":   mid,
        "pic_id":   mid,
        "lyric_id": mid,
    }


def _to_playlist_track(item, server):
    mid = _extract_id_from_item(item)
    ar = _split_artists(item.get("author", "") or "")
    # Meting 返回的 item['pic'] 已经是真直链（p1.music.126.net），
    # 不再调 _resolve_get_redirect，避免每个 track 多一次 HTTPS round-trip。
    pic = item.get("pic", "") or ""
    return {
        "id":   mid,
        "name": item.get("title", "") or "",
        "ar":   [{"name": n} for n in ar],
        "al":   {"name": item.get("title", "") or "", "picUrl": pic},
    }


# Meting 源（netease / tencent / kugou）
def remote_search(server, name):
    """真实源搜索。返回 list（可能为空）或 None（异常需 fallback）。
    QQ/酷狗当前 Meting 镜像只支持网易云，这里仍通用调用，若镜像支持可自动生效；
    返回空时由 handle() 统一 fallback 到网易云 + 本地。"""
    if server not in ("netease", "tencent", "kugou"):
        return None
    rows = _meting_get_list(server, "search", name, 30)
    if rows is None:
        return None
    return [_to_search_row(it, server) for it in rows]


def _song_url(server, mid):
    """先 type=song 拿详情（含 auth 的 url 字段），再跟 302 拿真实 MP3"""
    import time as _t
    print("[song_url] start server=%s mid=%s" % (server, mid), flush=True)
    t0 = _t.time()
    rows = _meting_get_list(server, "song", mid, 1)
    print("[song_url] meting list done (%.2fs) rows=%d" % (_t.time() - t0, len(rows)), flush=True)
    if not rows:
        return ""
    auth_url = rows[0].get("url", "") or ""
    if not auth_url:
        return ""
    print("[song_url] meting url: %s" % auth_url, flush=True)
    t1 = _t.time()
    final = _resolve_get_redirect(auth_url)
    print("[song_url] resolve done (%.2fs) result: %s" % (_t.time() - t1, final[:80] if final else "(empty)"), flush=True)
    return final


def _song_pic(server, mid):
    """list 返回的 pic 字段是带 auth 的代理 URL；跟 302 拿网易云真直链"""
    rows = _meting_get_list(server, "song", mid, 1)
    if not rows:
        return ""
    auth_url = rows[0].get("pic", "") or ""
    if not auth_url:
        return ""
    return _resolve_get_redirect(auth_url)


def _song_lrc(server, mid):
    """通过 type=song 拿详情（含 auth 的 lrc URL），GET 拿 LRC 文本"""
    rows = _meting_get_list(server, "song", mid, 1)
    if not rows:
        return ""
    auth_url = rows[0].get("lrc", "") or ""
    if not auth_url:
        return ""
    try:
        s, b = _http_get(auth_url)
        if s == 200:
            return b.decode("utf-8", errors="ignore")
        return ""
    except Exception:
        return ""


def remote_get_url(server, mid):
    return _song_url(server, mid)


def remote_get_pic(server, mid):
    return _song_pic(server, mid)


def remote_get_lrc(server, mid):
    return _song_lrc(server, mid)


def remote_get_playlist(server, pid):
    rows = _meting_get_list(server, "playlist", pid, 50)
    if not rows:
        return None
    return {
        "name":         "歌单 " + str(pid),
        "coverImgUrl":  rows[0].get("pic", "") if rows else "",
        "creator":      {"nickname": "网络", "avatarUrl": ""},
        "tracks":       [_to_playlist_track(it, server) for it in rows],
    }


# 网易云按 UID 拉用户歌单
def remote_get_userlist(uid):
    pls = _netease_get_user_playlists(uid, 50)
    if not pls:
        return None
    mapped = []
    for p in pls:
        if "id" not in p:
            continue
        mapped.append({
            "id":          str(p["id"]),
            "name":        p.get("name", "未命名"),
            "coverImgUrl": p.get("coverImgUrl", ""),
            "creator": {
                "nickname":  (p.get("creator") or {}).get("nickname", "未知"),
                "avatarUrl": (p.get("creator") or {}).get("avatarUrl", ""),
            },
        })
    if not mapped:
        return None
    return {"code": 200, "playlist": mapped}


# ============== 路由 ==============
def handle(types, source, name, sid, uid, count, pages, callback):
    if types == "search":
        if source == "all":
            merged, seen = [], set()
            # 真实源
            for srv in ("netease", "tencent", "kugou"):
                rows = remote_search(srv, name) or []
                for r in rows:
                    key = (r["name"], tuple(r["artist"]), srv)
                    if key not in seen:
                        seen.add(key); merged.append(r)
            # 本地兜底
            for srv in SOURCES:
                for r in search_local(name, srv):
                    key = (r["name"], tuple(r["artist"]), srv)
                    if key not in seen:
                        seen.add(key); merged.append(r)
            rows = merged
        else:
            rows = remote_search(source, name)
            if rows is None:
                rows = []
            if not rows:
                # QQ/酷狗镜像当前只支持网易云：单源搜索空时自动 fallback 到网易云 + 本地
                fb = remote_search("netease", name)
                rows = fb if fb else search_local(name, "netease")
        start = (pages - 1) * count
        return rows[start:start + count]

    if types == "url":
        url = ""
        if source in ("netease", "tencent", "kugou"):
            url = remote_get_url(source, sid)
        if not url and source != "all":
            # 真实源回退（tencent / kugou → netease）
            for srv in ("netease", "tencent", "kugou"):
                if srv == source:
                    continue
                u = remote_get_url(srv, sid)
                if u:
                    url = u; break
            # local 兜底
            if not url:
                for srv in SOURCES:
                    if srv == source:
                        continue
                    u = get_url_local(sid, srv)
                    if u:
                        url = u; break
        return {"url": url}

    if types == "pic":
        if re.match(r"^c\d+$", sid):
            return {"url": "images/covers/%s.png" % sid}
        url = ""
        if source in ("netease", "tencent", "kugou"):
            url = remote_get_pic(source, sid)
        return {"url": url}

    if types == "lyric":
        if re.match(r"^\d+$", sid) and len(sid) <= 4:
            p = os.path.join(LYRIC_DIR, "%s.txt" % sid)
            if os.path.exists(p):
                return {"lyric": open(p, encoding="utf-8").read()}
        if source in ("netease", "tencent", "kugou"):
            lrc = remote_get_lrc(source, sid)
            return {"lyric": lrc or ""}
        return {"lyric": ""}

    if types == "playlist":
        pl = None
        if source in ("netease", "tencent", "kugou"):
            pl = remote_get_playlist(source, sid)
        if not pl:
            pl = get_playlist_local(sid)
        if pl and pl.get("deleted"):
            return {"playlist": {"deleted": True}}
        if not pl:
            pl = {"name": "", "coverImgUrl": "", "creator": {"nickname": "", "avatarUrl": ""}, "tracks": []}
        return {"playlist": pl}

    if types == "userlist":
        ul = remote_get_userlist(uid)
        return ul if ul else {"code": 404, "playlist": []}

    if types == "deleteplaylist":
        import re as _re
        pid = sid or ""
        if not _re.match(r"^pl_[A-Za-z0-9_]+$", pid):
            return {"code": 403, "msg": "forbidden: only local pl_ playlists can be deleted"}
        # 以磁盘最新数据为准，避免内存与磁盘不一致
        try:
            cur = json.load(open(os.path.join(DATA, "playlists.json"), encoding="utf-8"))["playlists"]
        except Exception:
            cur = list(PLAYLISTS)
        new = [p for p in cur if (p.get("id") or "") != pid]
        if len(new) == len(cur):
            return {"code": 404, "msg": "not found"}
        with open(os.path.join(DATA, "playlists.json"), "w", encoding="utf-8") as f:
            json.dump({"playlists": new}, f, ensure_ascii=False, indent=2)
        PLAYLISTS[:] = new   # 同步内存，使后续 playlist 查询立即生效
        return {"code": 200, "msg": "deleted", "id": pid}

    return {"error": "unknown types: " + str(types)}


class Handler(BaseHTTPRequestHandler):
    def _serve(self, u, q):
        # ---- API 分支：/api.php 或带 types 参数 ----
        if u.path == "/api.php" or "types" in q:
            g = lambda k: q.get(k, [None])[0]
            types = g("types")
            source = g("source") or "netease"
            name = g("name") or ""
            sid = g("id") or ""
            uid = g("uid") or ""
            try:
                count = int(g("count") or 10)
                pages = int(g("pages") or 1)
            except (TypeError, ValueError):
                count, pages = 10, 1
            callback = g("callback")
            res = handle(types, source, name, sid, uid, count, pages, callback)
            body = json.dumps(res, ensure_ascii=False)
            if callback and re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*$", callback):
                payload = (callback + "(" + body + ")").encode("utf-8")
                ct = "application/javascript"
            else:
                payload = body.encode("utf-8")
                ct = "application/json"
            try:
                self.send_response(200)
                self.send_header("Content-Type", ct + "; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.connection.sendall(payload)
            except Exception:
                pass
            return

        # ---- 静态文件分支：前端页面 / js / css / audio / images ----
        rel = u.path.lstrip("/")
        if rel == "":
            rel = "index.html"
        fpath = os.path.normpath(os.path.join(ROOT, rel))
        if not fpath.startswith(os.path.abspath(ROOT)):
            self.send_error(403)
            return
        if os.path.isfile(fpath):
            ct = mimetypes.guess_type(fpath)[0] or "application/octet-stream"
            size = os.path.getsize(fpath)
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(size))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                with open(fpath, "rb") as fl:
                    while True:
                        chunk = fl.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                self.wfile.flush()
            except Exception:
                pass
        else:
            self.send_error(404)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        self._serve(u, q)

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        clen = 0
        try:
            clen = int(self.headers.get("Content-Length", "0") or 0)
        except (TypeError, ValueError):
            clen = 0
        if clen > 0:
            try:
                body_raw = self.rfile.read(clen).decode("utf-8", errors="ignore")
            except Exception:
                body_raw = ""
            if body_raw:
                extra = parse_qs(body_raw, keep_blank_values=True)
                for k, v in extra.items():
                    q[k] = v
        self._serve(u, q)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    load()
    port = int(os.environ.get("PORT", "8010"))
    print("[*] MKPLAYER-PREVIEW v3 (real sources) 已启动: http://127.0.0.1:%d/" % port)
    print("[*] ROOT=%s" % ROOT)
    print("[*] METING_BASE=%s  NETEASE_BASE=%s" % (METING_BASE, NETEASE_BASE))
    print("[*] METING_SOURCES(%d): %s" % (len(_METING_SOURCES), ", ".join(_METING_SOURCES)))
    # P1: 用 ThreadingHTTPServer 替代单线程 HTTPServer。
    # 某个请求卡在 Meting 镜像超时时，不会拖死整站（健康检查 / 静态资源 / 其他 API 仍正常响应）。
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()