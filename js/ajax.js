/**************************************************
 * MYOnlinePlayer v2.4
 * Ajax 后台数据交互请求模块
 * 编写：mengkun(https://mkblog.cn)
 * 时间：2018-3-11
 * 2026-09-15 改：搜索/播放/歌词/真实歌单改为前端直连 Meting
 *   (api.i-meto.com)，绕过 Render 服务器出站被限流问题。
 *   本地歌单(pl_xxx)/删除/用户同步仍走 mkPlayer.api 后端。
 *************************************************/

// ===== 前端直连 Meting 配置（绕过 Render 出站限流）=====
var METING_API = "https://api.i-meto.com/meting/api";

// 从 Meting 返回的代理 URL 中抠出音乐 id
function metingId(u) {
    if(!u) return "";
    var m = ("" + u).match(/[?&]id=([^&]+)/);
    return m ? m[1] : "";
}

// 直连 Meting，依赖其 CORS（默认 Access-Control-Allow-Origin: *）
function metingQuery(server, type, id, cb) {
    $.ajax({
        url: METING_API,
        data: { server: server, type: type, id: id },
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
            var tempItem =  {
                id: mid,
                name: it.title,
                artist: (it.author || "").split(/[/、,|&]/)[0].trim(),
                album: it.author || "",
                source: rem.source,
                url_id: mid,
                pic_id: metingId(it.pic),
                lyric_id: metingId(it.lrc),
                pic: it.pic || null,
                // 关键：Meting 返回的 url 字段是自带 auth 的代理 URL，浏览器可直接跟 302 播放，
                // 不要再二次请求 type=url（该镜像对不带 auth 的 url 请求返回 401）。
                url: it.url || null
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
    });
}

// 完善获取音乐信息
// 音乐所在列表ID、音乐对应ID、回调函数
function ajaxUrl(music, callback)
{
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
    
    // 走后端解析直链（保留原 MKPlayer 架构：types=url 由后端代理 Meting）。
    // 注意：不能直接 metingQuery(type="url") 直连——该镜像对不带 auth 的 url 请求返回 401。
    // 搜索/真实歌单已在列表构建时把 it.url（自带 auth 的代理 URL）写入 music.url，
    // 走到这里的通常是本地歌单(pl_xxx)曲目；Render 上后端出站被限流可能超时，但绝不再刷 401。
    $.ajax({
        type: mkPlayer.method,
        url: mkPlayer.api,
        data: "types=url&id=" + encodeURIComponent(music.id) + "&source=" + encodeURIComponent(music.source),
        dataType: "jsonp",
        timeout: 15000,
        success: function(jsonData){
            if(jsonData && jsonData.url) {
                music.url = jsonData.url;    // 代理 URL，浏览器自行跟 302
            } else {
                music.url = "err";
            }
            updateMinfo(music); // 更新音乐信息
            callback(music);    // 回调函数
        },
        error: function(){
            music.url = "err";
            updateMinfo(music);
            callback(music);
        }
    });
    return true;
}

// 完善获取音乐封面图
// 包含音乐信息的数组、回调函数
function ajaxPic(music, callback)
{
    // 已经有数据，直接回调
    if(music.pic !== null && music.pic !== "err" && music.pic !== "") {
        callback(music);
        return true;
    }
    // pic_id 为空，赋值链接错误。直接回调
    if(music.pic_id === null) {
        music.pic = "err";
        updateMinfo(music); // 更新音乐信息
        callback(music);
        return true;
    }
    
    metingQuery(music.source, "pic", music.pic_id, function(arr){
        if(!arr || !arr.length || !arr[0].pic) {
            music.pic = "err";
        } else {
            music.pic = arr[0].pic;    // 记录结果
        }
        updateMinfo(music); // 更新音乐信息
        callback(music);    // 回调函数
        return true;
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
                            url: null   // mp3链接
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
            name: "网易云歌单 " + lid,
            cover: (arr[0] && arr[0].pic) ? arr[0].pic : "",
            creatorName: "",
            creatorAvatar: "",
            item: []
        };
        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            var mid = metingId(it.url);
            tempList.item.push({
                id: mid,
                name: it.title,
                artist: (it.author || "").split(/[/、,|&]/)[0].trim(),
                album: it.author || "",
                source: "netease",
                url_id: mid,
                pic_id: metingId(it.pic),
                lyric_id: metingId(it.lrc),
                pic: it.pic || null,
                // 关键同搜索：Meting 返回的 url 字段是自带 auth 的代理 URL，浏览器可直接跟 302 播放，
                // 不要再二次请求 type=url（该镜像对不带 auth 的 url 请求返回 401）。
                url: it.url || null
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
    
    if(!music.lyric_id) { callback(''); return; }  // 没有歌词ID，直接返回
    
    metingQuery(music.source, "lrc", music.lyric_id, function(arr){
        if(!arr || !arr.length) { callback(''); return; }
        var lrc = arr[0].lrc;
        if(!lrc) { callback(''); return; }
        // lrc 可能是歌词文本，也可能是 lrc 文件 URL
        if(/^https?:\/\//.test(lrc)) {
            $.ajax({
                url: lrc, dataType: "text", timeout: 10000,
                success: function(t){ callback(t || '', music.lyric_id); },
                error: function(){ callback('', music.lyric_id); }
            });
        } else {
            callback(lrc, music.lyric_id);
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
