<?php
/**
 * 音乐播放器后端 - 多源适配器
 * ------------------------------------------------------------------
 * 设计：所有源实现同一组方法（search / getUrl / getPic / getLyric /
 * getPlaylist / getUserlist）。api.php 只认接口，不关心背后是离线素材
 * 还是真实音乐平台 API。要加新平台，照着 NeteaseSource 的骨架写一个类，
 * 在 api.php 的源分发里注册即可。
 *
 * 当前提供：
 *   - LocalSource   : 本地离线源（用 tools/gen_assets.py 生成的素材，永远可用）
 *   - NeteaseSource : 网易云接入骨架（真实 API 接入点，默认返回 null 降级到 local）
 *   - TencentSource : 腾讯接入骨架
 *   - KugouSource   : 酷狗接入骨架
 */

/* ============ 本地离线源 ============ */
class LocalSource {
    private $songs = [];
    private $playlists = [];
    private $users = [];

    public function __construct() {
        $this->songs     = json_decode(file_get_contents(DATA_DIR . '/songs.json'), true)['songs'];
        $this->playlists = json_decode(file_get_contents(DATA_DIR . '/playlists.json'), true)['playlists'];
        $this->users     = json_decode(file_get_contents(DATA_DIR . '/users.json'), true);
    }

    /** 把内部歌曲结构映射成前端 search 期望的形状 */
    private function mapSearchRow($song, $source) {
        $buckets = $song['sources'];
        $src = $buckets[$source] ?? reset($buckets);
        return [
            'id'        => $song['id'],
            'name'      => $song['name'],
            'artist'    => $song['artist'],            // 数组
            'album'     => $song['album'],
            'source'    => $source,
            'url_id'    => $src['url_id'],
            'pic_id'    => $src['pic_id'],
            'lyric_id'  => $src['lyric_id'],
        ];
    }

    private function findSong($id) {
        foreach ($this->songs as $s) if ($s['id'] === $id) return $s;
        return null;
    }

    /**
     * 搜索（子串匹配，安全无注入）
     * @param string $name   关键词
     * @param string $source 目标源（决定返回哪个源桶的 id 映射）
     */
    public function search($name, $source) {
        $out = [];
        foreach ($this->songs as $s) {
            if (stripos($s['name'], $name) !== false ||
                stripos(json_encode($s['artist'], JSON_UNESCAPED_UNICODE), $name) !== false) {
                $out[] = $this->mapSearchRow($s, $source);
            }
        }
        return $out;
    }

    /** 取播放外链；空串表示"该源死链"，由 api.php 触发 fallback */
    public function getUrl($id, $source) {
        $s = $this->findSong($id);
        if (!$s) return '';
        $b = $s['sources'][$source] ?? reset($s['sources']);
        return $b['url'] ?? '';
    }

    /** 封面：id 形如 c1001，对应 images/covers/c1001.png */
    public function getPic($id) {
        return 'images/covers/' . $id . '.png';
    }

    /** 歌词：id 为歌曲 id，对应 data/lyrics/{id}.txt */
    public function getLyric($id) {
        $p = LYRIC_DIR . '/' . $id . '.txt';
        return file_exists($p) ? file_get_contents($p) : '';
    }

    public function getPlaylist($id) {
        foreach ($this->playlists as $pl) if ($pl['id'] === $id) return $pl;
        // 本地 id 显式缺失（可能已被删除）：返回 deleted 标记，前端据此移除该歌单
        if ($id && strpos($id, 'pl_') === 0) return ['deleted' => true];
        // 兜底：找不到时返回第一个可用歌单，避免前端 jsonData.playlist 为 null 报错
        return $this->playlists[0] ?? null;
    }

    public function getUserlist($uid) {
        return $this->users[$uid] ?? null;
    }
}

/* ============ 真实平台源（通过 Meting API） ============
 * 接入说明：
 *   所有方法签名与 LocalSource 一致。内部用 MetingClient（clients.php）调
 *   Meting API（默认 meting.mikus.ink，配置见 config.php 的 METING_API_URL）。
 *   返回结构严格归一化成 LocalSource 同形状，便于 api.php 路由分发。
 */
class MetingSource {
    protected $server;        // 'netease' | 'tencent' | 'kugou'
    protected $client;

    public function __construct($server, $client) {
        $this->server = $server;
        $this->client = $client;
    }

    /** Meting 的 author 字符串拆成数组（支持 / 、 、 、 & 分隔） */
    protected function splitArtists($author) {
        if (!$author) return [''];
        $parts = preg_split('/[\/、,&\x{7C}]\s*/u', $author);
        $parts = array_values(array_filter(array_map('trim', $parts), function($x){ return $x !== ''; }));
        return $parts ?: [trim($author)];
    }

