var currentUser=null;
// ===== STATE =====
let yt=null,ytReady=false,pendingId=null;
let allTracks=[],curIdx=-1,progTimer,searchTimer;
let currentPage='home',shuffleOn=false,repeatOn=false;
let currentArtistTracks=[];
let lyricsTrackId=null,lyricsIdx=0,syncedLines=null;
let lastSearchResults=[],currentSearchFilter='all',lastSearchQ='';
let currentLibTab='all';
let isBuffering=false;
let currentSubPanel=null;

// ===== LYRICS CACHE (FIX: pre-fetch) =====
let lyricsCacheMap={};

// ===== STORAGE HELPERS =====
// ===== DATA STORAGE - PER ACCOUNT =====
// Kalau login: pakai Firestore. Kalau guest: pakai localStorage dengan prefix uid
function getUserKey(key){
  const uid = currentUser ? currentUser.uid : 'guest';
  return `nada_${uid}_${key}`;
}
function getLiked(){try{return JSON.parse(localStorage.getItem(getUserKey('liked'))||'[]')}catch{return[]}}
function saveLiked(a){
  localStorage.setItem(getUserKey('liked'),JSON.stringify(a));
  syncToFirestore('liked',a);
}
function getHistory(){try{return JSON.parse(localStorage.getItem(getUserKey('history'))||'[]')}catch{return[]}}
function saveHistory(a){
  const s=a.slice(0,50);
  localStorage.setItem(getUserKey('history'),JSON.stringify(s));
  syncToFirestore('history',s);
}
function getPlaylists(){try{return JSON.parse(localStorage.getItem(getUserKey('playlists'))||'[]')}catch{return[]}}
function savePlaylists(a){
  localStorage.setItem(getUserKey('playlists'),JSON.stringify(a));
  syncToFirestore('playlists',a);
}
function getDownloaded(){try{return JSON.parse(localStorage.getItem(getUserKey('downloaded'))||'[]')}catch{return[]}}
function saveDownloaded(a){localStorage.setItem(getUserKey('downloaded'),JSON.stringify(a))}
function getCached(){try{return JSON.parse(localStorage.getItem(getUserKey('cached'))||'[]')}catch{return[]}}
function saveCached(a){localStorage.setItem(getUserKey('cached'),JSON.stringify(a.slice(0,30)))}

// Sync ke Firestore kalau login
async function syncToFirestore(key, data){
  if(!currentUser||!firebaseApp)return;
  try{
    const {getFirestore,doc,setDoc}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=getFirestore(firebaseApp);
    await setDoc(doc(db,'users',currentUser.uid),{[key]:JSON.stringify(data)},{merge:true});
  }catch(e){}
}

// Load data dari Firestore ke localStorage pas login
async function loadUserDataFromFirestore(){
  if(!currentUser||!firebaseApp)return;
  try{
    const {getFirestore,doc,getDoc}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=getFirestore(firebaseApp);
    const snap=await getDoc(doc(db,'users',currentUser.uid));
    if(snap.exists()){
      const d=snap.data();
      ['liked','history','playlists','subscribed'].forEach(k=>{
        if(d[k]) localStorage.setItem(getUserKey(k), d[k]);
      });
    }
  }catch(e){}
  // Refresh UI setelah data diload
  if(typeof renderLibrary==='function') renderLibrary();
  // Random beranda HANYA kalau ini beneran akun baru (ganti akun / login pertama kali),
  // BUKAN pas cuma refresh/reopen app dengan akun yang sama (biar gak kayak "reload dari nol")
  const lastUid=localStorage.getItem('hidaka_last_home_uid');
  if(lastUid!==currentUser.uid){
    localStorage.setItem('hidaka_last_home_uid',currentUser.uid);
    if(typeof loadHome==='function') loadHome(getRandomHomeQuery());
  }
}

// Query random untuk beranda
const HOME_QUERIES=[
  'nadin amizah pamungkas hindia popular songs',
  'lagu indonesia viral 2025 spotify',
  'top hits indonesia terbaru 2025',
  'indie indonesia terpopuler 2024',
  'lagu galau indonesia terbaru',
  'pop indonesia hits pamungkas raisa',
  'trending music indonesia 2025',
  'lagu santai indonesia chill',
  'for revenge hindia weird genius indonesia',
  'lagu romantis indonesia terpopuler',
];
function getRandomHomeQuery(){
  return HOME_QUERIES[Math.floor(Math.random()*HOME_QUERIES.length)];
}


// ===== TOAST =====
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}

// ===== SKELETON LOADERS =====
function skeletonHCards(n=6){
  return Array.from({length:n},()=>`<div class="skel-card"><div class="skeleton skel-img"></div><div class="skeleton skel-line"></div><div class="skeleton skel-line short"></div></div>`).join('');
}
function skeletonQP(n=6){
  return `<div style="padding:0 20px">`+Array.from({length:n},()=>`<div class="skel-qp"><div class="skeleton skel-qp-thumb"></div><div style="flex:1"><div class="skeleton skel-line" style="margin-bottom:8px"></div><div class="skeleton skel-line short"></div></div></div>`).join('')+`</div>`;
}

// ===== YOUTUBE =====
window.onYouTubeIframeAPIReady=function(){
  ytReady=true;
  yt=new YT.Player('yt',{height:'1',width:'1',
    playerVars:{autoplay:1,controls:0,playsinline:1},
    events:{
      onReady:(ev)=>{
        setVolume(document.getElementById('fpVol').value);
        yt.setPlaybackQuality('small'); // 144p/240p — hemat kuota
        if(pendingId){yt.loadVideoById(pendingId);pendingId=null;}
      },
      onStateChange:(e)=>{
        if(e.data===YT.PlayerState.PLAYING){
          yt.setPlaybackQuality('small'); // Paksa 144p setiap kali play
          setBuffering(false);setPlaying(true);startProg();
        }
        else if(e.data===YT.PlayerState.BUFFERING){setBuffering(true);setPlaying(false);}
        else if(e.data===YT.PlayerState.PAUSED){setBuffering(false);setPlaying(false);}
        else if(e.data===YT.PlayerState.ENDED){setBuffering(false);if(repeatOn){yt.seekTo(0);yt.playVideo();}else nextTrack();}
      },
      onError:(e)=>{setBuffering(false);setPlaying(false);if(e.data===150||e.data===101)nextTrack();}
    }
  });
};
const ytTag=document.createElement('script');ytTag.src='https://www.youtube.com/iframe_api';document.head.appendChild(ytTag);

function setBuffering(yes){
  isBuffering=yes;
  document.getElementById('miniLoading').classList.toggle('show',yes);
  document.getElementById('fpPlayBtn').classList.toggle('buffering',yes);
  document.getElementById('fpImg').classList.toggle('buffering',yes);
}

async function ytSearch(q,max=12){
  try{
    const res=await fetch(`/api/search?q=${encodeURIComponent(q)}&max=${max}`);
    if(!res.ok)return[];
    return await res.json();
  } catch{return[];}
}

// ===== PAGE NAV =====
function showPage(p, pushState=true){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  currentPage=p;
  // URL routing
  const urlMap={home:'/',search:'/search',library:'/library',developer:'/developer'};
  if(pushState && window.location.pathname !== (urlMap[p]||'/'))
    history.pushState({page:p}, '', urlMap[p]||'/');
  if(p==='home'){document.getElementById('pageHome').classList.add('active');document.getElementById('navHome').classList.add('active');}
  else if(p==='search'){document.getElementById('pageSearch').classList.add('active');document.getElementById('navSearch').classList.add('active');setTimeout(()=>document.getElementById('searchInput').focus(),100);renderSearchHistory();_trackMissionProgress('open_search',1);}
  else if(p==='library'){document.getElementById('pageLibrary').classList.add('active');document.getElementById('navLibrary').classList.add('active');renderLibrary();_trackMissionProgress('open_library',1);}
  else if(p==='developer'){document.getElementById('pageDeveloper').classList.add('active');document.getElementById('navDeveloper').classList.add('active');}
}

// Handle browser back/forward button
window.addEventListener('popstate', e=>{
  // Kalau ada overlay yang lagi kebuka (Profile/Settings/Misi/Tema Banner), tutup itu dulu
  // biar tombol back gak langsung tembus keluar dari web
  let closedOverlay=false;
  ['profilePage','settingsPage','misiPage','bannerThemePage'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&el.classList.contains('open')){el.classList.remove('open');closedOverlay=true;}
  });
  if(closedOverlay){togglePreviewMode(false);return;}
  const p = e.state?.page || routeFromPath(window.location.pathname);
  showPage(p, false);
});

function routeFromPath(path){
  if(path==='/search') return 'search';
  if(path==='/library') return 'library';
  if(path==='/developer') return 'developer';
  return 'home';
}

// ===== SUBPANEL TOGGLE =====
function switchSubPanel(panel,btn){
  const btabs=['btabUpnext','btabLyrics','btabComments','btabArtist'];
  const swapZone=document.getElementById('fpSwapZone');
  const upnextEl=document.getElementById('fpSubUpnext');
  const commentsEl=document.getElementById('fpSubComments');
  const aboutEl=document.getElementById('fpAboutArtist');

  if(currentSubPanel===panel){
    currentSubPanel=null;
    swapZone.classList.remove('show-lyrics');
    upnextEl.classList.remove('active');
    upnextEl.style.display='none';
    if(commentsEl){commentsEl.classList.remove('active');commentsEl.style.display='none';}
    btabs.forEach(id=>document.getElementById(id)&&document.getElementById(id).classList.remove('active'));
    if(aboutEl&&allTracks[curIdx]) aboutEl.style.display='block';
    return;
  }

  currentSubPanel=panel;
  btabs.forEach(id=>document.getElementById(id)&&document.getElementById(id).classList.remove('active'));
  if(btn) btn.classList.add('active');
  upnextEl.classList.remove('active');
  upnextEl.style.display='none';
  if(commentsEl){commentsEl.classList.remove('active');commentsEl.style.display='none';}
  if(aboutEl) aboutEl.style.display='none';

  if(panel==='lyrics'){
    // Preload lyrics first, then animate — reduces jank
    loadLyrics();
    requestAnimationFrame(()=>swapZone.classList.add('show-lyrics'));
  } else if(panel==='upnext'){
    swapZone.classList.remove('show-lyrics');
    upnextEl.style.display='flex';
    upnextEl.style.flexDirection='column';
    requestAnimationFrame(()=>upnextEl.classList.add('active'));
    renderUpNext();
  } else if(panel==='comments'){
    swapZone.classList.remove('show-lyrics');
    if(commentsEl){
      commentsEl.style.display='flex';
      commentsEl.style.flexDirection='column';
      requestAnimationFrame(()=>commentsEl.classList.add('active'));
      loadComments();
      const bgEl=document.getElementById('commentsBannerBg');
      const t=allTracks[curIdx];
      if(bgEl&&t&&t.thumb){
        bgEl.style.backgroundImage="url('"+t.thumb+"')";
        bgEl.classList.add('show');
      }else if(bgEl){
        bgEl.classList.remove('show');
      }
    }
  } else if(panel==='artist'){
    currentSubPanel=null;
    swapZone.classList.remove('show-lyrics');
    btabs.forEach(id=>document.getElementById(id).classList.remove('active'));
    const t=allTracks[curIdx];
    if(!t){showToast('Putar lagu dulu sebelum lihat artis');return;}
    closeFullPlayer();
    setTimeout(()=>openArtistByName(t.channel, t.thumb),350);
  }
}

// ===== LYRICS HELPER: clean title & artist =====
function cleanLyricsTitle(t){
  return t.title
    .replace(/\s*[\(\[【][^)\]】]*[\)\]】]/g,'')
    .replace(/ft\..*$/i,'').replace(/feat\..*$/i,'')
    .replace(/official\s*(music\s*)?(video|audio|lyric|mv)?/gi,'')
    .replace(/\|\s*.*/,'')
    .replace(/-\s*[^-]*official.*/gi,'')
    .replace(/lyrics?/gi,'').replace(/hd/gi,'')
    .replace(/\s{2,}/g,' ').trim();
}
function cleanLyricsArtist(t){
  return t.channel
    .replace(/VEVO/gi,'').replace(/-\s*Topic$/i,'')
    .replace(/Official/gi,'').replace(/Music/gi,'')
    .replace(/\s{2,}/g,' ').trim();
}

// ===== PRE-FETCH LYRICS (FIX: called when song starts) =====
async function prefetchLyrics(t){
  if(lyricsCacheMap[t.id] !== undefined)return; // already cached or marked not found
  const rawTitle=cleanLyricsTitle(t);
  const artist=cleanLyricsArtist(t);
  const tries=[
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(rawTitle)}&artist_name=${encodeURIComponent(artist)}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent(rawTitle)}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent(t.title.split('-')[0].trim())}`,
  ];
  for(const url of tries){
    try{
      const r=await fetch(url,{headers:{'Lrclib-Client':'NadaMusic/1.0'}});
      const arr=await r.json();
      if(Array.isArray(arr)&&arr.length){
        lyricsCacheMap[t.id]=arr;
        return;
      }
    }catch{}
  }
  lyricsCacheMap[t.id]=null; // mark as "tried but not found"
}

// ===== LYRICS via lrclib.net =====
async function loadLyrics(){
  const t=allTracks[curIdx];
  if(!t)return;
  if(lyricsTrackId===t.id)return; // already rendered
  lyricsTrackId=t.id;
  const targetId=t.id; // snapshot ID to check later

  // Clear old lyrics and syncedLines immediately to prevent bleed-over
  syncedLines=null;
  lyricsIdx=0;

  // Use cache if available
  const cached=lyricsCacheMap[t.id];
  if(cached===null){showNoLyrics();return;}
  if(cached){
    // Double-check still same song (user might have switched)
    if(allTracks[curIdx]?.id!==targetId)return;
    processLyricsData(cached,targetId);
    return;
  }

  // Not prefetched yet — show loading and fetch now
  document.getElementById('lyricsContent').innerHTML=`<div class="lyrics-loading"><div class="spin"></div><span>${getLang().loadingLyrics||'Memuat lirik...'}</span></div>`;
  await prefetchLyrics(t);
  // CRITICAL: check user hasn't changed song while we were fetching
  if(allTracks[curIdx]?.id!==targetId){return;}
  const result=lyricsCacheMap[t.id];
  if(!result){showNoLyrics();return;}
  processLyricsData(result,targetId);
}

function processLyricsData(arr,targetId){
  // Guard: if song changed while processing, abort
  if(targetId && allTracks[curIdx]?.id!==targetId)return;
  // Always reset syncedLines before setting new ones
  syncedLines=null;
  lyricsIdx=0;
  const withSynced=arr.find(x=>x.syncedLyrics&&x.syncedLyrics.length>50);
  const withPlain=arr.find(x=>x.plainLyrics&&x.plainLyrics.length>50);
  const match=withSynced||withPlain||arr[0];
  if(!match){showNoLyrics();return;}
  if(match.syncedLyrics&&match.syncedLyrics.length>50){
    const lines=match.syncedLyrics.split('\n').map(l=>{
      const m=l.match(/\[(\d+):(\d+\.\d+)\](.*)/);
      if(!m)return null;
      return{time:parseInt(m[1])*60+parseFloat(m[2]),text:m[3].trim()||'♪'};
    }).filter(Boolean);
    syncedLines=lines;
    renderLyricsLines(lines.map(l=>l.text));
  } else if(match.plainLyrics&&match.plainLyrics.length>50){
    syncedLines=null;
    const lines=match.plainLyrics.split('\n').filter(l=>l.trim());
    renderLyricsLines(lines);
  } else {
    showNoLyrics();
  }
}

function showNoLyrics(){
  document.getElementById('lyricsContent').innerHTML='<div class="lyrics-loading" style="padding:40px 28px;text-align:center"><span style="color:var(--muted);font-size:15px;line-height:2">Lirik tidak tersedia 😔<br><span style="font-size:12px">Coba lagu berbahasa Inggris<br>atau artis internasional</span></span></div>';
}

function renderLyricsLines(lines){
  const html=lines.map((l,i)=>`<div class="lyrics-line ${i===0?'active':''}" data-idx="${i}" onclick="seekToLyric(${i})">${l||'♪'}</div>`).join('');
  document.getElementById('lyricsContent').innerHTML=`<div class="lyrics-wrap"><div class="lyrics-scroll-inner" id="lyricsScrollInner">${html}</div></div><div class="lyrics-source">Lirik dari LRCLIB</div>`;
  lyricsIdx=0;
  _applyLyricsProximity(0);
}

function _applyLyricsProximity(activeIdx){
  const lines=document.querySelectorAll('#lyricsContent .lyrics-line');
  if(!lines.length)return;
  lines.forEach((el,i)=>{
    el.classList.remove('active','prev1','prev2','next1','next2');
    const d=i-activeIdx;
    if(d===0) el.classList.add('active');
    else if(d===-1) el.classList.add('prev1');
    else if(d===-2) el.classList.add('prev2');
    else if(d===1) el.classList.add('next1');
    else if(d===2) el.classList.add('next2');
  });
  // Auto-scroll active line to center
  const activeEl=lines[activeIdx];
  if(activeEl){
    const scrollEl=document.getElementById('lyricsScrollInner');
    if(scrollEl){
      const elTop=activeEl.offsetTop;
      const elH=activeEl.offsetHeight;
      const scrollH=scrollEl.clientHeight;
      scrollEl.scrollTo({top:elTop-(scrollH/2)+(elH/2),behavior:'smooth'});
    }
  }
}

function updateLyricsHighlight(){
  if(!yt?.getDuration)return;
  if(currentSubPanel!=='lyrics')return;
  const cur=yt.getCurrentTime()||0;
  const lines=document.querySelectorAll('#lyricsContent .lyrics-line');
  if(!lines.length)return;
  // Guard: if syncedLines belongs to a different song, skip
  const t=allTracks[curIdx];
  if(lyricsTrackId && t && lyricsTrackId!==t.id)return;
  let newIdx=lyricsIdx;
  if(syncedLines&&syncedLines.length){
    for(let i=syncedLines.length-1;i>=0;i--){
      if(cur>=syncedLines[i].time){newIdx=i;break;}
    }
  } else {
    const dur=yt.getDuration()||1;
    newIdx=Math.min(Math.floor((cur/dur)*lines.length),lines.length-1);
  }
  if(newIdx!==lyricsIdx){
    lyricsIdx=newIdx;
    _applyLyricsProximity(newIdx);
  }
}

function seekToLyric(idx){
  if(!yt?.getDuration)return;
  if(syncedLines&&syncedLines[idx]){yt.seekTo(syncedLines[idx].time);}
  else{const dur=yt.getDuration();const lines=document.querySelectorAll('#lyricsContent .lyrics-line');yt.seekTo((idx/lines.length)*dur);}
}

// ===== UP NEXT =====
function renderUpNext(){
  const el=document.getElementById('upnextList');
  if(!allTracks.length){el.innerHTML=`<div style="padding:40px;text-align:center;color:var(--muted)">${getLang().noQueue||'Belum ada antrian'}</div>`;return;}
  el.innerHTML=allTracks.map((t,i)=>`
    <div class="upnext-item ${i===curIdx?'playing':''}" onclick="playTrack(${i},allTracks);switchSubPanel('upnext',null)">
      <div class="upnext-num">${i===curIdx?'<div class="eq"><span></span><span></span><span></span></div>':i+1}</div>
      <img class="upnext-thumb" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="upnext-info">
        <div class="upnext-title-text">${t.title}</div>
        <div class="upnext-ch">${t.channel}</div>
      </div>
    </div>`).join('');
}

// ===== COMMENTS (YouTube-style, Firestore Real-time) =====
let _commentsUnsubscribe=null;
let _likedComments={};

function _getCommentTrackId(){
  const t=allTracks[curIdx];
  return t?t.id.replace(/[^a-zA-Z0-9_-]/g,'_'):'unknown';
}

function _avatarEl(user,photoURL,size){
  // size: 'normal' = 36px, 'sm' = 28px
  const cls=size==='sm'?'yt-avatar-sm':'yt-avatar';
  const initials=(user||'?')[0].toUpperCase();
  const colors=['#1db954','#1e90ff','#ff6b6b','#f7c948','#a855f7','#f97316'];
  const bg=colors[initials.charCodeAt(0)%colors.length];
  if(photoURL){
    return '<div class="'+cls+'"><img src="'+photoURL+'" onerror="this.style.display=\'none\';this.parentElement.textContent=\''+initials+'\'"></div>';
  }
  return '<div class="'+cls+'" style="background:'+bg+'">'+initials+'</div>';
}

function _updateInputAvatar(){
  const el=document.getElementById('commentInputAvatar');
  if(!el)return;
  if(currentUser&&currentUser.photoURL){
    el.innerHTML='<img src="'+currentUser.photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    el.style.background='transparent';
  }else if(currentUser){
    el.textContent=(currentUser.displayName||currentUser.email||'?')[0].toUpperCase();
    el.style.background='#1db954';
  }else{
    el.textContent='?';el.style.background='#333';
  }
}

function _renderComment(d){
  const c=d.data();
  const isOwn=currentUser&&c.uid===currentUser.uid;
  const timeAgo=_commentTimeAgo(c.ts&&c.ts.toMillis?c.ts.toMillis():Date.now());
  const liked=_likedComments[d.id];
  const likes=(c.likes||0)+(liked?1:0);
  const replyCount=c.replyCount||0;
  const hasReplies=replyCount>0;

  return ''+
  '<div class="yt-comment" id="yc-'+d.id+'">'+
    // Top row: avatar+vline | text content
    '<div class="yt-comment-top">'+
      '<div class="yt-col">'+
        '<div class="yt-clickable" onclick="openUserProfile(\''+c.uid+'\')">'+_avatarEl(c.user,c.photoURL,'normal')+'</div>'+
        '<div class="yt-vline'+(hasReplies?' show':'')+'" id="vline-'+d.id+'"></div>'+
      '</div>'+
      '<div class="yt-right">'+
        '<div class="yt-meta">'+
          '<span class="yt-username yt-clickable" onclick="openUserProfile(\''+c.uid+'\')">'+escHtml(c.user||'User')+'</span>'+
          (c.level?'<span class="yt-lvl-badge">Lv.'+c.level+'</span>':'')+
          (c.role?'<span class="yt-rank-badge">'+escHtml(c.role)+'</span>':'')+
          '<span class="yt-time">'+timeAgo+'</span>'+
        '</div>'+
        '<div class="yt-text">'+escHtml(c.text||'')+'</div>'+
        '<div class="yt-actions">'+
          '<button class="yt-like-btn'+(liked?' liked':'')+'" onclick="likeComment(\''+d.id+'\',this)">'+
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="'+(liked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>'+
            '<span>'+(likes>0?likes:'')+'</span>'+
          '</button>'+
          '<button class="yt-dislike-btn" onclick="this.classList.toggle(\'liked\')">'+
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>'+
          '</button>'+
          '<button class="yt-reply-btn" onclick="toggleReplyInput(\''+d.id+'\')">Balas</button>'+
          (isOwn?'<button class="yt-del-btn" onclick="deleteComment(\''+d.id+'\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>':'')+
        '</div>'+
      '</div>'+
    '</div>'+
    // Reply input (full width, indented via margin-left)
    '<div class="yt-reply-input-wrap" id="reply-input-'+d.id+'">'+
      '<input class="yt-reply-input" placeholder="Balas..." maxlength="300" onkeypress="if(event.key===\'Enter\')sendReply(\''+d.id+'\',this)">'+
      '<button class="yt-reply-cancel" onclick="toggleReplyInput(\''+d.id+'\')">Batal</button>'+
      '<button class="yt-reply-send" onclick="sendReply(\''+d.id+'\',this.previousElementSibling.previousElementSibling)">Kirim</button>'+
    '</div>'+
    // Toggle replies button (full width, indented)
    (hasReplies?'<button class="yt-toggle-replies" id="rtbtn-'+d.id+'" onclick="loadReplies(\''+d.id+'\',this)">'+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'+
      replyCount+' balasan'+
    '</button>':'')+
    // Replies wrap dengan elbow curve
    '<div class="yt-replies-wrap" id="replieswrap-'+d.id+'">'+
      '<div class="yt-replies" id="replies-'+d.id+'"></div>'+
    '</div>'+
  '</div>';
}

function _renderReply(r){
  const rc=r.data();
  const isOwnR=currentUser&&rc.uid===currentUser.uid;
  const timeAgo=_commentTimeAgo(rc.ts&&rc.ts.toMillis?rc.ts.toMillis():Date.now());
  return ''+
  '<div class="yt-reply-item">'+
    '<div class="yt-col-sm">'+
      '<div class="yt-clickable" onclick="openUserProfile(\''+rc.uid+'\')">'+_avatarEl(rc.user,rc.photoURL,'sm')+'</div>'+
    '</div>'+
    '<div class="yt-right">'+
      '<div class="yt-meta">'+
        '<span class="yt-username yt-clickable" onclick="openUserProfile(\''+rc.uid+'\')">'+escHtml(rc.user||'User')+'</span>'+
        '<span class="yt-time">'+timeAgo+'</span>'+
      '</div>'+
      '<div class="yt-text">'+escHtml(rc.text||'')+'</div>'+
      '<div class="yt-actions">'+
        '<button class="yt-like-btn" onclick="this.classList.toggle(\'liked\')">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>'+
        '</button>'+
        (isOwnR?'<button class="yt-del-btn" onclick="deleteReply(\''+r.ref.parent.parent.id+'\',\''+r.id+'\',this.closest(\'.yt-reply-item\'))"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>':'')+
      '</div>'+
    '</div>'+
  '</div>';
}

async function loadComments(){
  const el=document.getElementById('commentsList');
  const inputEl=document.getElementById('commentInput');
  if(!el)return;
  if(inputEl)inputEl.placeholder=getLang().commentPlaceholder||'Tulis komentar...';
  _updateInputAvatar();
  if(_commentsUnsubscribe){_commentsUnsubscribe();_commentsUnsubscribe=null;}
  if(!firebaseApp){
    el.innerHTML='<div class="comments-empty">🔒 Login dulu untuk melihat komentar</div>';return;
  }
  el.innerHTML='<div class="comments-empty"><div class="spin" style="width:22px;height:22px;border:2px solid #333;border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 8px"></div>Memuat komentar...</div>';
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const trackId=_getCommentTrackId();
    const q=fs.query(fs.collection(db,'track_comments',trackId,'comments'),fs.orderBy('ts','asc'));
    _commentsUnsubscribe=fs.onSnapshot(q,function(snap){
      if(snap.empty){
        el.innerHTML='<div class="comments-empty">'+(getLang().commentsEmpty||'💬 Belum ada komentar. Jadilah yang pertama!')+'</div>';return;
      }
      el.innerHTML=snap.docs.map(function(d){return _renderComment(d);}).join('');
    },function(err){
      var msg='❌ Gagal memuat komentar';
      if(err.code==='permission-denied')msg='🔧 Cek Firestore Rules';
      else if(err.code==='unavailable')msg='📡 Koneksi bermasalah';
      el.innerHTML='<div class="comments-empty">'+msg+'</div>';
    });
  }catch(e){
    el.innerHTML='<div class="comments-empty">❌ Error: '+e.message+'</div>';
  }
}

async function loadReplies(commentId,btn){
  const wrapEl=document.getElementById('replieswrap-'+commentId);
  const repliesEl=document.getElementById('replies-'+commentId);
  if(!wrapEl||!repliesEl)return;
  const isOpen=wrapEl.classList.contains('open');
  const svg=btn.querySelector('svg');
  if(isOpen){
    wrapEl.classList.remove('open');
    if(svg)svg.style.transform='';
    return;
  }
  wrapEl.classList.add('open');
  if(svg)svg.style.transform='rotate(180deg)';
  repliesEl.innerHTML='<div style="padding:8px 0;color:var(--muted);font-size:12px">Memuat balasan...</div>';
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const trackId=_getCommentTrackId();
    const rSnap=await fs.getDocs(fs.query(fs.collection(db,'track_comments',trackId,'comments',commentId,'replies'),fs.orderBy('ts','asc')));
    if(rSnap.empty){repliesEl.innerHTML='';return;}
    repliesEl.innerHTML=rSnap.docs.map(function(r){return _renderReply(r);}).join('');
  }catch(e){
    repliesEl.innerHTML='<div style="padding:8px 0;color:var(--muted);font-size:11px">❌ Gagal load balasan</div>';
  }
}

async function sendComment(){
  const inp=document.getElementById('commentInput');
  if(!inp)return;
  const text=inp.value.trim();
  if(!text)return;
  if(!firebaseApp||!currentUser){showToast('🔒 Login dulu untuk komentar');return;}
  const sendBtn=document.getElementById('commentSendBtn');
  if(sendBtn)sendBtn.disabled=true;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    let myRole=null;
    try{
      const mySnap=await fs.getDoc(fs.doc(db,'user_profiles',currentUser.uid));
      if(mySnap.exists()){
        const md=mySnap.data();
        myRole=md.roleOverride||_getProfileRole(md.commentCount||0);
      }
    }catch(e){}
    await fs.addDoc(fs.collection(db,'track_comments',_getCommentTrackId(),'comments'),{
      uid:currentUser.uid,
      user:currentUser.displayName||currentUser.email.split('@')[0]||'User',
      photoURL:currentUser.photoURL||null,
      text:text,likes:0,replyCount:0,
      level:_computeLevelInfo(getLevelPoints()).level,
      role:myRole,
      ts:fs.serverTimestamp()
    });
    fs.setDoc(fs.doc(db,'user_profiles',currentUser.uid),{commentCount:fs.increment(1)},{merge:true}).catch(()=>{});
    _trackMissionProgress('comment',1);
    inp.value='';
  }catch(e){showToast('❌ Gagal kirim komentar');console.error(e);}
  finally{if(sendBtn)sendBtn.disabled=false;}
}

async function sendReply(commentId,inp){
  if(!inp)return;
  const text=inp.value.trim();
  if(!text)return;
  if(!firebaseApp||!currentUser){showToast('🔒 Login dulu');return;}
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const trackId=_getCommentTrackId();
    await fs.addDoc(fs.collection(db,'track_comments',trackId,'comments',commentId,'replies'),{
      uid:currentUser.uid,
      user:currentUser.displayName||currentUser.email.split('@')[0]||'User',
      photoURL:currentUser.photoURL||null,
      text:text,ts:fs.serverTimestamp()
    });
    await fs.updateDoc(fs.doc(db,'track_comments',trackId,'comments',commentId),{replyCount:fs.increment(1)});
    fs.setDoc(fs.doc(db,'user_profiles',currentUser.uid),{commentCount:fs.increment(1)},{merge:true}).catch(()=>{});
    inp.value='';
    toggleReplyInput(commentId);
    // Update vline visibility
    const vline=document.getElementById('vline-'+commentId);
    if(vline)vline.classList.add('show');
    // Update reply count badge text, atau reload kalau toggle button belum ada
    const rtbtn=document.getElementById('rtbtn-'+commentId);
    if(rtbtn){
      const svgEl=rtbtn.querySelector('svg');
      const curCount=parseInt(rtbtn.textContent)||0;
      rtbtn.innerHTML='';
      if(svgEl)rtbtn.appendChild(svgEl);
      rtbtn.append((curCount+1)+' balasan');
    }
    // Kalau udah open, refresh isinya langsung (tanpa toggle)
    const wrapEl=document.getElementById('replieswrap-'+commentId);
    const repliesEl=document.getElementById('replies-'+commentId);
    if(wrapEl&&wrapEl.classList.contains('open')&&repliesEl){
      const rSnap=await fs.getDocs(fs.query(fs.collection(db,'track_comments',trackId,'comments',commentId,'replies'),fs.orderBy('ts','asc')));
      repliesEl.innerHTML=rSnap.docs.map(function(r){return _renderReply(r);}).join('');
    }
  }catch(e){showToast('❌ Gagal kirim balasan');console.error(e);}
}

async function deleteComment(docId){
  if(!firebaseApp||!currentUser)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await fs.deleteDoc(fs.doc(fs.getFirestore(firebaseApp),'track_comments',_getCommentTrackId(),'comments',docId));
  }catch(e){showToast('❌ Gagal hapus komentar');}
}

async function deleteReply(commentId,replyId,elItem){
  if(!firebaseApp||!currentUser)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const trackId=_getCommentTrackId();
    await fs.deleteDoc(fs.doc(db,'track_comments',trackId,'comments',commentId,'replies',replyId));
    await fs.updateDoc(fs.doc(db,'track_comments',trackId,'comments',commentId),{replyCount:fs.increment(-1)});
    if(elItem)elItem.remove();
  }catch(e){showToast('❌ Gagal hapus balasan');}
}

function likeComment(docId,btn){
  if(!currentUser){showToast('🔒 Login dulu');return;}
  _likedComments[docId]=!_likedComments[docId];
  btn.classList.toggle('liked',_likedComments[docId]);
  const countEl=btn.querySelector('span');
  if(countEl){const cur=parseInt(countEl.textContent)||0;countEl.textContent=(_likedComments[docId]?cur+1:Math.max(0,cur-1))||'';}
  const svg=btn.querySelector('svg');
  if(svg)svg.setAttribute('fill',_likedComments[docId]?'currentColor':'none');
}

function toggleReplyInput(commentId){
  const wrap=document.getElementById('reply-input-'+commentId);
  if(!wrap)return;
  wrap.classList.toggle('open');
  if(wrap.classList.contains('open'))wrap.querySelector('.yt-reply-input').focus();
}

function _commentTimeAgo(ts){
  const d=Date.now()-ts,m=Math.floor(d/60000),h=Math.floor(d/3600000),dy=Math.floor(d/86400000);
  if(m<1)return getLang().commentJustNow||'Baru saja';
  if(m<60)return m+' menit lalu';
  if(h<24)return h+' jam lalu';
  if(dy<30)return dy+' hari lalu';
  return new Date(ts).toLocaleDateString('id-ID',{day:'numeric',month:'short'});
}
function escHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
// ===== END COMMENTS =====



function toggleLike(){
  const t=allTracks[curIdx];if(!t)return;
  const liked=getLiked();
  const idx=liked.findIndex(x=>x.id===t.id);
  if(idx>=0){
    liked.splice(idx,1);saveLiked(liked);
    showToast(getLang().removedFromLiked||'Dihapus dari Disukai');
  } else {
    liked.unshift(t);saveLiked(liked);
    showToast(getLang().addedToLiked||'❤️ Ditambahkan ke Disukai');
    _trackMissionProgress('favorite',1);
  }
  updateHeartUI();
  if(currentPage==='library')renderLibrary();
}
function updateHeartUI(){
  const t=allTracks[curIdx];if(!t)return;
  const liked=getLiked();const isLiked=liked.some(x=>x.id===t.id);
  const btn=document.getElementById('fpHeart');
  btn.classList.toggle('liked',isLiked);
  btn.querySelector('svg').setAttribute('fill',isLiked?'#ff4466':'none');
  btn.querySelector('svg').setAttribute('stroke',isLiked?'#ff4466':'currentColor');
  btn.style.color=isLiked?'#ff4466':'var(--muted)';
  // Also update mini player heart
  const miniHeart=document.getElementById('miniHeart');
  const miniHeartIc=document.getElementById('miniHeartIc');
  if(miniHeart&&miniHeartIc){
    miniHeart.style.color=isLiked?'#ff4466':'#888';
    miniHeartIc.setAttribute('fill',isLiked?'#ff4466':'none');
    miniHeartIc.setAttribute('stroke',isLiked?'#ff4466':'currentColor');
  }
}

// ===== HISTORY =====
function addToHistory(t){
  const h=getHistory();const idx=h.findIndex(x=>x.id===t.id);if(idx>=0)h.splice(idx,1);h.unshift(t);saveHistory(h);
  const c=getCached();const ci=c.findIndex(x=>x.id===t.id);if(ci>=0)c.splice(ci,1);c.unshift(t);saveCached(c);
}

// ===== LIBRARY =====
function renderLibrary(){
  const tab=currentLibTab;
  const el=document.getElementById('libList');
  const liked=getLiked();
  const history=getHistory();
  const playlists=getPlaylists();
  const downloaded=getDownloaded();

  if(tab==='subscribed'){
    const subs=getSubscribed();
    if(!subs.length){
      el.innerHTML=`<div style="padding:60px 20px;text-align:center;color:var(--muted)">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:0.4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">Belum ada artis</div>
        <div style="font-size:13px">Subscribe artis dari Full Player atau halaman Artis</div>
      </div>`;
      return;
    }
    el.innerHTML=subs.map((a,i)=>`
      <div class="lib-item" onclick="openArtistByName('${a.name.replace(/'/g,"\'")}','${(a.thumb||'').replace(/'/g,"\'")}')">
        <div class="lib-icon" style="border-radius:50%;overflow:hidden">${a.thumb?`<img src="${a.thumb}" alt="" style="width:100%;height:100%;object-fit:cover">`:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}</div>
        <div class="lib-info">
          <div class="lib-name">${a.name}</div>
          <div class="lib-sub">Artis</div>
        </div>
        <button onclick="event.stopPropagation();unsubscribeArtist('${a.name.replace(/'/g,"\'")}');renderLibrary()" style="background:none;border:1px solid rgba(255,255,255,0.2);border-radius:500px;color:var(--text2);font-family:'Inter',sans-serif;font-size:11px;font-weight:600;padding:5px 12px;cursor:pointer">Unsubscribe</button>
      </div>`).join('');
    return;
  }

  if(tab==='all'){
    el.innerHTML=`
      <div class="lib-item" onclick="currentLibTab='liked';document.querySelectorAll('#libChips .chip').forEach(c=>{c.classList.toggle('active',c.dataset.lib==='liked')});renderLibrary()">
        <div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="${liked.length?'#ff4466':'none'}" stroke="${liked.length?'#ff4466':'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
        <div class="lib-info"><div class="lib-name">${getLang().liked||"Disukai"}</div><div class="lib-sub">${liked.length} ${getLang().songs||"lagu"}</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <div class="lib-item" onclick="downloadCurrent()">
        <div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
        <div class="lib-info"><div class="lib-name">${getLang().downloaded||'Diunduh'}</div><div class="lib-sub">${downloaded.length} ${getLang().songs||'lagu'}</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <div class="lib-item" onclick="openTopPlayed()">
        <div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
        <div class="lib-info"><div class="lib-name">${getLang().topPlayed||'Teratas Saya 50'}</div><div class="lib-sub">${getLang().mostPlayed||'Lagu yang paling sering diputar'}</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <div class="lib-item" onclick="currentLibTab='history';document.querySelectorAll('#libChips .chip').forEach(c=>{c.classList.toggle('active',c.dataset.lib==='history')});renderLibrary()">
        <div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div class="lib-info"><div class="lib-name">${getLang().historyCache||"Riwayat / Cache"}</div><div class="lib-sub">${history.length} ${getLang().played||"lagu diputar"}</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <div class="lib-item" onclick="showToast(getLang().uploadSoon||'Fitur upload akan segera hadir')">
        <div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg></div>
        <div class="lib-info"><div class="lib-name">${getLang().uploaded||'Diunggah'}</div><div class="lib-sub">${getLang().uploadSub||'Unggah musik sendiri'}</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      ${playlists.map((pl,i)=>`
      <div class="lib-item" onclick="openPlaylistDetail(${i})">
        <div class="lib-icon">${pl.tracks[0]?`<img src="${pl.tracks[0].thumb}" alt="">`:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'}</div>
        <div class="lib-info"><div class="lib-name">${pl.name}</div><div class="lib-sub">${pl.tracks.length} lagu</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>`).join('')}
      <div class="lib-item" onclick="openCreatePlaylist()">
        <div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
        <div class="lib-info"><div class="lib-name">${getLang().createPlaylist||'Buat playlist baru'}</div></div>
      </div>
