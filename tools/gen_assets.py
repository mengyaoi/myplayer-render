#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CTF 音乐播放器靶机 - 离线素材生成器
生成：可播放音频(WAV) / 封面(PNG) / 数据集(JSON) / 歌词(TXT)
全部离线、无版权依赖，纯本地 CTF 靶机使用。
运行：python tools/gen_assets.py
"""
import os, struct, math, zlib, json, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, "audio")
IMG_DIR = os.path.join(ROOT, "images", "covers")
DATA_DIR = os.path.join(ROOT, "data")
LYRIC_DIR = os.path.join(DATA_DIR, "lyrics")

for d in (AUDIO_DIR, IMG_DIR, DATA_DIR, LYRIC_DIR):
    os.makedirs(d, exist_ok=True)

SR = 44100

SONGS = [
    {"id": "1001", "name": "赛博霓虹",     "artist": ["虚拟歌手A"], "album": "电子梦境", "color": (40, 90, 200),  "freq": 440.0},
    {"id": "1002", "name": "午夜列车",     "artist": ["合成器B"],   "album": "霓虹都市", "color": (200, 60, 90),  "freq": 523.25},
    {"id": "1003", "name": "星河漫游",     "artist": ["电子C"],     "album": "深空",     "color": (60, 180, 140), "freq": 587.33},
    {"id": "1004", "name": "旧磁带",       "artist": ["复古D"],     "album": "怀旧",     "color": (230, 170, 40), "freq": 659.25},
    {"id": "1005", "name": "雨夜代码",     "artist": ["极客E"],     "album": "二进制",   "color": (120, 80, 200), "freq": 392.0},
    {"id": "1006", "name": "失效链接测试曲", "artist": ["CTF靶机"],  "album": "漏洞演示", "color": (180, 60, 60),  "freq": 330.0},
]
SOURCES = ["netease", "tencent", "kugou"]


def write_wav(path, freq, seconds=4.0):
    """生成一段带简单旋律的可播放正弦波 WAV（16bit 单声道）"""
    n = int(SR * seconds)
    data = bytearray()
    # 用两个谐波 + 轻微滑音，让每首可区分
    for i in range(n):
        t = i / SR
        env = min(t / 0.05, 1.0) * min((seconds - t) / 0.3, 1.0)
        env = max(env, 0.0)
        s = (math.sin(2 * math.pi * freq * t) * 0.6 +
             math.sin(2 * math.pi * freq * 2 * t) * 0.25 +
             math.sin(2 * math.pi * freq * 1.5 * t) * 0.15)
        val = int(s * env * 32767 * 0.8)
        data += struct.pack("<h", val)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(data))


def png_solid(path, color, size=200):
    """生成纯色 PNG（最小实现，无第三方依赖）"""
    w, h = size, size
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            raw += bytes(color)
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body +
                struct.pack(">I", zlib.crc32(tag + body) & 0xffffffff))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit, color type 2 (RGB)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    # 1) 音频 + 封面
    songs_out = []
    for idx, s in enumerate(SONGS, start=1):
        tname = f"t{idx}.wav"
        write_wav(os.path.join(AUDIO_DIR, tname), s["freq"])
        cname = f"c{s['id']}.png"
        png_solid(os.path.join(IMG_DIR, cname), s["color"])
        # 每个源一个桶；1006 的 netease 故意空 URL -> 演示源 fallback
        buckets = {}
        for si, src in enumerate(SOURCES):
            dead = (s["id"] == "1006" and src == "netease")
            buckets[src] = {
                "url_id": s["id"],
                "pic_id": f"c{s['id']}",
                "lyric_id": s["id"],
                "url": "" if dead else f"audio/{tname}",
            }
        songs_out.append({
            "id": s["id"],
            "name": s["name"],
            "artist": s["artist"],
            "album": s["album"],
            "sources": buckets,
        })
        # 歌词
        lrc = (
            f"[ti:{s['name']}]\n[ar:{s['artist'][0]}]\n[al:{s['album']}]\n"
            f"[00:01.00]这是 CTF 靶机本地生成的示例歌词\n"
            f"[00:02.00]歌曲：{s['name']}\n"
            f"[00:03.00]用于演示播放/换源/超级搜索功能\n"
        )
        with open(os.path.join(LYRIC_DIR, f"{s['id']}.txt"), "w", encoding="utf-8") as f:
            f.write(lrc)
        print(f"  [+] 生成 {s['name']} -> audio/t{idx}.wav + cover + lyric")

    with open(os.path.join(DATA_DIR, "songs.json"), "w", encoding="utf-8") as f:
        json.dump({"songs": songs_out}, f, ensure_ascii=False, indent=2)

    # 2) 歌单（符合前端 tracks 结构）
    playlist_tracks = []
    for idx, s in enumerate(SONGS, start=1):
        playlist_tracks.append({
            "id": s["id"],
            "name": s["name"],
            "ar": [{"name": s["artist"][0]}],
            "al": {"name": s["album"], "picUrl": f"images/covers/c{s['id']}.png"},
        })
    playlists = [{
        "id": "pl_001",
        "name": "CTF 精选靶机歌单",
        "coverImgUrl": "images/covers/c1001.png",
        "creator": {"nickname": "靶机管理员", "avatarUrl": "images/covers/c1001.png"},
        "tracks": playlist_tracks,
    }]
    with open(os.path.join(DATA_DIR, "playlists.json"), "w", encoding="utf-8") as f:
        json.dump({"playlists": playlists}, f, ensure_ascii=False, indent=2)

    # 3) 用户歌单（userlist）
    users = {
        "123456": {
            "code": 200,
            "playlist": [
                {"id": "pl_001", "name": "CTF 精选靶机歌单",
                 "coverImgUrl": "images/covers/c1001.png",
                 "creator": {"nickname": "靶机管理员", "avatarUrl": "images/covers/c1001.png"}},
                {"id": "pl_002", "name": "我的私有歌单",
                 "coverImgUrl": "images/covers/c1003.png",
                 "creator": {"nickname": "靶机管理员", "avatarUrl": "images/covers/c1003.png"}},
            ],
        }
    }
    with open(os.path.join(DATA_DIR, "users.json"), "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

    print("\n[OK] 素材生成完成：")
    print(f"  audio/   : {len(SONGS)} 个 WAV")
    print(f"  covers   : {len(SONGS)} 个 PNG")
    print(f"  data/     : songs.json / playlists.json / users.json")
    print(f"  lyrics   : {len(SONGS)} 个 TXT")


if __name__ == "__main__":
    main()
