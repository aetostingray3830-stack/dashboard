/* ========= YouTube IFrame API ========= */
let player;
function onYouTubeIframeAPIReady(){
  try{
    player = new YT.Player('ytplayer', {
      height:'100%', width:'100%',
      host:'https://www.youtube.com',
      playerVars:{ playsinline:1, rel:0, origin: location.origin }
    });
  }catch(e){ console.error(e); }
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

/* ========= アプリ初期化 ========= */
document.addEventListener('DOMContentLoaded', () => {
  /* ====== 永続化：localStorage → IndexedDB → DL ====== */
  // localStorage ラッパー
  const lsOK = (()=>{ try{ const k='__probe__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }catch(_){ return false; }})();
  const lsGet = (k, def='') => { try{ const v = localStorage.getItem(k); return v===null? def : v; }catch(e){ console.warn('lsGet fail', e); return def; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, v); return true; }catch(e){ console.warn('lsSet fail', e); return false; } };
  // IndexedDB フォールバック
  const hasIDB = 'indexedDB' in window;
  let idbdb = null;
  function idbInit(){
    return new Promise((resolve)=> {
      if(!hasIDB){ resolve(null); return; }
      const req = indexedDB.open('glassDB', 1);
      req.onupgradeneeded = ()=> req.result.createObjectStore('kv');
      req.onsuccess = ()=> { idbdb = req.result; resolve(idbdb); };
      req.onerror = ()=> resolve(null);
    });
  }
  function idbSet(k, v){
    return new Promise((resolve)=> {
      if(!idbdb){ resolve(false); return; }
      const tx = idbdb.transaction('kv','readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror    = ()=> resolve(false);
    });
  }
  function idbGet(k){
    return new Promise((resolve)=> {
      if(!idbdb){ resolve(null); return; }
      const tx  = idbdb.transaction('kv','readonly');
      const req = tx.objectStore('kv').get(k);
      req.onsuccess = ()=> resolve(req.result ?? null);
      req.onerror   = ()=> resolve(null);
    });
  }
  // 退避用DL
  const download = (text, filename='backup.txt') => {
    const blob = new Blob([text], {type:'text/plain'}); const a=document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };
  // IndexedDB 起動
  idbInit();
  // 保存不可の注意（任意のバナー）
  if(!lsOK){
    const note=document.createElement('div');
    note.textContent='⚠ このブラウザでは通常保存が制限されています。保存時はIndexedDB/ファイルDLで退避します。';
    note.style.cssText='position:fixed;left:16px;bottom:16px;background:#000a;color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;z-index:2000';
    document.body.appendChild(note); setTimeout(()=>note.remove(), 6000);
  }

  /* ====== ユーティリティ ====== */
  const toStr = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
  const slugify = (str)=> toStr(str).toLowerCase().trim()
    .replace(/[^\w\- \u3000-\u9fff]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-');

  /* ===== 時計 ===== */
  const clockEl=document.getElementById('clock');
  function tick(){
    const d=new Date();
    if(clockEl) clockEl.textContent=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  tick(); setInterval(tick,1000);

  /* ===== メモ（Markdown + TOC + Toolbar） ===== */
  const memoKey='glass_memo_v1';
  const memoArea=document.getElementById('memoArea');
  const memoPreview=document.getElementById('memoPreview');
  const editBtn=document.getElementById('editMode');
  const previewBtn=document.getElementById('previewMode');
  const saveMemoBtn=document.getElementById('saveMemo');
  const clearMemoBtn=document.getElementById('clearMemo');
  const tocList=document.getElementById('tocList');

  if(memoArea) memoArea.value = lsGet(memoKey, '');
  // localStorageに無ければ IndexedDB から復元
  idbInit().then(()=> idbGet(memoKey)).then(v=>{
    if(memoArea && !memoArea.value && typeof v === 'string'){ memoArea.value = v; }
  });

  function buildTOC(md){
    if(!tocList) return;
    const lines = toStr(md).split(/\r?\n/), items=[];
    for(const line of lines){
      const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if(m){ items.push({level:m[1].length, text:m[2].replace(/#+\s*$/,'').trim()}); }
    }
    tocList.innerHTML='';
    items.forEach(it=>{
      const id=slugify(it.text);
      const li=document.createElement('li'); li.className='lvl'+it.level;
      const a=document.createElement('a'); a.href='#'+id; a.textContent=it.text;
      a.onclick=(e)=>{ e.preventDefault(); const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth'}) }
      li.appendChild(a); tocList.appendChild(li);
    });
  }

  function renderPreview(){
    if(!memoArea || !memoPreview) return;

    const fallbackHtml = (() => {
      const esc = (s)=>toStr(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
      let t = esc(memoArea.value || '');
      t = t.replace(/^######\s?(.*)$/gm, '<h6>$1</h6>')
           .replace(/^#####\s?(.*)$/gm,  '<h5>$1</h5>')
           .replace(/^####\s?(.*)$/gm,   '<h4>$1</h4>')
           .replace(/^###\s?(.*)$/gm,    '<h3>$1</h3>')
           .replace(/^##\s?(.*)$/gm,     '<h2>$1</h2>')
           .replace(/^#\s?(.*)$/gm,      '<h1>$1</h1>');
      t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
           .replace(/\*(.+?)\*/g,     '<em>$1</em>')
           .replace(/`([^`]+)`/g,     '<code>$1</code>');
      t = t.replace(/^\-\s+(.*)$/gm, '<li>$1</li>')
           .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
      t = t.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
      return `<p>${t}</p>`;
    })();

    let html = fallbackHtml;
    try {
      if (typeof window.marked !== 'undefined') {
        marked.setOptions({ mangle:false, headerIds:false }); // 内部ID生成を止める
        const renderer = new marked.Renderer();
        renderer.heading = (text, level, raw) => {
          const id = slugify(raw || text);
          return `<h${level} id="${id}">${toStr(text)}</h${level}>\n`;
        };
        html = marked.parse(toStr(memoArea.value || ''), { renderer });
      }
    } catch (e) {
      console.error('marked parse failed, fallback used:', e);
      html = fallbackHtml;
    }

    try { memoPreview.innerHTML = html; }
    catch(e){ console.error(e); memoPreview.innerHTML = '<p style="opacity:.7">プレビューで問題が発生しました。</p>'; }

    try { buildTOC(memoArea.value||''); } catch(e){ console.error('TOC build failed:', e); }
  }

  function showEdit(){
    try{
      if(memoArea) memoArea.classList.remove('hidden');
      if(memoPreview) memoPreview.classList.add('hidden');
    }catch(e){ console.error(e); }
  }
  function showPreview(){
    try{
      renderPreview();
      if(memoArea) memoArea.classList.add('hidden');
      if(memoPreview) memoPreview.classList.remove('hidden');
    }catch(e){ console.error(e); }
  }

  if(editBtn)    editBtn.onclick    = showEdit;
  if(previewBtn) previewBtn.onclick = showPreview;

  if(saveMemoBtn) saveMemoBtn.onclick = async () => {
    if(!memoArea) return;
    const val = memoArea.value;

    let ok = lsSet(memoKey, val);
    if(!ok){ await idbInit(); ok = await idbSet(memoKey, val); }

    if(ok){
      saveMemoBtn.textContent='保存済';
    }else{
      saveMemoBtn.textContent='保存失敗…バックアップDL';
      download(val, 'memo-backup.txt');
      alert('保存がブロックされました。テキストをダウンロードで退避しました。');
    }
    setTimeout(()=>saveMemoBtn.textContent='保存', 1200);
  };

  if(clearMemoBtn) clearMemoBtn.onclick=()=>{ 
    if(!memoArea) return; 
    if(confirm('メモを消去しますか？')){ memoArea.value=''; lsSet(memoKey,''); idbInit().then(()=>idbSet(memoKey,'')); renderPreview(); showEdit(); } 
  };

  if(memoArea) setInterval(async ()=> { 
    const val=memoArea.value; 
    if(!lsSet(memoKey, val)){ await idbInit(); await idbSet(memoKey, val); } 
  }, 10000);

  let tocTimer=null;
  if(memoArea) memoArea.addEventListener('input', ()=>{ if(tocTimer) clearTimeout(tocTimer); tocTimer=setTimeout(()=>buildTOC(memoArea.value||''), 250); });
  buildTOC((memoArea && memoArea.value)||'');

  // ツールバー（ワンクリック挿入）
  const TB = {
    wrap(selPrefix, selSuffix, placeholder=''){
      const ta=memoArea; if(!ta) return;
      const {selectionStart:s, selectionEnd:e}=ta;
      const before=ta.value.slice(0,s), selected=ta.value.slice(s,e) || placeholder, after=ta.value.slice(e);
      ta.value = before + selPrefix + selected + selSuffix + after;
      const cursorPos = (before + selPrefix + selected + selSuffix).length;
      ta.focus(); ta.setSelectionRange(cursorPos, cursorPos);
      ta.dispatchEvent(new Event('input'));
    },
    atLineStart(prefix){
      const ta=memoArea; if(!ta) return;
      const s=ta.selectionStart, e=ta.selectionEnd;
      const v=ta.value; const start=v.lastIndexOf('\n', s-1)+1; const end=v.indexOf('\n', e); const lineEnd = end===-1? v.length : end;
      const line=v.slice(start, lineEnd);
      const newLine = (line.startsWith(prefix)? line.replace(new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')), '') : prefix + line);
      ta.value = v.slice(0,start) + newLine + v.slice(lineEnd);
      const pos = start + (prefix.length);
      ta.focus(); ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event('input'));
    },
    multiLine(prefix){
      const ta=memoArea; if(!ta) return;
      const s=ta.selectionStart, e=ta.selectionEnd;
      const v=ta.value; const start=v.lastIndexOf('\n', s-1)+1; const end=e===v.length? e : v.indexOf('\n', e)+1;
      const block=v.slice(start, end<0?v.length:end);
      const lines=block.split(/\n/);
      const toggled = lines.every(l=> l.startsWith(prefix))
        ? lines.map(l=> l.replace(new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')), ''))
        : lines.map(l=> prefix + (l||''));
      const result = toggled.join('\n');
      ta.value = v.slice(0,start) + result + v.slice(start+block.length);
      ta.focus(); ta.setSelectionRange(start, start+result.length);
      ta.dispatchEvent(new Event('input'));
    },
    heading(level){ TB.atLineStart('#'.repeat(level)+' '); },
    bold(){ TB.wrap('**','**','太字'); },
    italic(){ TB.wrap('*','*','斜体'); },
    strike(){ TB.wrap('~~','~~','打消し'); },
    code(){ TB.wrap('`','`','code'); },
    quote(){ TB.multiLine('> '); },
    ul(){ TB.multiLine('- '); },
    ol(){
      const ta=memoArea; if(!ta) return;
      const s=ta.selectionStart, e=ta.selectionEnd;
      const v=ta.value; const start=v.lastIndexOf('\n', s-1)+1; const end=e===v.length? e : v.indexOf('\n', e)+1;
      const block=v.slice(start, end<0?v.length:end); const lines=block.split(/\n/);
      const already = lines.every(l=> /^\d+\.\s/.test(l));
      const result = already ? lines.map(l=> l.replace(/^\d+\.\s/,''))
                             : lines.map((l,i)=> `${i+1}. ${l||''}`);
      ta.value = v.slice(0,start) + result.join('\n') + v.slice(start+block.length);
      ta.focus(); ta.setSelectionRange(start, start+result.join('\n').length);
      ta.dispatchEvent(new Event('input'));
    },
    task(){ TB.multiLine('- [ ] '); },
    link(){ const url = prompt('リンクURLを入力してください','https://'); if(!url) return; TB.wrap('[', `](${url})`, 'テキスト'); },
    image(){ const url = prompt('画像URLを入力してください','https://'); if(!url) return; TB.wrap('![', `](${url})`, '代替テキスト'); },
    hr(){
      const ta=memoArea; if(!ta) return;
      const s=ta.selectionStart; const v=ta.value;
      ta.value = v.slice(0,s) + '\n\n---\n\n' + v.slice(s);
      const pos = s + 5; ta.focus(); ta.setSelectionRange(pos,pos); ta.dispatchEvent(new Event('input'));
    },
    fence(){ TB.wrap('\n```txt\n','\n```\n','ここにコード'); }
  };
  const toolbarLeft = document.querySelector('.toolbar-left');
  if (toolbarLeft) toolbarLeft.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const act = btn.dataset.act; const lvl = parseInt(btn.dataset.level||'0',10);
    if(!act) return;
    if(act==='heading') TB.heading(lvl);
    else TB[act] && TB[act]();
  });

  /* ===== ToDo ===== */
  const todoKey='glass_todos_v1';
  const todoInput=document.getElementById('todoInput');
  const todoList=document.getElementById('todoList');
  const clearTodos=document.getElementById('clearTodos');
  const loadTodos=()=>{ try{ return JSON.parse(lsGet(todoKey,'[]')); }catch{ return []; } };
  const saveTodos=(t)=> lsSet(todoKey, JSON.stringify(t));
  function renderTodos(){
    if(!todoList) return;
    const list=loadTodos(); todoList.innerHTML='';
    list.forEach((t,i)=>{
      const row=document.createElement('div'); row.className='todo-row';
      const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=!!t.done;
      const txt=document.createElement('input'); txt.type='text'; txt.value=t.text||'';
      const del=document.createElement('button'); del.className='btn'; del.textContent='✕';
      chk.onchange=()=>{const l=loadTodos(); l[i].done=chk.checked; saveTodos(l); row.style.opacity = chk.checked ? 0.55 : 1;};
      txt.onchange=()=>{const l=loadTodos(); l[i].text=txt.value; saveTodos(l);}
      del.onclick=()=>{const l=loadTodos(); l.splice(i,1); saveTodos(l); renderTodos();}
      row.append(chk,txt,del); if(chk.checked) row.style.opacity = 0.55;
      todoList.append(row);
    });
  }
  renderTodos();
  if(todoInput) todoInput.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    const v=todoInput.value.trim(); if(!v) return;
    const l=loadTodos(); l.push({text:v,done:false}); saveTodos(l);
    todoInput.value=''; renderTodos();
  });
  if(clearTodos) clearTodos.onclick=()=>{ if(confirm('ToDoを全て消しますか？')){ lsSet(todoKey,'[]'); renderTodos(); } };

  /* ===== YouTube 入力 ===== */
  const playlistInput=document.getElementById('playlistInput');
  if(playlistInput) playlistInput.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    const v=playlistInput.value.trim(); if(!v||!player) return;
    if(v.startsWith('PL')) player.loadPlaylist({list:v,listType:'playlist',index:0});
    else player.loadVideoById(v);
  });
  const playBtn=document.getElementById('playBtn');
  const pauseBtn=document.getElementById('pauseBtn');
  const prevBtn=document.getElementById('prevBtn');
  const nextBtn=document.getElementById('nextBtn');
  if(playBtn) playBtn.onclick=()=> player?.playVideo?.();
  if(pauseBtn) pauseBtn.onclick=()=> player?.pauseVideo?.();
  if(prevBtn) prevBtn.onclick=()=> player?.previousVideo?.();
  if(nextBtn) nextBtn.onclick=()=> player?.nextVideo?.();

  /* ===== タイマー ===== */
  const tKey='glass_timer_settings_v1';
  const modeSelect=document.getElementById('modeSelect');
  const workLen=document.getElementById('workLen');
  const breakLen=document.getElementById('breakLen');
  const timerDisplay=document.getElementById('timerDisplay');
  const phaseLabel=document.getElementById('phaseLabel');
  const startBtn=document.getElementById('startTimer');
  const pauseTBtn=document.getElementById('pauseTimer');
  const resetBtn=document.getElementById('resetTimer');
  const bell=()=>{try{const c=new (window.AudioContext||window.webkitAudioContext)();const o=c.createOscillator();const g=c.createGain();
    o.type='sine';o.frequency.value=660;o.connect(g);g.connect(c.destination);
    g.gain.setValueAtTime(.001,c.currentTime);g.gain.exponentialRampToValueAtTime(.25,c.currentTime+.01);
    g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.6);o.start();o.stop(c.currentTime+.62);}catch{}};

  let state={mode:'pomodoro',work:25,rest:5,phase:'work',left:25*60,running:false,last:0};
  try{ state=Object.assign(state, JSON.parse(lsGet(tKey,'{}'))); }catch{}

  function syncTimerUI(){
    if (timerDisplay) {
      const mm = String(Math.floor(state.left/60)).padStart(2,'0');
      const ss = String(state.left%60).padStart(2,'0');
      timerDisplay.textContent = `${mm}:${ss}`;
    }
    if (phaseLabel) {
      phaseLabel.textContent = state.mode==='plain' ? 'タイマー' : (state.phase==='work'?'作業':'休憩');
    }
    lsSet(tKey, JSON.stringify(state)); idbInit().then(()=>idbSet(tKey, JSON.stringify(state)));
  }
  syncTimerUI();

  function tickTimer(ts){
    if(!state.running) return;
    if(!state.last) state.last=ts;
    const d=Math.floor((ts-state.last)/1000);
    if(d>=1){
      state.left=Math.max(0,state.left-d); state.last+=d*1000;
      if(state.left===0){
        bell();
        if(state.mode==='pomodoro'){
          state.phase = state.phase==='work'?'rest':'work';
          state.left=(state.phase==='work'?state.work:state.rest)*60;
        }else{
          state.running=false;
        }
      }
      syncTimerUI();
    }
    requestAnimationFrame(tickTimer);
  }
  if(startBtn) startBtn.onclick=()=>{ if(!state.running){ state.running=true; state.last=0; requestAnimationFrame(tickTimer);} };
  if(pauseTBtn) pauseTBtn.onclick=()=>{ state.running=false; state.last=0; syncTimerUI(); };
  if(resetBtn) resetBtn.onclick=()=>{ state.running=false; state.last=0; state.phase='work'; state.left=state.work*60; syncTimerUI(); };
  if(modeSelect) modeSelect.onchange=()=>{ state.mode=modeSelect.value; state.running=false; state.left=state.work*60; state.phase='work'; syncTimerUI(); };
  if(workLen) workLen.onchange=()=>{ state.work=Math.max(1,parseInt(workLen.value||'25')); if(state.phase==='work'||state.mode==='plain'){ state.left=state.work*60;} syncTimerUI(); };
  if(breakLen) breakLen.onchange=()=>{ state.rest=Math.max(1,parseInt(breakLen.value||'5')); if(state.phase==='rest'&&state.mode==='pomodoro'){ state.left=state.rest*60;} syncTimerUI(); };

  /* ===== 執筆進捗 ===== */
  const pKey='glass_progress_v1';
  const goalInput=document.getElementById('goalInput');
  const currentInput=document.getElementById('currentInput');
  const autoCount=document.getElementById('autoCount');
  const progBar=document.getElementById('progBar');
  const progText=document.getElementById('progText');
  const remainText=document.getElementById('remainText');
  const saveProgressBtn=document.getElementById('saveProgress');
  let prog={goal:1000,current:0,auto:true};
  try{ prog=Object.assign(prog, JSON.parse(lsGet(pKey,'{}')) ); }catch{}
  // IndexedDB からの追復元
  idbInit().then(()=> idbGet(pKey)).then(v=>{
    if(typeof v === 'string'){
      try{
        const obj = JSON.parse(v);
        prog = Object.assign(prog, obj||{});
        if(goalInput) goalInput.value=prog.goal;
        if(currentInput) currentInput.value=prog.current;
        if(autoCount) autoCount.checked=!!prog.auto;
        updateProgress();
      }catch{}
    }
  });
  if(goalInput) goalInput.value=prog.goal;
  if(currentInput) currentInput.value=prog.current;
  if(autoCount) autoCount.checked=!!prog.auto;

  function memoChars(){ return (memoArea && memoArea.value ? memoArea.value.length : 0); }
  function updateProgress(){
    const goal=Math.max(0,parseInt((goalInput && goalInput.value)||'0'));
    let cur=Math.max(0,parseInt((currentInput && currentInput.value)||'0'));
    if(autoCount && autoCount.checked){ cur=memoChars(); if(currentInput) currentInput.value=cur; }
    const pct=goal>0? Math.min(100, Math.round(cur/goal*100)) : 0;
    if(progBar) progBar.style.width=pct+'%';
    if(progText) progText.textContent=`${cur} / ${goal}（${pct}%）`;
    if(remainText) remainText.textContent=String(Math.max(0,goal-cur));
  }
  updateProgress();
  async function saveProgress(){
    prog.goal=Math.max(0,parseInt((goalInput && goalInput.value)||'0'));
    prog.current=Math.max(0,parseInt((currentInput && currentInput.value)||'0'));
    prog.auto=!!(autoCount && autoCount.checked);
    const json = JSON.stringify(prog);
    let ok = lsSet(pKey, json);
    if(!ok){ await idbInit(); ok = await idbSet(pKey, json); }
    updateProgress();
    if(saveProgressBtn){
      saveProgressBtn.textContent = ok ? '保存済' : '保存失敗…バックアップDL';
      if(!ok){
        download(json, 'progress-backup.json');
        alert('進捗の保存に失敗しました。JSONをダウンロードで退避しました。');
      }
      setTimeout(()=>saveProgressBtn.textContent='保存', 1200);
    }
  }
  if(saveProgressBtn) saveProgressBtn.onclick=saveProgress;
  [goalInput,currentInput,autoCount].forEach(el=> el && el.addEventListener('change', saveProgress));
  if(memoArea) memoArea.addEventListener('input', ()=>{ if(autoCount && autoCount.checked) updateProgress(); });

  /* ===== 背景 & 白文字設定 + 設定パネル ===== */
  const openBtn=document.getElementById('openSettings');
  const panel=document.getElementById('settingsPanel');
  const bgControls=document.getElementById('bgControls');
  const blurRange=document.getElementById('blurRange');
  const resetView=document.getElementById('resetView');
  const toggleWhiteText=document.getElementById('toggleWhiteText');
  const settingsKey='glass_settings_v1';

  const applySettings=(s)=>{
    if(s.mode==='gradient-1'){ document.body.style.background='linear-gradient(120deg,#0f172a 0%, #1e293b 55%, #172554 100%)'; }
    else if(s.mode==='gradient-2'){ document.body.style.background='linear-gradient(120deg,#ffedd5 0%,#fecaca 38%,#bae6fd 100%)'; }
    else if(s.mode==='gradient-3'){ document.body.style.background='linear-gradient(120deg,#0f766e 0%,#065f46 50%,#022c22 100%)'; }
    else if(s.mode==='solid'){ document.body.style.background=s.solid||'#e5e7eb'; }
    else if(s.mode==='image'){ document.body.style.background=`url("${s.image||''}") center/cover no-repeat fixed, #000`; }
    document.documentElement.style.setProperty('--panel-blur', (s.blur||12) + 'px');
    document.body.classList.toggle('white-text', !!s.whiteText);
    if(toggleWhiteText) toggleWhiteText.textContent = s.whiteText ? '文字色を通常に戻す' : '文字色を白にする';
  };
  const saveSettings=(s)=>{ lsSet(settingsKey, JSON.stringify(s)); idbInit().then(()=>idbSet(settingsKey, JSON.stringify(s))); };
  const loadSettings=()=>{ try{return JSON.parse(lsGet(settingsKey,'{}'))}catch{return{}} };

  function drawBgControls(s){
    if(!bgControls) return;
    bgControls.innerHTML='';
    if(s.mode==='solid'){
      const color=document.createElement('input'); color.type='color'; color.value=s.solid||'#e5e7eb';
      const text=document.createElement('input'); text.type='text'; text.placeholder='#e5e7eb'; text.value=s.solid||'#e5e7eb';
      const apply=()=>{ s.solid=text.value=color.value; applySettings(s); saveSettings(s); };
      color.oninput=apply; text.onchange=()=>{ color.value=text.value; apply(); };
      bgControls.append(color,text);
    }
    if(s.mode==='image'){
      const url=document.createElement('input'); url.type='text'; url.placeholder='画像URL'; url.value=s.image||'';
      const file=document.createElement('input'); file.accept='image/*'; file.type='file';
      url.onchange=()=>{ s.image=url.value; applySettings(s); saveSettings(s); };
      file.onchange=(ev)=>{ const f=ev.target.files[0]; if(!f) return;
        const r=new FileReader(); r.onload=()=>{ s.image=r.result; url.value=s.image; applySettings(s); saveSettings(s); }; r.readAsDataURL(f);
      };
      bgControls.append(url,file);
    }
  }
  function initSettings(){
    const s=Object.assign({mode:'gradient-1',blur:12,whiteText:false}, loadSettings());
    applySettings(s); if(blurRange) blurRange.value=s.blur||12;
    document.querySelectorAll('.settings .btn[data-bg]').forEach(b=>{
      b.addEventListener('click', ()=>{ s.mode=b.dataset.bg; saveSettings(s); applySettings(s); drawBgControls(s); });
    });
    if(blurRange) blurRange.oninput=()=>{ s.blur=Number(blurRange.value); applySettings(s); saveSettings(s); };
    if(resetView) resetView.onclick=()=>{ const def={mode:'gradient-1',blur:12,whiteText:s.whiteText}; saveSettings(def); applySettings(def); drawBgControls(def); if(blurRange) blurRange.value=12; };
    if(toggleWhiteText) toggleWhiteText.onclick=()=>{ s.whiteText = !s.whiteText; saveSettings(s); applySettings(s); };
    drawBgControls(s);
  }
  initSettings();

  // ギア開閉（外側クリックで閉じる、ショートカット付）
  if(openBtn && panel){
    openBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); panel.classList.toggle('active'); });
    document.addEventListener('click', (e)=>{ if(panel.classList.contains('active') && !panel.contains(e.target) && !openBtn.contains(e.target)){ panel.classList.remove('active'); } });
    document.addEventListener('keydown', (e)=>{ if((e.ctrlKey||e.metaKey) && e.key === '.'){ panel.classList.toggle('active'); } });
  }

  /* ===== Backdrop フォールバック ===== */
  const supportsBackdrop = CSS.supports('backdrop-filter','blur(10px)') || CSS.supports('-webkit-backdrop-filter','blur(10px)');
  if(!supportsBackdrop){ document.querySelectorAll('.glass').forEach(el=> el.style.background='rgba(255,255,255,.9)'); }
});