`;
    // Tambah tombol import via DOM setelah innerHTML set
    const _btn=document.createElement('div');
    _btn.className='lib-item';
    _btn.style.cssText='cursor:pointer';
    _btn.innerHTML='<div class="lib-icon" style="background:#1a1a1a"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points=\'16 16 12 12 8 16\'/><line x1=\'12\' y1=\'12\' x2=\'12\' y2=\'21\'/><path d=\'M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3\'/></svg></div><div class="lib-info"><div class="lib-name">Impor Playlist YouTube</div><div class="lib-sub">Impor dari link playlist YouTube</div></div>';
    _btn.addEventListener('click',openImportPlaylist);
    el.appendChild(_btn);
    return;
  }

  if(tab==='liked'){
    if(!liked.length){el.innerHTML=`<div style="padding:40px;text-align:center;color:var(--muted)">${getLang().noLiked||'Belum ada lagu yang disukai ❤️'}</div>`;return;}
    el.innerHTML=liked.map((t,i)=>`
      <div class="lib-item" onclick="playFromLib(${i},'liked')">
        <div class="lib-icon"><img src="${t.thumb}" alt=""></div>
        <div class="lib-info"><div class="lib-name">${t.title}</div><div class="lib-sub">${t.channel}</div></div>
        <button class="dl-btn" onclick="event.stopPropagation();downloadTrack('${t.id}','${t.title.replace(/'/g,"\\'")}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>`).join('');
    return;
  }

  if(tab==='history'){
    if(!history.length){el.innerHTML=`<div style="padding:40px;text-align:center;color:var(--muted)">${getLang().noHistory||'Belum ada riwayat 🎵'}</div>`;return;}
    el.innerHTML=history.map((t,i)=>`
      <div class="lib-item" onclick="playFromLib(${i},'history')">
        <div class="lib-icon"><img src="${t.thumb}" alt=""></div>
        <div class="lib-info"><div class="lib-name">${t.title}</div><div class="lib-sub">${t.channel}</div></div>
        <button onclick="event.stopPropagation();openMoreMenu('${t.id}','history')" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:8px">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>`).join('');
    return;
  }

  if(tab==='playlist'){
    if(!playlists.length){
      el.innerHTML=`<div style="padding:40px;text-align:center;color:var(--muted)">Belum ada playlist</div>
      <div style="padding:0 20px"><button class="modal-btn" onclick="openCreatePlaylist()">+ Buat Playlist</button></div>`;
      return;
    }
    el.innerHTML=playlists.map((pl,i)=>`
      <div class="lib-item" onclick="openPlaylistDetail(${i})">
        <div class="lib-icon">${pl.tracks[0]?`<img src="${pl.tracks[0].thumb}" alt="">`:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'}</div>
        <div class="lib-info"><div class="lib-name">${pl.name}</div><div class="lib-sub">${pl.tracks.length} lagu</div></div>
      </div>`).join('')+`<div style="padding:16px 20px"><button class="modal-btn" onclick="openCreatePlaylist()">+ Buat Playlist</button></div>`;
    return;
  }
}

function openTopPlayed(){
  const history=getHistory();
  const playCount={};
  history.forEach(t=>{playCount[t.id]=(playCount[t.id]||0)+1;});
  const sorted=history.filter((t,i,arr)=>arr.findIndex(x=>x.id===t.id)===i)
    .sort((a,b)=>(playCount[b.id]||0)-(playCount[a.id]||0)).slice(0,50);

  // Cover = thumbnail lagu teratas
  const coverThumb=sorted[0]?.thumb||'';
  const totalDur=sorted.reduce((s,t)=>s+(t.duration||0),0);
  const durStr=totalDur>0?`${Math.floor(totalDur/60)} menit`:`${sorted.length} lagu`;

  const el=document.getElementById('libList');
  el.innerHTML=`
    <!-- BACK -->
    <div style="padding:12px 20px 0;display:flex;align-items:center;gap:8px">
      <button onclick="currentLibTab='all';renderLibrary()" style="background:none;border:none;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:4px;font-size:13px;font-family:'Inter',sans-serif">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <span style="font-size:15px;font-weight:700;color:var(--text)">Teratas Saya 50</span>
    </div>

    <!-- HERO HEADER -->
    <div style="padding:20px 24px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px">
      <div style="width:220px;height:220px;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6);flex-shrink:0;background:#222">
        ${coverThumb?`<img src="${coverThumb}" style="width:100%;height:100%;object-fit:cover" alt="">`:'<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px">🎵</div>'}
      </div>
      <div>
        <div style="font-size:22px;font-weight:800;margin-bottom:4px">Teratas Saya 50</div>
        <div style="font-size:13px;color:var(--text2)">${sorted.length} lagu • ${durStr}</div>
      </div>
      <!-- Controls -->
      <div style="display:flex;align-items:center;gap:16px">
        <button onclick="shuffleTopPlayed()" style="width:44px;height:44px;border-radius:50%;background:var(--card2);border:none;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
        </button>
        <button onclick="playTopTrackDirect(0)" style="width:60px;height:60px;border-radius:50%;background:var(--accent);border:none;color:#000;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.3)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button style="width:44px;height:44px;border-radius:50%;background:var(--card2);border:none;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
    </div>

    <!-- LIST LABEL -->
    <div style="padding:4px 20px 8px;font-size:11px;font-weight:700;letter-spacing:1px;color:var(--text2);text-transform:uppercase">Sepanjang waktu</div>

    <!-- TRACK LIST -->
    ${!sorted.length?`<div style="padding:40px;text-align:center;color:var(--muted)">${getLang().noPlayCount||'Belum ada data pemutaran'}</div>`:
    sorted.map((t,i)=>`
      <div class="lib-item" style="cursor:pointer" onclick="playTopTrackDirect(${i})">
        <div style="width:28px;text-align:center;flex-shrink:0">
          <span class="track-num" id="top50num_${t.id}" style="color:var(--muted);font-size:13px;font-weight:700">${i+1}</span>
          <div class="track-num-eq" id="top50eq_${t.id}"><span></span><span></span><span></span></div>
        </div>
        <div class="lib-icon"><img src="${t.thumb}" alt="" onerror="this.style.background='#333'"></div>
        <div class="lib-info">
          <div class="lib-name">${t.title}</div>
          <div class="lib-sub">${t.channel}${playCount[t.id]>1?` • ${playCount[t.id]}x diputar`:''}</div>
        </div>
        <button onclick="event.stopPropagation();openMoreMenu('${t.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:8px">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>`).join('')}
  `;

  // Simpan sorted ke cache buat dipake playTopTrackDirect
  window._topPlayedTracks=sorted;
  // Restore equalizer kalau ada lagu yang lagi main
  setTimeout(()=>{
    const t=allTracks[curIdx];
    const isPlaying=yt&&yt.getPlayerState&&yt.getPlayerState()===1;
    if(t&&isPlaying) updateTop50Equalizer(true);
  },50);
}

function playTopTrackDirect(idx){
  const tracks=window._topPlayedTracks;
  if(!tracks||!tracks.length)return;
  allTracks=tracks;
  playTrack(idx,allTracks);
  openFullPlayer();
}

function shuffleTopPlayed(){
  const tracks=window._topPlayedTracks;
  if(!tracks||!tracks.length)return;
  const shuffled=[...tracks].sort(()=>Math.random()-.5);
  window._topPlayedTracks=shuffled;
  allTracks=shuffled;
  playTrack(0,allTracks);
  openFullPlayer();
}

function playFromLib(idx,source){
  let tracks=[];
  if(source==='liked')tracks=getLiked();
  if(source==='history')tracks=getHistory();
  if(!tracks.length)return;
  allTracks=tracks;playTrack(idx,allTracks);
}

// ===== PLAYLIST =====
let editingPlaylistIdx=-1;
function openCreatePlaylist(){editingPlaylistIdx=-1;document.getElementById('playlistModalTitle').textContent=getLang().createPlaylist||'Buat Playlist';document.getElementById('playlistNameInput').value='';document.getElementById('playlistModal').classList.add('open');}
function closePlaylistModal(){document.getElementById('playlistModal').classList.remove('open');}
function savePlaylist(){
  const name=document.getElementById('playlistNameInput').value.trim();if(!name)return;
  const pls=getPlaylists();
  const isNew=editingPlaylistIdx<0;
  if(editingPlaylistIdx>=0)pls[editingPlaylistIdx].name=name;else pls.push({name,tracks:[]});
  savePlaylists(pls);closePlaylistModal();renderLibrary();showToast(getLang().playlistSaved||'✅ Playlist disimpan!');
  if(isNew)_trackMissionProgress('playlist_create',1);
}
function openPlaylistDetail(idx){
  const pls=getPlaylists();const pl=pls[idx];if(!pl)return;
  const el=document.getElementById('libList');
  el.innerHTML=`
    <div style="padding:16px 20px 8px;display:flex;align-items:center;gap:12px">
      <button onclick="currentLibTab='playlist';renderLibrary()" style="background:none;border:none;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:4px;font-size:13px;font-family:'Inter',sans-serif">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Kembali
      </button>
      <div style="font-size:16px;font-weight:800;flex:1">${pl.name}</div>
      <button onclick="deletePl(${idx})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;font-family:'Inter',sans-serif">Hapus</button>
    </div>
    ${!pl.tracks.length?'<div style="padding:40px;text-align:center;color:var(--muted)">Playlist kosong. Putar lagu dan klik ⋯ untuk menambahkan.</div>':
    pl.tracks.map((t,i)=>`
      <div class="lib-item" onclick="playFromPlaylist(${idx},${i})">
        <div class="lib-icon"><img src="${t.thumb}" alt=""></div>
        <div class="lib-info"><div class="lib-name">${t.title}</div><div class="lib-sub">${t.channel}</div></div>
        <button onclick="event.stopPropagation();removeFrPl(${idx},${i})" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:8px;font-size:18px">×</button>
      </div>`).join('')}
    ${pl.tracks.length?`<div style="padding:16px 20px"><button class="modal-btn" onclick="playFromPlaylist(${idx},0)">▶ Putar Semua</button></div>`:''}`;
}
function playFromPlaylist(plIdx,trackIdx){const pls=getPlaylists();const pl=pls[plIdx];if(!pl||!pl.tracks.length)return;allTracks=pl.tracks;playTrack(trackIdx,allTracks);}
function deletePl(idx){const pls=getPlaylists();pls.splice(idx,1);savePlaylists(pls);currentLibTab='playlist';renderLibrary();showToast(getLang().playlistDeleted||'Playlist dihapus');}
function removeFrPl(plIdx,trackIdx){const pls=getPlaylists();pls[plIdx].tracks.splice(trackIdx,1);savePlaylists(pls);openPlaylistDetail(plIdx);}

let trackToAddToPlaylist=null;
function openAddToPlaylist(t){
  trackToAddToPlaylist=t;
  const pls=getPlaylists();
  const el=document.getElementById('playlistChoices');
  if(!pls.length){el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:8px 0 16px">Belum ada playlist. Buat dulu!</div>';}
  else{el.innerHTML=pls.map((pl,i)=>`<div class="playlist-item" onclick="addTrackToPl(${i})"><div class="pl-icon">${pl.tracks[0]?`<img src="${pl.tracks[0].thumb}" alt="">`:''}</div><div><div style="font-size:14px;font-weight:600">${pl.name}</div><div style="font-size:12px;color:var(--text2)">${pl.tracks.length} lagu</div></div></div>`).join('');}
  el.innerHTML+=`<button class="modal-btn" style="margin-top:12px" onclick="closeAddToPlaylist();openCreatePlaylist()">+ Buat Playlist Baru</button>`;
  document.getElementById('addToPlaylistModal').classList.add('open');
}
function addTrackToPl(idx){
  if(!trackToAddToPlaylist)return;
  const pls=getPlaylists();
  if(!pls[idx].tracks.some(t=>t.id===trackToAddToPlaylist.id)){pls[idx].tracks.push(trackToAddToPlaylist);savePlaylists(pls);showToast(`${getLang().addedToPlaylist||'✅ Ditambahkan ke'} ${pls[idx].name}`);_trackMissionProgress('playlist_add',1);}
  else showToast(getLang().alreadyInPlaylist||'Lagu sudah ada di playlist ini');
  closeAddToPlaylist();
}
function closeAddToPlaylist(){document.getElementById('addToPlaylistModal').classList.remove('open');}

function openMoreMenu(id,source){
  let t=null;
  if(source==='fullplayer'){t=allTracks[curIdx]||null;}
  else if(source==='history'){t=getHistory().find(x=>x.id===id);}
  else{t=(window._topPlayedTracks||[]).find(x=>x.id===id)||(getHistory().find(x=>x.id===id));}
  if(!t)return;

  const existing=document.getElementById('trackMoreSheet');
  if(existing)existing.remove();
  const existingOv=document.getElementById('trackMoreOverlay');
  if(existingOv)existingOv.remove();

  const sheet=document.createElement('div');
  sheet.id='trackMoreSheet';
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-radius:20px 20px 0 0;padding:20px;z-index:9999;box-shadow:0 -8px 40px rgba(0,0,0,.5)';
  const tJson=JSON.stringify({id:t.id,title:t.title,channel:t.channel,thumb:t.thumb});
  sheet.innerHTML=`
    <div style="width:36px;height:4px;background:var(--muted);border-radius:2px;margin:0 auto 16px"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <img src="${t.thumb}" style="width:48px;height:48px;border-radius:8px;object-fit:cover">
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3">${t.title}</div>
        <div style="font-size:12px;color:var(--text2)">${t.channel}</div>
      </div>
    </div>
    <div onclick="openAddToPlaylist(window._moreMenuTrack);closeMoreMenu()" style="display:flex;align-items:center;gap:16px;padding:14px 0;cursor:pointer">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <span style="font-size:15px;color:var(--text)">Tambah ke Playlist</span>
    </div>
    <div onclick="removeFromSource('${t.id}','${source||'top50'}');closeMoreMenu()" style="display:flex;align-items:center;gap:16px;padding:14px 0;cursor:pointer">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      <span style="font-size:15px;color:#ff4444">Hapus</span>
    </div>
  `;
  window._moreMenuTrack=t;

  const overlay=document.createElement('div');
  overlay.id='trackMoreOverlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998';
  overlay.onclick=closeMoreMenu;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
}

function closeMoreMenu(){
  document.getElementById('trackMoreSheet')?.remove();
  document.getElementById('trackMoreOverlay')?.remove();
}

function removeFromSource(id,source){
  const h=getHistory().filter(x=>x.id!==id);
  saveHistory(h);
  if(window._topPlayedTracks){
    window._topPlayedTracks=window._topPlayedTracks.filter(x=>x.id!==id);
  }
  showToast('🗑️ Lagu dihapus');
  if(source==='history'){
    renderLibrary();
  } else {
    openTopPlayed();
  }
}

function downloadCurrent(){const t=allTracks[curIdx];if(!t)return;downloadTrack(t.id,t.title);}
async function downloadTrack(id,title){
  showToast('⬇️ Menyiapkan audio...');
  try{
    const form=new URLSearchParams();
    form.append('url',`https://www.youtube.com/watch?v=${id}`);
    const res=await fetch('https://youtube-to-mp3-downloader1.p.rapidapi.com/output.php',{
      method:'POST',
      headers:{
        'Content-Type':'application/x-www-form-urlencoded',
        'x-rapidapi-host':'youtube-to-mp3-downloader1.p.rapidapi.com',
        'x-rapidapi-key':'05d72b013cmshde1758b1360e267p1051efjsna1e9c06d073a'
      },
      body:form
    });
    const data=await res.json();
    const link=data?.link||data?.url||data?.download_url||data?.dlink;
    if(!link) throw new Error('No download link');
    window.open(link,'_blank');
    showToast('🎵 Download dimulai!');
    _saveDownloaded(id,title);
  }catch(e){
    console.error(e);
    showToast('❌ Gagal download, coba lagi');
  }
}
function _saveDownloaded(id,title){
  const dl=getDownloaded();
  if(!dl.find(x=>x.id===id)){
    const thumb=allTracks[curIdx]?.thumb||'';
    dl.unshift({id,title,thumb,addedAt:Date.now()});
    saveDownloaded(dl);
  }
}

// ===== SEARCH FILTER =====
let lastRawResults=[];
let lastSearchQuery='';

document.getElementById('searchChips').addEventListener('click',e=>{
  const c=e.target.closest('.chip');if(!c)return;
  document.querySelectorAll('#searchChips .chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');
  currentSearchFilter=c.dataset.filter;
  if(lastSearchQuery) applySearchFilter();
});

async function applySearchFilter(){
  const f=currentSearchFilter;
  const q=lastSearchQuery;
  const el=document.getElementById('searchResults');

  if(f==='artis'){
    el.innerHTML=`<div class="loading"><div class="spin"></div><span>${getLang().searching||'Mencari...'}</span></div>`;
    const results=await ytSearch(`${q} official music video`,20);
    // Deduplicate by channel
    const seen=new Set(), artists=[];
    for(const t of results){
      if(!seen.has(t.channel)){seen.add(t.channel);artists.push(t);}
    }
    if(!artists.length){el.innerHTML=`<div class="search-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>${getLang().noResult2||'Tidak ada hasil 😔'}</p></div>`;return;}
    el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:8px 0">
      ${artists.map(a=>`
        <div style="cursor:pointer;text-align:center" onclick="openArtistByName('${a.channel.replace(/'/g,"\'")}','${a.thumb.replace(/'/g,"\'")}')">
          <img src="${a.thumb}" alt="" draggable="false" onerror="this.style.background='#333'" style="width:90px;height:90px;border-radius:50%;object-fit:cover;display:block;margin:0 auto 8px;background:#222;pointer-events:none;user-select:none;-webkit-user-drag:none">
          <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.channel}</div>
          <div style="font-size:11px;color:var(--text2)">Artis</div>
        </div>`).join('')}
    </div>`;
    return;
  }

  if(f==='album'){
    el.innerHTML=`<div class="loading"><div class="spin"></div><span>${getLang().searching||'Mencari...'}</span></div>`;
    const results=await ytSearch(`${q} full album playlist`,16);
    if(!results.length){el.innerHTML=`<div class="search-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>${getLang().noResult2||'Tidak ada hasil 😔'}</p></div>`;return;}
    el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:8px 0">
      ${results.map((t,i)=>`
        <div style="cursor:pointer" onclick="playSearchAlbum(${i})">
          <img src="${t.thumb}" alt="" draggable="false" onerror="this.style.background='#333'" style="width:100%;height:140px;border-radius:10px;object-fit:cover;display:block;margin-bottom:8px;background:#222;pointer-events:none;user-select:none;-webkit-user-drag:none">
          <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.title}</div>
          <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.channel}</div>
        </div>`).join('')}
    </div>`;
    lastRawResults=results; allTracks=results;
    return;
  }

  // lagu / video / semua — filter dari lastRawResults biasa
  let filtered=lastRawResults;
  if(f==='lagu'){
    filtered=lastRawResults.filter(t=>{
      const tl=t.title.toLowerCase();
      return !tl.includes('podcast')&&!tl.includes('full album')&&!tl.includes('compilation')&&!tl.includes('kompilasi');
    });
  } else if(f==='video'){
    filtered=lastRawResults.filter(t=>{
      const tl=t.title.toLowerCase();
      return tl.includes('video')||tl.includes('mv')||tl.includes('live')||tl.includes('official');
    });
  }
  if(!filtered.length) filtered=lastRawResults;
  allTracks=filtered;curIdx=-1;renderSearch(filtered);
}

function playSearchAlbum(idx){
  if(!allTracks[idx])return;
  playTrack(idx,allTracks);
}

// ===== RENDER =====
function renderSpeedGrid(tracks){
  document.getElementById('speedGrid').innerHTML=tracks.slice(0,9).map((t,i)=>`
    <div class="speed-card anim" style="animation-delay:${i*.04}s" onclick="playTrack(${i},allTracks)">
      <img src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="speed-card-label">${t.title}</div>
    </div>`).join('');
}
function renderQP(tracks){
  document.getElementById('qpList').innerHTML=tracks.slice(0,8).map((t,i)=>`
    <div class="qp-item anim ${i===curIdx?'playing':''}" style="animation-delay:${i*.04}s" onclick="playTrack(${i},allTracks)">
      <img class="qp-thumb" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="qp-info"><div class="qp-title">${t.title}</div><div class="qp-artist">${t.channel}</div></div>
      <button class="qp-more" onclick="event.stopPropagation();openAddToPlaylist(allTracks[${i}])">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>`).join('');
}
function renderHCards(id,tracks,offset=0){
  document.getElementById(id).innerHTML=tracks.slice(offset,offset+8).map((t,i)=>`
    <div class="h-card anim" style="animation-delay:${i*.04}s" onclick="playTrack(${i+offset},allTracks)">
      <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="h-card-title">${t.title}</div>
      <div class="h-card-sub">${t.channel}</div>
    </div>`).join('');
}
function renderArtists(tracks){
  const seen=new Set(),artists=[];
  for(const t of tracks){if(!seen.has(t.channel)){seen.add(t.channel);artists.push(t);}if(artists.length>=6)break;}
  document.getElementById('artistList').innerHTML=artists.map((t,i)=>`
    <div class="artist-card anim" style="animation-delay:${i*.04}s" onclick="openArtistByName('${t.channel.replace(/'/g,"\\'")}','${t.thumb.replace(/'/g,"\\'")}')">
      <img class="artist-img" src="${t.thumb}" alt="">
      <div class="artist-name">${t.channel}</div>
      <div class="artist-role">Artis</div>
    </div>`).join('');
}
function renderSearch(tracks){
  const el=document.getElementById('searchResults');
  if(!tracks.length){el.innerHTML=`<div class="search-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>${getLang().noResult2||"Tidak ada hasil 😔"}</p></div>`;return;}
  el.innerHTML=`<div class="qp-list">${tracks.map((t,i)=>`
    <div class="qp-item anim" style="animation-delay:${i*.04}s" onclick="playTrack(${i},allTracks)">
      <img class="qp-thumb" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="qp-info"><div class="qp-title">${t.title}</div><div class="qp-artist">${t.channel}</div></div>
      <button class="qp-more" onclick="event.stopPropagation();openAddToPlaylist(allTracks[${i}])">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>`).join('')}</div>`;
}

