/**************************************************
 * MYOnlinePlayer v2.4
 * Ajax 后台数据交互请求模块
 * 编写：mengkun(https://mkblog.cn)
 * 时间：2018-3-11
 * 2026-09-15 改：搜索/播放/歌词/真实歌单改为前端直连 Meting
 *   (api.i-meto.com)，绕过 Render 服务器出站被限流问题。
 *   本地歌单(pl_xxx)/删除/用户同步仍走 mkPlayer.api 后端。
 *************************************************/

// ===== 前端直连 Meting 配置 =====
// 2026-11-08 换源：api.i-meto.com 的 type=url 端点已彻底失效
//   （带 auth → 404 空体，不带 auth → 401「服务器未知异常」），导致全部歌曲无法播放。
// 现改用 api.qijieya.cn，实测：
//   - type=url 无需任何 auth，直接返回 audio/mpeg 音频流（206 / 支持 Range）
//   - CORS: Access-Control-Allow-Origin: *
//   - 国内直连 0.3s 左右，无需代理
//   - 无效 id 返回 200 + text/html 空体（<audio> 会报错 → 自动跳下一首）
var METING_API = "https://api.qijieya.cn/meting/";

// 从 Meting 返回的代理 URL 中抠出 id（歌曲 id / 图片 id 都在 url 的 id 参数里）
function metingId(u) {
    if(!u) return "";
    var m = ("" + u).match(/[?&]id=([^&]+)/);
    return m ? m[1] : "";
}

// 直接拼出 Meting 端点地址。
// 因为 qijieya 的 url/pic/lrc 端点不需要 auth，只要拿到 id 就能拼，
// 所以缺链接时不必再"按歌名回搜"，直接构造即可。
function metingUrl(server, type, id) {
    if(!id) return "";
    return METING_API + "?server=" + encodeURIComponent(server || "netease")
         + "&type=" + encodeURIComponent(type)
         + "&id=" + encodeURIComponent(id);
}

// 直连 Meting，依赖其 CORS（Access-Control-Allow-Origin: *）
// limit 可选：qijieya 的 search 默认只回 30 条，传 limit 可拿更多（实测 limit=50 正常）
function metingQuery(server, type, id, cb, limit) {
    var d = { server: server, type: type, id: id };
    if(limit) d.limit = limit;
    $.ajax({
        url: METING_API,
        data: d,
        dataType: "json",
        crossDomain: true,
        timeout: 15000,
        success: function(d){ cb(d); },
        error: function(x, t, e){
            console.error("[meting] " + type + " err:", t, e);
            cb(null);
        }
    });
}

// 兜底：按歌名回搜一次，用来补「图片」。
// 为什么只有图片需要兜底：qijieya 的 pic 端点用的是图片 id（如 109951172453712025），
// 与歌曲 id 不是同一套，无法由歌曲 id 直接拼出来；而 url / lrc 都能用歌曲 id 直接拼。
function metingResolveBySearch(music, cb) {
    var kw = (music.name || "").trim();
    if(!kw) { cb(null); return; }
    var servers = [];
    if(music.source) servers.push(music.source);
    if(servers.indexOf("netease") < 0) servers.push("netease");   // 网易云最稳，兜底
    var si = 0;
    (function next(){
        if(si >= servers.length) { cb(null); return; }
        var srv = servers[si++];
        metingQuery(srv, "search", kw, function(arr){
            if(!arr || !arr.length) { next(); return; }
            var hit = null;
            for (var i = 0; i < arr.length; i++) {
                if(metingId(arr[i].url) === String(music.id)) { hit = arr[i]; break; }
            }
            if(!hit) hit = arr[0];   // 同 id 未命中，退而取第一条同名结果
            if(hit && (hit.pic || hit.url)) { hit._src = srv; cb(hit); } else next();
        });
    })();
}

