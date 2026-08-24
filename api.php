<?php
/**
 * 音乐播放器后端 - 主入口 api.php
 * ------------------------------------------------------------------
 * 完全按前端（MKOnlineMusicPlayer / mkPlayer）契约实现：
 *   types=search    -> 搜索，返回歌曲数组
 *   types=url       -> 取播放外链（带源自动回退）
 *   types=pic       -> 取封面地址
 *   types=lyric     -> 取歌词
 *   types=playlist  -> 取歌单详情
 *   types=userlist  -> 取用户歌单列表（按网易云 UID）
 *
 * 扩展能力：
 *   - 真实平台接入：search/url/pic/lyric/playlist 走真实源（netease/tencent/kugou）
 *   - 超级搜索：types=search&source=all 时聚合所有真实源 + 本地源
 *   - 源回退：types=url 某源外链为空时，自动尝试其它源同 id
 *   - 本地兜底：真实源失败时降级到 LocalSource（永远可用）
 *   - 支持 JSONP（callback 白名单过滤，防 XSS）
 *
 * 部署：与前端 index.html 同目录（默认请求 api.php 相对路径）。
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/clients.php';
require_once __DIR__ . '/sources.php';

if (DEBUG) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(0);
}

$local = new LocalSource();

/* ---------- 参数解析 ---------- */
$types    = isset($_GET['types'])   ? trim($_GET['types'])   : '';
$source   = isset($_GET['source'])  ? trim($_GET['source'])  : $DEFAULT_SRC;
$name     = isset($_GET['name'])    ? trim($_GET['name'])    : '';
$id       = isset($_GET['id'])      ? trim($_GET['id'])      : (isset($_POST['id']) ? trim($_POST['id']) : '');
$uid      = isset($_GET['uid'])     ? trim($_GET['uid'])     : '';
$count    = isset($_GET['count'])   ? max(1, (int)$_GET['count'])   : 10;
$pages    = isset($_GET['pages'])   ? max(1, (int)$_GET['pages'])   : 1;
$callback = isset($_GET['callback'])? trim($_GET['callback']) : '';

/* ---------- 真实源工厂 ---------- */
function remoteSource($name) {
    switch ($name) {
        case 'netease': return new NeteaseSource();
        case 'tencent': return new TencentSource();
        case 'kugou':   return new KugouSource();
        default:        return null;
    }
}
function remoteSources() {
    return [
        'netease' => new NeteaseSource(),
        'tencent' => new TencentSource(),
        'kugou'   => new KugouSource(),
    ];
}

/* ---------- 分页辅助 ---------- */
function paginate($rows, $count, $pages) {
    $start = ($pages - 1) * $count;
    return array_slice((array)$rows, $start, $count);
}

/* ---------- 路由 ---------- */
$result = null;