// ===== ABOUT ARTIST IN PLAYER =====
let _aboutArtistCache={};
let _currentArtistChannelId='';

async function updateAboutArtist(name, thumb){
  const el=document.getElementById('fpAboutArtist');
  if(!el)return;
  const cleanName=name.replace(/VEVO/gi,'').replace(/-\s*Topic$/i,'').replace(/Official/gi,'').replace(/Music/gi,'').trim();

  // Reset UI
  document.getElementById('fpArtistNameBig').textContent=cleanName;
  document.getElementById('fpArtistBanner').src=thumb;
  document.getElementById('fpArtistListeners').textContent='';
  document.getElementById('fpArtistBio').innerHTML=`<div style="display:flex;gap:8px;align-items:center"><div class="spin" style="display:block;width:14px;height:14px;border-width:2px;flex-shrink:0"></div><span style="color:var(--muted);font-size:12px">Memuat info artis...</span></div>`;
  document.getElementById('fpArtistBioMore').style.display='none';
  document.getElementById('fpExploreSection').style.display='none';
  // Update tombol subscribe
  const subBtn=document.getElementById('fpSubscribeBtn');
  const updateSubBtn=()=>{
    const subbed=isSubscribed(cleanName);
    subBtn.textContent=subbed?`✓ ${getLang().subscribed||'Subscribed'}`:`${getLang().subscribe||'Subscribe'}`;
    subBtn.style.background=subbed?'var(--accent)':'none';
    subBtn.style.color=subbed?'#000':'#fff';
    subBtn.style.borderColor=subbed?'var(--accent)':'rgba(255,255,255,0.3)';
  };
  updateSubBtn();
  subBtn.onclick=()=>{
    const subbed=isSubscribed(cleanName);
    if(subbed) unsubscribeArtist(cleanName);
    else subscribeArtist(cleanName, document.getElementById('fpArtistBanner').src);
    updateSubBtn();
  };
  el.style.display='block';

  // Pakai cache
  if(_aboutArtistCache[cleanName]){
    _renderAboutArtist(_aboutArtistCache[cleanName]);
    return;
  }

  // Fetch lagu artis (buat banner + explore) dan bio paralel
  try{
    // Jalankan fetch lagu + generate bio secara paralel
    const [tracks, bio] = await Promise.all([
      ytSearch(`${cleanName} official music`,8),
      _generateArtistBio(cleanName)
    ]);
    const bannerThumb=tracks[0]?.thumb||thumb;
    document.getElementById('fpArtistBanner').src=bannerThumb;

    const data={name:cleanName,thumb:bannerThumb,bio,tracks,channelName:cleanName};
    _aboutArtistCache[cleanName]=data;
    _renderAboutArtist(data);
  }catch(e){
    console.error('updateAboutArtist error:',e);
    document.getElementById('fpArtistBio').textContent='Tidak ada info tersedia.';
  }
}

async function _generateArtistBio(artistName){
  const lang=getAiLang();
  const cacheKey=artistName+'__'+lang;

  // Cek cache Firestore dulu
  try{
    const cached=await _getArtistBioFromFirestore(cacheKey);
    if(cached) return cached;
  }catch(e){}

  // Generate via API dengan bahasa
  try{
    const resp=await fetch(`/api/artist-bio?name=${encodeURIComponent(artistName)}&lang=${encodeURIComponent(lang)}`);
    const data=await resp.json();
    const bio=data.bio||'';
    if(bio){
      _saveArtistBioToFirestore(cacheKey, bio);
    }
    return bio;
  }catch(e){return '';}
}

async function _getArtistBioFromFirestore(artistName){
  if(!currentUser||!firebaseApp) return null;
  try{
    const {getFirestore,doc,getDoc}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=getFirestore(firebaseApp);
    const key=artistName.toLowerCase().replace(/[^a-z0-9_]/g,'_').slice(0,100);
    const snap=await getDoc(doc(db,'users',currentUser.uid,'artist_bios',key));
    if(snap.exists()) return snap.data().bio||null;
  }catch(e){}
  return null;
}

async function _saveArtistBioToFirestore(artistName, bio){
  if(!currentUser||!firebaseApp) return;
  try{
    const {getFirestore,doc,setDoc}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=getFirestore(firebaseApp);
    const key=artistName.toLowerCase().replace(/[^a-z0-9_]/g,'_').slice(0,100);
    await setDoc(doc(db,'users',currentUser.uid,'artist_bios',key),{
      bio,
      artistName,
      savedAt:Date.now()
    });
  }catch(e){}
}

function _renderAboutArtist(data){
  document.getElementById('fpArtistBanner').src=data.thumb;
  document.getElementById('fpArtistNameBig').textContent=data.name;

  const bioEl=document.getElementById('fpArtistBio');
  bioEl._lastArtist=data.name;
  if(data.bio&&data.bio.trim()){
    bioEl.textContent=data.bio;
    bioEl.style.display='-webkit-box';
    bioEl.style.webkitLineClamp='3';
    bioEl.style.webkitBoxOrient='vertical';
    bioEl.style.overflow='hidden';
    document.getElementById('fpArtistBioMore').style.display='block';
  }else{
    bioEl.textContent='Info artis tidak tersedia.';
    bioEl.style.display='block';
    bioEl.style.overflow='visible';
    document.getElementById('fpArtistBioMore').style.display='none';
  }

  // Render "Jelajahi [Nama]"
  if(data.tracks&&data.tracks.length){
    const sec=document.getElementById('fpExploreSection');
    document.getElementById('fpExploreTitleEl').textContent=`${getLang().explore||'Jelajahi'} ${data.name}`;
    const tracksJson=JSON.stringify(data.tracks.map(x=>({id:x.id,title:x.title,channel:x.channel,thumb:x.thumb})));
    document.getElementById('fpExploreGrid').innerHTML=data.tracks.slice(0,8).map((t,i)=>`
      <div style="flex-shrink:0;width:110px;cursor:pointer" onclick='playTrack(${i},${tracksJson})'>
        <img src="${t.thumb}" draggable="false" style="width:110px;height:110px;border-radius:8px;object-fit:cover;display:block;margin-bottom:6px;pointer-events:none;background:#222">
        <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${t.title}</div>
        <div style="font-size:10px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${t.channel}</div>
      </div>`).join('');
    sec.style.display='block';
  }
}

function toggleArtistBio(){
  const el=document.getElementById('fpArtistBio');
  const btn=document.getElementById('fpArtistBioMore');
  const isExpanded=el.style.webkitLineClamp==='unset';
  if(isExpanded){
    el.style.webkitLineClamp='3';
    el.style.overflow='hidden';
    el.style.display='-webkit-box';
    el.style.webkitBoxOrient='vertical';
    btn.textContent='Tampilkan lebih banyak';
  } else {
    el.style.webkitLineClamp='unset';
    el.style.overflow='visible';
    el.style.display='block';
    btn.textContent='Tampilkan lebih sedikit';
  }
}

// ===== SUBSCRIBED ARTISTS =====
function getSubscribed(){try{return JSON.parse(localStorage.getItem(getUserKey('subscribed'))||'[]');}catch{return[];}}
function saveSubscribed(d){
  localStorage.setItem(getUserKey('subscribed'),JSON.stringify(d));
  syncToFirestore('subscribed',d);
}

function subscribeArtist(name, thumb){
  if(!name)return;
  const subs=getSubscribed();
  const exists=subs.find(x=>x.name===name);
  if(exists){
    showToast('✅ Sudah subscribe '+name);
    return;
  }
  subs.unshift({name,thumb:thumb||'',addedAt:Date.now()});
  saveSubscribed(subs);
  showToast('✅ Subscribe '+name+'!');
  if(currentPage==='library')renderLibrary();
}

function unsubscribeArtist(name){
  const subs=getSubscribed().filter(x=>x.name!==name);
  saveSubscribed(subs);
  showToast('Unsubscribe '+name);
  renderLibrary();
}

function isSubscribed(name){
  return getSubscribed().some(x=>x.name===name);
}

// ===== ARTIST PAGE =====
async function openArtistPage(){
  const t=allTracks[curIdx];
  if(!t){showToast('Putar lagu dulu sebelum lihat artis');return;}
  closeFullPlayer();
  setTimeout(()=>openArtistByName(t.channel, t.thumb), 350);
}
async function openArtistByName(name,thumb){
  document.getElementById('artistHeroName').textContent=name;
  document.getElementById('artistAboutBadge').textContent=`${getLang().topSongs||'Artis'} • ${name}`;
  document.getElementById('artistAboutText').textContent='Memuat info artis...';
  _trackMissionProgress('artist_view',1);
  // Generate bio via Groq
  const cleanName=name.replace(/VEVO/gi,'').replace(/-\s*Topic$/i,'').replace(/Official/gi,'').replace(/Music/gi,'').trim();
  _generateArtistBio(cleanName).then(bio=>{
    const el=document.getElementById('artistAboutText');
    if(bio&&bio.trim()){
      el.textContent=bio;
    } else {
      el.textContent=(getLang().aboutText||'Dengarkan karya-karya terbaik dari artis ini.').replace('artis ini',cleanName);
    }
  });
  document.getElementById('artistHeroImg').src=thumb;
  document.getElementById('artistTopSongs').innerHTML='<div class="loading"><div class="spin"></div></div>';
  document.getElementById('artistPage').classList.add('open');
  setTimeout(()=>_updateArtistSubBtn(name),100);
  // Coba beberapa query, pakai yang ada hasilnya
  let tracks=await ytSearch(`${cleanName} official music video`,10);
  if(tracks.length<3) tracks=await ytSearch(`${cleanName} song`,10);
  if(tracks.length<3) tracks=await ytSearch(cleanName,10);
  currentArtistTracks=tracks;
  if(tracks.length)document.getElementById('artistHeroImg').src=tracks[0].thumb;
  const cleanForExtras=cleanName.trim();
  loadArtistExtras(cleanForExtras);
  document.getElementById('artistTopSongs').innerHTML=tracks.map((tr,i)=>`
    <div class="qp-item anim" style="animation-delay:${i*.04}s" onclick="playArtistTrack(${i})">
      <img class="qp-thumb" src="${tr.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="qp-info"><div class="qp-title">${tr.title}</div><div class="qp-artist">${tr.channel}</div></div>
      <button class="qp-more" onclick="event.stopPropagation();openAddToPlaylist(currentArtistTracks[${i}])">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>`).join('');
}
function closeArtistPage(){document.getElementById('artistPage').classList.remove('open');}
function playArtistTopSong(){if(currentArtistTracks.length){allTracks=currentArtistTracks;playTrack(0,allTracks);closeArtistPage();}}
function playArtistTrack(idx){allTracks=currentArtistTracks;playTrack(idx,allTracks);closeArtistPage();}

let artistSubscribed={};
function toggleArtistSubscribe(){
  const name=document.getElementById('artistHeroName').textContent;
  const thumb=document.getElementById('artistHeroImg').src||'';
  const subbed=isSubscribed(name);
  if(subbed) unsubscribeArtist(name);
  else subscribeArtist(name,thumb);
  _updateArtistSubBtn(name);
}
function _updateArtistSubBtn(name){
  const btn=document.getElementById('artistSubBtn');
  if(!btn)return;
  const subbed=isSubscribed(name);
  btn.textContent=subbed?'Subscribed':'Subscribe';
  btn.style.background=subbed?'var(--accent)':'none';
  btn.style.color=subbed?'#000':'var(--text)';
  btn.style.border=subbed?'none':'1px solid rgba(255,255,255,.3)';
}

async function playArtistRadio(){
  const name=document.getElementById('artistHeroName').textContent.replace(/VEVO/gi,'').replace(/-\s*Topic$/i,'').trim();
  showToast(getLang().loadingRadio||'📻 Memuat radio...');
  const tracks=await ytSearch(`${name} similar artists mix radio`,12);
  if(tracks.length){allTracks=tracks;playTrack(0,allTracks);closeArtistPage();}
}

let artistSinglesTracks=[],artistVideosTracks=[],artistFeaturedTracks=[];
async function loadArtistExtras(name){
  // Singles & EPs
  const singles=await ytSearch(`${name} single EP official audio 2024 2025`,8);
  artistSinglesTracks=singles;
  const singlesEl=document.getElementById('artistSinglesList');
  if(singlesEl) singlesEl.innerHTML=singles.length?singles.map((t,i)=>`
    <div class="h-card anim" onclick="playArtistSingle(${i})">
      <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="h-card-title">${t.title}</div>
      <div class="h-card-sub">${t.channel}</div>
    </div>`).join(''):'<div style="padding:20px;color:var(--muted);font-size:12px">Tidak ada</div>';

  // Videos
  const videos=await ytSearch(`${name} official music video mv`,6);
  artistVideosTracks=videos;
  const videosEl=document.getElementById('artistVideosList');
  if(videosEl) videosEl.innerHTML=videos.length?videos.map((t,i)=>`
    <div class="video-card anim" onclick="playArtistVideo(${i})">
      <img class="video-thumb" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="h-card-title" style="padding:0 4px">${t.title}</div>
      <div class="h-card-sub" style="padding:0 4px">${t.channel}</div>
    </div>`).join(''):'<div style="padding:20px;color:var(--muted);font-size:12px">Tidak ada</div>';

  // Featured on
  const featured=await ytSearch(`${name} featured collaboration playlist`,6);
  artistFeaturedTracks=featured;
  const featuredEl=document.getElementById('artistFeaturedList');
  if(featuredEl) featuredEl.innerHTML=featured.length?featured.map((t,i)=>`
    <div class="h-card anim" onclick="playArtistFeatured(${i})">
      <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="h-card-title">${t.title}</div>
      <div class="h-card-sub">${t.channel}</div>
    </div>`).join(''):'<div style="padding:20px;color:var(--muted);font-size:12px">Tidak ada</div>';
}
function playArtistSingle(idx){allTracks=artistSinglesTracks;playTrack(idx,allTracks);}
function playArtistVideo(idx){allTracks=artistVideosTracks;playTrack(idx,allTracks);}
function playArtistFeatured(idx){allTracks=artistFeaturedTracks;playTrack(idx,allTracks);}

// ===== EXTRA SECTIONS =====
const EXTRA_SECTIONS={
  'nadin amizah pamungkas hindia popular songs':[
    ['Nadin Amizah • Popular','nadin amizah official music video'],
    ['Pamungkas • Top Songs','pamungkas official music video'],
    ['Hindia • Lagu Pilihan','hindia official music video']
  ],
  'kunto aji maliq d essentials tejana lagu populer':[
    ['Kunto Aji','kunto aji official music video'],
    ['Maliq & D\'Essentials','maliq dessentials official music'],
    ['Tejana / Indie Jakarta','indie jakarta pop official']
  ],
  'nadin amizah official music video':[
    ['Album Selamat Ulang Tahun','nadin amizah selamat ulang tahun album'],
    ['Serupa','nadin amizah serupa official'],
    ['Bertaut','nadin amizah bertaut official']
  ],
  'pamungkas official music video':[
    ['Flying Solo','pamungkas flying solo album'],
    ['To The Bone','pamungkas to the bone official'],
    ['One Only','pamungkas one only official']
  ],
  'hindia official music video lagu':[
    ['Rumah Ke Rumah','hindia rumah ke rumah official'],
    ['Belum Tidur','hindia belum tidur official'],
    ['Evakuasi','hindia evakuasi official']
  ],
  'tulus official music video':[
    ['Monokrom','tulus monokrom official'],
    ['Gajah','tulus gajah official'],
    ['Baru','tulus baru official']
  ],
  'raisa official music video lagu populer':[
    ['Raisa Top Songs','raisa andriana official music'],
    ['Serba Salah','raisa serba salah official'],
    ['Melangkah','raisa melangkah official']
  ],
  'rizky febian official music video':[
    ['Kesempurnaan Cinta','rizky febian kesempurnaan cinta'],
    ['Indah Pada Waktunya','rizky febian indah pada waktunya'],
    ['Kita Tidak Sama','rizky febian kita tidak sama']
  ],
  'tiara andini official music video':[
    ['Perdana','tiara andini perdana official'],
    ['Gemintang Hatiku','tiara andini gemintang hatiku'],
    ['Merasa Indah','tiara andini merasa indah official']
  ],
  'bedroom pop indonesia indie official':[
    ['Hindia x Nadin','hindia nadin amizah official'],
    ['Reality Club','reality club official music'],
    ['Feast','feast band official music video']
  ],
  'the rain noah band noah official music':[
    ['Noah Top Songs','noah band official music video'],
    ['The Rain','the rain band official music'],
    ['Peterpan','peterpan band official music']
  ],
  'lofi chill hip hop beats official':[
    ['Lo-Fi Hip Hop','lofi hip hop chill beats'],
    ['Study Beats','study lofi beats relax'],
    ['Chill Vibes','chill vibes playlist lofi']
  ],
  'taylor swift official music video':[
    ['Midnights','taylor swift midnights official'],
    ['Anti-Hero','taylor swift anti hero official'],
    ['Cruel Summer','taylor swift cruel summer official']
  ],
  'billie eilish official music video':[
    ['Hit Me Hard','billie eilish hit me hard official'],
    ['Bad Guy','billie eilish bad guy official'],
    ['Happier Than Ever','billie eilish happier than ever official']
  ],
  'the weeknd official music video':[
    ['After Hours','the weeknd after hours official'],
    ['Blinding Lights','the weeknd blinding lights official'],
    ['Starboy','the weeknd starboy official']
  ]
};
let extraTrackPools={},extraSectionCount=0,extraSectionsLoading=false,currentChipQ='nadin amizah pamungkas hindia popular songs';


