<?php
/**
 * 音乐播放器后端 - 配置文件
 * ------------------------------------------------------------------
 * 按前端契约（MKOnlineMusicPlayer / mkPlayer）补齐的 api.php 后端配置。
 * 本后端只提供功能：搜索 / 播放外链 / 封面 / 歌词 / 歌单 / 用户歌单，
 * 并支持"超级搜索"（多源聚合）与"播放源自动回退"。不含任何漏洞注入。
 *
 * 部署：把 player/ 整个目录丢进支持 PHP 的 Web 服务根目录即可。
 */

// 数据目录（由 tools/gen_assets.py 生成：data/*.json, audio/*.wav, images/covers/*.png）
define('ROOT_DIR',   __DIR__);
define('DATA_DIR',   __DIR__ . '/data');
define('AUDIO_DIR',  __DIR__ . '/audio');
define('IMG_DIR',    __DIR__ . '/images/covers');
define('LYRIC_DIR',  __DIR__ . '/data/lyrics');

// 调试开关（true 时把 PHP 错误输出到响应，便于本地排查；生产可关）
define('DEBUG', false);

/**
 * 源注册表
 * - $SOURCES 的顺序即"超级搜索"聚合时各源的尝试顺序
 * - $DEFAULT_SRC 为单源搜索缺省使用的源
 * - $LOCAL_ONLY = true 时强制只用本地离线源（断网环境也能跑）
 */
$SOURCES     = ['netease', 'tencent', 'kugou'];
$DEFAULT_SRC = 'netease';
$LOCAL_ONLY  = false;

/**
 * Meting API base URL
 * 真实平台源（搜索/播放/封面/歌词/歌单）通过 Meting API 接入，
 * 默认走公开镜像 api.i-meto.com（沙盒验证可用）。
 * 切换镜像或自部署：改这个常量即可。
 * 公开 Meting 镜像示例：
 *   https://api.i-meto.com/meting/api
 *   https://meting.mikus.ink/api
 *   https://metoapi.kentxxj.com/api
 * 自部署参考：https://github.com/metowolf/Meting-API
 */
define('METING_API_URL', getenv('METING_API_URL') ?: 'https://api.i-meto.com/meting/api');

/**
 * NeteaseClient 公开端点 base URL
 * 网易云 UID → 用户歌单列表（无需加密签名）
 */
define('NETEASE_API_URL', 'https://music.163.com');