switch ($types) {

    case 'search':
        if ($source === 'all') {
            // 超级搜索：聚合所有真实源 + local，按 (歌名|歌手|源) 去重
            $merged = [];
            $seen   = [];
            foreach (remoteSources() as $srcName => $remote) {
                $rows = $remote->search($name, $srcName);
                if (!is_array($rows)) $rows = $local->search($name, $srcName);
                foreach ($rows as $r) {
                    $key = ($r['name'] ?? '') . '|' . implode(',', (array)($r['artist'] ?? [])) . '|' . $srcName;
                    if (!isset($seen[$key])) { $seen[$key] = 1; $merged[] = $r; }
                }
            }
            // 本地也参与一次（可能包含真实源没收录的老歌）
            foreach ($SOURCES as $srcName) {
                $rows = $local->search($name, $srcName);
                foreach ($rows as $r) {
                    $key = $r['name'] . '|' . implode(',', $r['artist']) . '|' . $srcName;
                    if (!isset($seen[$key])) { $seen[$key] = 1; $merged[] = $r; }
                }
            }
            $result = paginate($merged, $count, $pages);
        } else {
            // 单源：先真实源；空时 fallback 到网易云 + 本地（QQ/酷狗镜像当前只支持网易云）
            $rows = null;
            $remote = remoteSource($source);
            if ($remote) {
                $rows = $remote->search($name, $source);
            }
            if (!is_array($rows) || empty($rows)) {
                $ne = new NeteaseSource();
                $fb = $ne->search($name, 'netease');
                if (is_array($fb) && !empty($fb)) {
                    $rows = $fb;
                } else {
                    $rows = $local->search($name, 'netease');
                }
            }
            $result = paginate($rows, $count, $pages);
        }
        break;

    case 'url':
        // 播放外链：先真实源解析；空则按源顺序回退到其它源（含 local）
        $url = '';
        $remote = remoteSource($source);
        if ($remote) {
            $url = $remote->getUrl($id, $source);
        }
        if ($url === '' && $source !== 'all') {
            // 真实源死链/未匹配：依次试本地 + 其他真实源
            foreach ($SOURCES as $src) {
                if ($src === $source) continue;
                $u = $local->getUrl($id, $src);
                if ($u !== '') { $url = $u; break; }
            }
            if ($url === '') {
                foreach (remoteSources() as $srcName => $rem) {
                    if ($srcName === $source) continue;
                    $u = $rem->getUrl($id, $srcName);
                    if ($u !== '') { $url = $u; break; }
                }
            }
        }
        $result = ['url' => $url];
        break;

    case 'pic':
        // 优先 local 静态封面（id 形如 c1001），否则走真实源
        if (preg_match('/^c\d+$/', $id)) {
            $result = ['url' => 'images/covers/' . $id . '.png'];
        } else {
            $remote = remoteSource($source);
            $picUrl = $remote ? $remote->getPic($id) : '';
            $result = ['url' => $picUrl];
        }
        break;

    case 'lyric':
        // 优先 local（数字 id 是预生成数据），否则真实源拉 LRC
        if (preg_match('/^\d+$/', $id) && strlen($id) <= 4) {
            // 本地歌曲 id 范围 1001-1006
            $p = LYRIC_DIR . '/' . $id . '.txt';
            if (file_exists($p)) {
                $result = ['lyric' => file_get_contents($p)];
                break;
            }
        }
        $remote = remoteSource($source);
        $lrc = $remote ? $remote->getLyric($id) : '';
        $result = ['lyric' => $lrc];
        break;

    case 'playlist':
        // 优先真实源拉歌单详情；本地兜底
        $pl = null;
        $remote = remoteSource($source);
        if ($remote) $pl = $remote->getPlaylist($id);
        if (!$pl) $pl = $local->getPlaylist($id);
        // 本地歌单已被删除：返回 deleted 标记，前端据此移除该歌单项
        if ($pl && isset($pl['deleted'])) {
            $result = ['playlist' => ['deleted' => true]];
            break;
        }
        // 终极兜底：确保返回合法 playlist 对象
        if (!$pl) {
            $pl = [
                'name'       => '',
                'coverImgUrl'=> '',
                'creator'    => ['nickname' => '', 'avatarUrl' => ''],
                'tracks'     => []
            ];
        }
        $result = ['playlist' => $pl];
        break;

    case 'userlist':
        // 按网易云 UID 拉用户公开歌单（走 NeteaseClient 公开端点）
        $nc = new NeteaseUserSource();
        $ul = $nc->getUserlist($uid);
        $result = $ul ?: ['code' => 404, 'playlist' => []];
        break;

    case 'deleteplaylist':
        // 删除本地歌单（仅允许 pl_ 前缀的本地歌单，禁止操作系统列表/远程歌单）
        if (!preg_match('/^pl_[A-Za-z0-9_]+$/', $id)) {
            $result = ['code' => 403, 'msg' => 'forbidden: only local pl_ playlists can be deleted'];
            break;
        }
        $file = DATA_DIR . '/playlists.json';
        if (!is_file($file)) {
            $result = ['code' => 404, 'msg' => 'not found'];
            break;
        }
        $data = json_decode(file_get_contents($file), true);
        if (!isset($data['playlists']) || !is_array($data['playlists'])) {
            $result = ['code' => 500, 'msg' => 'bad data'];
            break;
        }
        $before = count($data['playlists']);
        $data['playlists'] = array_values(array_filter($data['playlists'], function($p) use ($id) {
            return ($p['id'] ?? '') !== $id;
        }));
        if (count($data['playlists']) === $before) {
            $result = ['code' => 404, 'msg' => 'not found'];
            break;
        }
        file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        $result = ['code' => 200, 'msg' => 'deleted', 'id' => $id];
        break;

    default:
        $result = ['error' => 'unknown types: ' . $types];
}

/* ---------- 输出（JSONP，callback 白名单过滤） ---------- */
$json = json_encode($result, JSON_UNESCAPED_UNICODE);
if ($callback !== '' && preg_match('/^[A-Za-z_$][A-Za-z0-9_$]*$/', $callback)) {
    header('Content-Type: application/javascript; charset=utf-8');
    echo $callback . '(' . $json . ')';
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo $json;
}