// ===== TRANSLATIONS =====
const LANGS = {
  id: {
    flag:'🇮🇩', name:'Indonesia',
    home:'Beranda', search:'Mencari', library:'Pustaka', developer:'Developer',
    trending:'🔥 Trending Sekarang', speedDial:'Speed dial', quickPick:'Pilihan cepat',
    playAll:'Putar semua', keepListening:'Tetap mendengarkan', trendingNow:'Trending Now',
    newReleases:'New Releases', fromCommunity:'From the community',
    viralTiktok:'Viral on TikTok', eidGetaway:'For Eid Getaways',
    surrender:'Surrender to the Beat', throwback:'Fun Throwbacks',
    feelgood:'Feel-good Rock', acoustic:'Acoustic Chill', top50:'Top 50 Indonesia',
    upNext:'UP NEXT', lyrics:'LYRICS', comments:'KOMENTAR', seeArtist:'LIHAT ARTIS', commentPlaceholder:'Tulis komentar...', commentsEmpty:'💬 Belum ada komentar. Jadilah yang pertama!', commentJustNow:'Baru saja',
    searchPlaceholder:'Ketik lalu tekan Cari...', searchBtn:'Cari',
    noResult:'Tidak ada hasil 😔', searching:'Mencari...',
    allFilter:'Semua', songFilter:'Lagu', videoFilter:'Video', albumFilter:'Album', artistFilter:'Artis',
    libTitle:'Pustaka', liked:'Disukai', history:'Riwayat', playlist:'Playlist',
    aboutTitle:'Tentang', leadDev:'Lead Developer', madeBy:'MADE BY ALAN',
    installApp:'Install Aplikasi', appVersion:'Versi Aplikasi',
    topSongs:'Top songs', singlesEps:'Singles & EPs', videos:'Videos', featuredOn:'Featured on',
    subscribe:'Subscribe', radio:'Radio',
    homeQuery:'nadin amizah pamungkas hindia popular songs',
    aboutArtist:'TENTANG ARTIS', explore:'Jelajahi', subscribed:'Subscribed', bioLang:'id',
    playAll2:'Putar semua',
    noQueue:'Belum ada antrian',
    noLiked:'Belum ada lagu yang disukai ❤️',
    noHistory:'Belum ada riwayat 🎵',
    noPlaylist:'Belum ada playlist',
    noPlayCount:'Belum ada data pemutaran',
    noPlaylistCreate:'Belum ada playlist. Buat dulu!',
    addedToLiked:'❤️ Ditambahkan ke Disukai',
    removedFromLiked:'Dihapus dari Disukai',
    loadingLyrics:'Memuat lirik...',
    noLyrics:'Lirik tidak tersedia 😔',
    playingFrom:'Memutar dari Trending',
    songs:'lagu',
    played:'lagu diputar',
    myTop50:'Teratas Saya 50',
    back:'Kembali',
    createPlaylist:'Buat playlist baru',
    savePlaylist:'Simpan',
    cancel:'Batal',
    playlistName:'Nama playlist...',
    addToPlaylist:'Tambah ke Playlist',
    createNew:'+ Buat Playlist Baru',
    alreadyInPlaylist:'Lagu sudah ada di playlist ini',
    addedToPlaylist:'✅ Ditambahkan ke',
    playlistSaved:'✅ Playlist disimpan!',
    playlistDeleted:'Playlist dihapus',
    searchEmpty:'Cari lagu, album, atau artis',
    downloaded:'Diunduh',
    uploaded:'Diunggah',
    topPlayed:'Teratas Saya 50',
    historyCache:'Riwayat / Tersimpan di Cache',
    aboutText:'Dengarkan karya-karya terbaik dari artis ini. Jelajahi lagu populer, album terbaru, dan single yang telah dirilis.',
    devAboutText:'Platform streaming musik modern gratis tanpa iklan. Nikmati jutaan lagu, buat daftar putar Anda sendiri, dan temukan musik baru setiap hari dengan kualitas audio premium tanpa batasan.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Link belum tersedia',
    subscribeOk:'✅ Subscribe berhasil!',
    unsubscribe:'Unsubscribe',
    loadingRadio:'📻 Memuat radio...',
    sortDate:'Tanggal ditambahkan ↓',
    noResult2:'Tidak ada hasil 😔',
        mostPlayed:'Lagu yang paling sering diputar',
    downloadSoon:'Fitur download akan segera hadir',
    uploadSoon:'Fitur upload akan segera hadir',
    uploadSub:'Unggah musik sendiri',
    downloadingAudio:'⬇️ Menyiapkan audio...',
    downloadStarted:'Download dimulai!',
    downloadFailed:'Gagal download. Coba lagi.',
chipQueries:[
      {label:'Beranda',q:'nadin amizah pamungkas hindia popular songs'},
      {label:'Pop Indo',q:'kunto aji maliq d essentials tejana lagu populer'},
      {label:'Nadin Amizah',q:'nadin amizah official music video'},
      {label:'Pamungkas',q:'pamungkas official music video'},
      {label:'Indie Indo',q:'bedroom pop indonesia indie official'},
      {label:'Rock Indo',q:'the rain noah band noah official music'},
      {label:'Lo-Fi',q:'lofi chill hip hop beats official'},
      {label:'Taylor Swift',q:'taylor swift official music video'},
      {label:'Billie Eilish',q:'billie eilish official music video'},
    ]
  },
  ru: {
    flag:'🇷🇺', name:'Россия',
    home:'Главная', search:'Поиск', library:'Библиотека', developer:'Разработчик',
    trending:'🔥 В тренде', speedDial:'Быстрый набор', quickPick:'Быстрый выбор',
    playAll:'Играть всё', keepListening:'Продолжай слушать', trendingNow:'В тренде',
    newReleases:'Новые релизы', fromCommunity:'От сообщества',
    viralTiktok:'Вирусно в TikTok', eidGetaway:'Хиты лета',
    surrender:'Отдайся ритму', throwback:'Ностальгия',
    feelgood:'Рок для настроения', acoustic:'Акустика', top50:'Топ 50 Россия',
    upNext:'ДАЛЕЕ', lyrics:'ТЕКСТ', comments:'КОММЕНТАРИИ', seeArtist:'АРТИСТ', commentPlaceholder:'Написать комментарий...', commentsEmpty:'💬 Комментариев пока нет. Будьте первым!', commentJustNow:'Только что',
    aboutArtist:'ОБ АРТИСТЕ', explore:'Исследуйте', subscribed:'Подписан', bioLang:'ru',
    searchPlaceholder:'Введите и нажмите Поиск...', searchBtn:'Поиск',
    noResult:'Нет результатов 😔', searching:'Поиск...',
    allFilter:'Все', songFilter:'Песни', videoFilter:'Видео', albumFilter:'Альбом', artistFilter:'Артист',
    libTitle:'Библиотека', liked:'Любимые', history:'История', playlist:'Плейлист',
    aboutTitle:'О нас', leadDev:'Ведущий разработчик', madeBy:'СДЕЛАНО АЛАНОМ',
    installApp:'Установить', appVersion:'Версия приложения',
    topSongs:'Лучшие песни', singlesEps:'Синглы и EP', videos:'Видео', featuredOn:'Участвует в',
    subscribe:'Подписаться', radio:'Радио',
    homeQuery:'russian popular music hits 2024',
    playAll2:'Играть всё',
    noQueue:'Очередь пуста',
    noLiked:'Нет понравившихся песен ❤️',
    noHistory:'История пуста 🎵',
    noPlaylist:'Нет плейлистов',
    noPlayCount:'Нет данных о воспроизведении',
    noPlaylistCreate:'Плейлистов нет. Создайте первый!',
    addedToLiked:'❤️ Добавлено в избранное',
    removedFromLiked:'Удалено из избранного',
    loadingLyrics:'Загрузка текста...',
    noLyrics:'Текст недоступен 😔',
    playingFrom:'Играет из Трендов',
    songs:'песен',
    played:'сыграно',
    myTop50:'Мой топ 50',
    back:'Назад',
    createPlaylist:'Создать плейлист',
    savePlaylist:'Сохранить',
    cancel:'Отмена',
    playlistName:'Название плейлиста...',
    addToPlaylist:'Добавить в плейлист',
    createNew:'+ Создать новый плейлист',
    alreadyInPlaylist:'Песня уже в плейлисте',
    addedToPlaylist:'✅ Добавлено в',
    playlistSaved:'✅ Плейлист сохранён!',
    playlistDeleted:'Плейлист удалён',
    searchEmpty:'Поиск песен, альбомов, артистов',
    downloaded:'Скачанные',
    uploaded:'Загруженные',
    topPlayed:'Мой топ 50',
    historyCache:'История / Кэш',
    aboutText:'Слушайте лучшие работы этого артиста. Изучайте популярные песни, новые альбомы и синглы.',
    devAboutText:'Современная бесплатная платформа для стриминга музыки без рекламы. Наслаждайтесь миллионами песен без ограничений.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Ссылка недоступна',
    subscribeOk:'✅ Подписка оформлена!',
    unsubscribe:'Отписаться',
    loadingRadio:'📻 Загрузка радио...',
    sortDate:'Дата добавления ↓',
    noResult2:'Нет результатов 😔',
        mostPlayed:'Самые часто воспроизводимые песни',
    downloadSoon:'Функция загрузки скоро появится',
    uploadSoon:'Функция загрузки скоро появится',
    uploadSub:'Загрузите свою музыку',
    downloadingAudio:'⬇️ Подготовка аудио...',
    downloadStarted:'Загрузка началась!',
    downloadFailed:'Ошибка загрузки. Попробуй снова.',
chipQueries:[
      {label:'Главная',q:'russian popular music hits 2024'},
      {label:'Поп',q:'russian pop music official'},
      {label:'Рок',q:'russian rock music official'},
      {label:'Хип-хоп',q:'russian hip hop rap official'},
      {label:'Классика',q:'russian classic hits official'},
      {label:'Новинки',q:'new russian music 2025'},
    ]
  },
  ph: {
    flag:'🇵🇭', name:'Philippines',
    home:'Home', search:'Hanapin', library:'Library', developer:'Developer',
    trending:'🔥 Trending Ngayon', speedDial:'Speed Dial', quickPick:'Mabilis na Pili',
    playAll:'I-play Lahat', keepListening:'Patuloy Makinig', trendingNow:'Trending',
    newReleases:'Bagong Labas', fromCommunity:'Mula sa Komunidad',
    viralTiktok:'Viral sa TikTok', eidGetaway:'OPM Hits',
    surrender:'Sumuko sa Ritmo', throwback:'Throwback',
    feelgood:'Feel-good Rock', acoustic:'Acoustic', top50:'Top 50 Pilipinas',
    upNext:'SUSUNOD', lyrics:'LIRIKA', comments:'KOMENTO', seeArtist:'ARTISTA', commentPlaceholder:'Sumulat ng komento...', commentsEmpty:'💬 Walang mga komento pa. Ikaw ang maging una!', commentJustNow:'Ngayon lang',
    aboutArtist:'TUNGKOL SA ARTISTA', explore:'I-explore', subscribed:'Naka-subscribe', bioLang:'fil',
    searchPlaceholder:'Mag-type at pindutin Hanapin...', searchBtn:'Hanapin',
    noResult:'Walang resulta 😔', searching:'Naghahanap...',
    allFilter:'Lahat', songFilter:'Kanta', videoFilter:'Video', albumFilter:'Album', artistFilter:'Artista',
    libTitle:'Library', liked:'Gusto', history:'Kasaysayan', playlist:'Playlist',
    aboutTitle:'Tungkol', leadDev:'Pangunahing Developer', madeBy:'GAWA NI ALAN',
    installApp:'I-install', appVersion:'Bersyon ng App',
    topSongs:'Pinakasikat', singlesEps:'Singles & EPs', videos:'Videos', featuredOn:'Kasama sa',
    subscribe:'Mag-subscribe', radio:'Radio',
    homeQuery:'OPM Filipino music popular hits 2024',
    playAll2:'I-play Lahat',
    noQueue:'Walang pila',
    noLiked:'Walang mga paboritong kanta ❤️',
    noHistory:'Walang kasaysayan 🎵',
    noPlaylist:'Walang playlist',
    noPlayCount:'Walang data ng pagpapatugtog',
    noPlaylistCreate:'Walang playlist. Gumawa muna!',
    addedToLiked:'❤️ Idinagdag sa Gusto',
    removedFromLiked:'Tinanggal sa Gusto',
    loadingLyrics:'Nilo-load ang lirika...',
    noLyrics:'Walang lirika 😔',
    playingFrom:'Nagpapatugtog mula sa Trending',
    songs:'kanta',
    played:'na pinatugtog',
    myTop50:'Aking Top 50',
    back:'Bumalik',
    createPlaylist:'Gumawa ng playlist',
    savePlaylist:'I-save',
    cancel:'Kanselahin',
    playlistName:'Pangalan ng playlist...',
    addToPlaylist:'Idagdag sa Playlist',
    createNew:'+ Gumawa ng Bagong Playlist',
    alreadyInPlaylist:'Nandoon na ang kanta',
    addedToPlaylist:'✅ Idinagdag sa',
    playlistSaved:'✅ Nai-save ang playlist!',
    playlistDeleted:'Natanggal ang playlist',
    searchEmpty:'Maghanap ng kanta, album, o artista',
    downloaded:'Na-download',
    uploaded:'Na-upload',
    topPlayed:'Aking Top 50',
    historyCache:'Kasaysayan / Cache',
    aboutText:'Pakinggan ang pinakamahusay na gawa ng artista. I-explore ang mga sikat na kanta at bagong album.',
    devAboutText:'Modernong libreng music streaming platform na walang ads. Mag-enjoy ng milyun-milyong kanta nang walang limitasyon.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Hindi available ang link',
    subscribeOk:'✅ Naka-subscribe na!',
    unsubscribe:'I-unsubscribe',
    loadingRadio:'📻 Naglo-load ng radyo...',
    sortDate:'Petsa ng pagdaragdag ↓',
    noResult2:'Walang resulta 😔',
        mostPlayed:'Pinaka-madalas na pinatugtog',
    downloadSoon:'Download feature coming soon',
    uploadSoon:'Upload feature coming soon',
    uploadSub:'I-upload ang sariling musika',
    downloadingAudio:'⬇️ Inihahanda ang audio...',
    downloadStarted:'Nagsimula ang download!',
    downloadFailed:'Download failed. Subukan muli.',
chipQueries:[
      {label:'Home',q:'OPM Filipino music popular hits 2024'},
      {label:'OPM',q:'OPM love songs official music video'},
      {label:'P-Pop',q:'ppop philippines official music video'},
      {label:'Rap',q:'filipino rap music official'},
      {label:'Rock',q:'filipino rock music official'},
      {label:'Lo-Fi',q:'lofi chill hip hop beats official'},
    ]
  },
  us: {
    flag:'🇺🇸', name:'USA',
    home:'Home', search:'Search', library:'Library', developer:'Developer',
    trending:'🔥 Trending Now', speedDial:'Speed Dial', quickPick:'Quick Picks',
    playAll:'Play All', keepListening:'Keep Listening', trendingNow:'Trending Now',
    newReleases:'New Releases', fromCommunity:'From the Community',
    viralTiktok:'Viral on TikTok', eidGetaway:'Summer Hits',
    surrender:'Surrender to the Beat', throwback:'Fun Throwbacks',
    feelgood:'Feel-good Rock', acoustic:'Acoustic Chill', top50:'Top 50 USA',
    upNext:'UP NEXT', lyrics:'LYRICS', comments:'COMMENTS', seeArtist:'SEE ARTIST', commentPlaceholder:'Write a comment...', commentsEmpty:'💬 No comments yet. Be the first!', commentJustNow:'Just now',
    aboutArtist:'ABOUT THE ARTIST', explore:'Explore', subscribed:'Subscribed', bioLang:'en',
    searchPlaceholder:'Type then press Search...', searchBtn:'Search',
    noResult:'No results 😔', searching:'Searching...',
    allFilter:'All', songFilter:'Songs', videoFilter:'Videos', albumFilter:'Albums', artistFilter:'Artists',
    libTitle:'Library', liked:'Liked', history:'History', playlist:'Playlist',
    aboutTitle:'About', leadDev:'Lead Developer', madeBy:'MADE BY ALAN',
    installApp:'Install App', appVersion:'App Version',
    topSongs:'Top Songs', singlesEps:'Singles & EPs', videos:'Videos', featuredOn:'Featured On',
    subscribe:'Subscribe', radio:'Radio',
    homeQuery:'usa popular music hits 2024 billboard',
    playAll2:'Play All',
    noQueue:'Queue is empty',
    noLiked:'No liked songs yet ❤️',
    noHistory:'No history yet 🎵',
    noPlaylist:'No playlists yet',
    noPlayCount:'No play data yet',
    noPlaylistCreate:'No playlists. Create one first!',
    addedToLiked:'❤️ Added to Liked',
    removedFromLiked:'Removed from Liked',
    loadingLyrics:'Loading lyrics...',
    noLyrics:'Lyrics not available 😔',
    playingFrom:'Playing from Trending',
    songs:'songs',
    played:'played',
    myTop50:'My Top 50',
    back:'Back',
    createPlaylist:'Create playlist',
    savePlaylist:'Save',
    cancel:'Cancel',
    playlistName:'Playlist name...',
    addToPlaylist:'Add to Playlist',
    createNew:'+ Create New Playlist',
    alreadyInPlaylist:'Song already in playlist',
    addedToPlaylist:'✅ Added to',
    playlistSaved:'✅ Playlist saved!',
    playlistDeleted:'Playlist deleted',
    searchEmpty:'Search songs, albums, or artists',
    downloaded:'Downloaded',
    uploaded:'Uploaded',
    topPlayed:'My Top 50',
    historyCache:'History / Cache',
    aboutText:'Listen to the best works from this artist. Explore popular songs, latest albums, and singles.',
    devAboutText:'Modern free music streaming platform with no ads. Enjoy millions of songs with premium audio quality.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Link not available',
    subscribeOk:'✅ Subscribed!',
    unsubscribe:'Unsubscribe',
    loadingRadio:'📻 Loading radio...',
    sortDate:'Date added ↓',
    noResult2:'No results 😔',
        mostPlayed:'Most frequently played songs',
    downloadSoon:'Download feature coming soon',
    uploadSoon:'Upload feature coming soon',
    uploadSub:'Upload your own music',
    downloadingAudio:'⬇️ Preparing audio...',
    downloadStarted:'Download started!',
    downloadFailed:'Download failed. Try again.',
chipQueries:[
      {label:'Home',q:'usa popular music hits 2024 billboard'},
      {label:'Pop',q:'american pop music official video 2024'},
      {label:'Hip-Hop',q:'us hip hop rap official music video'},
      {label:'R&B',q:'rnb soul music official video 2024'},
      {label:'Rock',q:'american rock music official video'},
      {label:'Country',q:'country music official video 2024'},
      {label:'Lo-Fi',q:'lofi chill hip hop beats official'},
    ]
  },
  ar: {
    flag:'🇸🇦', name:'العربية',
    home:'الرئيسية', search:'بحث', library:'المكتبة', developer:'المطور',
    trending:'🔥 الأكثر رواجاً', speedDial:'الاتصال السريع', quickPick:'اختيار سريع',
    playAll:'تشغيل الكل', keepListening:'استمر في الاستماع', trendingNow:'الأكثر رواجاً',
    newReleases:'إصدارات جديدة', fromCommunity:'من المجتمع',
    viralTiktok:'فيروسي على تيك توك', eidGetaway:'أغاني العيد',
    surrender:'استسلم للإيقاع', throwback:'ذكريات',
    feelgood:'موسيقى روك', acoustic:'أكوستيك', top50:'أفضل 50 عربي',
    upNext:'التالي', lyrics:'الكلمات', comments:'تعليقات', seeArtist:'الفنان', commentPlaceholder:'اكتب تعليقاً...', commentsEmpty:'💬 لا تعليقات بعد. كن الأول!', commentJustNow:'الآن',
    aboutArtist:'عن الفنان', explore:'استكشف', subscribed:'مشترك', bioLang:'ar',
    searchPlaceholder:'اكتب ثم اضغط بحث...', searchBtn:'بحث',
    noResult:'لا توجد نتائج 😔', searching:'جارٍ البحث...',
    allFilter:'الكل', songFilter:'أغاني', videoFilter:'فيديو', albumFilter:'ألبوم', artistFilter:'فنان',
    libTitle:'المكتبة', liked:'المفضلة', history:'السجل', playlist:'قائمة التشغيل',
    aboutTitle:'حول', leadDev:'المطور الرئيسي', madeBy:'صنع بواسطة ألان',
    installApp:'تثبيت التطبيق', appVersion:'إصدار التطبيق',
    topSongs:'أفضل الأغاني', singlesEps:'سينجلز', videos:'فيديوهات', featuredOn:'يظهر في',
    subscribe:'اشتراك', radio:'راديو',
    homeQuery:'arabic music popular hits 2024 اغاني عربية',
    playAll2:'تشغيل الكل',
    noQueue:'القائمة فارغة',
    noLiked:'لا توجد أغاني مفضلة ❤️',
    noHistory:'لا يوجد سجل 🎵',
    noPlaylist:'لا توجد قوائم تشغيل',
    noPlayCount:'لا توجد بيانات',
    noPlaylistCreate:'لا توجد قوائم. أنشئ واحدة أولاً!',
    addedToLiked:'❤️ أضيف إلى المفضلة',
    removedFromLiked:'حذف من المفضلة',
    loadingLyrics:'جارٍ تحميل الكلمات...',
    noLyrics:'الكلمات غير متاحة 😔',
    playingFrom:'يعزف من الأكثر رواجاً',
    songs:'أغاني',
    played:'شُغِّل',
    myTop50:'أفضل 50 لي',
    back:'رجوع',
    createPlaylist:'إنشاء قائمة',
    savePlaylist:'حفظ',
    cancel:'إلغاء',
    playlistName:'اسم قائمة التشغيل...',
    addToPlaylist:'إضافة إلى قائمة',
    createNew:'+ إنشاء قائمة جديدة',
    alreadyInPlaylist:'الأغنية موجودة بالفعل',
    addedToPlaylist:'✅ أضيف إلى',
    playlistSaved:'✅ تم حفظ القائمة!',
    playlistDeleted:'تم حذف القائمة',
    searchEmpty:'ابحث عن أغاني أو ألبومات أو فنانين',
    downloaded:'محمّل',
    uploaded:'مرفوع',
    topPlayed:'أفضل 50 لي',
    historyCache:'السجل / التخزين المؤقت',
    aboutText:'استمع إلى أفضل أعمال هذا الفنان. استكشف الأغاني الشائعة والألبومات الجديدة.',
    devAboutText:'منصة بث موسيقي حديثة ومجانية بدون إعلانات. استمتع بملايين الأغاني.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'الرابط غير متاح',
    subscribeOk:'✅ تم الاشتراك!',
    unsubscribe:'إلغاء الاشتراك',
    loadingRadio:'📻 جارٍ تحميل الراديو...',
    sortDate:'تاريخ الإضافة ↓',
    noResult2:'لا توجد نتائج 😔',
        mostPlayed:'الأغاني الأكثر تشغيلاً',
    downloadSoon:'ميزة التنزيل قريباً',
    uploadSoon:'ميزة الرفع قريباً',
    uploadSub:'ارفع موسيقاك الخاصة',
    downloadingAudio:'⬇️ جارٍ تحضير الصوت...',
    downloadStarted:'بدأ التنزيل!',
    downloadFailed:'فشل التنزيل. حاول مجدداً.',
chipQueries:[
      {label:'الرئيسية',q:'arabic music popular hits 2024'},
      {label:'شعبي',q:'arabic pop music official video'},
      {label:'خليجي',q:'khaliji music official video'},
      {label:'مهرجانات',q:'mahragan music egypt official'},
      {label:'كلاسيك',q:'arabic classic music official'},
    ]
  },
  my: {
    flag:'🇲🇾', name:'Malaysia',
    home:'Laman Utama', search:'Cari', library:'Pustaka', developer:'Pembangun',
    trending:'🔥 Trending Sekarang', speedDial:'Panggilan Pantas', quickPick:'Pilihan Pantas',
    playAll:'Main Semua', keepListening:'Terus Mendengar', trendingNow:'Trending',
    newReleases:'Keluaran Baru', fromCommunity:'Dari Komuniti',
    viralTiktok:'Viral di TikTok', eidGetaway:'Lagu Raya',
    surrender:'Ikut Rentak', throwback:'Nostalgia',
    feelgood:'Rock Feel-good', acoustic:'Akustik', top50:'Top 50 Malaysia',
    upNext:'SETERUSNYA', lyrics:'LIRIK', comments:'KOMEN', seeArtist:'ARTIS', commentPlaceholder:'Tulis komen...', commentsEmpty:'💬 Tiada komen lagi. Jadilah yang pertama!', commentJustNow:'Baru sahaja',
    aboutArtist:'TENTANG ARTIS', explore:'Jelajahi', subscribed:'Dilanggan', bioLang:'ms',
    searchPlaceholder:'Taip lalu tekan Cari...', searchBtn:'Cari',
    noResult:'Tiada hasil 😔', searching:'Mencari...',
    allFilter:'Semua', songFilter:'Lagu', videoFilter:'Video', albumFilter:'Album', artistFilter:'Artis',
    libTitle:'Pustaka', liked:'Disukai', history:'Sejarah', playlist:'Senarai Main',
    aboutTitle:'Tentang', leadDev:'Pembangun Utama', madeBy:'DIBUAT OLEH ALAN',
    installApp:'Pasang Apl', appVersion:'Versi Apl',
    topSongs:'Lagu Terbaik', singlesEps:'Singles & EPs', videos:'Video', featuredOn:'Ditampilkan',
    subscribe:'Langgan', radio:'Radio',
    homeQuery:'lagu malaysia popular 2024 official',
    playAll2:'Main Semua',
    noQueue:'Tiada lagu dalam baris',
    noLiked:'Tiada lagu disukai ❤️',
    noHistory:'Tiada sejarah 🎵',
    noPlaylist:'Tiada senarai main',
    noPlayCount:'Tiada data permainan',
    noPlaylistCreate:'Tiada senarai main. Buat dulu!',
    addedToLiked:'❤️ Ditambah ke Disukai',
    removedFromLiked:'Dibuang dari Disukai',
    loadingLyrics:'Memuatkan lirik...',
    noLyrics:'Lirik tidak tersedia 😔',
    playingFrom:'Bermain dari Trending',
    songs:'lagu',
    played:'dimainkan',
    myTop50:'Top 50 Saya',
    back:'Kembali',
    createPlaylist:'Cipta senarai main',
    savePlaylist:'Simpan',
    cancel:'Batal',
    playlistName:'Nama senarai main...',
    addToPlaylist:'Tambah ke Senarai Main',
    createNew:'+ Cipta Senarai Main Baru',
    alreadyInPlaylist:'Lagu sudah ada',
    addedToPlaylist:'✅ Ditambah ke',
    playlistSaved:'✅ Senarai main disimpan!',
    playlistDeleted:'Senarai main dipadam',
    searchEmpty:'Cari lagu, album, atau artis',
    downloaded:'Dimuat turun',
    uploaded:'Dimuat naik',
    topPlayed:'Top 50 Saya',
    historyCache:'Sejarah / Cache',
    aboutText:'Dengarkan karya terbaik artis ini. Terokai lagu popular dan album terbaru.',
    devAboutText:'Platform streaming muzik moden percuma tanpa iklan. Nikmati berjuta lagu tanpa had.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Pautan tidak tersedia',
    subscribeOk:'✅ Berjaya melanggan!',
    unsubscribe:'Berhenti langgan',
    loadingRadio:'📻 Memuatkan radio...',
    sortDate:'Tarikh ditambah ↓',
    noResult2:'Tiada hasil 😔',
        mostPlayed:'Lagu yang paling kerap dimainkan',
    downloadSoon:'Ciri muat turun akan datang',
    uploadSoon:'Ciri muat naik akan datang',
    uploadSub:'Muat naik muzik sendiri',
    downloadingAudio:'⬇️ Menyediakan audio...',
    downloadStarted:'Muat turun dimulakan!',
    downloadFailed:'Muat turun gagal. Cuba lagi.',
chipQueries:[
      {label:'Utama',q:'lagu malaysia popular 2024 official'},
      {label:'Pop Melayu',q:'pop melayu malaysia official music video'},
      {label:'Rock',q:'rock malaysia official music video'},
      {label:'Hip-Hop',q:'hip hop malaysia official music video'},
      {label:'Indie',q:'indie malaysia official music video'},
    ]
  },
  th: {
    flag:'🇹🇭', name:'ไทย',
    home:'หน้าแรก', search:'ค้นหา', library:'ห้องสมุด', developer:'นักพัฒนา',
    trending:'🔥 กำลังมาแรง', speedDial:'โทรด่วน', quickPick:'เลือกเร็ว',
    playAll:'เล่นทั้งหมด', keepListening:'ฟังต่อ', trendingNow:'กำลังมาแรง',
    newReleases:'เพลงใหม่', fromCommunity:'จากชุมชน',
    viralTiktok:'ไวรัลใน TikTok', eidGetaway:'เพลงฮิต',
    surrender:'หลงใหลในจังหวะ', throwback:'ย้อนวัย',
    feelgood:'ร็อคสนุก', acoustic:'อะคูสติก', top50:'Top 50 ไทย',
    upNext:'ถัดไป', lyrics:'เนื้อเพลง', comments:'ความคิดเห็น', seeArtist:'ศิลปิน', commentPlaceholder:'เขียนความคิดเห็น...', commentsEmpty:'💬 ยังไม่มีความคิดเห็น เป็นคนแรก!', commentJustNow:'เมื่อกี้',
    aboutArtist:'เกี่ยวกับศิลปิน', explore:'สำรวจ', subscribed:'สมัครแล้ว', bioLang:'th',
    searchPlaceholder:'พิมพ์แล้วกดค้นหา...', searchBtn:'ค้นหา',
    noResult:'ไม่พบผลลัพธ์ 😔', searching:'กำลังค้นหา...',
    allFilter:'ทั้งหมด', songFilter:'เพลง', videoFilter:'วิดีโอ', albumFilter:'อัลบั้ม', artistFilter:'ศิลปิน',
    libTitle:'ห้องสมุด', liked:'ชื่นชอบ', history:'ประวัติ', playlist:'เพลย์ลิสต์',
    aboutTitle:'เกี่ยวกับ', leadDev:'นักพัฒนาหลัก', madeBy:'สร้างโดย ALAN',
    installApp:'ติดตั้งแอป', appVersion:'เวอร์ชันแอป',
    topSongs:'เพลงยอดนิยม', singlesEps:'ซิงเกิลและ EP', videos:'วิดีโอ', featuredOn:'ปรากฏใน',
    subscribe:'ติดตาม', radio:'วิทยุ',
    homeQuery:'thai music popular hits 2024 เพลงไทย',
    playAll2:'เล่นทั้งหมด',
    noQueue:'ไม่มีเพลงในคิว',
    noLiked:'ยังไม่มีเพลงที่ชื่นชอบ ❤️',
    noHistory:'ยังไม่มีประวัติ 🎵',
    noPlaylist:'ยังไม่มีเพลย์ลิสต์',
    noPlayCount:'ยังไม่มีข้อมูล',
    noPlaylistCreate:'ไม่มีเพลย์ลิสต์ สร้างก่อนเลย!',
    addedToLiked:'❤️ เพิ่มในรายการโปรด',
    removedFromLiked:'ลบออกจากรายการโปรด',
    loadingLyrics:'กำลังโหลดเนื้อเพลง...',
    noLyrics:'ไม่มีเนื้อเพลง 😔',
    playingFrom:'กำลังเล่นจากเทรนดิ้ง',
    songs:'เพลง',
    played:'เล่นแล้ว',
    myTop50:'Top 50 ของฉัน',
    back:'กลับ',
    createPlaylist:'สร้างเพลย์ลิสต์',
    savePlaylist:'บันทึก',
    cancel:'ยกเลิก',
    playlistName:'ชื่อเพลย์ลิสต์...',
    addToPlaylist:'เพิ่มในเพลย์ลิสต์',
    createNew:'+ สร้างเพลย์ลิสต์ใหม่',
    alreadyInPlaylist:'เพลงนี้มีอยู่แล้ว',
    addedToPlaylist:'✅ เพิ่มใน',
    playlistSaved:'✅ บันทึกเพลย์ลิสต์แล้ว!',
    playlistDeleted:'ลบเพลย์ลิสต์แล้ว',
    searchEmpty:'ค้นหาเพลง อัลบั้ม หรือศิลปิน',
    downloaded:'ดาวน์โหลดแล้ว',
    uploaded:'อัปโหลดแล้ว',
    topPlayed:'Top 50 ของฉัน',
    historyCache:'ประวัติ / แคช',
    aboutText:'ฟังผลงานที่ดีที่สุดของศิลปินนี้ สำรวจเพลงยอดนิยมและอัลบั้มใหม่',
    devAboutText:'แพลตฟอร์มสตรีมเพลงฟรีทันสมัยไม่มีโฆษณา เพลิดเพลินกับเพลงนับล้านเพลง',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'ลิงก์ไม่พร้อมใช้งาน',
    subscribeOk:'✅ ติดตามแล้ว!',
    unsubscribe:'เลิกติดตาม',
    loadingRadio:'📻 กำลังโหลดวิทยุ...',
    sortDate:'วันที่เพิ่ม ↓',
    noResult2:'ไม่พบผลลัพธ์ 😔',
        mostPlayed:'เพลงที่เล่นบ่อยที่สุด',
    downloadSoon:'ฟีเจอร์ดาวน์โหลดเร็วๆ นี้',
    uploadSoon:'ฟีเจอร์อัปโหลดเร็วๆ นี้',
    uploadSub:'อัปโหลดเพลงของคุณเอง',
    downloadingAudio:'⬇️ กำลังเตรียมเสียง...',
    downloadStarted:'เริ่มดาวน์โหลดแล้ว!',
    downloadFailed:'ดาวน์โหลดล้มเหลว ลองอีกครั้ง',
chipQueries:[
      {label:'หน้าแรก',q:'thai music popular hits 2024'},
      {label:'ลูกทุ่ง',q:'thai country music official'},
      {label:'ป็อป',q:'thai pop music official video'},
      {label:'ร็อค',q:'thai rock music official'},
      {label:'ฮิปฮอป',q:'thai hip hop official music video'},
    ]
  },
  br: {
    flag:'🇧🇷', name:'Brasil',
    home:'Início', search:'Pesquisar', library:'Biblioteca', developer:'Desenvolvedor',
    trending:'🔥 Em Alta', speedDial:'Discagem Rápida', quickPick:'Escolha Rápida',
    playAll:'Tocar Tudo', keepListening:'Continue Ouvindo', trendingNow:'Em Alta',
    newReleases:'Novos Lançamentos', fromCommunity:'Da Comunidade',
    viralTiktok:'Viral no TikTok', eidGetaway:'Hits do Verão',
    surrender:'Entregue-se ao Ritmo', throwback:'Flashback',
    feelgood:'Rock Animado', acoustic:'Acústico', top50:'Top 50 Brasil',
    upNext:'PRÓXIMO', lyrics:'LETRAS', comments:'COMENTÁRIOS', seeArtist:'VER ARTISTA', commentPlaceholder:'Escrever comentário...', commentsEmpty:'💬 Sem comentários ainda. Seja o primeiro!', commentJustNow:'Agora',
    aboutArtist:'SOBRE O ARTISTA', explore:'Explorar', subscribed:'Inscrito', bioLang:'pt',
    searchPlaceholder:'Digite e pressione Pesquisar...', searchBtn:'Pesquisar',
    noResult:'Nenhum resultado 😔', searching:'Pesquisando...',
    allFilter:'Tudo', songFilter:'Músicas', videoFilter:'Vídeos', albumFilter:'Álbuns', artistFilter:'Artistas',
    libTitle:'Biblioteca', liked:'Curtidas', history:'Histórico', playlist:'Playlist',
    aboutTitle:'Sobre', leadDev:'Desenvolvedor Principal', madeBy:'FEITO POR ALAN',
    installApp:'Instalar App', appVersion:'Versão do App',
    topSongs:'Top Músicas', singlesEps:'Singles e EPs', videos:'Vídeos', featuredOn:'Aparece em',
    subscribe:'Inscrever-se', radio:'Rádio',
    homeQuery:'musica brasileira popular 2024 hits',
    playAll2:'Tocar Tudo',
    noQueue:'Fila vazia',
    noLiked:'Nenhuma música curtida ❤️',
    noHistory:'Sem histórico 🎵',
    noPlaylist:'Sem playlists',
    noPlayCount:'Sem dados de reprodução',
    noPlaylistCreate:'Sem playlists. Crie uma primeiro!',
    addedToLiked:'❤️ Adicionado às Curtidas',
    removedFromLiked:'Removido das Curtidas',
    loadingLyrics:'Carregando letras...',
    noLyrics:'Letras não disponíveis 😔',
    playingFrom:'Tocando dos Destaques',
    songs:'músicas',
    played:'reproduzidas',
    myTop50:'Meu Top 50',
    back:'Voltar',
    createPlaylist:'Criar playlist',
    savePlaylist:'Salvar',
    cancel:'Cancelar',
    playlistName:'Nome da playlist...',
    addToPlaylist:'Adicionar à Playlist',
    createNew:'+ Criar Nova Playlist',
    alreadyInPlaylist:'Música já está na playlist',
    addedToPlaylist:'✅ Adicionado a',
    playlistSaved:'✅ Playlist salva!',
    playlistDeleted:'Playlist deletada',
    searchEmpty:'Pesquisar músicas, álbuns ou artistas',
    downloaded:'Baixado',
    uploaded:'Enviado',
    topPlayed:'Meu Top 50',
    historyCache:'Histórico / Cache',
    aboutText:'Ouça as melhores obras deste artista. Explore músicas populares e novos álbuns.',
    devAboutText:'Plataforma de streaming de música moderna e gratuita sem anúncios. Aproveite milhões de músicas.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Link não disponível',
    subscribeOk:'✅ Inscrito!',
    unsubscribe:'Cancelar inscrição',
    loadingRadio:'📻 Carregando rádio...',
    sortDate:'Data de adição ↓',
    noResult2:'Nenhum resultado 😔',
        mostPlayed:'Músicas mais tocadas',
    downloadSoon:'Recurso de download em breve',
    uploadSoon:'Recurso de upload em breve',
    uploadSub:'Envie sua própria música',
    downloadingAudio:'⬇️ Preparando áudio...',
    downloadStarted:'Download iniciado!',
    downloadFailed:'Falha no download. Tente novamente.',
chipQueries:[
      {label:'Início',q:'musica brasileira popular 2024 hits'},
      {label:'Funk',q:'funk brasileiro official music video'},
      {label:'Sertanejo',q:'sertanejo oficial musica video'},
      {label:'Pagode',q:'pagode samba oficial musica'},
      {label:'Pop BR',q:'pop brasileiro official music video'},
      {label:'Rap',q:'rap brasileiro official music video'},
    ]
  },
  de: {
    flag:'🇩🇪', name:'Deutschland',
    home:'Startseite', search:'Suchen', library:'Bibliothek', developer:'Entwickler',
    trending:'🔥 Trending', speedDial:'Schnellwahl', quickPick:'Schnellauswahl',
    playAll:'Alle abspielen', keepListening:'Weiter hören', trendingNow:'Trending',
    newReleases:'Neue Veröffentlichungen', fromCommunity:'Von der Community',
    viralTiktok:'Viral auf TikTok', eidGetaway:'Sommer Hits',
    surrender:'Dem Rhythmus hingeben', throwback:'Nostalgie',
    feelgood:'Feel-good Rock', acoustic:'Akustik', top50:'Top 50 Deutschland',
    upNext:'ALS NÄCHSTES', lyrics:'LIEDTEXT', comments:'KOMMENTARE', seeArtist:'KÜNSTLER', commentPlaceholder:'Kommentar schreiben...', commentsEmpty:'💬 Noch keine Kommentare. Sei der Erste!', commentJustNow:'Gerade eben',
    aboutArtist:'ÜBER DEN KÜNSTLER', explore:'Erkunden', subscribed:'Abonniert', bioLang:'de',
    searchPlaceholder:'Tippe und drücke Suchen...', searchBtn:'Suchen',
    noResult:'Keine Ergebnisse 😔', searching:'Suche...',
    allFilter:'Alle', songFilter:'Lieder', videoFilter:'Videos', albumFilter:'Alben', artistFilter:'Künstler',
    libTitle:'Bibliothek', liked:'Gefällt mir', history:'Verlauf', playlist:'Playlist',
    aboutTitle:'Über', leadDev:'Lead-Entwickler', madeBy:'ERSTELLT VON ALAN',
    installApp:'App installieren', appVersion:'App-Version',
    topSongs:'Top Songs', singlesEps:'Singles & EPs', videos:'Videos', featuredOn:'Erscheint in',
    subscribe:'Abonnieren', radio:'Radio',
    homeQuery:'deutsche musik popular 2024 hits',
    playAll2:'Alle abspielen',
    noQueue:'Warteschlange leer',
    noLiked:'Keine Lieblingslieder ❤️',
    noHistory:'Kein Verlauf 🎵',
    noPlaylist:'Keine Playlists',
    noPlayCount:'Keine Daten',
    noPlaylistCreate:'Keine Playlists. Erst erstellen!',
    addedToLiked:'❤️ Zu Gefällt mir hinzugefügt',
    removedFromLiked:'Aus Gefällt mir entfernt',
    loadingLyrics:'Liedtexte laden...',
    noLyrics:'Liedtext nicht verfügbar 😔',
    playingFrom:'Wiedergabe aus Trending',
    songs:'Lieder',
    played:'gespielt',
    myTop50:'Meine Top 50',
    back:'Zurück',
    createPlaylist:'Playlist erstellen',
    savePlaylist:'Speichern',
    cancel:'Abbrechen',
    playlistName:'Playlist-Name...',
    addToPlaylist:'Zur Playlist hinzufügen',
    createNew:'+ Neue Playlist erstellen',
    alreadyInPlaylist:'Lied bereits in Playlist',
    addedToPlaylist:'✅ Hinzugefügt zu',
    playlistSaved:'✅ Playlist gespeichert!',
    playlistDeleted:'Playlist gelöscht',
    searchEmpty:'Lieder, Alben oder Künstler suchen',
    downloaded:'Heruntergeladen',
    uploaded:'Hochgeladen',
    topPlayed:'Meine Top 50',
    historyCache:'Verlauf / Cache',
    aboutText:'Hören Sie die besten Werke dieses Künstlers. Entdecken Sie beliebte Songs und neue Alben.',
    devAboutText:'Moderne kostenlose Musik-Streaming-Plattform ohne Werbung. Genießen Sie Millionen von Songs.',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'Link nicht verfügbar',
    subscribeOk:'✅ Abonniert!',
    unsubscribe:'Abonnement kündigen',
    loadingRadio:'📻 Radio laden...',
    sortDate:'Hinzufügungsdatum ↓',
    noResult2:'Keine Ergebnisse 😔',
        mostPlayed:'Am häufigsten gespielte Songs',
    downloadSoon:'Download-Funktion kommt bald',
    uploadSoon:'Upload-Funktion kommt bald',
    uploadSub:'Eigene Musik hochladen',
    downloadingAudio:'⬇️ Audio wird vorbereitet...',
    downloadStarted:'Download gestartet!',
    downloadFailed:'Download fehlgeschlagen. Erneut versuchen.',
chipQueries:[
      {label:'Startseite',q:'deutsche musik popular 2024 hits'},
      {label:'Pop',q:'deutsche pop musik official video'},
      {label:'Rock',q:'deutscher rock musik official'},
      {label:'Hip-Hop',q:'deutscher hip hop rap official'},
      {label:'Schlager',q:'schlager musik official video'},
      {label:'Lo-Fi',q:'lofi chill hip hop beats official'},
    ]
  },
  jp: {
    flag:'🇯🇵', name:'日本',
    home:'ホーム', search:'検索', library:'ライブラリ', developer:'開発者',
    trending:'🔥 トレンド', speedDial:'スピードダイヤル', quickPick:'クイック選択',
    playAll:'すべて再生', keepListening:'聴き続ける', trendingNow:'トレンド',
    newReleases:'新着', fromCommunity:'コミュニティから',
    viralTiktok:'TikTokでバイラル', eidGetaway:'夏のヒット',
    surrender:'リズムに身を委ねて', throwback:'懐かしの曲',
    feelgood:'フィールグッドロック', acoustic:'アコースティック', top50:'日本トップ50',
    upNext:'次へ', lyrics:'歌詞', comments:'コメント', seeArtist:'アーティスト', commentPlaceholder:'コメントを書く...', commentsEmpty:'💬 まだコメントはありません。最初のコメントを書きましょう！', commentJustNow:'たった今',
    aboutArtist:'アーティストについて', explore:'探索', subscribed:'登録済み', bioLang:'ja',
    searchPlaceholder:'入力して検索を押す...', searchBtn:'検索',
    noResult:'結果なし 😔', searching:'検索中...',
    allFilter:'すべて', songFilter:'曲', videoFilter:'動画', albumFilter:'アルバム', artistFilter:'アーティスト',
    libTitle:'ライブラリ', liked:'お気に入り', history:'履歴', playlist:'プレイリスト',
    aboutTitle:'について', leadDev:'リード開発者', madeBy:'ALANが制作',
    installApp:'アプリをインストール', appVersion:'アプリバージョン',
    topSongs:'人気曲', singlesEps:'シングル＆EP', videos:'動画', featuredOn:'参加作品',
    subscribe:'登録', radio:'ラジオ',
    homeQuery:'japanese music popular jpop 2024',
    playAll2:'すべて再生',
    noQueue:'キューが空です',
    noLiked:'お気に入りの曲がありません ❤️',
    noHistory:'履歴がありません 🎵',
    noPlaylist:'プレイリストがありません',
    noPlayCount:'再生データなし',
    noPlaylistCreate:'プレイリストなし。先に作成してください！',
    addedToLiked:'❤️ お気に入りに追加',
    removedFromLiked:'お気に入りから削除',
    loadingLyrics:'歌詞を読み込んでいます...',
    noLyrics:'歌詞がありません 😔',
    playingFrom:'トレンドから再生中',
    songs:'曲',
    played:'再生済み',
    myTop50:'マイトップ50',
    back:'戻る',
    createPlaylist:'プレイリストを作成',
    savePlaylist:'保存',
    cancel:'キャンセル',
    playlistName:'プレイリスト名...',
    addToPlaylist:'プレイリストに追加',
    createNew:'+ 新しいプレイリストを作成',
    alreadyInPlaylist:'曲はすでにプレイリストにあります',
    addedToPlaylist:'✅ 追加しました',
    playlistSaved:'✅ プレイリストを保存しました！',
    playlistDeleted:'プレイリストを削除しました',
    searchEmpty:'曲、アルバム、アーティストを検索',
    downloaded:'ダウンロード済み',
    uploaded:'アップロード済み',
    topPlayed:'マイトップ50',
    historyCache:'履歴 / キャッシュ',
    aboutText:'このアーティストの最高の作品を聴いてください。人気曲や新しいアルバムを探索しましょう。',
    devAboutText:'広告なしの現代的な無料音楽ストリーミングプラットフォーム。何百万もの曲をお楽しみください。',
    appName:'Hidaka Music v1.0',
    linkNotAvail:'リンクは利用できません',
    subscribeOk:'✅ 登録しました！',
    unsubscribe:'登録解除',
    loadingRadio:'📻 ラジオを読み込んでいます...',
    sortDate:'追加日 ↓',
    noResult2:'結果がありません 😔',
        mostPlayed:'最も再生された曲',
    downloadSoon:'ダウンロード機能は近日公開',
    uploadSoon:'アップロード機能は近日公開',
    uploadSub:'自分の音楽をアップロード',
    downloadingAudio:'⬇️ 音声を準備中...',
    downloadStarted:'ダウンロード開始！',
    downloadFailed:'ダウンロード失敗。もう一度試して。',
chipQueries:[
      {label:'ホーム',q:'japanese music popular jpop 2024'},
      {label:'J-Pop',q:'jpop official music video 2024'},
      {label:'J-Rock',q:'jrock official music video'},
      {label:'アニソン',q:'anime song official music video'},
      {label:'ヒップホップ',q:'japanese hip hop official music video'},
      {label:'Lo-Fi',q:'lofi japanese chill music'},
    ]
  },
  cn: {
    flag:'🇨🇳', name:'中文',
    home:'首页', search:'搜索', library:'音乐库', developer:'开发者',
    trending:'🔥 热门', speedDial:'快速拨号', quickPick:'快速选择',
    playAll:'全部播放', keepListening:'继续收听', trendingNow:'热门',
    newReleases:'新发布', fromCommunity:'来自社区',
    viralTiktok:'抖音热门', eidGetaway:'夏日热歌',
    surrender:'沉浸在节奏中', throwback:'怀旧金曲',
    feelgood:'快乐摇滚', acoustic:'民谣', top50:'中国TOP50',
    upNext:'下一首', lyrics:'歌词', comments:'评论', seeArtist:'查看歌手', commentPlaceholder:'写评论...', commentsEmpty:'💬 暂无评论，成为第一个评论的人！', commentJustNow:'刚刚',
    aboutArtist:'关于艺术家', explore:'探索', subscribed:'已订阅', bioLang:'zh',
    searchPlaceholder:'输入后按搜索...', searchBtn:'搜索',
    noResult:'没有结果 😔', searching:'搜索中...',
    allFilter:'全部', songFilter:'歌曲', videoFilter:'视频', albumFilter:'专辑', artistFilter:'歌手',
    libTitle:'音乐库', liked:'收藏', history:'历史', playlist:'播放列表',
    aboutTitle:'关于', leadDev:'首席开发者', madeBy:'由ALAN制作',
    installApp:'安装应用', appVersion:'应用版本',
    topSongs:'热门歌曲', singlesEps:'单曲和EP', videos:'视频', featuredOn:'出现在',
    subscribe:'订阅', radio:'电台',
    homeQuery:'chinese mandarin popular music 2024 华语流行',
    playAll2:'全部播放', noQueue:'队列为空',
    noLiked:'还没有收藏的歌曲 ❤️', noHistory:'没有历史记录 🎵',
    noPlaylist:'没有播放列表', noPlayCount:'没有播放数据',
    noPlaylistCreate:'没有播放列表，先创建一个！',
    addedToLiked:'❤️ 已添加到收藏', removedFromLiked:'已从收藏中删除',
    loadingLyrics:'加载歌词中...', noLyrics:'暂无歌词 😔',
    playingFrom:'正在播放热门', songs:'首歌', played:'已播放',
    myTop50:'我的TOP50', back:'返回', createPlaylist:'创建播放列表',
    savePlaylist:'保存', cancel:'取消', playlistName:'播放列表名称...',
    addToPlaylist:'添加到播放列表', createNew:'+ 创建新播放列表',
    alreadyInPlaylist:'歌曲已在播放列表中', addedToPlaylist:'✅ 已添加到',
    playlistSaved:'✅ 播放列表已保存！', playlistDeleted:'播放列表已删除',
    searchEmpty:'搜索歌曲、专辑或歌手', downloaded:'已下载',
    uploaded:'已上传', topPlayed:'我的TOP50', historyCache:'历史 / 缓存',
    aboutText:'收听这位艺人的最佳作品，探索热门歌曲和最新专辑。',
    devAboutText:'现代免费音乐流媒体平台，无广告。尽情享受数百万首歌曲。',
    appName:'Hidaka Music v1.0', linkNotAvail:'链接暂不可用',
    subscribeOk:'✅ 订阅成功！', unsubscribe:'取消订阅',
    loadingRadio:'📻 加载电台中...', sortDate:'添加日期 ↓',
    noResult2:'没有结果 😔', mostPlayed:'最常播放的歌曲',
    downloadSoon:'下载功能即将推出', uploadSoon:'上传功能即将推出',
    uploadSub:'上传自己的音乐', downloadingAudio:'⬇️ 准备音频中...',
    downloadStarted:'开始下载！', downloadFailed:'下载失败，请重试。',
    chipQueries:[
      {label:'首页',q:'chinese mandarin popular music 2024 华语流行'},
      {label:'华语流行',q:'chinese pop music mandarin official 2024'},
      {label:'国风',q:'chinese traditional folk music official'},
      {label:'嘻哈',q:'chinese hip hop rap official music video'},
      {label:'摇滚',q:'chinese rock music official'},
      {label:'抖音热门',q:'douyin tiktok china viral music 2024'},
    ]
  },
  kr: {
    flag:'🇰🇷', name:'한국',
    home:'홈', search:'검색', library:'보관함', developer:'개발자',
    trending:'🔥 트렌딩', speedDial:'빠른 전화', quickPick:'빠른 선택',
    playAll:'모두 재생', keepListening:'계속 듣기', trendingNow:'트렌딩',
    newReleases:'신규 발매', fromCommunity:'커뮤니티에서',
    viralTiktok:'TikTok 바이럴', eidGetaway:'여름 히트',
    surrender:'리듬에 빠져들어', throwback:'추억의 노래',
    feelgood:'기분 좋은 록', acoustic:'어쿠스틱', top50:'한국 TOP50',
    upNext:'다음', lyrics:'가사', comments:'댓글', seeArtist:'아티스트', commentPlaceholder:'댓글 작성...', commentsEmpty:'💬 아직 댓글이 없습니다. 첫 번째가 되세요!', commentJustNow:'방금',
    aboutArtist:'아티스트 소개', explore:'탐색', subscribed:'구독됨', bioLang:'ko',
    searchPlaceholder:'입력 후 검색 누르기...', searchBtn:'검색',
    noResult:'결과 없음 😔', searching:'검색 중...',
    allFilter:'전체', songFilter:'노래', videoFilter:'동영상', albumFilter:'앨범', artistFilter:'아티스트',
    libTitle:'보관함', liked:'좋아요', history:'최근 들은 곡', playlist:'플레이리스트',
    aboutTitle:'소개', leadDev:'리드 개발자', madeBy:'ALAN이 만든',
    installApp:'앱 설치', appVersion:'앱 버전',
    topSongs:'인기곡', singlesEps:'싱글 및 EP', videos:'동영상', featuredOn:'수록된',
    subscribe:'구독', radio:'라디오',
    homeQuery:'kpop korean popular music 2024 케이팝',
    playAll2:'모두 재생', noQueue:'대기열이 비어 있습니다',
    noLiked:'좋아요 누른 곡이 없어요 ❤️', noHistory:'최근 들은 곡이 없어요 🎵',
    noPlaylist:'플레이리스트가 없어요', noPlayCount:'재생 데이터 없음',
    noPlaylistCreate:'플레이리스트가 없습니다. 먼저 만들어보세요!',
    addedToLiked:'❤️ 좋아요에 추가됨', removedFromLiked:'좋아요에서 제거됨',
    loadingLyrics:'가사 불러오는 중...', noLyrics:'가사를 찾을 수 없어요 😔',
    playingFrom:'트렌딩에서 재생 중', songs:'곡', played:'재생됨',
    myTop50:'내 TOP50', back:'뒤로', createPlaylist:'플레이리스트 만들기',
    savePlaylist:'저장', cancel:'취소', playlistName:'플레이리스트 이름...',
    addToPlaylist:'플레이리스트에 추가', createNew:'+ 새 플레이리스트 만들기',
    alreadyInPlaylist:'이미 플레이리스트에 있습니다', addedToPlaylist:'✅ 추가됨',
    playlistSaved:'✅ 플레이리스트 저장됨!', playlistDeleted:'플레이리스트 삭제됨',
    searchEmpty:'노래, 앨범, 아티스트 검색', downloaded:'다운로드됨',
    uploaded:'업로드됨', topPlayed:'내 TOP50', historyCache:'기록 / 캐시',
    aboutText:'이 아티스트의 최고 작품을 감상하세요. 인기곡과 최신 앨범을 탐색해보세요.',
    devAboutText:'광고 없는 현대적인 무료 음악 스트리밍 플랫폼. 수백만 곡을 즐기세요.',
    appName:'Hidaka Music v1.0', linkNotAvail:'링크를 사용할 수 없습니다',
    subscribeOk:'✅ 구독 완료!', unsubscribe:'구독 취소',
    loadingRadio:'📻 라디오 불러오는 중...', sortDate:'추가된 날짜 ↓',
    noResult2:'결과 없음 😔', mostPlayed:'가장 많이 재생된 곡',
    downloadSoon:'다운로드 기능 곧 출시', uploadSoon:'업로드 기능 곧 출시',
    uploadSub:'내 음악 업로드', downloadingAudio:'⬇️ 오디오 준비 중...',
    downloadStarted:'다운로드 시작!', downloadFailed:'다운로드 실패. 다시 시도해주세요.',
    chipQueries:[
      {label:'홈',q:'kpop korean popular music 2024 케이팝'},
      {label:'K-Pop',q:'kpop girl group boy band official mv 2024'},
      {label:'발라드',q:'korean ballad music official 2024'},
      {label:'힙합',q:'korean hip hop rap official music video'},
      {label:'인디',q:'korean indie music official 2024'},
      {label:'트로트',q:'trot korean music official'},
    ]
  },
};

