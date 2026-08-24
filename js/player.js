/**************************************************
 * MYOnlinePlayer v2.41
 * 播放器主功能模块
 * 编写：mengkun(https://mkblog.cn)
 * 时间：2018-3-13
 *************************************************/
// 播放器功能配置
var mkPlayer = {
    api: "api.php", // api地址
    loadcount: 20,  // 搜索结果一次加载多少条
    method: "POST",     // 数据传输方式(POST/GET)
    defaultlist: 3,    // 默认要显示的播放列表编号
    autoplay: false,    // 是否自动播放(true/false) *此选项在移动端可能无效
    coverbg: true,      // 是否开启封面背景(true/false) *开启后会有些卡
    mcoverbg: true,     // 是否开启[移动端]封面背景(true/false)
    dotshine: true,    // 是否开启播放进度条的小点闪动效果[不支持IE](true/false) *开启后会有些卡
    mdotshine: false,   // 是否开启[移动端]播放进度条的小点闪动效果[不支持IE](true/false)
    volume: 0.6,        // 默认音量值(0~1之间)
    version: "v2.41",    // 播放器当前版本号(仅供调试)
    debug: false   // 是否开启调试模式(true/false)
};



/*******************************************************
 * 以下内容是播放器核心文件，不建议进行修改，否则可能导致播放器无法正常使用!
 * 
 * 哈哈，吓唬你的！想改就改呗！不过建议修改之前先【备份】,要不然改坏了弄不好了。
 ******************************************************/

// 存储全局变量
var rem = [];

// 音频错误处理函数
function audioErr() {
    // 没播放过，直接跳过
    if(rem.playlist === undefined) return true;

    // === P2：播放失败先自动换源重试（netease→tencent），两源都失败才跳下一首 ===
    // 背景：Render 部署下，仅用 netease 源时部分歌在网易云 CDN 返回 403/资源下架，
    // 浏览器跟 302 后拿不到音频。同一 id 换 tencent 源往往有资源，可救回。
    // 注：kugou 在 Meting 镜像层返回的 url 里 id=undefined（已本地验证），救不回，已剔除。
    var cur = musicList[1].item[rem.playid];
    console.log('[audioErr] triggered. rem.playid=', rem.playid, 'cur=', cur && {id:cur.id, name:cur.name, source:cur.source, url:(cur.url||'').slice(0,60)});
    if(cur && cur.id) {
        // 已尝试的源顺序（netease 是默认，先试它之后的）
        var SOURCES = ["netease", "tencent"];
        if(!rem._trySrc) rem._trySrc = {};                 // 记录每首歌试到哪个源
        var key = cur.id;
        if(rem._trySrc[key] === undefined) rem._trySrc[key] = "netease";  // 起始
        var idx = SOURCES.indexOf(rem._trySrc[key]);
        var nextSrc = SOURCES[idx + 1];
        console.log('[audioErr] _trySrc[',key,']=', rem._trySrc[key], 'nextSrc=', nextSrc);
        if(nextSrc) {
            rem._trySrc[key] = nextSrc;
            cur.source = nextSrc;   // 换源
            cur.url = null;         // 强制重新取 url
            layer.msg('当前源播放失败，尝试 ' + nextSrc + ' 源');
            console.log('[audioErr] 换源请求发出: source=' + nextSrc + ' id=' + cur.id);
            ajaxUrl(cur, play);     // 用新源重新取并播放
            return true;
        }
        // 两源都试完，清理标记
        delete rem._trySrc[key];
        console.log('[audioErr] 两源都试完, 走 nextMusic()');
    } else {
        console.warn('[audioErr] 拿不到当前歌, cur=', cur);
    }
    // === 换源逻辑结束，以下为原逻辑：连续失败过多才停 ===

    if(rem.errCount > 10) { // 连续播放失败的歌曲过多
        layer.msg('似乎出了点问题~播放已停止');
        rem.errCount = 0;
    } else {
        rem.errCount++;     // 记录连续播放失败的歌曲数目
        layer.msg('当前歌曲播放失败，自动播放下一首');
        nextMusic();    // 切换下一首歌
    }
}

