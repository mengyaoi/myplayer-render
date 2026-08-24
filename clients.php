<?php
/**
 * MetingClient - 通用 Meting API HTTP 客户端
 * ------------------------------------------------------------------
 * 用途：调 Meting API（公开部署 meting.mikus.ink 之类）获取真实平台数据
 * 覆盖：netease / tencent / kugou 的 search / song / playlist / url / pic / lrc
 *
 * baseUrl 可在 config.php 里改，默认 meting.mikus.ink
 */
class MetingClient {
    private $baseUrl;
    private $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

    public function __construct($baseUrl) {
        $this->baseUrl = rtrim($baseUrl, '/');
    }

    /**
     * 调用 Meting list 类接口（search/song/playlist/album/artist）
     * 返回 [{title,author,pic,url,lrc}, ...]
     */
    public function getList($server, $type, $id, $limit = 30) {
        $url = $this->baseUrl . '/api?server=' . urlencode($server)
             . '&type=' . urlencode($type)
             . '&id=' . urlencode($id)
             . '&limit=' . (int)$limit;
        $body = $this->httpGet($url);
        if ($body === '' || $body[0] !== '[') return [];
        $arr = json_decode($body, true);
        return is_array($arr) ? $arr : [];
    }

    /**
     * 解析 Meting 的 url 代理（302 重定向）拿真实 MP3 外链
     */
    public function resolveUrl($server, $id) {
        if (!function_exists('curl_init')) return '';
        $url = $this->baseUrl . '/api?server=' . urlencode($server) . '&type=url&id=' . urlencode($id);
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 5,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_USERAGENT      => $this->ua,
            CURLOPT_NOBODY         => true,
        ]);
        curl_exec($ch);
        $final = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($code >= 200 && $code < 400 && $final && $final !== $url) ? $final : '';
    }

    /**
     * 解析 Meting 的 pic 代理拿真实封面 URL
     */
    public function resolvePic($server, $id) {
        if (!function_exists('curl_init')) return '';
        $url = $this->baseUrl . '/api?server=' . urlencode($server) . '&type=pic&id=' . urlencode($id);
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 5,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_NOBODY         => true,
        ]);
        curl_exec($ch);
        $final = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        curl_close($ch);
        return $final ?: '';
    }

    /**
     * 拿 LRC 歌词（直读文本）
     */
    public function resolveLrc($server, $id) {
        $url = $this->baseUrl . '/api?server=' . urlencode($server) . '&type=lrc&id=' . urlencode($id);
        return $this->httpGet($url);
    }

    private function httpGet($url) {
        $ctx = stream_context_create([
            'http' => [
                'timeout'       => 15,
                'user_agent'    => $this->ua,
                'ignore_errors' => true,
            ],
        ]);
        $r = @file_get_contents($url, false, $ctx);
        return $r === false ? '' : $r;
    }
}

/**
 * NeteaseClient - 网易云官方公开端点
 * ------------------------------------------------------------------
 * 用途：网易云仍有一些公开端点无需加密签名（user/playlist 等），用于按 UID
 *       拉用户歌单列表。Meting 自身不直接支持该接口。
 * 端点：https://music.163.com/api/user/playlist?uid=X
 */
class NeteaseClient {
    private $base = 'https://music.163.com';
    private $ua   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

    /**
     * 拉指定 UID 的用户公开歌单列表
     * 返回 [{id, name, coverImgUrl, creator:{nickname, avatarUrl}, playCount, trackCount}, ...]
     */
    public function getUserPlaylists($uid, $limit = 30) {
        $url = $this->base . '/api/user/playlist?uid=' . urlencode((string)$uid)
             . '&limit=' . (int)$limit;
        $body = $this->httpGet($url);
        if ($body === '') return [];
        $obj = json_decode($body, true);
        if (!is_array($obj) || !isset($obj['playlist']) || !is_array($obj['playlist'])) return [];
        return $obj['playlist'];
    }

    private function httpGet($url) {
        $ctx = stream_context_create([
            'http' => [
                'timeout'       => 12,
                'user_agent'    => $this->ua,
                'ignore_errors' => true,
                'header'        => "Referer: https://music.163.com/\r\n",
            ],
        ]);
        $r = @file_get_contents($url, false, $ctx);
        return $r === false ? '' : $r;
    }
}