let currentLang='id';
function getLang(){return LANGS[currentLang]||LANGS.id;}

function applyLanguage(code){
  currentLang=code;
  localStorage.setItem('nada_lang',code);
  const L=getLang();

  // Static IDs
  const ids={
    topbarTitle:L.home, navLabelHome:L.home, navLabelSearch:L.search,
    navLabelLibrary:L.library, libTitleEl:L.libTitle,
    secSpeedDial:L.speedDial, secQuickPick:L.quickPick, btnPlayAll:L.playAll2,
    secKeepListening:L.keepListening, secTrending:L.trendingNow,
    secNewReleases:L.newReleases, tabUpNext:L.upNext, tabLyrics:L.lyrics,
    tabComments:L.comments||'KOMENTAR', tabArtist:L.seeArtist, devAboutTitle:L.aboutTitle, devLeadDev:L.leadDev,
    devInstallBtn:L.installApp, devAppVersionLabel:L.appVersion,
    sortLabel:L.sortDate, addToPlaylistTitle:L.addToPlaylist,
    lyricsLoadingText:L.loadingLyrics,
    libChipAll:L.allFilter, libChipLiked:L.liked, libChipHistory:L.history, libChipPlaylist:L.playlist, libChipSubscribed:'Subscribe',
    fpFrom:L.playingFrom,
    fpAboutArtistLabel:L.aboutArtist||'TENTANG ARTIS',
  };
  Object.entries(ids).forEach(([id,txt])=>{
    const el=document.getElementById(id);
    if(el)el.textContent=txt;
  });

  // Nav labels (4th nav = developer)
  const navDevLabel=document.querySelector('#navDeveloper .nav-label');
  if(navDevLabel)navDevLabel.textContent=L.developer;

  // Search input + button
  const inp=document.getElementById('searchInput');
  if(inp)inp.placeholder=L.searchPlaceholder;
  const searchBtnEl=document.querySelector('[onclick="doSearch()"]');
  if(searchBtnEl)searchBtnEl.textContent=L.searchBtn;

  // Regenerate bio artis kalau bahasa berubah
  const curArtist=document.getElementById('fpArtistBio')?._lastArtist;
  if(curArtist){
    // Reset cache untuk bahasa lama, generate ulang
    document.getElementById('fpArtistBio').textContent='...';
    document.getElementById('fpArtistBioMore').style.display='none';
    _generateArtistBio(curArtist).then(bio=>{
      if(bio){
        const el=document.getElementById('fpArtistBio');
        el.textContent=bio;
        if(bio.length>200){document.getElementById('fpArtistBioMore').style.display='block';}
      }
    });
  }

  // Search chips
  const filterChips=document.querySelectorAll('#searchChips .chip');
  [L.allFilter,L.songFilter,L.videoFilter,L.albumFilter,L.artistFilter].forEach((t,i)=>{
    if(filterChips[i])filterChips[i].textContent=t;
  });

  // Library chips
  const libChips=document.querySelectorAll('#libChips .chip');
  [L.allFilter,L.liked,L.history,L.playlist].forEach((t,i)=>{
    if(libChips[i])libChips[i].textContent=t;
  });

  // Artist about text
  const artistAboutEl=document.getElementById('artistAboutText');
  if(artistAboutEl&&!artistAboutEl.dataset.custom)artistAboutEl.textContent=L.aboutText||'Dengarkan karya-karya terbaik dari artis ini.';

  // From community section titles
  const fromCommEl=document.querySelector('#fromCommunitySection .sec-title');
  if(fromCommEl)fromCommEl.textContent=L.fromCommunity;
  const viralEl=document.querySelector('#viralTiktokSection .sec-title');
  if(viralEl)viralEl.textContent=L.viralTiktok;
  const eidEl=document.querySelector('#eidSection .sec-title');
  if(eidEl)eidEl.textContent=L.eidGetaway;
  const surEl=document.querySelector('#surrenderSection .sec-title');
  if(surEl)surEl.textContent=L.surrender;
  const throwEl=document.querySelector('#throwbackSection .sec-title');
  if(throwEl)throwEl.textContent=L.throwback;
  const feelEl=document.querySelector('#feelgoodSection .sec-title');
  if(feelEl)feelEl.textContent=L.feelgood;
  const acouEl=document.querySelector('#acousticSection .sec-title');
  if(acouEl)acouEl.textContent=L.acoustic;
  const top50El=document.querySelector('#top50Section .sec-title');
  if(top50El)top50El.textContent=L.top50;

  // Developer page description + info
  const devDesc=document.querySelector('#pageDeveloper p');
  if(devDesc)devDesc.textContent=L.devAboutText;
  const madeByEl=document.querySelector('#pageDeveloper [style*="MADE BY"], #pageDeveloper [style*="Made by"]');
  if(madeByEl&&madeByEl.textContent.trim())madeByEl.textContent=L.madeBy;
  // Find Made By Alan by content
  document.querySelectorAll('#pageDeveloper *').forEach(el=>{
    if(el.children.length===0&&el.textContent.trim().toUpperCase().startsWith('MADE'))
      el.textContent=L.madeBy;
  });

  // Rebuild home chips + reload
  rebuildHomeChips(L);
  loadHome(L.chipQueries[0].q);

  // Modal buttons
  const saveBtn=document.getElementById('btnSavePlaylist');
  if(saveBtn)saveBtn.textContent=L.savePlaylist||'Simpan';
  const cancelBtn=document.getElementById('btnCancelPlaylist');
  if(cancelBtn)cancelBtn.textContent=L.cancel||'Batal';
  const plInput=document.getElementById('playlistNameInputEl');
  if(plInput)plInput.placeholder=L.playlistName||'Nama playlist...';

  // App version label
  const appVerEl=document.getElementById('devAppVersion');
  if(appVerEl)appVerEl.textContent=L.appName||'Hidaka Music v1.0';

  showToast(L.flag+' '+L.name);
  closeLangMenu();
}

function rebuildHomeChips(L){
  const container=document.getElementById('homeChips');
  if(!container)return;
  container.innerHTML=L.chipQueries.map((c,i)=>`
    <button class="chip ${i===0?'active':''}" data-q="${c.q}">${c.label}</button>`).join('');
  // Re-attach click handler
  container.querySelectorAll('.chip').forEach(btn=>{
    btn.addEventListener('click',()=>{
      container.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      loadHome(btn.dataset.q);
    });
  });
}

// ===== BAHASA AI (Terjemahkan Ke) — terpisah dari Bahasa Sistem =====
const AI_LANG_NAMES={id:'Indonesia',en:'English',ru:'Русский',fil:'Filipino',ar:'العربية',ms:'Bahasa Melayu',th:'ไทย',pt:'Português',de:'Deutsch',ja:'日本語',zh:'中文',ko:'한국어'};
function getAiLang(){
  return localStorage.getItem('hidaka_ai_lang')||(getLang().bioLang)||'id';
}
function applyAiLang(code){
  localStorage.setItem('hidaka_ai_lang',code);
  const el=document.getElementById('settingsAiLangVal');
  if(el)el.textContent=AI_LANG_NAMES[code]||code;
  closeAiLangMenu();
  showToast('✅ Bahasa AI diperbarui');
}
function openAiLangMenu(){
  const m=document.getElementById('aiLangMenu');
  m.classList.add('open');
  document.querySelectorAll('#aiLangMenu .lang-btn').forEach(b=>b.classList.remove('active'));
  const activeBtn=document.getElementById('ailang_'+getAiLang());
  if(activeBtn)activeBtn.classList.add('active');
}
function closeAiLangMenu(){
  document.getElementById('aiLangMenu').classList.remove('open');
}

function openLangMenu(){
  const m=document.getElementById('langMenu');
  m.classList.add('open');
  // Update active lang button
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.remove('active'));
  const activeBtn=document.getElementById('lang_'+currentLang);
  if(activeBtn)activeBtn.classList.add('active');
}
function closeLangMenu(){
  document.getElementById('langMenu').classList.remove('open');
}

async function loadHome(q){
  if(!q) q=getRandomHomeQuery();
  currentChipQ=q;extraTrackPools={};extraSectionCount=0;
  document.getElementById('extraSections').innerHTML='';
  document.getElementById('speedGrid').innerHTML='<div class="loading"><div class="spin"></div></div>';
  document.getElementById('qpList').innerHTML=skeletonQP();
  document.getElementById('trendList').innerHTML=skeletonHCards();
  document.getElementById('newList').innerHTML=skeletonHCards();
  document.getElementById('artistList').innerHTML='<div class="loading"><div class="spin"></div></div>';
  allTracks=await ytSearch(q,24);curIdx=-1;
  if(!allTracks.length)return;
  renderSpeedGrid(allTracks);renderQP(allTracks);renderArtists(allTracks);
  renderHCards('trendList',allTracks,0);renderHCards('newList',allTracks,8);
  loadNextExtraSection();
  setTimeout(loadNextExtraSection,300);
  // Load new sections async - spaced out to avoid Vercel concurrent limit
  loadFeaturedSlider(allTracks);
  setTimeout(()=>loadViralTiktok(),300);
  setTimeout(()=>loadCommunitySection(),800);
  setTimeout(()=>loadExtraHomeSections(),1500);
  setTimeout(()=>loadSerupaDengan(allTracks),2500);
}

function loadFeaturedSlider(tracks){
  if(!tracks.length)return;
  const slides=tracks.slice(0,5);
  document.getElementById('featuredSlider').innerHTML=slides.map((t,i)=>`
    <div class="featured-slide" onclick="playTrack(${i},allTracks)">
      <div class="featured-slide-bg" style="background-image:url(${t.thumb})"></div>
      <div class="featured-slide-overlay"></div>
      <div class="featured-slide-body">
        <div class="featured-slide-label">🔥 Trending Sekarang</div>
        <div class="featured-slide-title">${t.title}</div>
        <div class="featured-slide-sub">${t.channel}</div>
      </div>
      <button class="featured-slide-play" onclick="event.stopPropagation();playTrack(${i},allTracks)"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></button>
    </div>`).join('');
}

let communityTracks={};
async function loadCommunitySection(){
  const queries=[
    {title:'Chill Rap 🏙️',q:'chill rap hip hop playlist'},
    {title:'Pop Hits 🎵',q:'pop hits 2024 playlist'},
    {title:'Indie Vibes 🌿',q:'indie alternative playlist'},
    {title:'R&B Soul ✨',q:'rnb soul playlist 2024'},
    {title:'Lo-Fi Study 📚',q:'lofi hip hop study beats playlist'},
    {title:'Rock Anthems 🎸',q:'rock anthems classic hits playlist'},
    {title:'Dance Floor 🕺',q:'dance electronic edm playlist 2024'},
    {title:'Throwback 🕰️',q:'throwback 90s 2000s hits playlist'},
  ];
  const el=document.getElementById('communityList');
  el.innerHTML='';
  for(const {title,q} of queries){
    const tracks=await ytSearch(q,8);
    if(!tracks.length)continue;
    communityTracks[title]=tracks;
    const preview=tracks.slice(0,3);
    const card=document.createElement('div');
    card.className='community-card anim';
    card.innerHTML=`
      <div class="community-card-header">
        <img class="community-cover" src="${tracks[0].thumb}" onerror="this.style.background='#333'" alt="">
        <div><div class="community-title">${title}</div><div class="community-count">${tracks.length} lagu</div></div>
      </div>
      ${preview.map(t=>`
        <div class="community-track">
          <img class="community-track-thumb" src="${t.thumb}" alt="" onerror="this.style.background='#333'">
          <div style="min-width:0"><div class="community-track-title">${t.title}</div><div class="community-track-artist">${t.channel}</div></div>
        </div>`).join('')}
      <div class="community-actions">
        <button class="community-play-btn" onclick="playCommunity('${title}')"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></button>
        <button class="community-action-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg></button>
        <button class="community-action-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      </div>`;
    el.appendChild(card);
  }
}

function playCommunity(title){
  const tracks=communityTracks[title];
  if(!tracks||!tracks.length)return;
  allTracks=tracks;playTrack(0,allTracks);
}

let viralTracks=[];
async function loadViralTiktok(){
  viralTracks=await ytSearch('viral tiktok indonesia 2025 lagu populer',10);
  const el=document.getElementById('viralList');
  if(!viralTracks.length){el.innerHTML='';return;}
  el.innerHTML=viralTracks.map((t,i)=>`
    <div class="h-card anim" onclick="playViralTrack(${i})">
      <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="h-card-title">${t.title}</div>
      <div class="h-card-sub">${t.channel}</div>
    </div>`).join('');
}
function playViralTrack(idx){allTracks=viralTracks;playTrack(idx,allTracks);}

