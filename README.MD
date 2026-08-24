MYOnlineMusicPlayer
========
MYOnlineMusicPlayer 是一款全屏的音乐播放器 UI 框架，前端界面参照 QQ 音乐网页版进行布局，采用响应式设计，在 PC 端和手机端均能带来原生 app 般的使用体验。

本项目已接入完整后端（PHP 版 `api.php` + 无 PHP 环境下的 Python 等价后端 `tools/serve.py`），支持音乐搜索、播放、歌词同步、个人歌单同步、网易云 UID 歌单导入，并内置本地离线播放源作为兜底。

> 本项目仅为学习前端的练手之作，请勿用作商业用途，请勿利用本项目搭建盗版音乐网站，否则后果自负！

### 界面欣赏
-----
![主界面(电脑端)](https://user-images.githubusercontent.com/16880885/30487091-f7b45980-9a64-11e7-9588-8b6b87ac6763.jpg)

![播放列表界面(电脑端)](https://user-images.githubusercontent.com/16880885/30487141-1f8ad416-9a65-11e7-960c-a102c47a3d0e.jpg)

![歌曲搜索与播放](https://user-images.githubusercontent.com/16880885/30487344-c93a0306-9a65-11e7-92f3-552072b1dbce.jpg)


### 本地运行
-----
- **有 PHP 环境**：把本项目放到任意支持 PHP 的 Web 服务器（如 Apache/Nginx）根目录，直接访问 `index.html` 即可。
- **无 PHP 环境（纯静态预览）**：用 Python 启动内置后端：
  ```bash
  python tools/serve.py
  # 默认监听 0.0.0.0:8010，浏览器打开 http://127.0.0.1:8010/
  # 可通过环境变量 PORT 覆盖端口（如 Render 等平台自动注入）
  ```
- 搜索 / 播放 / 歌词默认走 `config.php` 中的 `METING_API_URL`（公开 Meting 镜像），网易云 UID 歌单同步走网易云公开端点，均无需额外配置。

### 部署到 Render（Docker）
-----
见 `README_deploy.md`，使用 `player/` 根目录下的 `Dockerfile` 与 `render.yaml`，Web Service（Docker 模式，Free 计划）一键部署。

### 后端实现说明
-----
见 `README_backend.md`，包含 API 契约、源注册表、本地离线源、Meting 接入、防目录穿越、QQ/酷狗搜索回退、删除歌单等细节。


### 开发文档[待完善]
-----
#### 播放列表DIY教程
本播放器支持后台自定义播放列表。打开 `js/musicList.js`，按照里面的说明对应修改即可。

#### 播放器DIY教程
除了自定义播放列表，本播放器还支持一些 DIY 设定，比如修改 api.php 文件的默认路径、修改搜索框的默认搜索内容等。具体请打开 `js/player.js` 查看

#### rem 变量表
程序中的rem数组用于存储全局变量，具体的成员(部分)及作用见下表：

| 变量名    | 用途   |
| ----------- | ----------- |
| rem.audio | audio dom |
| rem.playlist | 当前正在播放的播放列表编号 |
| rem.playid | 正在播放的这首歌在播放列表中的编号 |
| rem.dislist | 当前显示的列表的列表编号 |
| rem.loadPage | 搜索功能已加载的页码 |
| rem.wd | 当前的搜索词 |
| rem.source | 当前选定的音乐源 |
| rem.uid | 当前已同步的用户的网易云 ID |
| rem.uname | 已登录用户的用户名 |
| rem.sheetList | 歌单容器操作对象 |
| rem.mainList | 歌曲列表容器操作对象 |
| rem.isMobile | 是否是手机浏览 |

### 致谢
-----
#### 特别感谢 `网易云音乐`、`QQ音乐`、`虾米`、`酷狗`、`百度音乐`

#### 采用的开源模块
- **Jquery**：js主流开发框架 [http://jquery.com/](http://jquery.com/)
- **Meting**：一个高效的多平台音乐 API 框架 [https://github.com/metowolf/Meting](https://github.com/metowolf/Meting)
- **layer**：一款强大的web弹层组件 [http://layer.layui.com/](http://layer.layui.com/)
- **mCustomScrollbar**：jQuery自定义滚动条样式插件 [http://manos.malihu.gr/jquery-custom-content-scroller/](http://manos.malihu.gr/jquery-custom-content-scroller/)
- **background-blur**：跨浏览器磨砂效果背景图片模糊特效插件 [https://msurguy.github.io/background-blur/](https://msurguy.github.io/background-blur/)
- **Let's Kill IE6**：消灭IE [http://overtrue.me](http://overtrue.me)

##### 在开发过程中，还参照了很多开源 html 播放器的相关代码，在此一并向他们表示感谢！