// ajax加载搜索结果
function ajaxSearch() {
    if(rem.wd === ""){
        layer.msg('搜索内容不能为空', {anim:6});
        return false;
    }
    
    var tmpLoading = null;
    if(rem.loadPage == 1) { // 弹出搜索提示
        tmpLoading = layer.msg('搜索中', {icon: 16,shade: 0.01});
    }
    
    // search 一次取 100 条：前端每页 20 条（mkPlayer.loadcount），可支持翻 5 页
    metingQuery(rem.source, "search", rem.wd, function(arr){
        if(tmpLoading) layer.close(tmpLoading);    // 关闭加载中动画
        
        if(!arr || !arr.length) {
            if(rem.loadPage == 1) layer.msg('没有找到相关歌曲', {anim:6});
            return false;
        }
        
        var start = (rem.loadPage - 1) * mkPlayer.loadcount;
        var page = arr.slice(start, start + mkPlayer.loadcount);
        
        if(rem.loadPage == 1) { // 加载第一页，清空列表
            musicList[0].item = [];
            rem.mainList.html('');   // 清空列表中原有的元素
            addListhead();      // 加载列表头
        } else {
            $("#list-foot").remove();     //已经是加载后面的页码了，删除之前的“加载更多”提示
        }
        
        if(page.length === 0) {
            addListbar("nomore");  // 加载完了
            return false;
        }
        
        var no = musicList[0].item.length;
        
        for (var i = 0; i < page.length; i++) {
            no ++;
            var it = page[i];
            var mid = metingId(it.url);
            // qijieya 用 name/artist，i-meto 用 title/author —— 两套都兼容
            var itName   = it.title  || it.name   || "";
            var itAuthor = it.author || it.artist || "";
            var tempItem =  {
                id: mid,
                name: itName,
                artist: itAuthor.split(/[/、,|&]/)[0].trim(),
                album: itAuthor,
                source: rem.source,
                url_id: mid,
                pic_id: metingId(it.pic),
                lyric_id: mid,
                pic: it.pic || null,
                // url / lrc 端点不需要 auth，缺了直接用歌曲 id 拼，不必回搜
                lrc_url: it.lrc || metingUrl(rem.source, "lrc", mid),
                url: it.url || metingUrl(rem.source, "url", mid)
            };
            musicList[0].item.push(tempItem);   // 保存到搜索结果临时列表中
            addItem(no, tempItem.name, tempItem.artist, tempItem.album);  // 在前端显示
        }
        
        rem.dislist = 0;    // 当前显示的是搜索列表
        rem.loadPage ++;    // 已加载的列数+1
        
        dataBox("list");    // 在主界面显示出播放列表
        refreshList();  // 刷新列表，添加正在播放样式
        
        if(no < start + mkPlayer.loadcount) {
            addListbar("nomore");  // 没加载满，说明已经加载完了
        } else {
            addListbar("more");     // 还可以点击加载更多
        }
        
        if(rem.loadPage == 2) listToTop();    // 播放列表滚动到顶部
    }, 100);
}

// 完善获取音乐信息
// 音乐所在列表ID、音乐对应ID、回调函数
function ajaxUrl(music, callback)
{
    // 旧版缓存清理：localStorage 里「正在播放 / 播放历史」可能存着旧镜像
    // （api.i-meto.com 的 auth 链接，现已全部 404）或旧的后端 api.php 链接。
    // 这些链接非空但已失效，若不丢弃会被下面的"已有数据直接回调"放过，导致老歌永远放不出。
    if(music.url && ("" + music.url).indexOf(METING_API) !== 0) {
        music.url = null;
    }

    // 已经有数据，直接回调
    if(music.url !== null && music.url !== "err" && music.url !== "") {
        callback(music);
        return true;
    }
    // id为空，赋值链接错误。直接回调
    if(music.id === null) {
        music.url = "err";
        updateMinfo(music); // 更新音乐信息
        callback(music);
        return true;
    }
    
    // qijieya 的 type=url 不需要任何 auth：直接用歌曲 id 拼出音频流地址即可。
    // 该地址返回 audio/mpeg（206 / 支持 Range），<audio> 可直接播放；
    // 无效 id 会返回 200 + text/html 空体，<audio> 触发 error → audioErr() 换源或跳下一首。
    // 所以这里不再需要"按歌名回搜"，也不依赖任何后端。
    music.url = metingUrl(music.source, "url", music.id);
    if(!music.url) {
        music.url = "err";
    }
    updateMinfo(music); // 更新音乐信息
    callback(music);    // 回调函数
    return true;
}

