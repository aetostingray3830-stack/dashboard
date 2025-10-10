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
  /* ===== 任意：拡張の未処理Promise警告を抑制 ===== */
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) || '';
    if (/message port closed/i.test(msg)) e.preventDefault();
  });

  /* ===== 永続化：localStorage → IndexedDB ===== */
  const lsGet = (k, def='') => { try{ const v = localStorage.getItem(k); return v===null? def : v; }catch{ return def; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, v); return true; }catch{ return false; } };

  let idbdb=null;
  function idbInit(){
    return new Promise((resolve)=>{
      if(!('indexedDB' in window)){ resolve(null); return; }
      const req = indexedDB.open('glassDB', 1);
      req.onupgradeneeded = ()=> req.result.createObjectStore('kv');
      req.onsuccess = ()=>{ idbdb=req.result; resolve(idbdb); };
      req.onerror = ()=> resolve(null);
    });
  }
  function idbSet(k, v){
    return new Promise((resolve)=>{
      if(!idbdb){ resolve(false); return; }
      const tx = idbdb.transaction('kv','readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> resolve(false);
    });
  }
  function idbGet(k){
    return new Promise((resolve)=>{
      if(!idbdb){ resolve(null); return; }
      const tx = idbdb.transaction('kv','readonly');
      const req = tx.objectStore('kv').get(k);
      req.onsuccess = ()=> resolve(req.result ?? null);
      req.onerror = ()=> resolve(null);
    });
  }
  idbInit();

  /* ===== ダウンロード（Blob→msSave→dataURL） ===== */
  function download(text, filename='backup.txt') {
    try {
      const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
      if (window.navigator && typeof window.navigator.msSaveBlob === 'function') {
        window.navigator.msSaveBlob(blob, filename); return true;
      }
      const a=document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      return true;
    } catch(e) {
      try{
        const a=document.createElement('a');
        a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(()=> a.remove(), 0);
        return true;
      }catch{ return false; }
    }
  }
  const downloadTxt = (t, name)=> download(t, name || 'memo.txt');

  /* ===== ユーティリティ ===== */
  const toStr = (v)=> (typeof v==='string'? v : (v==null? '' : String(v)));
  const escHtml = (s)=> String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const slugify = (str)=> toStr(str).toLowerCase().trim()
    .replace(/[^\w\- \u3000-\u9fff]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-');

  // Markdown正規化（全角＃→半角、CRLF→LF）
  function normalizeMd(md){
    return toStr(md).replace(/＃/g, '#').replace(/\r\n?/g, '\n');
  }

  // ========== 色タグ：マーカー化 / 復元 / 剥がし ==========
  // ⟦C:#hex⟧...⟦/C⟧ に一旦変換（Markdownを中で解釈させるため）
  function encodeColorMarkers(md){
    return String(md ?? '')
      .replace(/<font\b([^>]*)>/gi, (m, attrs) => {
        const col = (attrs.match(/color\s*=\s*["']?([#\w()-]+)["']?/i) || [])[1];
        return col ? `⟦C:${col}⟧` : '';
      })
      .replace(/<\/font>/gi, '⟦/C⟧');
  }
  // マーカーを <span style="color:..."> に戻す
  function decodeColorMarkersToHtml(html){
    return String(html ?? '')
      .replace(/⟦C:([^⟧]+)⟧/g, (_,c)=>`<span style="color:${escHtml(c)}">`)
      .replace(/⟦\/C⟧/g, '</span>');
  }
  // TXT出力用：<font> とマーカー両方を除去
  function stripAllColorTags(mdOrText){
    return String(mdOrText ?? '')
      .replace(/<\/?font\b[^>]*>/gi, '')
      .replace(/⟦C:[^⟧]+⟧/g, '')
      .replace(/⟦\/C⟧/g, '');
  }

  // ========== インラインMarkdown（見出し内などで使う軽量処理） ==========
  function inlineMdToHtml(s){
    return String(s ?? '')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  // ========== 見出し先行HTML化（id付与、見出し内の装飾OK） ==========
  function preprocessHeadings(md){
    const src = String(md ?? '');
    return src.replace(
      /^ {0,3}(#{1,6})\s+([\s\S]*?)\s*#*\s*$/gm,
      (m, hashes, innerMd) => {
        const level = hashes.length;
        const plain = String(innerMd).replace(/<[^>]*>/g, '');
        const id = slugify(plain);
        const innerHtml = inlineMdToHtml(innerMd);
        return `<h${level} id="${id}">${innerHtml}</h${level}>`;
      }
    );
  }

  function createRenderer(){ return new marked.Renderer(); }

  // ========== ファイル名/タイトル ==========
  function memoTxtFilename() {
    const text = (memoArea && memoArea.value) || '';
    const m = text.match(/^ {0,3}#\s*(.+?)\s*#*\s*$/m);
    const base = m ? m[1] : `memo-${new Date().toISOString().slice(0,10)}`;
    const safe = base.replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,80) || 'memo';
    return `${safe}.txt`;
  }
  function memoHtmlFilename() { return memoTxtFilename().replace(/\.txt$/i, '.html'); }
  function memoPdfFilename()  { return memoTxtFilename().replace(/\.txt$/i, '.pdf'); }
  function memoTitle() {
    const text = (memoArea && memoArea.value) || '';
    const m = text.match(/^ {0,3}#\s*(.+?)\s*#*\s*$/m);
    return (m ? m[1] : 'Memo');
  }

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
  const exportHtmlBtn=document.getElementById('exportHtml'); // （HTML側に無ければ無視）
  const exportPdfBtn = document.getElementById('exportPdf'); // （HTML側に無ければ無視）
  const tocList=document.getElementById('tocList');

  if(memoArea) memoArea.value = lsGet(memoKey, '');
  idbInit().then(()=> idbGet(memoKey)).then(v=>{
    if(memoArea && !memoArea.value && typeof v === 'string'){ memoArea.value = v; }
  });

  function buildTOC(md){
    if(!tocList) return;
    const text = normalizeMd(md);
    const lines = text.split('\n'), items=[];
    for(const line of lines){
      const m = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if(m){ items.push({level:m[1].length, text:m[2].trim()}); }
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

  // 1) 正規化 → <font> を一旦マーカー化（⟦C:#hex⟧..⟦/C⟧）
  const md0 = normalizeMd(memoArea.value || '');
  const md1 = encodeColorMarkers(md0);

  // 2) 見出しだけ先に HTML 化（見出し内でも ** / * / ~~ / ` が効く）
  const mdPre = preprocessHeadings(md1);

  // 3) 本文の Markdown をHTML化
  let html;
  if (typeof window.marked !== 'undefined' && marked?.parse) {
    marked.setOptions({ mangle:false, headerIds:false, gfm:true, breaks:false });
    html = marked.parse(mdPre);
  } else {
    // フォールバック（最低限のインライン装飾＋引用・箇条書き）
    // 新：ブロック単位のパーサ
    html = fallbackMarkdownToHtml(mdPre);

  // 4) 色マーカーを <span style="color:…"> に復元（ここで色が付く）
  html = decodeColorMarkersToHtml(html);

  // 5) 反映＆TOC
  memoPreview.innerHTML = html;
  buildTOC(md0);
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

  // .txt 保存：ブラウザ保存＋ダウンロード（DLは 色タグ/マーカー を全部除去）
  if (saveMemoBtn) saveMemoBtn.onclick = async () => {
    if (!memoArea) return;
    const val = memoArea.value;             // 本体（色タグ可）
    const txtOut = stripAllColorTags(val);  // DL用（色タグ/マーカー除去）
    let savedWhere = [];
    try { if (lsSet(memoKey, val)) savedWhere.push('localStorage'); } catch{}
    if (!savedWhere.length) {
      try { await idbInit(); if (await idbSet(memoKey, val)) savedWhere.push('IndexedDB'); } catch{}
    }
    const name = memoTxtFilename();
    const dlOK = downloadTxt(txtOut, name);
    const okParts = [...savedWhere, dlOK ? 'DL(タグ除去)' : null].filter(Boolean);
    saveMemoBtn.textContent = okParts.length ? `保存OK：${okParts.join(' + ')}` : '保存失敗';
    setTimeout(()=> saveMemoBtn.textContent = '保存', 1600);
  };

  if(clearMemoBtn) clearMemoBtn.onclick=()=>{ 
    if(!memoArea) return; 
    if(confirm('メモを消去しますか？')){
      memoArea.value=''; lsSet(memoKey,''); idbInit().then(()=>idbSet(memoKey,'')); renderPreview(); showEdit();
    } 
  };

  if(memoArea) setInterval(async ()=> { 
    const val=memoArea.value; 
    if(!lsSet(memoKey, val)){ await idbInit(); await idbSet(memoKey, val); } 
  }, 10000);

  let tocTimer=null;
  if(memoArea) memoArea.addEventListener('input', ()=>{
    if(tocTimer) clearTimeout(tocTimer);
    tocTimer=setTimeout(()=>buildTOC(normalizeMd(memoArea.value||'')), 250);
  });
  buildTOC((memoArea && normalizeMd(memoArea.value))||'');

  /* ===== ツールバー（色パレット付き） ===== */
  function applyColorToSelection(hex){
    const ta = memoArea; if(!ta) return;
    const v = ta.value;
    let { selectionStart:s, selectionEnd:e } = ta;

    // 現在行
    const lineStart = v.lastIndexOf('\n', s-1) + 1;
    const nl = v.indexOf('\n', s);
    const lineEnd = nl === -1 ? v.length : nl;
    const line = v.slice(lineStart, lineEnd);

    // 見出し本文範囲
    const m = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const hashes = m[1];
      const hashPos = line.indexOf(hashes) + hashes.length;
      const afterHashSpace = (line.slice(hashPos).match(/^\s*/)||[''])[0].length;
      const contentStartInLine = hashPos + afterHashSpace;
      const tail = (line.match(/\s*#*\s*$/)||[''])[0];
      const contentEndInLine = Math.max(contentStartInLine, line.length - tail.length);
      const contentAbsStart = lineStart + contentStartInLine;
      const contentAbsEnd   = lineStart + contentEndInLine;

      if (s === e) { s = contentAbsStart; e = contentAbsEnd; }
      else {
        const overlapsThisLine = !(e <= lineStart || s >= lineEnd);
        if (overlapsThisLine) {
          const ns = Math.max(s, contentAbsStart);
          const ne = Math.min(e, contentAbsEnd);
          if (ns < ne) { s = ns; e = ne; }
          else { s = contentAbsStart; e = contentAbsEnd; }
        }
      }
    } else if (s === e) {
      const before = v.slice(0, s), after = v.slice(e);
      const selected = 'テキスト';
      ta.value = `${before}<font color="${hex}">${selected}</font>${after}`;
      const pos = (before + `<font color="${hex}">${selected}</font>`).length;
      ta.focus(); ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event('input'));
      return;
    }

    const before = v.slice(0, s);
    const selected = v.slice(s, e) || 'テキスト';
    const after = v.slice(e);
    ta.value = `${before}<font color="${hex}">${selected}</font>${after}`;
    const pos = (before + `<font color="${hex}">${selected}</font>`).length;
    ta.focus(); ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input'));
  }

  function removeColorFromSelection(){
    const ta=memoArea; if(!ta) return;
    let {selectionStart:s, selectionEnd:e}=ta;
    let v=ta.value;

    if (s < e) {
      const selected = v.slice(s,e);
      const stripped = selected.replace(/<\/?font\b[^>]*>/gi, '');
      ta.value = v.slice(0,s) + stripped + v.slice(e);
      const pos = s + stripped.length;
      ta.focus(); ta.setSelectionRange(pos,pos);
      ta.dispatchEvent(new Event('input'));
      return;
    }
    // 空選択：カーソルが <font>…</font> 内ならその1組を剥がす
    const openIdx = v.lastIndexOf('<font', s);
    const closeIdx = v.indexOf('</font>', s);
    if (openIdx !== -1 && closeIdx !== -1) {
      const openEnd = v.indexOf('>', openIdx);
      if (openEnd !== -1 && openEnd < s && closeIdx >= s) {
        const inner = v.slice(openEnd+1, closeIdx);
        ta.value = v.slice(0, openIdx) + inner + v.slice(closeIdx + 7);
        const pos = openIdx + inner.length;
        ta.focus(); ta.setSelectionRange(pos,pos);
        ta.dispatchEvent(new Event('input'));
      }
    }
  }

  // パレットUI
  let colorPopover = null;
  const PALETTE = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#111827','#000000','#ffffff'];
  function closeColorPopover(){ if(colorPopover){ colorPopover.remove(); colorPopover=null; document.removeEventListener('click', outsideClose, true); } }
  function outsideClose(e){ if(colorPopover && !colorPopover.contains(e.target)) closeColorPopover(); }
  function showColorPopover(anchorBtn){
    closeColorPopover();
    const rect = anchorBtn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'color-popover';
    Object.assign(pop.style, {
      position:'fixed', left: `${Math.round(rect.left)}px`, top: `${Math.round(rect.bottom + 6)}px`,
      background:'rgba(17,17,17,.9)', color:'#fff', border:'1px solid rgba(255,255,255,.15)',
      padding:'8px', borderRadius:'10px', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)',
      boxShadow:'0 10px 30px rgba(0,0,0,.25)', zIndex: 9999, display:'flex', alignItems:'center', gap:'6px'
    });
    PALETTE.forEach(hex=>{
      const b = document.createElement('button');
      Object.assign(b.style, {
        width:'22px', height:'22px', borderRadius:'6px', border:'1px solid rgba(255,255,255,.25)',
        cursor:'pointer', background: hex, outline:'none'
      });
      b.title = hex;
      b.onclick = (e)=>{ e.preventDefault(); applyColorToSelection(hex); closeColorPopover(); };
      pop.appendChild(b);
    });
    const custom = document.createElement('button');
    custom.textContent = '…';
    Object.assign(custom.style, {
      width:'28px', height:'22px', borderRadius:'6px', border:'1px solid rgba(255,255,255,.25)',
      background:'transparent', color:'#fff', cursor:'pointer'
    });
    custom.onclick = (e)=>{
      e.preventDefault();
      const input = document.createElement('input');
      input.type='color'; input.value='#ff4d4f'; input.style.position='fixed'; input.style.left='-9999px';
      document.body.appendChild(input);
      input.addEventListener('input', ()=>{
        applyColorToSelection(input.value || '#000000'); closeColorPopover();
        setTimeout(()=> input.remove(), 0);
      }, {once:true});
      input.click();
    };
    pop.appendChild(custom);
    const clear = document.createElement('button');
    clear.textContent = '×';
    Object.assign(clear.style, {
      width:'28px', height:'22px', borderRadius:'6px', border:'1px solid rgba(255,255,255,.25)',
      background:'transparent', color:'#fff', cursor:'pointer', fontWeight:'bold'
    });
    clear.title = '色を解除';
    clear.onclick = (e)=>{ e.preventDefault(); removeColorFromSelection(); closeColorPopover(); };
    pop.appendChild(clear);
    document.body.appendChild(pop);
    colorPopover = pop;
    setTimeout(()=> document.addEventListener('click', outsideClose, true), 0);
  }

  // ツールバー
  const toolbarLeft = document.querySelector('.toolbar-left');
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
      const result = already ? lines.map(l=> l.replace(/^\d+\.\s/,'')) : lines.map((l,i)=> `${i+1}. ${l||''}`);
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
    fence(){ TB.wrap('\n```txt\n','\n```\n','ここにコード'); },
    color(btn){ showColorPopover(btn); },
    uncolor(){ removeColorFromSelection(); }
  };
  if (toolbarLeft) toolbarLeft.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const act = btn.dataset.act; const lvl = parseInt(btn.dataset.level||'0',10);
    if(!act) return;
    if(act==='heading') TB.heading(lvl);
    else if(act==='color') TB.color(btn);
    else TB[act] && TB[act]();
  });

  /* ===== Markdown → HTML 変換 & HTML/ PDF 書き出し ===== */
  function markdownToHtmlBody(md) {
  const text0 = normalizeMd(md);
  const text1 = encodeColorMarkers(text0);
  const textPre = preprocessHeadings(text1);

  let out;
  if (typeof window.marked !== 'undefined' && marked?.parse) {
    marked.setOptions({ mangle:false, headerIds:false, gfm:true, breaks:false });
    out = marked.parse(textPre);
  } else {
    out = fallbackMarkdownToHtml(textPre);
  }
  return decodeColorMarkersToHtml(out);
}

  function buildStandaloneHtml(title, innerHtml) {
    const css = `
      body{margin:24px auto;max-width:800px;padding:0 16px;line-height:1.75;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji';color:#111;}
      h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.6em 0 .6em}
      h1{font-size:2rem} h2{font-size:1.6rem} h3{font-size:1.3rem}
      pre{padding:12px;background:#f5f5f5;overflow:auto;border-radius:8px}
      code{background:#f5f5f5;padding:.2em .35em;border-radius:4px}
      blockquote{margin:1em 0;padding:.5em 1em;border-left:4px solid #ddd;color:#555;background:#fafafa}
      ul,ol{padding-left:1.4em}
      a{color:#2563eb;text-decoration:none} a:hover{text-decoration:underline}
      hr{border:none;border-top:1px solid #e5e5e5;margin:2em 0}
      img{max-width:100%;height:auto}
      table{border-collapse:collapse} td,th{border:1px solid #e5e5e5;padding:.4em .6em}
    `.trim();
    return [
      '<!doctype html>',
      '<html lang="ja"><head>',
      '<meta charset="utf-8" />',
      `<title>${escHtml(title)}</title>`,
      '<meta name="viewport" content="width=device-width,initial-scale=1" />',
      `<style>${css}</style>`,
      '</head><body>',
      innerHtml,
      '</body></html>'
    ].join('\n');
  }

  if (exportHtmlBtn) exportHtmlBtn.onclick = () => {
    if (!memoArea) return;
    const md = memoArea.value;
    const htmlBody = markdownToHtmlBody(md);
    const doc = buildStandaloneHtml(memoTitle(), htmlBody);
    const name = memoHtmlFilename();
    const ok = download(doc, name);
    exportHtmlBtn.textContent = ok ? 'HTML保存済' : 'HTML保存失敗';
    setTimeout(()=> exportHtmlBtn.textContent = 'HTML保存', 1400);
  };

  // PDF：非表示ホストに完全HTMLを構築→html2pdfでその要素を保存
  if (exportPdfBtn) exportPdfBtn.onclick = async () => {
    if (!memoArea) return;

    const md = memoArea.value;
    const htmlBody = markdownToHtmlBody(md);
    const docHtml  = buildStandaloneHtml(memoTitle(), htmlBody);

    const parsed = new DOMParser().parseFromString(docHtml, 'text/html');
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed', left: '-9999px', top: '-9999px',
      width: '794px', maxWidth:'794px', background:'#fff'
    });

    // CSS(style)を移植
    parsed.head.querySelectorAll('style').forEach(st => {
      const copy = document.createElement('style');
      copy.textContent = st.textContent || '';
      host.appendChild(copy);
    });
    // 本文を移植
    Array.from(parsed.body.childNodes).forEach(node => host.appendChild(node.cloneNode(true)));
    // 画像CORS
    host.querySelectorAll('img').forEach(img => {
      if (!img.getAttribute('crossorigin')) img.setAttribute('crossorigin', 'anonymous');
    });

    document.body.appendChild(host);

    const waitForReady = async () => {
      const imgs = Array.from(host.querySelectorAll('img'));
      await Promise.all(imgs.map(img => (img.complete ? Promise.resolve() : new Promise(res => {
        img.addEventListener('load', res, { once:true });
        img.addEventListener('error', res, { once:true });
      }))));
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch {}
      }
    };

    const filename = memoPdfFilename();

    try {
      await waitForReady();
      if (window.html2pdf) {
        await html2pdf().set({
          margin: 10,
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: host.scrollWidth,
            windowHeight: host.scrollHeight,
            backgroundColor: '#ffffff'
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(host).save();
        exportPdfBtn.textContent = 'PDF保存済';
      } else {
        alert('html2pdf.js が読み込まれていません。<head>のCDNを確認してください。');
        exportPdfBtn.textContent = 'PDF保存失敗';
      }
    } catch (e) {
      console.error(e);
      exportPdfBtn.textContent = 'PDF保存失敗';
    } finally {
      setTimeout(()=> exportPdfBtn.textContent = 'PDF保存', 1400);
      host.remove();
    }
  };

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

  /* ===== YouTube 入力（URL/ID対応） ===== */
  function parseYouTubeInput(input){
    const s = String(input || '').trim();
    // 1) URLとして解釈
    try{
      const u = new URL(s);
      const list = u.searchParams.get('list');
      const v    = u.searchParams.get('v');
      if (list) return { playlist:list };
      if (u.hostname === 'youtu.be' && u.pathname.length > 1) {
        return { video: u.pathname.slice(1) };
      }
      if (v) return { video:v };
    }catch{ /* 非URL */ }
    // 2) プレーンID
    if (/^PL[\w-]+$/i.test(s)) return { playlist:s };
    if (/^[\w-]{11}$/.test(s)) return { video:s };
    return {};
  }

  const playlistInput=document.getElementById('playlistInput');
  if(playlistInput) playlistInput.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    const v=playlistInput.value.trim(); if(!v||!player) return;
    const p = parseYouTubeInput(v);
    if (p.playlist) player.loadPlaylist({ list:p.playlist, listType:'playlist', index:0 });
    else if (p.video) player.loadVideoById(p.video);
    else alert('YouTubeのURL/IDが読めませんでした');
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
  const phaseLabel=document.getElementById('phaseLabel'); // 無くてもOK
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
    if(resetView) resetView.onclick=()=>{ const def={mode:'gradient-1',blur:12,whiteText:s.whiteText}; saveSettings(def); applySettings(def); drawBgControls(def); if(blurRange) value=12; };
    if(toggleWhiteText) toggleWhiteText.onclick=()=>{ s.whiteText = !s.whiteText; saveSettings(s); applySettings(s); };
    drawBgControls(s);
  }
  initSettings();

  // ギア開閉
  if(openBtn && panel){
    openBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); panel.classList.toggle('active'); });
    document.addEventListener('click', (e)=>{ if(panel.classList.contains('active') && !panel.contains(e.target) && !openBtn.contains(e.target)){ panel.classList.remove('active'); } });
    document.addEventListener('keydown', (e)=>{ if((e.ctrlKey||e.metaKey) && e.key === '.'){ panel.classList.toggle('active'); } });
  }

  /* ===== Backdrop フォールバック ===== */
  const supportsBackdrop = CSS.supports('backdrop-filter','blur(10px)') || CSS.supports('-webkit-backdrop-filter','blur(10px)');
  if(!supportsBackdrop){ document.querySelectorAll('.glass').forEach(el=> el.style.background='rgba(255,255,255,.9)'); }

// フォールバック用：ブロックごとに段落化（見出し/箇条書き/引用は尊重）
function fallbackMarkdownToHtml(mdPre){
  const blocks = String(mdPre ?? '').split(/\n{2,}/); // 空行でブロック区切り
  const out = [];

  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  for (const raw of blocks) {
    const b = raw.replace(/\s+$/,''); // 末尾空白除去
    if (!b.trim()) continue;

    // 既に見出しHTML（preprocessHeadings済み）
    if (/^<h[1-6]\b/i.test(b.trim())) {
      out.push(b.trim());
      continue;
    }

    // 箇条書き（ブロック内の全行が "- " 始まりなら <ul>）
    const lines = b.split('\n');
    if (lines.every(l => /^\s*-\s+/.test(l))) {
      const items = lines.map(l => {
        const m = l.match(/^\s*-\s+(.*)$/);
        return `<li>${inline(m ? m[1] : l)}</li>`;
      }).join('');
      out.push(`<ul>${items}</ul>`);
      continue;
    }

    // 引用（全行が "> " 始まりなら <blockquote> の中で段落化）
    if (lines.every(l => /^\s*>\s+/.test(l))) {
      const q = lines.map(l => {
        const m = l.match(/^\s*>\s+(.*)$/);
        return inline(m ? m[1] : l);
      }).join('<br>');
      out.push(`<blockquote>${q}</blockquote>`);
      continue;
    }

    // それ以外は通常段落（単一改行は <br>）
    out.push(`<p>${inline(b).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('\n');
}

  
  // 初期化確認ログ
  console.log('[init] app.js loaded, buttons:', {
    save: !!document.getElementById('saveMemo'),
    exportHtml: !!document.getElementById('exportHtml'),
    exportPdf: !!document.getElementById('exportPdf')
  });
});