    /** Meting list item → 前端 search 行 */
    protected function toSearchRow($item) {
        $id = $this->extractId($item);
        return [
            'id'       => $id,
            'name'     => $item['title']  ?? '',
            'artist'   => $this->splitArtists($item['author'] ?? ''),
            'album'    => $item['pic']    ?? '',     // Meting 不直接给专辑，封面图作为占位
            'source'   => $this->server,
            'url_id'   => $id,
            'pic_id'   => $id,
            'lyric_id' => $id,
        ];
    }

    /** Meting list item → 前端 playlist track 行 */
    protected function toPlaylistTrack($item) {
        $id = $this->extractId($item);
        $ar = $this->splitArtists($item['author'] ?? '');
        $picUrl = $this->client->resolvePic($this->server, $id);
        return [
            'id'   => $id,
            'name' => $item['title'] ?? '',
            'ar'   => array_map(function($n){ return ['name' => $n]; }, $ar),
            'al'   => [
                'name'    => $item['title'] ?? '',
                'picUrl'  => $picUrl,
            ],
        ];
    }

    /** 从 Meting item 提取原始歌曲 id（Meting 的 url/lrc 字段形如 ...&id=XXX） */
    protected function extractId($item) {
        foreach (['url','lrc','pic'] as $k) {
            if (!empty($item[$k]) && preg_match('/[?&]id=([^&]+)/', $item[$k], $m)) {
                return $m[1];
            }
        }
        return '';
    }

    public function search($name, $source) {
        $rows = $this->client->getList($this->server, 'search', $name, 30);
        if (!$rows) return null;
        return array_map([$this, 'toSearchRow'], $rows);
    }

    public function getUrl($id, $source) {
        return $this->client->resolveUrl($this->server, $id);
    }

    public function getPic($id) {
        return $this->client->resolvePic($this->server, $id);
    }

    public function getLyric($id) {
        return $this->client->resolveLrc($this->server, $id);
    }

    public function getPlaylist($id) {
        $rows = $this->client->getList($this->server, 'playlist', $id, 50);
        if (!$rows) return null;
        return [
            'name'         => '歌单 ' . $id,
            'coverImgUrl'  => $rows ? ($rows[0]['pic'] ?? '') : '',
            'creator'      => ['nickname' => '网络', 'avatarUrl' => ''],
            'tracks'       => array_map([$this, 'toPlaylistTrack'], $rows),
        ];
    }

    public function getUserlist($uid) {
        return null;   // 网易云按 UID 拉用户歌单走 NeteaseClient，不在 Meting 这层
    }
}

class NeteaseSource extends MetingSource {
    public function __construct() {
        parent::__construct('netease', new MetingClient(defined('METING_API_URL') ? METING_API_URL : 'https://meting.mikus.ink'));
    }
}
class TencentSource extends MetingSource {
    public function __construct() {
        parent::__construct('tencent', new MetingClient(defined('METING_API_URL') ? METING_API_URL : 'https://meting.mikus.ink'));
    }
    /** Meting 当前不支持 tencent 搜索（返回 400），降级返回空 */
    public function search($name, $source) { return []; }
}
class KugouSource extends MetingSource {
    public function __construct() {
        parent::__construct('kugou', new MetingClient(defined('METING_API_URL') ? METING_API_URL : 'https://meting.mikus.ink'));
    }
    /** Meting 对 kugou 同样未提供稳定 search；返回空，前端会 fallback 到其他源 */
    public function search($name, $source) { return []; }
}

/**
 * NeteaseUserSource - 网易云按 UID 拉用户公开歌单列表
 * 走网易云官方公开端点 /api/user/playlist?uid=X（无需加密签名）
 * 前端 ajax.userlist 期望：{code, playlist:[{creator, id, name, coverImgUrl}, ...]}
 */
class NeteaseUserSource {
    private $nc;

    public function __construct() {
        $this->nc = new NeteaseClient();
    }

    public function search($name, $source)   { return null; }
    public function getUrl($id, $source)     { return ''; }
    public function getPic($id)              { return ''; }
    public function getLyric($id)            { return ''; }
    public function getPlaylist($id)         { return null; }

    /**
     * 按 UID 拉用户歌单列表
     */
    public function getUserlist($uid) {
        $pls = $this->nc->getUserPlaylists($uid, 50);
        if (!$pls) return null;
        $mapped = [];
        foreach ($pls as $p) {
            if (!isset($p['id'])) continue;
            $mapped[] = [
                'id'          => (string)$p['id'],
                'name'        => $p['name'] ?? '未命名歌单',
                'coverImgUrl' => $p['coverImgUrl'] ?? '',
                'creator'     => [
                    'nickname'  => $p['creator']['nickname'] ?? '未知',
                    'avatarUrl' => $p['creator']['avatarUrl'] ?? '',
                ],
            ];
        }
        if (!$mapped) return null;
        return [
            'code'     => 200,
            'playlist' => $mapped,
        ];
    }
}