// 点击暂停按钮的事件
function pause() {
    if(rem.paused === false) {  // 之前是播放状态
        rem.audio[0].pause();  // 暂停
    } else {
        // 第一次点播放
        if(rem.playlist === undefined) {
            rem.playlist = rem.dislist;
            
            musicList[1].item = musicList[rem.playlist].item; // 更新正在播放列表中音乐
            
            // 正在播放 列表项已发生变更，进行保存
            playerSavedata('playing', musicList[1].item);   // 保存正在播放列表
            
            listClick(0);
        }
        rem.audio[0].play();
    }
}

// 循环顺序
function orderChange() {
    var orderDiv = $(".btn-order");
    orderDiv.removeClass();
    switch(rem.order) {
        case 1:     // 单曲循环 -> 列表循环
            orderDiv.addClass("player-btn btn-order btn-order-list");
            orderDiv.attr("title", "列表循环");
            layer.msg("列表循环");
            rem.order = 2;
            break;
            
        case 3:     // 随机播放 -> 单曲循环
            orderDiv.addClass("player-btn btn-order btn-order-single");
            orderDiv.attr("title", "单曲循环");
            layer.msg("单曲循环");
            rem.order = 1;
            break;
            
        // case 2:
        default:    // 列表循环(其它) -> 随机播放
            orderDiv.addClass("player-btn btn-order btn-order-random");
            orderDiv.attr("title", "随机播放");
            layer.msg("随机播放");
            rem.order = 3;
    }
}

// 播放
function audioPlay() {
    rem.paused = false;     // 更新状态（未暂停）
    refreshList();      // 刷新状态，显示播放的波浪
    $(".btn-play").addClass("btn-state-paused");        // 恢复暂停
    
    if((mkPlayer.dotshine === true && !rem.isMobile) || (mkPlayer.mdotshine === true && rem.isMobile)) {
        $("#music-progress .mkpgb-dot").addClass("dot-move");   // 小点闪烁效果
    }
    
    var music = musicList[rem.playlist].item[rem.playid];   // 获取当前播放的歌曲信息
    var msg = " 正在播放: " + music.name + " - " + music.artist;  // 改变浏览器标题
    
    // 清除定时器
    if (rem.titflash !== undefined ) 
    {
        clearInterval(rem.titflash);
    }
    // 标题滚动
    titleFlash(msg);
}
// 标题滚动
function titleFlash(msg) {

    // 截取字符
    var tit = function() {
        msg = msg.substring(1,msg.length)+ msg.substring(0,1);
        document.title = msg;
    };
    // 设置定时间 300ms滚动
    rem.titflash = setInterval(function(){tit()}, 300);
}
// 暂停
function audioPause() {
    rem.paused = true;      // 更新状态（已暂停）
    
    $(".list-playing").removeClass("list-playing");        // 移除其它的正在播放
    
    $(".btn-play").removeClass("btn-state-paused");     // 取消暂停
    
    $("#music-progress .dot-move").removeClass("dot-move");   // 小点闪烁效果

     // 清除定时器
    if (rem.titflash !== undefined ) 
    {
        clearInterval(rem.titflash);
    }
    document.title = rem.webTitle;    // 改变浏览器标题
}

// 播放上一首歌
function prevMusic() {
    playList(rem.playid - 1);
}

// 播放下一首歌
function nextMusic() {
    switch (rem.order ? rem.order : 1) {
        case 1,2: 
            playList(rem.playid + 1);
        break;
        case 3: 
            if (musicList[1] && musicList[1].item.length) {
                var id = parseInt(Math.random() * musicList[1].item.length);
                playList(id);
            }
        break;
        default:
            playList(rem.playid + 1); 
        break;
    }
}
// 自动播放时的下一首歌
function autoNextMusic() {
    if(rem.order && rem.order === 1) {
        playList(rem.playid);
    } else {
        nextMusic();
    }
}

// 歌曲时间变动回调函数
function updateProgress(){
    // 暂停状态不管
    if(rem.paused !== false) return true;
    // 同步进度条
	music_bar.goto(rem.audio[0].currentTime / rem.audio[0].duration);
    // 同步歌词显示
	scrollLyric(rem.audio[0].currentTime);

    // === P2 兜底：网易云 403 时 audio 不报错也不更新进度，8 秒还是 0 就强制换源 ===
    var a = rem.audio[0];
    if(a.currentTime === 0 && a.readyState < 3) {
        // 还在加载中（readyState < HAVE_FUTURE_DATA）
        if(!rem._stallSince) rem._stallSince = Date.now();
        if(Date.now() - rem._stallSince > 8000) {
            console.warn('[updateProgress] 8秒还在loading且currentTime=0, 强制换源');
            rem._stallSince = null;
            audioErr();
        }
    } else {
        // 有进度了，重置 stall 计时
        rem._stallSince = null;
    }
}

