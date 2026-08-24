# 音乐播放器后端（api.php）使用说明

按前端（MKOnlineMusicPlayer / mkPlayer）契约补齐的后端，提供完整的搜索 / 播放 /
封面 / 歌词 / 歌单 / 用户歌单能力，并支持「超级搜索」（多源聚合）与「播放源自动回退」。
本后端不含任何漏洞注入，仅做功能实现。

## 目录结构

```
player/
├── api.php              # 后端主入口（正式部署用，PHP）
├── config.php           # 配置：数据目录、源注册表
├── sources.php          # 多源适配器：LocalSource + 真实源骨架
├── index.html           # 前端（官方仓库原样）
├── js/ css/ plugins/    # 前端资源
├── audio/               # 生成的可播放示例音频（t1.wav ... t6.wav）
├── images/covers/       # 生成的封面（c1001.png ... c1006.png）
├── data/
│   ├── songs.json       # 歌曲数据集（含各源外链桶）
│   ├── playlists.json   # 歌单数据
│   ├── users.json       # 用户歌单数据
│   └── lyrics/          # 歌词文本
└── tools/
    ├── gen_assets.py    # 离线素材生成器（生成 audio/covers/data）
    ├── serve.py         # 无 PHP 时的本地预览服务器（等价后端）
    └── contract_test.py # 后端契约自测
```

## 运行方式

### 方式 A：正式部署（PHP）
把 `player/` 整个目录丢进支持 PHP 的 Web 服务根目录（如 nginx + php-fpm），
前端默认请求相对路径 `api.php`，无需改任何前端代码。
数据由 `tools/gen_assets.py` 生成（已生成，可直接用）。

### 方式 B：本地预览（无 PHP）
```bash
python tools/serve.py
# 然后浏览器打开前端 index.html，其 api.php 请求改为指向
# http://127.0.0.1:8000/api.php
# （serve.py 与 api.php 契约完全一致，仅用于预览/自测）
```

## API 契约

所有请求走 `GET`，前端用 JSONP 调用，后端同时支持 `callback=` 包裹。

| types     | 参数                              | 返回形状 |
|-----------|-----------------------------------|----------|
| `search`  | `name` `source` `count` `pages`   | 数组：`{id,name,artist:[],album,source,url_id,pic_id,lyric_id}` |
| `url`     | `id` `source`                     | `{url:"..."}`（空 → 触发源回退） |
| `pic`     | `id`（形如 `c1001`）              | `{url:"images/covers/c1001.png"}` |
| `lyric`   | `id`（歌曲数字 id）               | `{lyric:"..."}` |
| `playlist`| `id`                              | `{playlist:{name,coverImgUrl,creator:{nickname,avatarUrl},tracks:[...]}}` |
| `userlist`| `uid`                             | `{code, playlist:[...]}` |
| `deleteplaylist`| `id`（仅限 `pl_` 前缀的本地歌单） | `{code:200,msg:"deleted",id:"pl_xxx"}` / `{code:403}`（非法 id）/ `{code:404}`（不存在） |

### 超级搜索
`types=search&source=all`：后端依次用 `netease / tencent / kugou` 搜索，
合并结果并按「歌名+歌手+源」去重。前端可据此实现「一次搜全部平台」。

### 播放源自动回退（解决「搜得到但播不了」）
`types=url&id=XXX&source=netease`：若当前源返回空外链（死链），
后端自动尝试其余源的同 id，返回第一个可用外链——前端无感换源。
（素材中 `1006` 号的 `netease` 桶故意为空，用来演示回退生效。）

### 删除本地歌单（前端按钮 + 后端接口）
- 前端「播放列表」页中，鼠标悬停 **本地歌单**（即 `musicList.js` 里 `id` 以 `pl_` 开头的自定义歌单）右上角会出现 `×` 删除按钮。
- 点击后弹确认框 → 调 `types=deleteplaylist&id=pl_xxx` → 后端从 `data/playlists.json` 永久移除该歌单并写回磁盘，前端同步从列表移除。
- 安全限制：接口只接受 `pl_` 前缀的本地歌单 id，拒绝删除系统列表（搜索结果 / 正在播放 / 播放历史）与远程歌单，非法 id 返回 `{code:403}`。
- 若某 `pl_` 歌单在服务端已不存在，`playlist` 接口返回 `{playlist:{deleted:true}}`，前端自动隐藏该项（避免刷新后残留）。

## 扩展点

### 1. 真实平台源（搜索/播放/封面/歌词/歌单）
后端通过 **Meting API** 接入网易云 / QQ / 酷狗，路径：
- `api.php` 路由 → `sources.php` 中的 `MetingSource` 子类 → `clients.php` 的 `MetingClient`
- 默认 base URL：`https://api.i-meto.com/meting/api`（沙盒验证可用）
- **切换镜像 / 自部署**：在 `config.php` 里改 `METING_API_URL` 常量（也支持环境变量 `METING_API_URL` 在 `serve.py` 模式下生效）

支持的 Meting 操作：`search / song / playlist / url / pic / lrc`，全部走 GET。

### 2. 网易云 UID 同步我的歌单
前端「我的歌单 [点击同步]」要求输入网易云 UID。后端走 **网易云官方公开端点**
`https://music.163.com/api/user/playlist?uid=<UID>`（无需加密签名），
由 `NeteaseClient`（`clients.php`）实现，自动把网易云原始数据结构归一化成前端期望的 `{code, playlist:[{creator,id,name,coverImgUrl}]}`。

### 3. 加新平台源
在 `sources.php` 里写一个新类继承 `MetingSource`，覆盖构造函数里的 `server` 名（如 `kugou`/`baidu`/`ytmusic`），再到 `api.php` 的 `resolveRemoteSource()` 注册，并在 `config.php` 的 `$SOURCES` 里加上对应名字。

### 4. 离线兜底
任何真实源返回空 / 失败时，自动降级到 `LocalSource`（`data/songs.json` 等预生成素材），保证 6 个接口永远可用。

### 5. 重新生成离线素材
```bash
python tools/gen_assets.py
```

## 已知限制（来自公共服务）
- **Meting 是公共服务**（`api.i-meto.com` 等），有限流策略：首次访问 auth URL 可能 404（防滥用），后端自动 sleep 后重试；如果持续失败，**生产环境建议自部署 Meting API**（参考 `metowolf/Meting-API` / `xizeyoupan/Meting-API` 项目）并改 `METING_API_URL`。
- **网易云 UID 接口**只返回**公开**用户歌单（用户设为隐私的拉不到）。
- **QQ / 酷狗搜索**：单源搜索（`source=tencent` / `source=kugou`）若所选源返回空，后端自动 fallback 到网易云真实源 + 本地源，保证「搜得到歌」；具体直连效果取决于你配置的 Meting 镜像。