const homeSections=[
  {id:'eidList',q:'lagu lebaran idul fitri 2025',pool:'eidTracks'},
  {id:'surrenderList',q:'dance electronic beat drop 2024',pool:'surrenderTracks'},
  {id:'throwbackList',q:'throwback hits 90s 2000s classic',pool:'throwbackTracks'},
  {id:'feelgoodList',q:'feel good rock alternative hits',pool:'feelgoodTracks'},
  {id:'acousticList',q:'acoustic chill guitar indie folk',pool:'acousticTracks'},
  {id:'top50List',q:'top 50 indonesia spotify chart 2025',pool:'top50Tracks'},
];
let homeSectionPools={};
async function loadExtraHomeSections(){
  for(const sec of homeSections){
    const tracks=await ytSearch(sec.q,8);
    homeSectionPools[sec.pool]=tracks;
    const el=document.getElementById(sec.id);
    if(!el||!tracks.length)continue;
    el.innerHTML=tracks.map((t,i)=>`
      <div class="h-card anim" onclick="playHomeSection('${sec.pool}',${i})">
        <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
        <div class="h-card-title">${t.title}</div>
        <div class="h-card-sub">${t.channel}</div>
      </div>`).join('');
    await new Promise(r=>setTimeout(r,800));
  }
}
let serupaTracks={};
async function loadSerupaDengan(tracks){
  const el=document.getElementById('serupaSection');
  if(!el)return;
  // Pick up to 6 unique artists from current tracks
  const seen=new Set(),artists=[];
  for(const t of tracks){
    if(!seen.has(t.channel)){seen.add(t.channel);artists.push(t);}
    if(artists.length>=6)break;
  }
  el.innerHTML='';
  for(const a of artists){
    const cleanName=a.channel.replace(/VEVO/gi,'').replace(/-\s*Topic$/i,'').replace(/Official/gi,'').trim();
    const similar=await ytSearch(`${cleanName} similar artists mix`,6);
    if(!similar.length)continue;
    const key=`serupa_${cleanName}`;
    serupaTracks[key]=similar;
    const div=document.createElement('div');
    div.className='similar-section';
    div.innerHTML=`
      <div class="similar-artist-row" onclick="openArtistByName('${cleanName.replace(/'/g,"\'")}','${a.thumb.replace(/'/g,"\'")}')">
        <div class="similar-artist-info">
          <img class="similar-artist-img" src="${a.thumb}" alt="">
          <div><div class="similar-label-sm">Serupa dengan</div><div class="similar-artist-name">${cleanName}</div></div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <div class="hscroll-wrap"><div class="hscroll">${similar.map((t,i)=>`
        <div class="h-card anim" onclick="playSerupaTrack('${key}',${i})">
          <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
          <div class="h-card-title">${t.title}</div>
          <div class="h-card-sub">${t.channel}</div>
        </div>`).join('')}</div></div>`;
    el.appendChild(div);
    // Delay antar artist biar gak ke-detect YouTube
    await new Promise(r=>setTimeout(r,700+Math.random()*500));
  }
}
function playSerupaTrack(key,idx){
  const tracks=serupaTracks[key];
  if(!tracks||!tracks.length)return;
  allTracks=tracks;playTrack(idx,allTracks);
}

function playHomeSection(pool,idx){
  const tracks=homeSectionPools[pool];
  if(!tracks||!tracks.length)return;
  allTracks=tracks;playTrack(idx,allTracks);
}

async function loadNextExtraSection(){
  if(extraSectionsLoading)return;
  const sections=EXTRA_SECTIONS[currentChipQ]||EXTRA_SECTIONS['nadin amizah pamungkas hindia popular songs'];
  if(extraSectionCount>=sections.length)return;
  extraSectionsLoading=true;
  const[label,query]=sections[extraSectionCount];
  const sId=`extra_${extraSectionCount}`;extraSectionCount++;
  const container=document.getElementById('extraSections');
  const secEl=document.createElement('div');secEl.className='sec';secEl.id=sId;
  secEl.innerHTML=`<div class="sec-head"><div class="sec-title">${label}</div></div><div class="hscroll-wrap"><div class="hscroll" id="${sId}_list">${skeletonHCards(4)}</div></div>`;
  container.appendChild(secEl);
  const tracks=await ytSearch(query,8);extraTrackPools[sId]=tracks;
  const listEl=document.getElementById(`${sId}_list`);
  if(!tracks.length){listEl.innerHTML='<div style="padding:20px;color:var(--muted);font-size:12px">Tidak ada hasil</div>';extraSectionsLoading=false;return;}
  listEl.innerHTML=tracks.map((t,i)=>`
    <div class="h-card anim" style="animation-delay:${i*.04}s" onclick="playExtraTrack('${sId}',${i})">
      <img class="h-card-img" src="${t.thumb}" alt="" onerror="this.style.background='#222'">
      <div class="h-card-title">${t.title}</div>
      <div class="h-card-sub">${t.channel}</div>
    </div>`).join('');
  extraSectionsLoading=false;
}

function playExtraTrack(sId,idx){
  const pool=extraTrackPools[sId];if(!pool)return;
  const alreadyIn=allTracks.some(t=>t.id===pool[0]?.id);
  const offset=allTracks.length;
  if(!alreadyIn)allTracks=[...allTracks,...pool];
  const realIdx=alreadyIn?allTracks.findIndex(t=>t.id===pool[idx].id):offset+idx;
  playTrack(realIdx<0?0:realIdx,allTracks);
}

function setupInfiniteScroll(){
  const obs=new IntersectionObserver(async entries=>{
    if(entries[0].isIntersecting&&currentPage==='home'){
      await loadNextExtraSection();
      setTimeout(loadNextExtraSection,300);
    }
  },{rootMargin:'600px'});
  obs.observe(document.getElementById('scrollSentinel'));
}

// ===== PLAY =====
function playTrack(idx,tracks){
  if(idx<0||idx>=tracks.length)return;
  if(tracks!==allTracks)allTracks=tracks;
  curIdx=idx;
  const t=allTracks[idx];
  _trackUniqueSongPlayed(t.id);
  lyricsTrackId=null;
  syncedLines=null;
  lyricsIdx=0;
  // Clear lyricsContent immediately so old lyrics don't flash
  document.getElementById('lyricsContent').innerHTML=`<div class="lyrics-loading"><div class="spin"></div><span>${getLang().loadingLyrics||'Memuat lirik...'}</span></div>`;

  // Reset subpanel to player (close lyrics swap, close upnext)
  currentSubPanel=null;
  document.getElementById('fpSwapZone').classList.remove('show-lyrics');
  document.getElementById('fpSubUpnext').style.display='none';
  document.getElementById('fpSubUpnext').classList.remove('active');
  document.querySelectorAll('.fp-btab').forEach(b=>b.classList.remove('active'));

  addToHistory(t);
  setFpBgColor(idx);
  document.getElementById('fpFrom').textContent=getLang().playingFrom||'Memutar dari Trending';
  document.getElementById('miniThumb').src=t.thumb;
  document.getElementById('miniTitle').textContent=t.title;
  document.getElementById('miniArtist').textContent=t.channel;
  document.getElementById('miniPlayer').classList.add('show');
  document.getElementById('miniProg').style.width='0%';
  document.getElementById('fpImg').src=t.thumb;
  document.getElementById('fpTitle').textContent=t.title;
  document.getElementById('fpArtist').textContent=t.channel;
  // Marquee: duplicate text + activate only if overflowing
  requestAnimationFrame(()=>{
    const titleEl=document.getElementById('fpTitle');
    const wrapEl=titleEl?.parentElement;
    if(!titleEl||!wrapEl)return;
    titleEl.classList.remove('marquee');
    titleEl.textContent=t.title;
    if(titleEl.scrollWidth>wrapEl.clientWidth){
      titleEl.textContent=t.title+'          '+t.title;
      titleEl.classList.add('marquee');
    }
  });
  document.getElementById('fpPfill').style.width='0%';
  document.getElementById('fpNow').textContent='0:00';
  document.getElementById('fpEnd').textContent='0:00';
  setPlaying(false);
  setBuffering(true);
  updateHeartUI();

  // Pre-fetch lirik + update about artist di background
  setTimeout(()=>prefetchLyrics(t),300);
  setTimeout(()=>updateAboutArtist(t.channel, t.thumb),500);

  if(ytReady&&yt&&typeof yt.loadVideoById==='function'){
    yt.loadVideoById(t.id);
    try{setVolume(document.getElementById('fpVol').value);}catch{}
  } else pendingId=t.id;
  renderQP(allTracks);
}

function featuredPlay(){playTrack(0,allTracks);}
function playAll(){playTrack(0,allTracks);}
function nextTrack(){
  if(shuffleOn&&allTracks.length>1){let i;do{i=Math.floor(Math.random()*allTracks.length);}while(i===curIdx);playTrack(i,allTracks);}
  else if(curIdx<allTracks.length-1)playTrack(curIdx+1,allTracks);
  else setPlaying(false);
}
function prevTrack(){if(curIdx>0)playTrack(curIdx-1,allTracks);}
function togglePlay(){if(!yt)return;yt.getPlayerState()===YT.PlayerState.PLAYING?yt.pauseVideo():yt.playVideo();}
function setPlaying(yes){
  document.getElementById('miniIcPlay').style.display=yes?'none':'block';
  document.getElementById('miniIcPause').style.display=yes?'block':'none';
  document.getElementById('fpIcPlay').style.display=yes?'none':'block';
  document.getElementById('fpIcPause').style.display=yes?'block':'none';
  const eq=document.getElementById('miniEqualizer');
  if(eq) eq.classList.toggle('playing',yes);
  updateTop50Equalizer(yes);
}

function updateTop50Equalizer(isPlaying){
  // Reset semua
  document.querySelectorAll('.track-num-eq').forEach(el=>el.classList.remove('playing'));
  document.querySelectorAll('.track-num').forEach(el=>el.style.display='');
  if(!isPlaying) return;
  // Highlight yang lagi main
  const t=allTracks[curIdx];
  if(!t) return;
  const eqEl=document.getElementById('top50eq_'+t.id);
  const numEl=document.getElementById('top50num_'+t.id);
  if(eqEl){eqEl.classList.add('playing');}
  if(numEl){numEl.style.display='none';}
}
function toggleShuffle(){shuffleOn=!shuffleOn;document.getElementById('btnShuffle').classList.toggle('on',shuffleOn);if(shuffleOn)_trackMissionProgress('shuffle',1);}
function toggleRepeat(){repeatOn=!repeatOn;document.getElementById('btnRepeat').classList.toggle('on',repeatOn);if(repeatOn)_trackMissionProgress('repeat',1);}

function startProg(){
  clearInterval(progTimer);
  progTimer=setInterval(()=>{
    if(!yt?.getDuration)return;
    const cur=yt.getCurrentTime()||0,dur=yt.getDuration()||0;
    if(!dur)return;
    const pct=(cur/dur*100)+'%';
    document.getElementById('miniProg').style.width=pct;
    document.getElementById('fpPfill').style.width=pct;
    document.getElementById('fpNow').textContent=fmt(cur);
    document.getElementById('fpEnd').textContent=fmt(dur);
    updateLyricsHighlight();
    if(yt.getPlayerState&&yt.getPlayerState()===YT.PlayerState.PLAYING)_trackListenSeconds(0.5);
  },500);
}

document.getElementById('fpPbar').onclick=e=>{
  if(!yt?.getDuration)return;
  const r=e.currentTarget.getBoundingClientRect();
  yt.seekTo(((e.clientX-r.left)/r.width)*yt.getDuration());
};
// ===== EQUALIZER + COMPRESSOR =====
let audioCtx=null,gainNode=null,bassFilter=null,midFilter=null,trebleFilter=null,compressor=null,compOn=false;

function initEQ(){
  if(audioCtx)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();

    // Bass filter - low shelf 200Hz
    bassFilter=audioCtx.createBiquadFilter();
    bassFilter.type='lowshelf';
    bassFilter.frequency.value=200;
    bassFilter.gain.value=0;

    // Mid filter - peaking 1000Hz
    midFilter=audioCtx.createBiquadFilter();
    midFilter.type='peaking';
    midFilter.frequency.value=1000;
    midFilter.Q.value=1;
    midFilter.gain.value=0;

    // Treble filter - high shelf 6000Hz
    trebleFilter=audioCtx.createBiquadFilter();
    trebleFilter.type='highshelf';
    trebleFilter.frequency.value=6000;
    trebleFilter.gain.value=0;

    // Compressor - makes everything punchier and louder-feeling
    compressor=audioCtx.createDynamicsCompressor();
    compressor.threshold.value=-24;
    compressor.knee.value=30;
    compressor.ratio.value=12;
    compressor.attack.value=0.003;
    compressor.release.value=0.25;

    gainNode=audioCtx.createGain();
    gainNode.gain.value=1;

    // Chain: bass -> mid -> treble -> compressor -> gain -> output
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Inject audio via <audio> element mirroring YouTube (best we can do)
    // YouTube audio is captured via AudioContext destination override
    console.log('EQ initialized');
  }catch(e){console.warn('EQ init failed:',e);audioCtx=null;}
}

function resumeEQ(){
  if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();
}

function setVolume(val){
  val=parseInt(val);
  if(yt?.setVolume)yt.setVolume(val);
}

// ===== EQ FUNCTIONS =====
const EQ_PRESETS={
  flat:   {bass:0,mid:0,treble:0},
  bass:   {bass:8,mid:2,treble:-2},
  vocal:  {bass:-2,mid:6,treble:4},
  rock:   {bass:5,mid:-2,treble:6},
  electronic:{bass:10,mid:0,treble:8},
};
let currentPreset='flat';

function setEQ(band,val){
  val=parseInt(val);
  // Update display value
  const labels={bass:'bassVal',mid:'midVal',treble:'trebleVal'};
  const el=document.getElementById(labels[band]);
  if(el){
    el.textContent=(val>0?'+':'')+val;
    el.style.color=val>0?'var(--accent)':val<0?'#ff6b6b':'var(--muted)';
  }
  // Update slider track
  const sliderId={bass:'eqBass',mid:'eqMid',treble:'eqTreble'}[band];
  const s=document.getElementById(sliderId);
  if(s){
    const pct=((val+12)/24)*100;
    const color=val>0?'var(--accent)':val<0?'#ff6b6b':'#555';
    s.style.background=`linear-gradient(to right,#333 ${100-pct}%,${color} ${100-pct}%)`;
  }
  // Apply to Web Audio if available
  if(!audioCtx){initEQ();resumeEQ();}
  try{
    if(band==='bass'&&bassFilter)bassFilter.gain.setTargetAtTime(val,audioCtx.currentTime,0.01);
    if(band==='mid'&&midFilter)midFilter.gain.setTargetAtTime(val,audioCtx.currentTime,0.01);
    if(band==='treble'&&trebleFilter)trebleFilter.gain.setTargetAtTime(val,audioCtx.currentTime,0.01);
  }catch(e){}
  // Clear active preset if manually adjusted
  currentPreset=null;
  document.querySelectorAll('.eq-preset').forEach(b=>b.classList.remove('active'));
}

function applyPreset(name){
  const p=EQ_PRESETS[name];if(!p)return;
  currentPreset=name;
  // Update sliders + labels
  document.getElementById('eqBass').value=p.bass;
  document.getElementById('eqMid').value=p.mid;
  document.getElementById('eqTreble').value=p.treble;
  setEQ('bass',p.bass);
  setEQ('mid',p.mid);
  setEQ('treble',p.treble);
  // Highlight active preset
  document.querySelectorAll('.eq-preset').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('preset_'+name);
  if(btn)btn.classList.add('active');
  showToast('🎛️ Preset: '+btn?.textContent);
}

function toggleCompressor(){
  compOn=!compOn;
  const toggle=document.getElementById('compToggle');
  const thumb=document.getElementById('compThumb');
  const label=document.getElementById('compLabel');
  if(compOn){
    if(toggle)toggle.style.background='var(--accent)';
    if(thumb){thumb.style.left='18px';thumb.style.background='#000';}
    if(label)label.style.color='var(--accent)';
    if(!audioCtx){initEQ();resumeEQ();}
    showToast('🎚️ Compressor ON — suara lebih padat');
  } else {
    if(toggle)toggle.style.background='#333';
    if(thumb){thumb.style.left='2px';thumb.style.background='#888';}
    if(label)label.style.color='var(--muted)';
    showToast('Compressor OFF');
  }
}

document.getElementById('fpVol').oninput=e=>{setVolume(e.target.value);};
function fmt(s){if(!s||isNaN(s))return'0:00';return`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;}

// ===== DYNAMIC BG COLOR =====
function setFpBgColor(trackIdx){
  const blob=document.getElementById('fpBgBlob');
  if(!blob)return;
  const hue=(trackIdx*137.508)%360;
  const sat=55+(trackIdx*7)%30;
  const lit=25+(trackIdx*3)%20;
  blob.style.background=`hsl(${hue},${sat}%,${lit}%)`;
}

function openFullPlayer(){document.getElementById('fullPlayer').classList.add('open');}
function closeFullPlayer(){document.getElementById('fullPlayer').classList.remove('open');}
let startY=0;
document.getElementById('fullPlayer').addEventListener('touchstart',e=>{startY=e.touches[0].clientY;},{passive:true});
document.getElementById('fullPlayer').addEventListener('touchend',e=>{if(e.changedTouches[0].clientY-startY>80)closeFullPlayer();});

// Home chips
document.getElementById('homeChips').addEventListener('click',e=>{
  const c=e.target.closest('.chip');if(!c)return;
  document.querySelectorAll('#homeChips .chip').forEach(x=>x.classList.remove('active'));
  c.classList.add('active');loadHome(c.dataset.q);
});

// Library chips
document.getElementById('libChips').addEventListener('click',e=>{
  const c=e.target.closest('.chip');if(!c)return;
  document.querySelectorAll('#libChips .chip').forEach(x=>x.classList.remove('active'));
  c.classList.add('active');currentLibTab=c.dataset.lib;renderLibrary();
});

// Search — hanya jalan saat Enter ditekan (hemat quota API YouTube)
// ===== SEARCH HISTORY =====
function getSearchHistory(){try{return JSON.parse(localStorage.getItem(getUserKey('search_history'))||'[]')}catch{return[]}}
function saveSearchHistory(a){localStorage.setItem(getUserKey('search_history'),JSON.stringify(a.slice(0,15)))}
function addSearchHistory(q){
  if(!q.trim())return;
  let h=getSearchHistory();
  h=h.filter(x=>x.toLowerCase()!==q.toLowerCase()); // remove duplicate
  h.unshift(q);
  saveSearchHistory(h);
}
function renderSearchHistory(){
  const el=document.getElementById('searchResults');
  const h=getSearchHistory();
  const inp=document.getElementById('searchInput').value.trim();
  if(inp||lastRawResults.length)return; // don't override active search
  if(!h.length){
    el.innerHTML=`<div class="search-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><p>Cari lagu, album, atau artis</p></div>`;
    return;
  }
  el.innerHTML=`
    <div style="padding:16px 20px 8px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:14px;font-weight:700;color:var(--text)">Pencarian Terakhir</span>
      <button onclick="clearSearchHistory()" style="background:none;border:none;color:var(--muted);font-size:12px;font-family:Inter,sans-serif;cursor:pointer;font-weight:600">Hapus Semua</button>
    </div>
    <div style="padding:0 20px">
      ${h.map((q,i)=>`
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="fillSearch('${q.replace(/'/g,"\'")}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span style="flex:1;font-size:14px;color:var(--text2)">${q}</span>
          <button onclick="event.stopPropagation();removeSearchHistory(${i})" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;display:flex;align-items:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`).join('')}
    </div>`;
}
function fillSearch(q){
  document.getElementById('searchInput').value=q;
  doSearch();
}
function clearSearchHistory(){
  saveSearchHistory([]);
  renderSearchHistory();
  showToast('Riwayat pencarian dihapus');
}
function removeSearchHistory(idx){
  let h=getSearchHistory();
  h.splice(idx,1);
  saveSearchHistory(h);
  renderSearchHistory();
}

async function doSearch(){
  const q=document.getElementById('searchInput').value.trim();
  if(!q){
    lastRawResults=[];
    renderSearchHistory();
    return;
  }
  lastSearchQuery=q;
  addSearchHistory(q);
  _trackMissionProgress('search',1);
  document.getElementById('searchResults').innerHTML=`<div class="loading"><div class="spin"></div><span>${getLang().searching||'Mencari...'}</span></div>`;
  const results=await ytSearch(q,20);
  lastRawResults=results;allTracks=results;curIdx=-1;
  applySearchFilter();
}

document.getElementById('searchInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();hideSuggest();doSearch();}
  if(e.key==='Escape'){hideSuggest();}
});

let suggestTimer=null;
function hideSuggest(){
  document.getElementById('searchSuggest').style.display='none';
}

async function fetchSuggestions(q){
  try{
    // Pake allorigins sebagai proxy buat bypass CORS
    const target=encodeURIComponent(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`);
    const res=await fetch(`https://api.allorigins.win/get?url=${target}`);
    const data=await res.json();
    const parsed=JSON.parse(data.contents);
    return parsed[1]||[];
  }catch{return[];}
}

document.getElementById('searchInput').addEventListener('input',e=>{
  const val=e.target.value.trim();
  if(!val){
    lastRawResults=[];
    hideSuggest();
    renderSearchHistory();
    return;
  }
  // Debounce suggestions
  clearTimeout(suggestTimer);
  suggestTimer=setTimeout(async()=>{
    const suggestions=await fetchSuggestions(val);
    const el=document.getElementById('searchSuggest');
    if(!suggestions.length||!document.getElementById('searchInput').value.trim()){
      el.style.display='none';return;
    }
    el.style.display='block';
    el.innerHTML=suggestions.slice(0,8).map(s=>`
      <div onclick="selectSuggest('${s.replace(/'/g,"\\'")}')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);active:background:#2a2a2a" onmousedown="event.preventDefault()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);flex-shrink:0;margin-left:auto;transform:rotate(225deg)"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
      </div>`).join('');
  },300);
});

function selectSuggest(q){
  document.getElementById('searchInput').value=q;
  hideSuggest();
  doSearch();
}

// Hide suggest when clicking outside
document.addEventListener('click',e=>{
  if(!e.target.closest('.search-input-wrap')) hideSuggest();
});

// Handle initial URL routing
(function(){
  const p = routeFromPath(window.location.pathname);
  if(p !== 'home') {
    // set initial state without pushing
    history.replaceState({page:'home'}, '', '/');
    history.pushState({page:p}, '', window.location.pathname);
  } else {
    history.replaceState({page:'home'}, '', '/');
  }
  // show correct page without re-pushing state
  showPage(p, false);
})();
// Load saved language
const savedLang=localStorage.getItem('nada_lang');
if(savedLang&&LANGS[savedLang]){
  currentLang=savedLang;
  // Update lang button active state
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.remove('active'));
  const activeBtn=document.getElementById('lang_'+savedLang);
  if(activeBtn)activeBtn.classList.add('active');
}
loadHome('lagu indonesia viral 2025 spotify');
setupInfiniteScroll();
renderLibrary();

// ===== PWA INSTALL =====
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredPrompt=e;
  const btn=document.getElementById('pwaInstallBtn');
  if(btn)btn.style.display='flex';
});
// Register service worker for PWA install prompt
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js')
      .then(()=>console.log('SW registered'))
      .catch(()=>{});
  });
}

window.addEventListener('appinstalled',()=>{
  deferredPrompt=null;
  const btn=document.getElementById('pwaInstallBtn');
  if(btn)btn.style.display='none';
  showToast('✅ Aplikasi berhasil diinstall!');
});
async function installPWA(){
  if(!deferredPrompt){
    // Try showing browser install instructions
    if(/Android/i.test(navigator.userAgent)){
      showToast('Ketuk ⋮ lalu "Add to Home screen"');
    } else {
      showToast('Buka di Chrome Android untuk install');
    }
    return;
  }
  try{
    deferredPrompt.prompt();
    const{outcome}=await deferredPrompt.userChoice;
    if(outcome==='accepted'){showToast('✅ Menginstall aplikasi...');}
    else{showToast('Install dibatalkan');}
    deferredPrompt=null;
    const btn=document.getElementById('pwaInstallBtn');
    if(btn)btn.style.display='none';
  }catch(e){
    showToast('Ketuk ⋮ lalu "Add to Home screen"');
  }
}

// ===== FIREBASE AUTH =====
// 🔧 GANTI dengan Firebase config lu sendiri dari console.firebase.google.com
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAhuoL67FZwSNdNqbuQrY2JXPplAfRccik",
  authDomain: "hidaka-music.firebaseapp.com",
  projectId: "hidaka-music",
  storageBucket: "hidaka-music.firebasestorage.app",
  messagingSenderId: "276288771048",
  appId: "1:276288771048:web:f62a28653051f4e889ca5d"
};

let firebaseApp=null, firebaseAuth=null;
let authEmailVisible=false, authCurrentTab='login';

async function initFirebase(){
  try{
    const {initializeApp}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const {getAuth,onAuthStateChanged,signInWithPopup,signInWithRedirect,getRedirectResult,GoogleAuthProvider,
           createUserWithEmailAndPassword,signInWithEmailAndPassword,
           sendPasswordResetEmail,updateProfile,signOut:fbSignOut,
           signInWithPhoneNumber,RecaptchaVerifier
    }=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    
    firebaseApp=initializeApp(FIREBASE_CONFIG);
    firebaseAuth=getAuth(firebaseApp);
    
    // Store refs globally
    window._fbAuth={getAuth,onAuthStateChanged,signInWithPopup,signInWithRedirect,getRedirectResult,GoogleAuthProvider,
      createUserWithEmailAndPassword,signInWithEmailAndPassword,
      sendPasswordResetEmail,updateProfile,signOut:fbSignOut,
      signInWithPhoneNumber,RecaptchaVerifier};

    // Cek redirect result (setelah balik dari Google login)
    try{
      const result=await getRedirectResult(firebaseAuth);
      if(result?.user) showToast('✅ Berhasil masuk!');
    }catch(e){};

    // Tunggu sebentar sebelum update UI biar Firebase restore session dulu
    let _authResolved=false;
    onAuthStateChanged(firebaseAuth, user=>{
      currentUser=user;
      _authResolved=true;
      updateAuthUI(user);
    });
    // Kalau 3 detik belum resolve, anggap tidak login
    setTimeout(()=>{if(!_authResolved)updateAuthUI(null);},3000);
  }catch(e){
    console.warn('Firebase init error:',e);
  }
}
initFirebase();

function updateAuthUI(user){
  const btn=document.getElementById('authTopBtn');
  const label=document.getElementById('authBtnLabel');
  const iconEl=document.getElementById('authBtnIcon');
  if(!btn)return;
  if(user){
    btn.classList.add('logged-in');
    const av=btn.querySelector('.auth-avatar');
    if(av)av.remove();
    iconEl.style.display='none';
    if(user.photoURL){
      const img=document.createElement('img');
      img.src=user.photoURL;
      img.className='auth-avatar';
      btn.insertBefore(img,label);
    } else {
      iconEl.style.display='';
    }
    label.textContent=user.displayName?.split(' ')[0]||'Akun';
    try{localStorage.setItem('hidaka_last_user_name',user.displayName?.split(' ')[0]||'Akun');}catch(e){}
    // Load data akun dari Firestore lalu refresh UI
    loadUserDataFromFirestore();
    syncUserProfile(user);
    updateProfileNavIcon();
  } else {
    btn.classList.remove('logged-in');
    const av=btn.querySelector('.auth-avatar');
    if(av)av.remove();
    iconEl.style.display='';
    label.textContent='Masuk';
    try{localStorage.removeItem('hidaka_last_user_name');}catch(e){}
    if(typeof renderLibrary==='function') renderLibrary();
  }
}

// ===== USER PUBLIC PROFILE (Firestore) =====
let _profileViewingUid=null;
let _editFieldType=null;

const ROLE_TIERS=[
  {min:0,name:'Pendengar'},{min:10,name:'Pendengar Aktif'},{min:20,name:'Komentator'},
  {min:30,name:'Komentator Rajin'},{min:40,name:'Kontributor'},{min:50,name:'Kontributor Setia'},
  {min:60,name:'Legenda Komentar'},{min:70,name:'Master Komentar'},{min:80,name:'Sesepuh'},
  {min:90,name:'Veteran Sejati'}
];
function _getProfileRole(commentCount){
  let name=ROLE_TIERS[0].name;
  for(const t of ROLE_TIERS)if(commentCount>=t.min)name=t.name;
  return name;
}
// Level sekarang dari poin dengerin musik (10 menit = +5 poin), BUKAN dari komentar lagi.
// Kebutuhan poin naik tiap level: req(n) = 20 + 15*(n-1), maksimal Lv.100
const MAX_LEVEL=100;
function _levelPointReq(n){return 20+15*(n-1);}
function getLevelPoints(){return parseFloat(localStorage.getItem('hidaka_level_points')||'0');}
function _computeLevelInfo(totalPoints){
  let lvl=1,cum=0;
  while(lvl<MAX_LEVEL){
    const req=_levelPointReq(lvl);
    if(totalPoints>=cum+req){cum+=req;lvl++;}else break;
  }
  const req=_levelPointReq(Math.min(lvl,MAX_LEVEL-1));
  return{level:lvl,into:Math.max(0,totalPoints-cum),need:req};
}
function _getProfileLv(totalPoints){return'Lv.'+_computeLevelInfo(totalPoints||0).level;}
async function addLevelPoints(v){
  const before=_computeLevelInfo(getLevelPoints()).level;
  const total=getLevelPoints()+v;
  localStorage.setItem('hidaka_level_points',String(total));
  const after=_computeLevelInfo(total).level;
  if(after>before)showToast('🎉 Level Up! Sekarang Lv.'+after);
  if(currentUser&&firebaseApp){
    try{
      const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const db=fs.getFirestore(firebaseApp);
      await fs.setDoc(fs.doc(db,'user_profiles',currentUser.uid),{levelPoints:total},{merge:true});
    }catch(e){console.error('Gagal sinkron level:',e.code||e.message||e);}
  }
}

async function syncUserProfile(user){
  if(!user||!firebaseApp)return;
  _retryPendingAvatarSync();
  _retryPendingEditFieldSync();
  _retryPendingBannerSync();
  _pullCoinsFromServer();
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const ref=fs.doc(db,'user_profiles',user.uid);
    const snap=await fs.getDoc(ref);
    if(!snap.exists()){
      await fs.setDoc(ref,{
        displayName:user.displayName||user.email?.split('@')[0]||'User',
        photoURL:user.photoURL||null,
        bio:'',commentCount:0,likeCount:0,followerCount:0,followingCount:0,
        joinedAt:fs.serverTimestamp()
      });
    }else{
      const d=snap.data(),patch={};
      if(user.displayName&&user.displayName!==d.displayName)patch.displayName=user.displayName;
      if(user.photoURL&&user.photoURL!==d.photoURL)patch.photoURL=user.photoURL;
      if(Object.keys(patch).length)await fs.setDoc(ref,patch,{merge:true});
    }
  }catch(e){console.warn('syncUserProfile:',e);}
}