// 显示的列表中的某一项点击后的处理函数
// 参数：歌曲在列表中的编号
function listClick(no) {
    // 记录要播放的歌曲的id
    var tmpid = no;
    
    // 调试信息输出
    if(mkPlayer.debug) {
        console.log("点播了列表中的第 " + (no + 1) + " 首歌 " + musicList[rem.dislist].item[no].name);
    }
    
    // 搜索列表的歌曲要额外处理
    if(rem.dislist === 0) {
        
        // 没播放过
        if(rem.playlist === undefined) {
            rem.playlist = 1;   // 设置播放列表为 正在播放 列表
            rem.playid = musicList[1].item.length - 1;  // 临时设置正在播放的曲目为 正在播放 列表的最后一首
        }
        
        // 获取选定歌曲的信息
        var tmpMusic = musicList[0].item[no];
        
        
        // 查找当前的播放列表中是否已经存在这首歌
        for(var i=0; i<musicList[1].item.length; i++) {
            if(musicList[1].item[i].id == tmpMusic.id && musicList[1].item[i].source == tmpMusic.source) {
                tmpid = i;
                playList(tmpid);    // 找到了直接播放
                return true;    // 退出函数
            }
        }
        
        
        // 将点击的这项追加到正在播放的条目的下方
        musicList[1].item.splice(rem.playid + 1, 0, tmpMusic);
        tmpid = rem.playid + 1;
        
        // 正在播放 列表项已发生变更，进行保存
        playerSavedata('playing', musicList[1].item);   // 保存正在播放列表
    } else {    // 普通列表
        // 与之前不是同一个列表了（在播放别的列表的歌曲）或者是首次播放
        if((rem.dislist !== rem.playlist && rem.dislist !== 1) || rem.playlist === undefined) {
            rem.playlist = rem.dislist;     // 记录正在播放的列表
            musicList[1].item = musicList[rem.playlist].item; // 更新正在播放列表中音乐
            
            // 正在播放 列表项已发生变更，进行保存
            playerSavedata('playing', musicList[1].item);   // 保存正在播放列表
            
            // 刷新正在播放的列表的动画
            refreshSheet();     // 更改正在播放的列表的显示
        }
    }
    
    playList(tmpid);
    
    return true;
}

// 播放正在播放列表中的歌曲
// 参数：歌曲在列表中的ID
function playList(id) {
    // 第一次播放
    if(rem.playlist === undefined) {
        pause();
        return true;
    }
    
    // 没有歌曲，跳出
    if(musicList[1].item.length <= 0) return true;
    
    // ID 范围限定
    if(id >= musicList[1].item.length) id = 0;
    if(id < 0) id = musicList[1].item.length - 1;
    
    // 记录正在播放的歌曲在正在播放列表中的 id
    rem.playid = id;
    
    // 如果链接为空，则 ajax 获取数据后再播放
    if(musicList[1].item[id].url === null || musicList[1].item[id].url === "") {
        ajaxUrl(musicList[1].item[id], play);
    } else {
        play(musicList[1].item[id]);
    }
}