// 完善获取音乐封面图
// 包含音乐信息的数组、回调函数
function ajaxPic(music, callback)
{
    // 旧版缓存清理：旧镜像的封面链接（含 api.i-meto.com）已失效，丢弃后走回搜补齐
    if(music.pic && ("" + music.pic).indexOf("api.i-meto.com") > -1) {
        music.pic = null;
    }

    // 已经有数据，直接回调
    if(music.pic !== null && music.pic !== "err" && music.pic !== "") {
        callback(music);
        return true;
    }
    // 缺封面才回搜：pic 端点用的是「图片 id」，与歌曲 id 不同源，没法直接拼，只能按歌名搜回来
    metingResolveBySearch(music, function(hit){
        if(hit && hit.pic) {
            music.pic = hit.pic;
            if(music.url === null && hit.url) music.url = hit.url;
            if(!music.lrc_url && hit.lrc) music.lrc_url = hit.lrc;
        } else {
            music.pic = "err";
        }
        updateMinfo(music); // 更新音乐信息
        callback(music);    // 回调函数
    });
}

// ajax加载用户歌单
// 参数：歌单网易云 id, 歌单存储 id，回调函数
function ajaxPlayList(lid, id, callback) {
    if(!lid) return false;
    
    // 本地歌单(pl_xxx)：仍走后端（不依赖 Meting，不会超时）
    if(typeof lid === "string" && lid.indexOf("pl_") === 0) {
        if(musicList[id].isloading === true) return true;
        musicList[id].isloading = true; // 更新状态：列表加载中
        
        $.ajax({
            type: mkPlayer.method, 
            url: mkPlayer.api, 
            data: "types=playlist&id=" + lid,
            dataType : "jsonp",
            timeout: 15000,
            complete: function(XMLHttpRequest, textStatus) {
                musicList[id].isloading = false;    // 列表已经加载完了
            },  // complete
            success: function(jsonData){
                // 后端标记该本地歌单已删除（可能刚被删/或刷新后不存在）：从前端移除
                if(jsonData.playlist && jsonData.playlist.deleted) {
                    for(var di=0; di<musicList.length; di++) {
                        if(musicList[di].id === lid) { musicList.splice(di, 1); break; }
                    }
                    clearSheet();
                    initList();
                    return false;
                }
                
                // 存储歌单信息
                var tempList = {
                    id: lid,    // 列表的网易云 id
                    name: jsonData.playlist.name,   // 列表名字
                    cover: jsonData.playlist.coverImgUrl,   // 列表封面
                    creatorName: jsonData.playlist.creator.nickname,   // 列表创建者名字
                    creatorAvatar: jsonData.playlist.creator.avatarUrl,   // 列表创建者头像
                    item: []
                };
                
                if(jsonData.playlist.coverImgUrl !== '') {
                    tempList.cover = jsonData.playlist.coverImgUrl + "?param=200y200";
                } else {
                    tempList.cover = musicList[id].cover;
                }
                
                if(typeof jsonData.playlist.tracks !== undefined || jsonData.playlist.tracks.length !== 0) {
                    // 存储歌单中的音乐信息
                    for (var i = 0; i < jsonData.playlist.tracks.length; i++) {
                        tempList.item[i] =  {
                            id: jsonData.playlist.tracks[i].id,  // 音乐ID
                            name: jsonData.playlist.tracks[i].name,  // 音乐名字
                            artist: jsonData.playlist.tracks[i].ar[0].name, // 艺术家名字
                            album: jsonData.playlist.tracks[i].al.name,    // 专辑名字
                            source: "netease",     // 音乐来源
                            url_id: jsonData.playlist.tracks[i].id,  // 链接ID
                            pic_id: null,  // 封面ID
                            lyric_id: jsonData.playlist.tracks[i].id,  // 歌词ID
                            pic: jsonData.playlist.tracks[i].al.picUrl + "?param=300y300",    // 专辑图片
                            url: jsonData.playlist.tracks[i].url || null   // mp3链接（后端若返回了就直接用，缺了再由 search 兜底）
                        };
                    }
                }
                
                // 歌单用户 id 不能丢
                if(musicList[id].creatorID) {
                    tempList.creatorID = musicList[id].creatorID;
                    if(musicList[id].creatorID === rem.uid) {   // 是当前登录用户的歌单，要保存到缓存中
                        var tmpUlist = playerReaddata('ulist');    // 读取本地记录的用户歌单
                        if(tmpUlist) {  // 读取到了
                            for(i=0; i<tmpUlist.length; i++) {  // 匹配歌单
                                if(tmpUlist[i].id == lid) {
                                    tmpUlist[i] = tempList; // 保存歌单中的歌曲
                                    playerSavedata('ulist', tmpUlist);  // 保存
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // 存储列表信息
                musicList[id] = tempList;
                
                // 首页显示默认列表
                if(id == mkPlayer.defaultlist) loadList(id);
                if(callback) callback(id);    // 调用回调函数
                
                // 改变前端列表
                $(".sheet-item[data-no='" + id + "'] .sheet-cover").attr('src', tempList.cover);    // 专辑封面
                $(".sheet-item[data-no='" + id + "'] .sheet-name").html(tempList.name);     // 专辑名字
                
                // 调试信息输出
                if(mkPlayer.debug) {
                    console.debug("歌单 [" +tempList.name+ "] 中的音乐获取成功");
                }
            },   //success
            error: function(XMLHttpRequest, textStatus, errorThrown) {
                layer.msg('歌单读取失败 - ' + XMLHttpRequest.status);
                console.error(XMLHttpRequest + textStatus + errorThrown);
                $(".sheet-item[data-no='" + id + "'] .sheet-name").html('<span style="color: #EA8383">读取失败</span>');     // 专辑名字
            }   // error  
        });//ajax
        return true;
    }
    
    // 真实网易云歌单：前端直连 Meting
    if(musicList[id].isloading === true) return true;
    musicList[id].isloading = true;
    metingQuery("netease", "playlist", lid, function(arr){
        musicList[id].isloading = false;
        if(!arr || !arr.length) {
            layer.msg('歌单读取失败');
            $(".sheet-item[data-no='" + id + "'] .sheet-name").html('<span style="color: #EA8383">读取失败</span>');
            return;
        }
        var tempList = {
            id: lid,
            // 保留 musicList.js 里配好的显示名（如"我喜欢的音乐"），没有才退化成"网易云歌单 <id>"
            name: musicList[id].name || ("网易云歌单 " + lid),
            cover: (arr[0] && arr[0].pic) ? arr[0].pic : "",
            creatorName: "",
            creatorAvatar: "",
            item: []
        };
        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            var mid = metingId(it.url);
            // qijieya 用 name/artist，i-meto 用 title/author —— 两套都兼容
            var itName   = it.title  || it.name   || "";
            var itAuthor = it.author || it.artist || "";
            tempList.item.push({
                id: mid,
                name: itName,
                artist: itAuthor.split(/[/、,|&]/)[0].trim(),
                album: itAuthor,
                source: "netease",
                url_id: mid,
                pic_id: metingId(it.pic),
                lyric_id: mid,
                pic: it.pic || null,
                // url / lrc 端点不需要 auth，缺了直接用歌曲 id 拼
                lrc_url: it.lrc || metingUrl("netease", "lrc", mid),
                url: it.url || metingUrl("netease", "url", mid)
            });
        }
        musicList[id] = tempList;
        if(id == mkPlayer.defaultlist) loadList(id);
        if(callback) callback(id);
        $(".sheet-item[data-no='" + id + "'] .sheet-cover").attr('src', tempList.cover);
        $(".sheet-item[data-no='" + id + "'] .sheet-name").html(tempList.name);
    });
    return true;
}

// ajax加载歌词
// 参数：音乐ID，回调函数
function ajaxLyric(music, callback) {
    lyricTip('歌词加载中...');

    // qijieya 的 type=lrc 不需要 auth，且直接返回【纯 LRC 文本】(text/plain)。
    // 用歌曲 id 直接拼地址即可；不再依赖列表里下发的 lrc_url（可能是已失效的旧镜像链接）。
    var u = metingUrl(music.source || "netease", "lrc", music.lyric_id || music.id);
    if(!u) { callback(''); return; }

    $.ajax({
        url: u, dataType: "text", timeout: 12000,
        success: function(t){
            t = t || '';
            // 兼容某些镜像返回 JSON 数组 [{lrc:"..."}] 的情况
            if(t.charAt(0) === '[' && t.indexOf('"lrc"') > -1) {
                try {
                    var a = JSON.parse(t);
                    callback((a && a[0] && a[0].lrc) || '', music.lyric_id);
                    return;
                } catch(e) {}
            }
            callback(t, music.lyric_id);
        },
        error: function(){
            // 备用：拼出的地址拿不到时，退回列表下发的 lrc_url（仅当其是 http 链接且与上面不同）
            var fb = music.lrc_url;
            if(fb && /^https?:\/\//.test(fb) && fb !== u) {
                $.ajax({
                    url: fb, dataType: "text", timeout: 12000,
                    success: function(t2){ callback(t2 || '', music.lyric_id); },
                    error: function(){ callback('', music.lyric_id); }
                });
            } else {
                callback('', music.lyric_id);
            }
        }
    });
}


// ajax删除本地歌单
// 参数：歌单本地 id（pl_xxx）、在 musicList 中的编号
function ajaxDeletePlayList(id, no) {
    if(!id || id.indexOf('pl_') !== 0) { layer.msg('只能删除本地歌单'); return false; }
    
    layer.confirm('确定删除本地歌单「' + (musicList[no] ? (musicList[no].name || id) : id) + '」？删除后不可恢复',
        {btn: ['删除', '取消'], title: '删除歌单'}, function(idx){
        layer.close(idx);
        var loading = layer.msg('删除中...', {icon: 16, shade: 0.01});
        $.ajax({
            type: mkPlayer.method,
            url: mkPlayer.api,
            data: "types=deleteplaylist&id=" + encodeURIComponent(id),
            dataType: "jsonp",
            timeout: 15000,
            complete: function(){ layer.close(loading); },
            success: function(jsonData){
                if(jsonData.code == 200) {
                    // 从运行时列表移除并重建歌单显示
                    for(var i=0; i<musicList.length; i++) {
                        if(musicList[i].id === id) { musicList.splice(i, 1); break; }
                    }
                    clearSheet();
                    initList();
                    layer.msg('歌单已删除');
                } else if(jsonData.code == 404) {
                    layer.msg('歌单不存在（可能已被删除）');
                } else if(jsonData.code == 403) {
                    layer.msg('该歌单不可删除');
                } else {
                    layer.msg('删除失败：' + (jsonData.msg || '未知错误'));
                }
            },
            error: function(XMLHttpRequest, textStatus, errorThrown) {
                layer.msg('删除请求失败 - ' + XMLHttpRequest.status);
                console.error(XMLHttpRequest + textStatus + errorThrown);
            }
        });
    });
    return true;
}

// ajax加载用户的播放列表
// 参数 用户的网易云 id
function ajaxUserList(uid)
{
    var tmpLoading = layer.msg('加载中...', {icon: 16,shade: 0.01});
    $.ajax({
        type: mkPlayer.method,
        url: mkPlayer.api,
        data: "types=userlist&uid=" + uid,
        dataType : "jsonp",
        timeout: 15000,
        complete: function(XMLHttpRequest, textStatus) {
            if(tmpLoading) layer.close(tmpLoading);    // 关闭加载中动画
        },  // complete
        success: function(jsonData){
            if(jsonData.code == "-1" || jsonData.code == 400){
                layer.msg('用户 uid 输入有误');
                return false;
            }
            
            if(jsonData.playlist.length === 0 || typeof(jsonData.playlist.length) === "undefined")
            {
                layer.msg('没找到用户 ' + uid + ' 的歌单');
                return false;
            }else{
                var tempList,userList = [];
                $("#sheet-bar").remove();   // 移除登陆条
                rem.uid = uid;  // 记录已同步用户 uid
                rem.uname = jsonData.playlist[0].creator.nickname;  // 第一个列表(喜欢列表)的创建者即用户昵称
                layer.msg('欢迎您 '+rem.uname);
                // 记录登录用户
                playerSavedata('uid', rem.uid);
                playerSavedata('uname', rem.uname);
                
                for (var i = 0; i < jsonData.playlist.length; i++)
                {
                    // 获取歌单信息
                    tempList = {
                        id: jsonData.playlist[i].id,    // 列表的网易云 id
                        name: jsonData.playlist[i].name,   // 列表名字
                        cover: jsonData.playlist[i].coverImgUrl  + "?param=200y200",   // 列表封面
                        creatorID: uid,   // 列表创建者id
                        creatorName: jsonData.playlist[i].creator.nickname,   // 列表创建者名字
                        creatorAvatar: jsonData.playlist[i].creator.avatarUrl,   // 列表创建者头像
                        item: []
                    };
                    // 存储并显示播放列表
                    addSheet(musicList.push(tempList) - 1, tempList.name, tempList.cover);
                    userList.push(tempList);
                }
                playerSavedata('ulist', userList);
                // 显示退出登录的提示条
                sheetBar();
            }
            // 调试信息输出
            if(mkPlayer.debug) {
                console.debug("用户歌单获取成功 [用户网易云ID：" + uid + "]");
            }
        },   //success
        error: function(XMLHttpRequest, textStatus, errorThrown) {
            layer.msg('歌单同步失败 - ' + XMLHttpRequest.status);
            console.error(XMLHttpRequest + textStatus + errorThrown);
        }   // error
    });//ajax
    return true;
}