async function openUserProfile(uid){
  if(!uid){showToast('🔒 Login dulu');return;}
  _profileViewingUid=uid;
  const isOwn=currentUser&&currentUser.uid===uid;
  const page=document.getElementById('profilePage');
  page.classList.add('open');
  history.pushState({overlay:'profile'},'',location.pathname);
  if(isOwn)_trackMissionProgress('open_profile',1);
  togglePreviewMode(false);

  // Reset (tapi kalau profil sendiri, pakai cache dulu biar gak kedip "Memuat..." tiap buka)
  let cachedName=null,cachedBio=null;
  if(isOwn){
    try{
      cachedName=localStorage.getItem('hidaka_name_'+uid);
      cachedBio=localStorage.getItem('hidaka_bio_'+uid);
    }catch(e){}
  }
  document.getElementById('profileNameText').textContent=cachedName||'Memuat...';
  document.getElementById('profileBioText').textContent=cachedBio||'';
  document.getElementById('profileLvText').textContent='Lv.1';
  document.getElementById('profileRoleText').textContent='PENDENGAR';
  document.getElementById('profileStatComments').textContent='0';
  document.getElementById('profileFollowerCount').textContent='0';
  document.getElementById('profileFollowingCount').textContent='0';
  document.getElementById('profileAvatarImg').innerHTML='?';
  document.getElementById('profileAvatarImg').style.background='#333';
  document.getElementById('profileRingkasanContent').innerHTML='<div class="profile-sub-empty">Memuat...</div>';
  document.getElementById('profileAktivitasContent').innerHTML='<div class="profile-sub-empty">Memuat aktivitas...</div>';

  // Show/hide own-profile elements
  document.getElementById('profileGearBtn').style.display=isOwn?'flex':'none';
  document.getElementById('profileMisiBtn').style.display=isOwn?'flex':'none';
  document.getElementById('profileActionRow').style.display=isOwn?'flex':'none';
  document.getElementById('profileBannerEditBtn').style.display=isOwn?'flex':'none';
  document.getElementById('profileAvatarCamBtn').style.display=isOwn?'flex':'none';

  const bannerVideoEl=document.getElementById('profileBannerVideo');
  if(bannerVideoEl){bannerVideoEl.pause();bannerVideoEl.style.display='none';}

  if(isOwn){
    // Populate from local data immediately
    _renderProfileLocal();
    try{
      const cachedAv=localStorage.getItem('hidaka_avatar_'+uid);
      if(cachedAv)document.getElementById('profileAvatarImg').innerHTML='<img src="'+cachedAv+'">';
    }catch(e){}
  }

  if(!firebaseApp)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const snap=await fs.getDoc(fs.doc(db,'user_profiles',uid));
    if(!snap.exists()){document.getElementById('profileNameText').textContent='Pengguna tidak ditemukan';return;}
    const d=snap.data();

    document.getElementById('profileNameText').textContent=d.displayName||'User';
    const bio=d.bio&&d.bio.trim()?d.bio:(isOwn?'Tap Edit Profil untuk menambahkan bio':'Belum ada bio.');
    document.getElementById('profileBioText').textContent=bio;
    if(isOwn){
      try{
        localStorage.setItem('hidaka_name_'+uid,d.displayName||'');
        localStorage.setItem('hidaka_bio_'+uid,bio);
      }catch(e){}
    }

    const cc=d.commentCount||0;
    document.getElementById('profileLvText').textContent=_getProfileLv(d.levelPoints||0);
    document.getElementById('profileRoleText').textContent=d.roleOverride||_getProfileRole(cc);
    document.getElementById('profileStatComments').textContent=cc;
    document.getElementById('profileFollowerCount').textContent=d.followerCount||0;

    // Banner theme — sekarang dibaca dari server (bukan localStorage lagi), jadi keliatan sama semua orang
    let bannerId=d.bannerThemeId;
    if(!bannerId&&isOwn){
      try{bannerId=localStorage.getItem('hidaka_selected_banner');}catch(e){}
    }
    if(bannerId){
      const bannerItem=BANNER_THEMES.find(t=>t.id===bannerId);
      if(bannerItem)applyBannerTheme(bannerItem);
      if(isOwn){try{localStorage.setItem('hidaka_selected_banner',bannerId);}catch(e){}}
    }
    document.getElementById('profileFollowingCount').textContent=d.followingCount||0;

    const avEl=document.getElementById('profileAvatarImg');
    if(d.photoURL){avEl.innerHTML='<img src="'+d.photoURL+'">';}
    else{
      const i=(d.displayName||'?')[0].toUpperCase();
      avEl.textContent=i;
      const cols=['#1db954','#1e90ff','#ff6b6b','#f7c948','#a855f7','#f97316'];
      avEl.style.background=cols[i.charCodeAt(0)%cols.length];
    }

    // Ringkasan stats card
    document.getElementById('profileRingkasanContent').innerHTML=
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        _statCard('💬','Komentar',cc)+
        _statCard('❤️','Disukai',d.likeCount||0)+
        _statCard('👥','Followers',d.followerCount||0)+
        _statCard('🎵','Lagu Disukai',getLiked().length)+
      '</div>';

    _loadProfileActivity(uid,fs,db);
    if(isOwn)_renderProfileLocal();
  }catch(e){
    console.error('Gagal muat profil:',e.code||e.message||e);
    const nameEl=document.getElementById('profileNameText');
    if(cachedName){
      nameEl.textContent=cachedName;
    }else if(nameEl.textContent==='Memuat...'){
      nameEl.textContent='Gagal memuat, tarik-refresh buat coba lagi';
    }
  }
}

function _statCard(icon,label,val){
  return '<div style="background:#1a1a1a;border-radius:10px;padding:14px;text-align:center">'+
    '<div style="font-size:20px;margin-bottom:4px">'+icon+'</div>'+
    '<div style="font-size:18px;font-weight:800;color:#f59e0b">'+val+'</div>'+
    '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">'+label+'</div>'+
  '</div>';
}

function _renderProfileLocal(){
  const liked=getLiked();
  const favEl=document.getElementById('profileFavoritContent');
  if(favEl){
    if(!liked.length){favEl.innerHTML='<div class="profile-sub-empty">Belum ada lagu favorit ❤️</div>';}
    else{
      window._profileLiked=liked;
      favEl.innerHTML=liked.slice(0,10).map((t,i)=>'<div class="profile-track-row" onclick="playTrack('+i+',window._profileLiked)">'+
        '<img class="profile-track-thumb" src="'+t.thumb+'" onerror="this.style.background=\'#222\'">'+
        '<div class="profile-track-info"><div class="profile-track-title">'+escHtml(t.title||'')+'</div><div class="profile-track-artist">'+escHtml(t.channel||'')+'</div></div>'+
      '</div>').join('');
    }
  }
  const hist=getHistory();
  const histEl=document.getElementById('profileRiwayatContent');
  if(histEl){
    if(!hist.length){histEl.innerHTML='<div class="profile-sub-empty">Belum ada riwayat 🎵</div>';}
    else{
      window._profileHistory=hist;
      histEl.innerHTML=hist.slice(0,10).map((t,i)=>'<div class="profile-track-row" onclick="playTrack('+i+',window._profileHistory)">'+
        '<img class="profile-track-thumb" src="'+t.thumb+'" onerror="this.style.background=\'#222\'">'+
        '<div class="profile-track-info"><div class="profile-track-title">'+escHtml(t.title||'')+'</div><div class="profile-track-artist">'+escHtml(t.channel||'')+'</div></div>'+
      '</div>').join('');
    }
  }
  const pls=getPlaylists();
  const plEl=document.getElementById('profilePlaylistContent');
  if(plEl){
    if(!pls.length){plEl.innerHTML='<div class="profile-sub-empty">Belum ada playlist 📋</div>';}
    else{plEl.innerHTML=pls.map(pl=>'<div class="profile-track-row">'+
      '<div class="profile-track-thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px;background:#1a1a1a">📋</div>'+
      '<div class="profile-track-info"><div class="profile-track-title">'+escHtml(pl.name||'Playlist')+'</div><div class="profile-track-artist">'+(pl.tracks?.length||0)+' lagu</div></div>'+
    '</div>').join('');}
  }
}

async function _loadProfileActivity(uid,fs,db){
  const el=document.getElementById('profileAktivitasContent');
  try{
    const cg=fs.collectionGroup(db,'comments');
    const q=fs.query(cg,fs.where('uid','==',uid),fs.orderBy('ts','desc'),fs.limit(10));
    const snap=await fs.getDocs(q);
    if(snap.empty){el.innerHTML='<div class="profile-sub-empty">💬 Belum ada aktivitas</div>';return;}
    el.innerHTML=snap.docs.map(d=>{
      const c=d.data();
      return '<div class="profile-track-row">'+
        '<div class="profile-track-thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px;background:#1a1a1a">💬</div>'+
        '<div class="profile-track-info">'+
          '<div class="profile-track-title">'+escHtml(c.text||'')+'</div>'+
          '<div class="profile-track-artist">'+_commentTimeAgo(c.ts?.toMillis?.()||Date.now())+'</div>'+
        '</div></div>';
    }).join('');
  }catch(e){el.innerHTML='<div class="profile-sub-empty">Aktivitas belum bisa dimuat</div>';}
}

function closeUserProfile(){
  document.getElementById('profilePage').classList.remove('open');
  togglePreviewMode(false);
}

function switchProfileSection(section,btn){
  document.querySelectorAll('.profile-section-item').forEach(el=>el.classList.remove('active-section'));
  btn.classList.add('active-section');
  document.querySelectorAll('.profile-sub-panel').forEach(el=>el.classList.remove('active'));
  const map={ringkasan:'subRingkasan',favorit:'subFavorit',aktivitas:'subAktivitas',riwayat:'subRiwayat',playlist:'subPlaylist'};
  const el=document.getElementById(map[section]);
  if(el)el.classList.add('active');
}

function handleProfileNavClick(){
  // Reset active semua nav dulu
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  if(currentUser){
    document.getElementById('navProfile')?.classList.add('active');
    openUserProfile(currentUser.uid);
  }else{
    openAuthScreen();
  }
}

function updateProfileNavIcon(){
  const wrap=document.getElementById('navProfileIconWrap');
  if(!wrap)return;
  if(currentUser&&currentUser.photoURL){
    wrap.innerHTML='<img src="'+currentUser.photoURL+'" style="width:24px;height:24px;border-radius:50%;object-fit:cover">';
  }else{
    wrap.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  }
}

// ===== SETTINGS PAGE =====
async function openSettingsPage(){
  if(!currentUser){showToast('🔒 Login dulu');return;}
  document.getElementById('settingsPage').classList.add('open');
  history.pushState({overlay:'settings'},'',location.pathname);
  _trackMissionProgress('open_settings',1);
  document.getElementById('settingsEmailVal').textContent=currentUser.email||'–';
  const aiLangEl=document.getElementById('settingsAiLangVal');
  if(aiLangEl)aiLangEl.textContent=AI_LANG_NAMES[getAiLang()]||'Indonesia';
  const avMini=document.getElementById('settingsAvatarMini');
  if(currentUser.photoURL)avMini.src=currentUser.photoURL;
  // Setiap buka Settings, langsung coba sinkron ulang apapun yang sempet gagal (diam-diam, no UI noise)
  _retryPendingAvatarSync();
  _retryPendingEditFieldSync();
  _retryPendingBannerSync();

  if(!firebaseApp)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const snap=await fs.getDoc(fs.doc(db,'user_profiles',currentUser.uid));
    const d=snap.exists()?snap.data():{};
    document.getElementById('settingsNameVal').textContent=d.displayName||currentUser.displayName||'–';
    document.getElementById('settingsBioVal').textContent=(d.bio&&d.bio.trim())?d.bio:'Belum diisi';
  }catch(e){}
}

function closeSettingsPage(){
  document.getElementById('settingsPage').classList.remove('open');
}

function openEditField(type){
  _editFieldType=type;
  const overlay=document.getElementById('editFieldOverlay');
  const title=document.getElementById('editFieldTitle');
  const input=document.getElementById('editFieldInput');
  if(type==='name'){
    title.textContent='Edit Nama';
    input.value=document.getElementById('settingsNameVal').textContent.replace('Belum diisi','');
    input.rows=1;
  }else{
    title.textContent='Edit Bio';
    const cur=document.getElementById('settingsBioVal').textContent;
    input.value=cur==='Belum diisi'?'':cur;
    input.rows=4;
  }
  overlay.classList.add('open');
  setTimeout(()=>input.focus(),100);
}

function closeEditField(){
  document.getElementById('editFieldOverlay').classList.remove('open');
}

async function saveEditField(){
  const val=document.getElementById('editFieldInput').value.trim();
  if(!currentUser){showToast('🔒 Login dulu untuk menyimpan');return;}
  if(!firebaseApp){showToast('⚠️ Koneksi belum siap, coba lagi');return;}
  if(_editFieldType==='name'&&!val){showToast('Nama tidak boleh kosong');return;}
  const btn=document.querySelector('.settings-edit-btn');
  if(btn){btn.disabled=true;btn.textContent='Menyimpan...';}
  // Update tampilan langsung (optimistic), biar gak kerasa gagal walau koneksi lelet
  if(_editFieldType==='name'){
    document.getElementById('settingsNameVal').textContent=val;
    document.getElementById('profileNameText').textContent=val;
  }else{
    document.getElementById('settingsBioVal').textContent=val||'Belum diisi';
    document.getElementById('profileBioText').textContent=val||'Tap Edit Profil untuk menambahkan bio';
  }
  closeEditField();
  await _syncEditFieldToServer(_editFieldType,val,3);
  if(btn){btn.disabled=false;btn.textContent='Simpan';}
}

async function _syncEditFieldToServer(type,val,attemptsLeft){
  if(attemptsLeft===undefined)attemptsLeft=3;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const ref=fs.doc(db,'user_profiles',currentUser.uid);
    if(type==='name'){
      await fs.setDoc(ref,{displayName:val},{merge:true});
      const {updateProfile}=window._fbAuth;
      if(updateProfile)await updateProfile(currentUser,{displayName:val});
    }else{
      await fs.setDoc(ref,{bio:val},{merge:true});
    }
    showToast('✅ Tersimpan & bisa dilihat orang lain');
    try{localStorage.removeItem('hidaka_pending_'+type+'_'+currentUser.uid);}catch(e){}
  }catch(e){
    console.error('Gagal simpan '+type+':',e.code||e.message||e);
    if(e.code==='permission-denied'){
      // Firestore Rules nolak write ini — simpan pending, diem-diem, gak ganggu user
      try{localStorage.setItem('hidaka_pending_'+type+'_'+currentUser.uid,val);}catch(e){}
      return;
    }
    if(attemptsLeft>1){
      await new Promise(r=>setTimeout(r,2000));
      return _syncEditFieldToServer(type,val,attemptsLeft-1);
    }
    try{localStorage.setItem('hidaka_pending_'+type+'_'+currentUser.uid,val);}catch(e){}
  }
}

// Coba sinkron ulang nama/bio yang sempat gagal, dipanggil pas login/koneksi membaik
async function _retryPendingEditFieldSync(){
  if(!currentUser||!firebaseApp)return;
  ['name','bio'].forEach(type=>{
    let pending=null;
    try{pending=localStorage.getItem('hidaka_pending_'+type+'_'+currentUser.uid);}catch(e){}
    if(pending!==null)_syncEditFieldToServer(type,pending,1);
  });
}

// ===== PREVIEW MODE (lihat profil sendiri kayak orang lain lihat) =====
function togglePreviewMode(on){
  const page=document.getElementById('profilePage');
  const banner=document.getElementById('profilePreviewBanner');
  page.classList.toggle('preview-mode',on);
  banner.style.display=on?'flex':'none';
  if(on)showToast('👀 Preview mode aktif');
}

// ===== AVATAR UPLOAD (nyata, bukan placeholder) =====
function handleAvatarFile(ev){
  const file=ev.target.files&&ev.target.files[0];
  ev.target.value='';
  if(!file)return;
  if(!file.type.startsWith('image/')){showToast('⚠️ File harus gambar');return;}
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const size=160;
      const canvas=document.createElement('canvas');
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d');
      const s=Math.min(img.width,img.height);
      const sx=(img.width-s)/2,sy=(img.height-s)/2;
      ctx.drawImage(img,sx,sy,s,s,0,0,size,size);
      const dataUrl=canvas.toDataURL('image/jpeg',0.7);
      saveAvatar(dataUrl);
    };
    img.onerror=()=>showToast('❌ Gagal baca gambar');
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveAvatar(dataUrl){
  if(!currentUser||!firebaseApp){showToast('🔒 Login dulu untuk ganti avatar');return;}
  showToast('⏳ Mengunggah avatar...');
  // Tampilkan langsung + cache lokal biar instan pas dibuka lagi
  const avEl=document.getElementById('profileAvatarImg');
  if(avEl)avEl.innerHTML='<img src="'+dataUrl+'">';
  const miniEl=document.getElementById('settingsAvatarMini');
  if(miniEl)miniEl.src=dataUrl;
  try{localStorage.setItem('hidaka_avatar_'+currentUser.uid,dataUrl);}catch(e){}
  _trackMissionProgress('change_avatar',1);
  await _syncAvatarToServer(dataUrl,3);
}

async function _syncAvatarToServer(dataUrl,attemptsLeft){
  if(attemptsLeft===undefined)attemptsLeft=3;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const ref=fs.doc(db,'user_profiles',currentUser.uid);
    await fs.setDoc(ref,{photoURL:dataUrl},{merge:true});
    showToast('✅ Avatar diperbarui & bisa dilihat orang lain');
    try{localStorage.removeItem('hidaka_avatar_pending_'+currentUser.uid);}catch(e){}
  }catch(e){
    console.error('Gagal simpan avatar:',e.code||e.message||e);
    if(e.code==='permission-denied'){
      try{localStorage.setItem('hidaka_avatar_pending_'+currentUser.uid,dataUrl);}catch(e){}
      return;
    }
    if(attemptsLeft>1){
      await new Promise(r=>setTimeout(r,2000));
      return _syncAvatarToServer(dataUrl,attemptsLeft-1);
    }
    // Gagal total → tetep aman, avatar udah tersimpan lokal, tinggal disinkron nanti
    try{localStorage.setItem('hidaka_avatar_pending_'+currentUser.uid,dataUrl);}catch(e){}
  }
}

// Coba sinkron ulang avatar yang sempat gagal, dipanggil pas login/koneksi membaik
async function _retryPendingAvatarSync(){
  if(!currentUser||!firebaseApp)return;
  let pending=null;
  try{pending=localStorage.getItem('hidaka_avatar_pending_'+currentUser.uid);}catch(e){}
  if(pending)await _syncAvatarToServer(pending,1);
}

// ===== SISTEM KOIN =====
function getCoins(){return parseInt(localStorage.getItem('hidaka_coins')||'0',10);}
function setCoins(v){
  v=Math.max(0,Math.round(v));
  localStorage.setItem('hidaka_coins',String(v));
  _refreshCoinUI();
  _syncCoinsToServer(v);
}
function addCoins(v){setCoins(getCoins()+v);}
async function _syncCoinsToServer(v,attemptsLeft){
  if(attemptsLeft===undefined)attemptsLeft=3;
  if(!currentUser||!firebaseApp)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    await fs.setDoc(fs.doc(db,'user_profiles',currentUser.uid),{coins:v},{merge:true});
  }catch(e){
    console.error('Gagal sinkron koin:',e.code||e.message||e);
    if(e.code!=='permission-denied'&&attemptsLeft>1){
      await new Promise(r=>setTimeout(r,2000));
      return _syncCoinsToServer(v,attemptsLeft-1);
    }
  }
}
// Tarik saldo koin terbaru dari server (misal abis admin nambahin) — dipanggil pas login/buka Misi
async function _pullCoinsFromServer(){
  if(!currentUser||!firebaseApp)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const snap=await fs.getDoc(fs.doc(db,'user_profiles',currentUser.uid));
    if(snap.exists()&&typeof snap.data().coins==='number'){
      const serverCoins=snap.data().coins;
      const localCoins=getCoins();
      if(serverCoins>localCoins){
        // Server lebih tinggi (misal admin baru kasih koin) → pakai itu
        localStorage.setItem('hidaka_coins',String(serverCoins));
        _refreshCoinUI();
      }else if(localCoins>serverCoins){
        // Lokal lebih tinggi (misal abis dapet dari misi tapi belum sempet ke-sync) → dorong ke server, jangan ditimpa turun
        _syncCoinsToServer(localCoins);
      }
    }
  }catch(e){}
}
function _refreshCoinUI(){
  const el=document.getElementById('coinBalanceText');
  if(el)el.textContent=getCoins();
}
function getOwnedBanners(){
  try{return JSON.parse(localStorage.getItem('hidaka_owned_banners')||'[]');}catch(e){return[];}
}
function ownBanner(id){
  const o=getOwnedBanners();
  if(!o.includes(id)){o.push(id);localStorage.setItem('hidaka_owned_banners',JSON.stringify(o));}
}
// Tracking waktu dengerin musik → +50 koin tiap 15 menit kumulatif
function _trackListenSeconds(sec){
  let total=parseFloat(localStorage.getItem('hidaka_listen_sec')||'0')+sec;
  const prevBlocks=Math.floor((total-sec)/900);
  const newBlocks=Math.floor(total/900);
  localStorage.setItem('hidaka_listen_sec',String(total));
  if(newBlocks>prevBlocks){
    addCoins(50*(newBlocks-prevBlocks));
    showToast('🎉 +50 koin! Makasih udah dengerin musik 15 menit');
  }
  // Poin level: tiap 10 menit dengerin +5 poin
  const prevPtBlocks=Math.floor((total-sec)/600);
  const newPtBlocks=Math.floor(total/600);
  if(newPtBlocks>prevPtBlocks)addLevelPoints(5*(newPtBlocks-prevPtBlocks));
  _refreshMisiListenUI();
  _trackMissionProgress('listen_min',sec/60);
}

function _refreshMisiListenUI(){
  const fill=document.getElementById('misiListenProgress');
  const label=document.getElementById('misiListenLabel');
  if(!fill&&!label)return;
  const total=parseFloat(localStorage.getItem('hidaka_listen_sec')||'0');
  const cycleSec=total%900;
  const pct=Math.min(100,(cycleSec/900)*100);
  const min=Math.floor(cycleSec/60),secRem=Math.floor(cycleSec%60);
  if(fill)fill.style.width=pct+'%';
  if(label)label.textContent=min+':'+String(secRem).padStart(2,'0')+' / 15:00';
}