// 初始化 Audio
function initAudio() {
    rem.audio = $('<audio></audio>').appendTo('body');
    
    // 应用初始音量
    rem.audio[0].volume = volume_bar.percent;
    // 绑定歌曲进度变化事件
    rem.audio[0].addEventListener('timeupdate', updateProgress);   // 更新进度
    rem.audio[0].addEventListener('play', audioPlay); // 开始播放了
    rem.audio[0].addEventListener('pause', audioPause);   // 暂停
    $(rem.audio[0]).on('ended', autoNextMusic);   // 播放结束
    rem.audio[0].addEventListener('error', audioErr);   // 播放器错误处理
    // === P2 兜底：网易云 403 时 audio 可能不触发 error，而是卡在 stalled/waiting，再加 stalled + play Promise reject 兜底 ===
    rem.audio[0].addEventListener('stalled', function(){
        console.warn('[audio] stalled event fired -> 触发换源');
        // 延迟 500ms 再触发，避免正常缓冲被误判
        setTimeout(function(){
            if(rem.audio && rem.audio[0] && rem.audio[0].paused && rem.audio[0].currentTime === 0) {
                audioErr();
            }
        }, 800);
    });
    rem.audio[0].addEventListener('suspend', function(){
        console.warn('[audio] suspend event fired (可能 403 资源被拒)');
    });
    // 监听 play() promise reject（src 不可用时不会触发 error，而是 promise reject）
    var _origPlay = rem.audio[0].play.bind(rem.audio[0]);
    rem.audio[0].play = function(){
        var p = _origPlay();
        if(p && typeof p.catch === 'function'){
            p.catch(function(e){
                console.warn('[audio] play() promise reject:', (e && e.name) || e);
                // play() 失败通常是 src 不可用，触发换源
                setTimeout(function(){ audioErr(); }, 300);
            });
        }
        return p;
    };
}


// 播放音乐
// 参数：要播放的音乐数组
function play(music) {
    // 调试信息输出
    if(mkPlayer.debug) {
        console.log('开始播放 - ' + music.name);
        
        console.info('id: "' + music.id + '",\n' + 
        'name: "' + music.name + '",\n' +
        'artist: "' + music.artist + '",\n' +
        'album: "' + music.album + '",\n' +
        'source: "' + music.source + '",\n' +
        'url_id: "' + music.url_id + '",\n' + 
        'pic_id: "' + music.pic_id + '",\n' + 
        'lyric_id: "' + music.lyric_id + '",\n' + 
        'pic: "' + music.pic + '",\n' +
        'url: "' + music.url + '"');
    }
    
    // 遇到错误播放下一首歌
    if(music.url == "err") {
        audioErr(); // 调用错误处理函数
        return false;
    }
    
    addHis(music);  // 添加到播放历史
    
    // 如果当前主界面显示的是播放历史，那么还需要刷新列表显示
    if(rem.dislist == 2 && rem.playlist !== 2) {
        loadList(2);
    } else {
        refreshList();  // 更新列表显示
    }
    
    try {
        rem.audio[0].pause();
        rem.audio.attr('src', music.url);
        rem.audio[0].play();
    } catch(e) {
        audioErr(); // 调用错误处理函数
        return;
    }

    rem.errCount = 0;   // 连续播放失败的歌曲数归零
    // 清理换源标记：等 audio 真能播（canplay）再清，避免换源后回失败又从头试的死循环
    // 用一次性 canplay 监听，触发后自移除
    var _okHandler = function(){
        rem.audio[0].removeEventListener('canplay', _okHandler);
        if(rem._trySrc && music.id !== undefined) {
            delete rem._trySrc[music.id];
            console.log('[play] canplay 真播放成功, 清 _trySrc[',music.id,']');
        }
    };
    rem.audio[0].addEventListener('canplay', _okHandler);
    music_bar.goto(0);  // 进度条强制归零
    changeCover(music);    // 更新封面展示
    ajaxLyric(music, lyricCallback);     // ajax加载歌词
    music_bar.lock(false);  // 取消进度条锁定
}


// 我的要求并不高，保留这一句版权信息可好？
// 保留了，你不会损失什么；而保留版权，是对作者最大的尊重。
console.info('欢迎使用 MYOnlinePlayer!\n当前版本：'+mkPlayer.version+' \n作者：mengkun(https://mkblog.cn)\n歌曲来源于各大音乐平台\nGithub：https://github.com/mengkunsoft/MKOnlineMusicPlayer');

// 音乐进度条拖动回调函数
function mBcallback(newVal) {
    var newTime = rem.audio[0].duration * newVal;
    // 应用新的进度
    rem.audio[0].currentTime = newTime;
    refreshLyric(newTime);  // 强制滚动歌词到当前进度
}

// 音量条变动回调函数
// 参数：新的值
function vBcallback(newVal) {
    if(rem.audio[0] !== undefined) {   // 音频对象已加载则立即改变音量
        rem.audio[0].volume = newVal;
    }
    
    if($(".btn-quiet").is('.btn-state-quiet')) {
        $(".btn-quiet").removeClass("btn-state-quiet");     // 取消静音
    }
    
    if(newVal === 0) $(".btn-quiet").addClass("btn-state-quiet");
    
    playerSavedata('volume', newVal); // 存储音量信息
}

