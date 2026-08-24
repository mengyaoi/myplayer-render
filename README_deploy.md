# 部署指南 — Render (Docker)

本项目是一个完整的 mkPlayer 音乐播放器 Web App：
浏览器 → index.html → serve.py（工具/serve.py，纯 Python 标准库实现，等价于 api.php）→ Meting / 本地数据。

Render 通过 Dockerfile 构建并运行，监听平台注入的 `PORT` 环境变量。

---

## 一、本地 Docker 测试（部署前必做）

> 需要本机已安装 Docker Desktop（Windows/Mac/Linux 均可，容器内是 Linux，能真实复现 Render 行为）。

```bash
cd player
docker build -t workbuddy-music-api .
docker run -d --name mk -p 10000:10000 -e PORT=10000 workbuddy-music-api
# 等 2~3 秒冷启动
curl -i http://localhost:10000/                 # 应返回 200 + HTML（首页）
curl "http://localhost:10000/api.php?types=playlist&id=pl_001&source=netease"   # 应返回 JSON 歌单
curl "http://localhost:10000/api.php?types=search&source=netease&name=test&count=3"  # JSON 数组
docker logs mk        # 看启动日志
docker rm -f mk
```

健康检查端点就是 `/`（返回 index.html，200）。

---

## 二、推送到 GitHub

在 GitHub 新建仓库（建议名 `workbuddy-music-api`，Public/Private 均可），然后本地：

```bash
cd player
git init
git add .
git commit -m "first deploy: mkplayer + serve.py on render docker"
git branch -M main
git remote add origin https://github.com/你的账号/workbuddy-music-api.git
git push -u origin main
```

> `.gitignore` / `.dockerignore` 已排除测试脚本（`tools/*_test.py`、`_inline_test.py` 等）和日志（`serve_debug.log`），不会污染仓库。

---

## 三、Render 部署（网页点击）

1. 打开 https://dashboard.render.com → **New +** → **Web Service**
2. 连接你的 GitHub，选中 `workbuddy-music-api` 仓库
3. **Runtime** 选 **Docker**（仓库根目录的 `Dockerfile` 会被自动识别）
4. **Plan** 选 **Free**
5. **Branch** 选 `main`
6. 环境变量：Render 会自动注入 `PORT`（无需手动填，render.yaml 里已声明 `PORT=10000` 作为默认值，平台部署时会用真实端口覆盖）
7. **Health Check Path** 填 `/`（render.yaml 已配置）
8. 点 **Create Web Service**
9. 等待构建（首次拉 python:3.12-slim 镜像约 1~2 分钟）
10. 成功后得到公网地址：`https://workbuddy-music-api.onrender.com`

> Render 免费版 15 分钟无请求会休眠，首次访问需冷启动数秒；本项目无状态、不存数据，休眠不影响功能。

---

## 四、部署后验证

```bash
BASE=https://workbuddy-music-api.onrender.com
curl "$BASE/"                                  # 200 HTML
curl "$BASE/api.php?types=playlist&id=pl_001&source=netease"
curl "$BASE/api.php?types=search&source=netease&name=test&count=3"
```

---

## 五、对接真实平台源（Meting）

默认 `serve.py` 的 `METING_API_URL` 指向 `https://meting.mikus.ink`。
要换成你自己的镜像（如自部署的 Meting-API / Apply.Build / Render 另一个服务），二选一：

- 在 Render 该服务的 **Environment** 里加环境变量 `METING_API_URL=https://你的镜像地址`
- 或改 `tools/serve.py:22` 的默认值

> 注意：新版 Meting-API（Bun 版）对 `url`/`pic`/`lrc` 类型需要 HMAC 鉴权（`auth` 参数），本项目当前调用未带 `auth`，
> 仅 `search`/`song`/`playlist` 这类无需鉴权的类型可用。若要完整支持，需在 `serve.py` 的 `_meting_get` 里补齐 token 计算。

---

## 六、端口机制说明（重要）

- `serve.py` 读取 `os.environ.get("PORT", "8010")`（已确认第 546 行）
- `serve.py` 绑定 `0.0.0.0`（已修复，原为 `127.0.0.1` 会导致 Render 外部无法访问）
- Render 平台注入真实 `PORT`，覆盖 Dockerfile 里的 `ENV PORT=8010`
- `render.yaml` 的 `envVars PORT=10000` 仅作默认值，平台部署以注入为准