// ===== MISI HARIAN (check-in + tugas) =====
function _todayStr(d){
  d=d||new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
const CHECKIN_REWARDS=[20,30,40,50,60,80,120];
function getCheckinStreak(){return parseInt(localStorage.getItem('hidaka_checkin_streak')||'0',10);}
function getCheckinLastDate(){return localStorage.getItem('hidaka_checkin_lastdate')||'';}
function canCheckinToday(){return getCheckinLastDate()!==_todayStr();}

function claimCheckin(){
  if(!canCheckinToday()){showToast('✅ Udah check-in hari ini, balik lagi besok!');return;}
  let streak=getCheckinStreak();
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  streak=(getCheckinLastDate()===_todayStr(yesterday))?streak+1:1;
  if(streak>7)streak=1;
  const reward=CHECKIN_REWARDS[streak-1];
  addCoins(reward);
  const pts=Math.max(1,Math.round(reward/10));
  addLevelPoints(pts);
  localStorage.setItem('hidaka_checkin_streak',String(streak));
  localStorage.setItem('hidaka_checkin_lastdate',_todayStr());
  showToast('🎉 Check-in Hari '+streak+'! +'+reward+' koin, +'+pts+' poin level');
  renderMisiPage();
}

function renderMisiPage(){
  _refreshCoinUI();
  const bal=document.getElementById('misiCoinBalance');
  if(bal)bal.textContent=getCoins();
  const streak=getCheckinStreak();
  const canClaim=canCheckinToday();
  document.getElementById('misiStreakNum').textContent=streak;
  const grid=document.getElementById('misiCheckinGrid');
  grid.innerHTML=CHECKIN_REWARDS.map((r,i)=>{
    const day=i+1;
    const claimed=day<=streak&&!canClaim;
    const isToday=canClaim&&day===(streak%7)+1;
    return '<div class="misi-checkin-day'+(claimed?' claimed':'')+(isToday?' today':'')+'">'+
      '<div>H'+day+'</div><div class="misi-day-coin">⚡'+r+'</div>'+
    '</div>';
  }).join('');
  const btn=document.getElementById('misiCheckinBtn');
  btn.disabled=!canClaim;
  btn.textContent=canClaim?'Check-in Sekarang (+'+CHECKIN_REWARDS[(streak%7)]+' koin)':'✅ Sudah Check-in Hari Ini';
  renderMisiPemula();
  renderMisiHarian();
}

// ===== POOL 70 MISI HARIAN (kategori x tier, generate programatik biar gak ada duplikat) =====
const MISSION_CATEGORIES=[
  {key:'listen_min',icon:'🎵',label:'Dengerin Musik',unit:'menit',tiers:[[5,10],[10,20],[15,30],[20,40],[25,50],[30,60],[40,80],[50,100],[60,120],[90,150],[120,180],[150,220],[180,260]]},
  {key:'favorite',icon:'⭐',label:'Kasih Favorit ke Lagu',unit:'lagu',tiers:[[1,10],[2,15],[3,20],[4,25],[5,30],[7,40],[10,55],[12,65],[15,80],[18,95],[20,110]]},
  {key:'search',icon:'🔍',label:'Cari Lagu',unit:'kali',tiers:[[1,10],[2,15],[3,20],[5,30],[7,40],[10,55],[15,70],[20,90],[25,110]]},
  {key:'comment',icon:'💬',label:'Kasih Komentar',unit:'komentar',tiers:[[1,15],[2,25],[3,35],[5,50],[7,65],[10,85]]},
  {key:'playlist_create',icon:'📋',label:'Bikin Playlist Baru',unit:'playlist',tiers:[[1,20],[2,35],[3,50],[4,70]]},
  {key:'playlist_add',icon:'➕',label:'Tambah Lagu ke Playlist',unit:'lagu',tiers:[[1,10],[3,25],[5,40],[7,55]]},
  {key:'artist_view',icon:'🎤',label:'Buka Halaman Artis',unit:'kali',tiers:[[1,10],[2,20],[3,30]]},
  {key:'unique_songs',icon:'🎧',label:'Dengerin Lagu Berbeda-beda',unit:'lagu',tiers:[[3,15],[5,25],[10,45],[15,65],[20,85],[25,105],[30,125],[35,145],[40,165]]},
  {key:'open_search',icon:'🔎',label:'Buka Halaman Cari',unit:'kali',tiers:[[1,10]]},
  {key:'open_library',icon:'📚',label:'Buka Perpustakaan',unit:'kali',tiers:[[1,10]]},
  {key:'open_profile',icon:'👤',label:'Buka Profil',unit:'kali',tiers:[[1,10]]},
  {key:'open_misi',icon:'🎯',label:'Buka Halaman Misi',unit:'kali',tiers:[[1,10]]},
  {key:'open_banner_theme',icon:'🖼️',label:'Buka Tema Banner',unit:'kali',tiers:[[1,10]]},
  {key:'open_settings',icon:'⚙️',label:'Buka Pengaturan',unit:'kali',tiers:[[1,10]]},
  {key:'change_avatar',icon:'📷',label:'Ganti Avatar',unit:'kali',tiers:[[1,30]]},
  {key:'change_banner',icon:'🎬',label:'Ganti Tema Banner',unit:'kali',tiers:[[1,30]]},
  {key:'share_profile',icon:'🔗',label:'Bagikan Profil',unit:'kali',tiers:[[1,20]]},
  {key:'shuffle',icon:'🔀',label:'Pakai Mode Acak',unit:'kali',tiers:[[1,15]]},
  {key:'repeat',icon:'🔁',label:'Pakai Mode Ulang',unit:'kali',tiers:[[1,15]]}
];
const MISSION_POOL=[];
MISSION_CATEGORIES.forEach(cat=>{
  cat.tiers.forEach(tier=>{
    const target=tier[0],reward=tier[1];
    MISSION_POOL.push({id:cat.key+'_'+target,key:cat.key,icon:cat.icon,title:cat.label+' '+target+' '+cat.unit,target:target,reward:reward});
  });
});

function _seedRandom(seedStr){
  let h=0;
  for(let i=0;i<seedStr.length;i++){h=(h<<5)-h+seedStr.charCodeAt(i);h|=0;}
  return function(){h=(h*9301+49297)%233280;return Math.abs(h)/233280;};
}

function _getDailyMissions(){
  const today=_todayStr();
  const uid=currentUser?currentUser.uid:'guest';
  const storedDate=localStorage.getItem('hidaka_mission_date');
  if(storedDate===today){
    try{
      const ids=JSON.parse(localStorage.getItem('hidaka_mission_ids')||'[]');
      const found=ids.map(id=>MISSION_POOL.find(m=>m.id===id)).filter(Boolean);
      if(found.length===ids.length&&found.length>0)return found;
    }catch(e){}
  }
  // Hari baru (atau belum pernah) → pilih 10 misi unik random, seed dari tanggal+uid biar konsisten sepanjang hari itu tapi ganti tiap hari
  const rand=_seedRandom(today+'_'+uid);
  const pool=MISSION_POOL.slice();
  const picked=[];
  while(picked.length<10&&pool.length){
    const idx=Math.floor(rand()*pool.length);
    picked.push(pool.splice(idx,1)[0]);
  }
  localStorage.setItem('hidaka_mission_date',today);
  localStorage.setItem('hidaka_mission_ids',JSON.stringify(picked.map(m=>m.id)));
  Object.keys(localStorage).forEach(k=>{
    if(k.indexOf('hidaka_mission_progress_')===0||k.indexOf('hidaka_mission_claimed_')===0)localStorage.removeItem(k);
  });
  return picked;
}
function _getMissionProgress(id){return parseFloat(localStorage.getItem('hidaka_mission_progress_'+id)||'0');}
function _setMissionProgress(id,v){localStorage.setItem('hidaka_mission_progress_'+id,String(v));}
function _isMissionClaimed(id){return localStorage.getItem('hidaka_mission_claimed_'+id)==='1';}

function _trackUniqueSongPlayed(trackId){
  if(!trackId||!currentUser)return;
  const today=_todayStr();
  let stored=localStorage.getItem('hidaka_unique_songs_date');
  let ids=[];
  if(stored===today){
    try{ids=JSON.parse(localStorage.getItem('hidaka_unique_songs_ids')||'[]');}catch(e){}
  }else{
    localStorage.setItem('hidaka_unique_songs_date',today);
  }
  if(!ids.includes(trackId)){
    ids.push(trackId);
    localStorage.setItem('hidaka_unique_songs_ids',JSON.stringify(ids));
    _trackMissionProgress('unique_songs',1);
  }
}

function _trackMissionProgress(key,amount){
  if(!currentUser)return;
  const missions=_getDailyMissions();
  let changed=false;
  missions.forEach(m=>{
    if(m.key===key&&!_isMissionClaimed(m.id)){
      const cur=_getMissionProgress(m.id);
      if(cur<m.target){_setMissionProgress(m.id,Math.min(m.target,cur+amount));changed=true;}
    }
  });
  if(changed){
    const page=document.getElementById('misiPage');
    if(page&&page.classList.contains('open'))renderMisiHarian();
  }
}

function claimMission(id){
  const missions=_getDailyMissions();
  const m=missions.find(x=>x.id===id);
  if(!m)return;
  if(_isMissionClaimed(id)){showToast('Udah diklaim');return;}
  if(_getMissionProgress(id)<m.target){showToast('Belum selesai nih, lanjutin dulu ya');return;}
  localStorage.setItem('hidaka_mission_claimed_'+id,'1');
  addCoins(m.reward);
  const pts=Math.max(1,Math.round(m.reward/10));
  addLevelPoints(pts);
  showToast('🎉 +'+m.reward+' koin, +'+pts+' poin level!');
  renderMisiHarian();
}

function renderMisiHarian(){
  const el=document.getElementById('misiHarianList');
  if(!el)return;
  const missions=_getDailyMissions();
  el.innerHTML=missions.map(m=>{
    const prog=_getMissionProgress(m.id);
    const claimed=_isMissionClaimed(m.id);
    const done=prog>=m.target;
    const pct=Math.min(100,Math.floor((prog/m.target)*100));
    const btnClass='misi-task-action'+(claimed?' done':(done?' claimable':''));
    const btnLabel=claimed?'✅ Selesai':(done?'Klaim':(Math.floor(prog)+'/'+m.target));
    const clickAttr=(!claimed&&done)?' onclick="claimMission(\''+m.id+'\')"':'';
    const disabledAttr=(claimed||!done)?' disabled':'';
    return '<div class="misi-task-row">'+
      '<div class="misi-task-icon'+(claimed?' done':'')+'">'+m.icon+'</div>'+
      '<div class="misi-task-body">'+
        '<div class="misi-task-title">'+m.title+'</div>'+
        '<div class="misi-task-desc">Reward: +'+m.reward+' koin ⚡ +'+Math.max(1,Math.round(m.reward/10))+' poin level</div>'+
        (!claimed?'<div class="misi-task-progress">'+Math.floor(prog)+' / '+m.target+' ('+pct+'%)</div>':'')+
      '</div>'+
      '<button class="'+btnClass+'"'+clickAttr+disabledAttr+'>'+btnLabel+'</button>'+
    '</div>';
  }).join('');
}

// ===== TUGAS PEMULA (one-time, gak reset harian) =====
const MISI_PEMULA=[
  {id:'pemula_avatar',icon:'📷',title:'Atur Avatar Pertama',desc:'Ganti foto profil kamu',reward:50,
    check:function(){try{return!!localStorage.getItem('hidaka_avatar_'+(currentUser?currentUser.uid:''));}catch(e){return false;}}},
  {id:'pemula_bio',icon:'✍️',title:'Isi Bio Profil',desc:'Ceritain sedikit tentang kamu',reward:50,
    check:function(){const el=document.getElementById('profileBioText');return!!(el&&el.textContent&&el.textContent!=='Tap Edit Profil untuk menambahkan bio'&&el.textContent!=='Belum ada bio.'&&el.textContent!=='');}},
  {id:'pemula_banner',icon:'🎬',title:'Pilih Tema Banner',desc:'Kasih banner video di profil kamu',reward:50,
    check:function(){try{return!!localStorage.getItem('hidaka_selected_banner');}catch(e){return false;}}}
];
function renderMisiPemula(){
  const el=document.getElementById('misiPemulaList');
  if(!el||!currentUser)return;
  el.innerHTML=MISI_PEMULA.map(m=>{
    const claimedKey='hidaka_pemula_claimed_'+m.id+'_'+currentUser.uid;
    const claimed=localStorage.getItem(claimedKey)==='1';
    const done=m.check();
    const btnClass='misi-task-action'+(claimed?' done':(done?' claimable':''));
    const btnLabel=claimed?'✅ Selesai':(done?'Klaim':'Belum');
    const clickAttr=(!claimed&&done)?' onclick="claimMisiPemula(\''+m.id+'\')"':'';
    const disabledAttr=(claimed||!done)?' disabled':'';
    return '<div class="misi-task-row">'+
      '<div class="misi-task-icon'+(claimed?' done':'')+'">'+m.icon+'</div>'+
      '<div class="misi-task-body"><div class="misi-task-title">'+m.title+'</div><div class="misi-task-desc">'+m.desc+' — +'+m.reward+' koin ⚡ +'+Math.max(1,Math.round(m.reward/10))+' poin level</div></div>'+
      '<button class="'+btnClass+'"'+clickAttr+disabledAttr+'>'+btnLabel+'</button>'+
    '</div>';
  }).join('');
}
function claimMisiPemula(id){
  const m=MISI_PEMULA.find(x=>x.id===id);
  if(!m||!currentUser)return;
  const claimedKey='hidaka_pemula_claimed_'+id+'_'+currentUser.uid;
  if(localStorage.getItem(claimedKey)==='1'){showToast('Udah diklaim');return;}
  if(!m.check()){showToast('Belum selesai nih');return;}
  localStorage.setItem(claimedKey,'1');
  addCoins(m.reward);
  const pts=Math.max(1,Math.round(m.reward/10));
  addLevelPoints(pts);
  showToast('🎉 +'+m.reward+' koin, +'+pts+' poin level!');
  renderMisiPemula();
}

function openMisiPage(){
  if(!currentUser){showToast('🔒 Login dulu');return;}
  document.getElementById('misiPage').classList.add('open');
  history.pushState({overlay:'misi'},'',location.pathname);
  renderMisiPage();
  _pullCoinsFromServer().then(()=>renderMisiPage());
  _trackMissionProgress('open_misi',1);
}
function closeMisiPage(){
  document.getElementById('misiPage').classList.remove('open');
}

// ===== BANNER THEME (live wallpaper) =====
const BANNER_THEMES=[
  {id:'free_calm',name:'Calm Waves',cost:0,url:'https://www.image2url.com/r2/default/videos/1783019267472-1a69fa19-a12d-41f6-9b38-2fa9cf5c2407.mp4'},
  {id:'prem_dream',name:'Dreamy Night',cost:150,url:'https://www.image2url.com/r2/default/videos/1783020130875-084d0e48-084d-4e2a-8272-d78c237fc277.mp4'},
  {id:'prem_gold',name:'Golden Hour',cost:200,url:'https://www.image2url.com/r2/default/videos/1783019336010-96b64639-c491-4a3f-b5e5-5bc7e5abf78c.mp4'},
  {id:'prem_ember',name:'Ember Blade',cost:350,url:'https://www.image2url.com/r2/default/videos/1783195042260-036a57f1-15bf-48bb-bcb0-57c93d51df07.mp4'},
  {id:'prem_starlight',name:'Starlight Path',cost:500,url:'https://www.image2url.com/r2/default/videos/1783195255806-d9011daf-8bb2-4ba5-a6ab-c17053986b8a.mp4'}
];

function openBannerThemePage(){
  document.getElementById('bannerThemePage').classList.add('open');
  history.pushState({overlay:'bannerTheme'},'',location.pathname);
  _trackMissionProgress('open_banner_theme',1);
  _refreshCoinUI();
  renderBannerThemeGrid();
}
function closeBannerThemePage(){
  document.getElementById('bannerThemePage').classList.remove('open');
}

function renderBannerThemeGrid(){
  const grid=document.getElementById('bannerThemeGrid');
  if(!grid)return;
  const owned=getOwnedBanners();
  const selected=localStorage.getItem('hidaka_selected_banner');
  grid.innerHTML=BANNER_THEMES.map(t=>{
    const isOwned=t.cost===0||owned.includes(t.id);
    const isSelected=selected===t.id;
    let badge='';
    if(isSelected)badge='<div class="banner-theme-check">✓</div>';
    let corner=t.cost===0?'<div class="banner-theme-badge free">Gratis</div>':
      (isOwned?'<div class="banner-theme-badge owned">✓ Dimiliki</div>':'<div class="banner-theme-badge locked">⚡ '+t.cost+'</div>');
    return '<div class="banner-theme-card'+(isSelected?' selected':'')+'" onclick="selectBannerTheme(\''+t.id+'\')">'+
      '<video class="bt-fallback" src="'+t.url+'" muted loop playsinline autoplay preload="auto"></video>'+
      corner+badge+
      '<div class="banner-theme-card-label">'+t.name+'</div>'+
    '</div>';
  }).join('');
}

async function selectBannerTheme(id){
  const item=BANNER_THEMES.find(t=>t.id===id);
  if(!item)return;
  const owned=getOwnedBanners();
  const isOwned=item.cost===0||owned.includes(id);
  if(!isOwned){
    if(getCoins()<item.cost){
      showToast('⚡ Koin gak cukup — dengerin musik dulu buat dapetin koin!');
      return;
    }
    addCoins(-item.cost);
    ownBanner(id);
    showToast('🎉 Tema berhasil dibuka!');
  }
  showToast('⏳ Menerapkan tema...');
  try{
    await applyBannerTheme(item,true);
    localStorage.setItem('hidaka_selected_banner',id);
    renderBannerThemeGrid();
    showToast('✅ Banner diterapkan');
    _trackMissionProgress('change_banner',1);
    _syncBannerThemeToServer(id);
  }catch(e){
    console.error(e);
    showToast('❌ Gagal memuat video, cek koneksi');
  }
}

// Simpan pilihan banner ke Firestore biar orang lain juga bisa lihat (bukan cuma localStorage lokal)
async function _syncBannerThemeToServer(id,attemptsLeft){
  if(attemptsLeft===undefined)attemptsLeft=3;
  if(!currentUser||!firebaseApp)return;
  try{
    const fs=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db=fs.getFirestore(firebaseApp);
    const ref=fs.doc(db,'user_profiles',currentUser.uid);
    await fs.setDoc(ref,{bannerThemeId:id},{merge:true});
    try{localStorage.removeItem('hidaka_banner_pending_'+currentUser.uid);}catch(e){}
  }catch(e){
    console.error('Gagal sinkron tema banner:',e.code||e.message||e);
    if(e.code==='permission-denied'){
      try{localStorage.setItem('hidaka_banner_pending_'+currentUser.uid,id);}catch(e){}
      return;
    }
    if(attemptsLeft>1){
      await new Promise(r=>setTimeout(r,2000));
      return _syncBannerThemeToServer(id,attemptsLeft-1);
    }
    try{localStorage.setItem('hidaka_banner_pending_'+currentUser.uid,id);}catch(e){}
  }
}

async function _retryPendingBannerSync(){
  if(!currentUser||!firebaseApp)return;
  let pending=null;
  try{pending=localStorage.getItem('hidaka_banner_pending_'+currentUser.uid);}catch(e){}
  if(pending)await _syncBannerThemeToServer(pending,1);
}

// PENTING: video di-set & diputer LANGSUNG dulu (gak nunggu Cache API sama sekali),
// biar banner selalu muncul walau Cache Storage lambat/gak didukung di device tertentu.
// Kalau streaming langsung gagal (server gak ramah buat progressive play),
// otomatis fallback ke fetch manual jadi blob lokal.
async function applyBannerTheme(item){
  const video=document.getElementById('profileBannerVideo');
  if(!video)return;
  video.style.display='block';
  let triedBlob=false;
  video.onerror=async function(){
    if(!this.currentSrc)return;
    if(triedBlob){
      console.error('Banner video gagal total:',this.error);
      showToast('⚠️ Video banner gagal dimuat, cek koneksi/link');
      return;
    }
    triedBlob=true;
    try{
      const res=await fetch(item.url);
      if(!res.ok)throw new Error('HTTP '+res.status);
      const blob=await res.blob();
      video.src=URL.createObjectURL(blob);
      video.load();
      await video.play();
      // Simpan juga ke cache biar next time instan
      try{const cache=await caches.open('hidaka-banners-v1');cache.put(item.url,new Response(blob));}catch(e){}
    }catch(e){
      console.error('Fallback fetch video gagal:',e);
      showToast('⚠️ Video banner gagal dimuat, cek koneksi/link');
    }
  };
  video.src=item.url;
  video.load();
  try{await video.play();}catch(e){}

  // Background: kalau udah pernah di-cache sebelumnya, upgrade ke situ (hemat kuota)
  try{
    const cache=await caches.open('hidaka-banners-v1');
    const cached=await cache.match(item.url);
    if(cached){
      const blob=await cached.blob();
      video.src=URL.createObjectURL(blob);
      video.load();
      try{await video.play();}catch(e){}
    }
  }catch(e){
    // Cache API gak tersedia — gapapa, videonya tetap jalan dari streaming langsung
  }
}

// Terapkan tema banner yang udah dipilih sebelumnya, dari cache (tanpa boros kuota)
async function applySavedBannerTheme(){
  const id=localStorage.getItem('hidaka_selected_banner');
  if(!id)return;
  const item=BANNER_THEMES.find(t=>t.id===id);
  if(!item)return;
  try{await applyBannerTheme(item,false);}catch(e){console.warn('applySavedBannerTheme:',e);}
}
_refreshCoinUI();

function openImportPlaylist(){
  const existing=document.getElementById('importPlSheet');
  if(existing)existing.remove();
  const ov=document.getElementById('importPlOverlay');
  if(ov)ov.remove();

  const overlay=document.createElement('div');
  overlay.id='importPlOverlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998';
  overlay.onclick=closeImportPlaylist;

  const sheet=document.createElement('div');
  sheet.id='importPlSheet';
  sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-radius:20px 20px 0 0;padding:24px 20px;z-index:9999;box-shadow:0 -8px 40px rgba(0,0,0,.5)';
  sheet.innerHTML=`
    <div style="width:36px;height:4px;background:var(--muted);border-radius:2px;margin:0 auto 20px"></div>
    <div style="font-size:17px;font-weight:700;margin-bottom:6px">Impor Playlist YouTube</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:20px">Paste link playlist YouTube di bawah ini</div>
    <input id="importPlInput" type="url" placeholder="https://youtube.com/playlist?list=..." style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;color:var(--text);font-size:14px;font-family:'Inter',sans-serif;box-sizing:border-box;outline:none;margin-bottom:12px">
    <button onclick="doImportPlaylist()" style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:15px;color:#000;font-size:15px;font-weight:700;font-family:'Inter',sans-serif;cursor:pointer;margin-bottom:10px">Impor Playlist</button>
    <button onclick="closeImportPlaylist()" style="width:100%;background:var(--card2);border:none;border-radius:12px;padding:15px;color:var(--text2);font-size:15px;font-family:'Inter',sans-serif;cursor:pointer">Batal</button>
    <div id="importPlStatus" style="text-align:center;color:var(--text2);font-size:13px;margin-top:12px;min-height:20px"></div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
}

function closeImportPlaylist(){
  document.getElementById('importPlSheet')?.remove();
  document.getElementById('importPlOverlay')?.remove();
}

async function doImportPlaylist(){
  const input=document.getElementById('importPlInput');
  const status=document.getElementById('importPlStatus');
  const url=input.value.trim();
  if(!url){showToast('Masukkan link playlist dulu');return;}

  // Extract playlist ID
  let listId='';
  try{
    const u=new URL(url);
    listId=u.searchParams.get('list')||'';
  }catch(e){listId=url;}
  if(!listId){showToast('Link tidak valid');return;}

  status.textContent='⏳ Mengambil lagu...';
  const btn=document.querySelector('#importPlSheet button');

  try{
    const res=await fetch(`/api/playlist?list=${encodeURIComponent(listId)}`);
    const data=await res.json();
    if(!data||!data.tracks||!data.tracks.length) throw new Error('Tidak ada lagu ditemukan');

    // Tanya nama playlist
    const name=data.title||'Playlist YouTube';
    const pls=getPlaylists();
    pls.push({name,tracks:data.tracks,createdAt:Date.now()});
    savePlaylists(pls);
    closeImportPlaylist();
    currentLibTab='playlist';
    renderLibrary();
    showToast('✅ '+data.tracks.length+' lagu berhasil diimpor!');
  }catch(e){
    status.textContent='❌ Gagal: '+e.message;
  }
}

renderLibrary();

function handleAuthBtnClick(){
  try{
  if(currentUser){
    const menu=document.getElementById('userMenu');
    const av=document.getElementById('userMenuAvatar');
    const nm=document.getElementById('userMenuName');
    const em=document.getElementById('userMenuEmail');
    av.src=currentUser.photoURL||'';
    av.style.display=currentUser.photoURL?'block':'none';
    nm.textContent=currentUser.displayName||'Pengguna';
    em.textContent=currentUser.email||'';
    menu.classList.toggle('show');
    // Close on outside click
    setTimeout(()=>{
      function outside(e){
        if(!document.getElementById('userMenu').contains(e.target)&&
           !document.getElementById('authTopBtn').contains(e.target)){
          document.getElementById('userMenu').classList.remove('show');
          document.removeEventListener('click',outside);
        }
      }
      document.addEventListener('click',outside);
    },0);
  } else {
    openAuthScreen();
  }
  }catch(e){showToast('Error: '+e.message);console.error(e);}
}

function openAuthScreen(){
  const sc=document.getElementById('authScreen');
  sc.classList.add('show');
  startAuthParticles();
  // Reset form state
  document.getElementById('authErr').textContent='';
  document.getElementById('authErrLogin').textContent='';
  document.getElementById('authEmail').value='';
  document.getElementById('authPassword').value='';
  document.getElementById('authName').value='';
  document.getElementById('authPhone').value='';
  document.getElementById('authOtp').value='';
  document.getElementById('authOtp').style.display='none';
  document.getElementById('authPhoneRecaptcha').style.display='flex';
  authPhoneVisible=false;
  authConfirmResult=null;
  window._recaptchaVerifier=null;
  document.getElementById('authPhoneForm').style.display='none';
  document.getElementById('authPhoneToggle').style.display='flex';
  document.getElementById('authPhoneBtn').textContent='Kirim OTP';
  switchAuthTab('login');
  // Trigger fade in after next frame
  requestAnimationFrame(()=>requestAnimationFrame(()=>sc.classList.add('visible')));
}

function closeAuthScreen(){
  const sc=document.getElementById('authScreen');
  sc.classList.remove('visible');
  setTimeout(()=>{
    sc.classList.remove('show');
    stopAuthParticles();
  },350);
}

let authPhoneVisible=false, authConfirmResult=null;

function switchAuthTab(tab){
  authCurrentTab=tab;
  document.getElementById('authTabLogin').classList.toggle('active',tab==='login');
  document.getElementById('authTabRegister').classList.toggle('active',tab==='register');
  const indicator=document.getElementById('authTabIndicator');
  if(tab==='register') indicator.classList.add('right');
  else indicator.classList.remove('right');
  const track=document.getElementById('authPanelsTrack');
  if(tab==='register') track.classList.add('show-register');
  else track.classList.remove('show-register');
  // Reset errors
  document.getElementById('authErr').textContent='';
  document.getElementById('authErrLogin').textContent='';
}

function togglePhoneForm(){
  authPhoneVisible=!authPhoneVisible;
  document.getElementById('authPhoneForm').style.display=authPhoneVisible?'flex':'none';
  document.getElementById('authPhoneToggle').style.display=authPhoneVisible?'none':'flex';
  if(authPhoneVisible) setupRecaptcha();
}

function setupRecaptcha(){
  if(!firebaseAuth||window._recaptchaVerifier)return;
  try{
    const {RecaptchaVerifier}=window._fbAuth;
    window._recaptchaVerifier=new RecaptchaVerifier(firebaseAuth,'authPhoneRecaptcha',{
      size:'normal',
      callback:()=>{document.getElementById('authPhoneBtn').disabled=false;}
    });
    window._recaptchaVerifier.render();
  }catch(e){console.warn('reCAPTCHA error:',e);}
}

async function signInWithGoogle(){
  if(!firebaseAuth){showToast('⚠️ Firebase belum dikonfigurasi');return;}
  try{
    const {signInWithPopup,GoogleAuthProvider}=window._fbAuth;
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    const result=await signInWithPopup(firebaseAuth,provider);
    if(result?.user){
      closeAuthScreen();
      showToast('✅ Berhasil masuk dengan Google!');
    }
  }catch(e){
    if(e.code==='auth/popup-blocked'||e.code==='auth/popup-closed-by-user'){
      // Fallback ke redirect kalau popup diblock
      try{
        const {signInWithRedirect,GoogleAuthProvider}=window._fbAuth;
        const provider2=new GoogleAuthProvider();
        await signInWithRedirect(firebaseAuth,provider2);
      }catch(e2){
        document.getElementById('authErrLogin').textContent='Gagal login: '+e2.message;
      }
    } else {
      document.getElementById('authErrLogin').textContent='Gagal: '+e.message;
    }
  }
}

async function handlePhoneAuth(){
  if(!firebaseAuth){showToast('⚠️ Firebase belum dikonfigurasi');return;}
  const btn=document.getElementById('authPhoneBtn');
  const errEl=document.getElementById('authErrLogin');
  const otpInput=document.getElementById('authOtp');

  // Step 2: verify OTP
  if(authConfirmResult){
    const otp=otpInput.value.trim();
    if(otp.length!==6){errEl.textContent='Masukkan 6 digit OTP';return;}
    btn.disabled=true;btn.textContent='Verifikasi...';
    try{
      await authConfirmResult.confirm(otp);
      closeAuthScreen();
      showToast('✅ Berhasil masuk!');
    }catch(e){
      errEl.textContent='OTP salah atau kadaluarsa';
    }finally{btn.disabled=false;btn.textContent='Verifikasi OTP';}
    return;
  }

  // Step 1: send OTP
  let phone=document.getElementById('authPhone').value.trim();
  if(!phone){errEl.textContent='Masukkan nomor telepon';return;}
  // Auto convert 08xxx -> +628xxx
  if(phone.startsWith('08')) phone='+62'+phone.slice(1);
  else if(phone.startsWith('8')) phone='+62'+phone;
  if(!phone.startsWith('+')) phone='+62'+phone;
  btn.disabled=true;btn.textContent='Mengirim...';
  try{
    const {signInWithPhoneNumber}=window._fbAuth;
    authConfirmResult=await signInWithPhoneNumber(firebaseAuth,phone,window._recaptchaVerifier);
    otpInput.style.display='block';
    document.getElementById('authPhoneRecaptcha').style.display='none';
    btn.textContent='Verifikasi OTP';
    btn.disabled=false;
    errEl.textContent='';
    showToast('📱 OTP terkirim!');
  }catch(e){
    errEl.textContent='Gagal kirim OTP: '+e.message;
    btn.disabled=false;btn.textContent='Kirim OTP';
    if(window._recaptchaVerifier){window._recaptchaVerifier.clear();window._recaptchaVerifier=null;}
  }
}

function toggleEmailForm(){
  // legacy — not used anymore
}

async function handleEmailAuth(){
  if(!firebaseAuth){showToast('⚠️ Firebase belum dikonfigurasi');return;}
  const btn=document.getElementById('authSubmitBtn');
  const errEl=document.getElementById('authErr');
  const email=document.getElementById('authEmail')?.value.trim();
  const pass=document.getElementById('authPassword')?.value.trim();
  const isRegister=document.getElementById('authTabRegister')?.classList.contains('active');

  if(!email||!pass){errEl.textContent='Isi email dan password';return;}
  if(pass.length<6){errEl.textContent='Password minimal 6 karakter';return;}

  btn.disabled=true;
  btn.textContent=isRegister?'Membuat akun...':'Masuk...';
  errEl.textContent='';

  try{
    if(isRegister){
      const {createUserWithEmailAndPassword}=window._fbAuth;
      await createUserWithEmailAndPassword(firebaseAuth,email,pass);
      closeAuthScreen();
      showToast('✅ Akun berhasil dibuat!');
    } else {
      const {signInWithEmailAndPassword}=window._fbAuth;
      await signInWithEmailAndPassword(firebaseAuth,email,pass);
      closeAuthScreen();
      showToast('✅ Berhasil masuk!');
    }
  }catch(e){
    const msg=e.code==='auth/email-already-in-use'?'Email sudah terdaftar':
              e.code==='auth/user-not-found'?'Email tidak ditemukan':
              e.code==='auth/wrong-password'?'Password salah':
              e.code==='auth/invalid-email'?'Format email tidak valid':
              e.message;
    errEl.textContent=msg;
    btn.disabled=false;
    btn.textContent=isRegister?'Buat Akun':'Masuk';
  }
}

async function handleForgotPassword(){
  if(!firebaseAuth){showToast('⚠️ Firebase belum dikonfigurasi');return;}
  const email=document.getElementById('authEmail').value.trim();
  if(!email){document.getElementById('authErr').textContent='Masukkan email dulu';return;}
  try{
    const {sendPasswordResetEmail}=window._fbAuth;
    await sendPasswordResetEmail(firebaseAuth,email);
    showToast('✉️ Email reset password terkirim!');
  }catch(e){
    document.getElementById('authErr').textContent='Gagal kirim reset: '+e.message;
  }
}

async function signOut(){
  if(!firebaseAuth)return;
  const {signOut:fbSignOut}=window._fbAuth;
  await fbSignOut(firebaseAuth);
  document.getElementById('userMenu').classList.remove('show');
  showToast('👋 Berhasil keluar');
}

// ===== ANIMATED PARTICLE BACKGROUND =====
let animFrameId=null;
function startAuthParticles(){
  const canvas=document.getElementById('authCanvas');
  const ctx=canvas.getContext('2d');
  canvas.width=window.innerWidth;
  canvas.height=window.innerHeight;
  const W=canvas.width,H=canvas.height;

  const particles=Array.from({length:80},()=>({
    x:Math.random()*W, y:Math.random()*H,
    r:Math.random()*2.5+0.8,
    vx:(Math.random()-.5)*0.35, vy:(Math.random()-.5)*0.35,
    o:Math.random()*0.5+0.15,
    hue:Math.random()*60+140
  }));

  const blobs=[
    {x:W*.15,y:H*.25,r:280,hue:155,phase:0},
    {x:W*.85,y:H*.65,r:320,hue:195,phase:2.1},
    {x:W*.5,y:H*.05,r:220,hue:135,phase:4.2},
    {x:W*.7,y:H*.9,r:180,hue:170,phase:1.1},
  ];

  let t=0;
  function draw(){
    t+=0.006;
    ctx.clearRect(0,0,W,H);

    // Dark base
    ctx.fillStyle='rgb(5,5,5)';
    ctx.fillRect(0,0,W,H);

    // Animated blobs
    blobs.forEach(b=>{
      const bx=b.x+Math.sin(t+b.phase)*90;
      const by=b.y+Math.cos(t*0.65+b.phase)*70;
      const grad=ctx.createRadialGradient(bx,by,0,bx,by,b.r);
      grad.addColorStop(0,`hsla(${b.hue},70%,25%,0.22)`);
      grad.addColorStop(0.5,`hsla(${b.hue},60%,20%,0.1)`);
      grad.addColorStop(1,'transparent');
      ctx.fillStyle=grad;
      ctx.fillRect(0,0,W,H);
    });

    // Particles
    particles.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`hsla(${p.hue},65%,65%,${p.o})`;
      ctx.fill();
    });

    // Connections
    ctx.lineWidth=0.4;
    for(let i=0;i<particles.length;i++){
      for(let j=i+1;j<particles.length;j++){
        const dx=particles[i].x-particles[j].x;
        const dy=particles[i].y-particles[j].y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<110){
          ctx.beginPath();
          ctx.moveTo(particles[i].x,particles[i].y);
          ctx.lineTo(particles[j].x,particles[j].y);
          ctx.strokeStyle=`rgba(29,185,84,${0.18*(1-dist/110)})`;
          ctx.stroke();
        }
      }
    }

    animFrameId=requestAnimationFrame(draw);
  }
  draw();
}

function stopAuthParticles(){
  if(animFrameId){cancelAnimationFrame(animFrameId);animFrameId=null;}
}

// Close auth screen on overlay click
document.getElementById('authScreen').addEventListener('click',function(e){
  if(e.target===this)closeAuthScreen();
});

(function(){
  const io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  },{threshold:0.08});

  function observe(){
    var selectors = [
      '.h-card','.speed-card','.qp-item',
      '.artist-card','.community-card','.lib-item',
      '.featured-card','.upnext-item','.sec-head',
      '.similar-banner','.h-card-img'
    ];
    selectors.forEach(function(s){
      document.querySelectorAll(s+':not(.reveal)').forEach(function(el,i){
        el.classList.add('reveal');
        el.setAttribute('data-d',(i%6)+1);
        io.observe(el);
      });
    });
  }

  observe();
  new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});
})();