// 下面是进度条处理
var initProgress = function(){  
    // 初始化播放进度条
    music_bar = new mkpgb("#music-progress", 0, mBcallback);
    music_bar.lock(true);   // 未播放时锁定不让拖动
    // 初始化音量设定
    var tmp_vol = playerReaddata('volume');
    tmp_vol = (tmp_vol != null)? tmp_vol: (rem.isMobile? 1: mkPlayer.volume);
    if(tmp_vol < 0) tmp_vol = 0;    // 范围限定
    if(tmp_vol > 1) tmp_vol = 1;
    if(tmp_vol == 0) $(".btn-quiet").addClass("btn-state-quiet"); // 添加静音样式
    volume_bar = new mkpgb("#volume-progress", tmp_vol, vBcallback);
};  

// mk进度条插件
// 进度条框 id，初始量，回调函数
mkpgb = function(bar, percent, callback){  
    this.bar = bar;
    this.percent = percent;
    this.callback = callback;
    this.locked = false;
    this.init();  
};

mkpgb.prototype = {
    // 进度条初始化
    init : function(){  
        var mk = this,mdown = false;
        // 加载进度条html元素
        $(mk.bar).html('<div class="mkpgb-bar"></div><div class="mkpgb-cur"></div><div class="mkpgb-dot"></div>');
        // 获取偏移量
        mk.minLength = $(mk.bar).offset().left; 
        mk.maxLength = $(mk.bar).width() + mk.minLength;
        // 窗口大小改变偏移量重置
        $(window).resize(function(){
            mk.minLength = $(mk.bar).offset().left; 
            mk.maxLength = $(mk.bar).width() + mk.minLength;
        });
        // 监听小点的鼠标按下事件
        $(mk.bar + " .mkpgb-dot").mousedown(function(e){
            e.preventDefault();    // 取消原有事件的默认动作
        });
        // 监听进度条整体的鼠标按下事件
        $(mk.bar).mousedown(function(e){
            if(!mk.locked) mdown = true;
            barMove(e);
        });
        // 监听鼠标移动事件，用于拖动
        $("html").mousemove(function(e){
            barMove(e);
        });
        // 监听鼠标弹起事件，用于释放拖动
        $("html").mouseup(function(e){
            mdown = false;
        });
        
        function barMove(e) {
            if(!mdown) return;
            var percent = 0;
            if(e.clientX < mk.minLength){ 
                percent = 0; 
            }else if(e.clientX > mk.maxLength){ 
                percent = 1;
            }else{  
                percent = (e.clientX - mk.minLength) / (mk.maxLength - mk.minLength);
            }
            mk.callback(percent);
            mk.goto(percent);
            return true;
        }
        
        mk.goto(mk.percent);
        
        return true;
    },
    // 跳转至某处
    goto : function(percent) {
        if(percent > 1) percent = 1;
        if(percent < 0) percent = 0;
        this.percent = percent;
        $(this.bar + " .mkpgb-dot").css("left", (percent*100) +"%"); 
        $(this.bar + " .mkpgb-cur").css("width", (percent*100)+"%");
        return true;
    },
    // 锁定进度条
    lock : function(islock) {
        if(islock) {
            this.locked = true;
            $(this.bar).addClass("mkpgb-locked");
        } else {
            this.locked = false;
            $(this.bar).removeClass("mkpgb-locked");
        }
        return true;
    }
};  

// 快捷键切歌，代码来自 @茗血(https://www.52benxi.cn/)
document.onkeydown = function showkey(e) {
    var key = e.keyCode || e.which || e.charCode;
    var ctrl = e.ctrlKey || e.metaKey;
    var isFocus = $('input').is(":focus");  
    if (ctrl && key == 37) playList(rem.playid - 1);    // Ctrl+左方向键 切换上一首歌
    if (ctrl && key == 39) playList(rem.playid + 1);    // Ctrl+右方向键 切换下一首歌
    if (key == 32 && isFocus == false) pause();         // 空格键 播放/暂停歌曲
}