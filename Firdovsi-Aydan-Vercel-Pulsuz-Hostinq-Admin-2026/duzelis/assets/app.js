'use strict';
(() => {
  const admin = document.body.dataset.admin === 'true';
  const $ = id => document.getElementById(id);
  let csrf = '';
  let rows = [];
  let selection = null;
  let selectedTable = null;
  let editId = null;
  let showMap = false;
  let inflight = 0;
  let activeSearch = 0;
  const norm = s => String(s || '').toLocaleLowerCase('az').normalize('NFC')
    .replace(/ə/g,'e').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ü/g,'u')
    .replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g');
  const el = (tag, cls, text) => {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  function message(txt, type='error') {
    const area = $(type);
    area.textContent = txt;
    area.hidden = !txt;
  }
  async function request(action, data={}) {
    const res = await fetch('/api/site', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
      body:JSON.stringify({action,...data}), cache:'no-store'
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `Server xətası: ${res.status}`);
    if (out.csrf) csrf = out.csrf;
    return out;
  }
  async function get(action, params={}) {
    const query = new URLSearchParams({action,...params});
    const res = await fetch(`/api/site?${query}`, {credentials:'same-origin',cache:'no-store'});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Məlumat yüklənmədi.');
    return data;
  }
  async function initialize() {
    try {
      const st = await get('status');
      csrf = st.csrf;
      if (admin && !st.admin) {
        $('login-screen').hidden = false;
        $('app').hidden = true;
        $('setup-fields').hidden = st.initialized;
        $('login-title').textContent = st.initialized ? 'Xoş gəldiniz' : 'İlk admin parolu';
        $('login-subtitle').textContent = st.initialized ? 'Admin panel' : 'Saytı yalnız siz qura bilərsiniz.';
        $('login-button').textContent = st.initialized ? 'Daxil ol' : 'Parolu saxla və daxil ol';
        $('password').setAttribute('autocomplete', st.initialized ? 'current-password' : 'new-password');
        $('login-form').dataset.initialized = String(st.initialized);
        return;
      }
      $('login-screen').hidden = true;
      $('app').hidden = false;
      await load();
    } catch (e) {
      if(admin) { $('login-screen').hidden = false; $('login-error').hidden=false; $('login-error').textContent=e.message; }
      else { $('app').hidden = false; message(e.message); }
    }
  }
  async function load() {
    try {
      if (admin) {
        rows = (await get('guests')).guests;
      } else {
        const q = $('query').value.trim();
        const searchId = ++activeSearch;
        const incoming = q.length>=2 ? (await get('guests',{q})).guests : [];
        if (searchId!==activeSearch || $('query').value.trim() !== q) return;
        rows = incoming;
      }
      render(); message('');
    } catch(e) { message(e.message); }
  }
  function selectedGuest() {return selection && rows.find(g=>g.id===selection);}
  function render() {
    const query = norm($('query').value.trim());
    const list = (admin ? rows.filter(g=>norm(g.name).includes(query)) : rows).slice(0,1000);
    $('clear-query').hidden = !$('query').value;
    $('result-count').textContent = list.length+' nəfər';
    if(admin) {
      const arrived = rows.filter(g=>g.arrived).length;
      $('total-count').textContent=String(rows.length);
      $('arrived-count').textContent=arrived+' / '+rows.length;
      $('used-count').textContent=new Set(rows.map(g=>g.tableNo)).size+' / 30';
      $('footer-status').textContent=`${arrived} / ${rows.length} qonaq qarşılanıb`;
    } else {
      $('footer-status').textContent = $('query').value.trim().length<2 ? 'Axtarmaq üçün ən azı 2 hərf yazın' : 'Qonağınızı seçin';
    }
    const container = $('results'); container.replaceChildren();
    if(!list.length) {
      const empty = el('div','empty');
      const icon=el('div','empty-icon', admin?'♡':'⌕');
      const title=el('h3','', admin && !rows.length?'İlk qonağı əlavə edin':!admin&&$('query').value.trim().length<2?'Qonağın adını yazın':'Qonaq tapılmadı');
      const p=el('p','',admin && !rows.length?'Qonaq əlavə etmək üçün yuxarıdakı formadan istifadə edin.':'Ad və soyadın bir hissəsini yoxlayın.');
      empty.append(icon,title,p); container.append(empty);
    }
    for(const g of list){
      const wrapper=el('div','guest'+(selection===g.id?' chosen':''));
      const btn=el('button','guest-main'); btn.type='button';
      const avatar=el('span','avatar',g.name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase());
      const name=el('span','guest-name',g.name);
      name.append(el('small','',g.arrived?'✓ Qarşılanıb':'Qarşılanma gözlənilir'));
      btn.append(avatar,name,el('span','table-tag','Masa '+g.tableNo));
      btn.addEventListener('click',()=>{selection=g.id;selectedTable=null;render();if(innerWidth<761)$('masa-netice').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
      wrapper.append(btn);
      if(admin){const edit=el('button','guest-action','✎');edit.type='button';edit.setAttribute('aria-label',g.name+' redaktə et');edit.addEventListener('click',()=>startEdit(g));wrapper.append(edit);const del=el('button','','✕');del.type='button';del.setAttribute('aria-label',g.name+' sil');del.addEventListener('click',async()=>{
        if(!confirm(g.name+' siyahıdan silinsin?'))return;
        await mutate('delete',{id:g.id},'Qonaq silindi.');
        if(selection===g.id)selection=null;
      });wrapper.append(del);}
      container.append(wrapper);
    }
    renderPanel();renderTableSelection();
  }
  function renderPanel(){
    const panel=$('masa-netice');panel.replaceChildren();
    const g=selectedGuest();const n=g?.tableNo || selectedTable;
    if(!n){const empty=el('div','result-empty');empty.append(el('span','','♡'));
      const title=el('h2');title.append('Hər qonağa',document.createElement('br'),'özəl bir yer.');
      empty.append(title,el('p','','Adı seçin, masa nömrəsi burada görünsün.'),el('span','result-dash','—'));panel.append(empty);return;}
    panel.append(el('span','result-label','Masa'),el('strong','result-number',String(n)));
    if(g){panel.append(el('h2','result-name',g.name),el('span','arrival-state'+(g.arrived?' is-arrived':''),g.arrived?'✓ Qarşılanıb':'Sizi gözləyirdik'));
      if(admin){const button=el('button','primary',g.arrived?'Qeydi geri al':'✓ Qarşılandı');button.type='button';button.addEventListener('click',async()=>{await mutate('arrived',{id:g.id,value:!g.arrived},'Qarşılanma statusu yeniləndi.');});panel.append(button);const edit=el('button','edit-selected','✎ Adı və ya masanı dəyiş');edit.type='button';edit.addEventListener('click',()=>startEdit(g));panel.append(edit);}
    } else if(admin) {panel.append(el('p','','Bu masada '+rows.filter(g=>g.tableNo===n).length+' qonaq var.'));}
    const bottom=el('div','result-bottom');bottom.append(el('span','','❧'));const p=el('p');p.append('Gözəl xatirələr',document.createElement('br'),'buradan başlayır.');bottom.append(p);panel.append(bottom);
  }
  function tables(){
    const wrapper=$('tables');wrapper.replaceChildren();
    for(const ns of [Array.from({length:10},(_,i)=>i+1),Array.from({length:5},(_,i)=>i+21),Array.from({length:5},(_,i)=>i+26),Array.from({length:10},(_,i)=>i+11)]){
      const group=el('div',ns[0]>20?'inner':'outer');
      for(const n of ns){const b=el('button','table t'+n+(n>20?' round':''),String(n));b.type='button';b.dataset.table=String(n);b.setAttribute('aria-label','Masa '+n);b.addEventListener('click',()=>{selection=null;selectedTable=n;renderPanel();renderTableSelection();});group.append(b);}
      wrapper.append(group);
    }
  }
  function renderTableSelection(){
    const g=selectedGuest(),n=g?.tableNo||selectedTable;
    document.querySelectorAll('.table').forEach(button=>{const yes=Number(button.dataset.table)===n;button.classList.toggle('active',yes);button.setAttribute('aria-pressed',yes?'true':'false');});
    const target=$('table-guests');target.replaceChildren();
    if(!n || !admin)return;
    target.append(el('h3','',`Masa ${n} · Qonaqlar`));
    const guests=rows.filter(g=>g.tableNo===n);
    guests.forEach(g=>{const b=el('button','',g.name+' ›');b.type='button';b.addEventListener('click',()=>{selection=g.id;selectedTable=null;render();});target.append(b);});
    if(!guests.length)target.append(el('p','','Bu masaya hələ qonaq əlavə edilməyib.'));
  }
  async function mutate(action,data,success){
    try {await request(action,data);await load();if(success)message(success,'notice');return true;}
    catch(e){message(e.message);return false;}
  }
  function startEdit(g){
    if(!admin) return;
    editId=g.id; $('edit-name').value=g.name; $('edit-table').value=String(g.tableNo);
    $('edit-panel').hidden=false; $('edit-panel').scrollIntoView({behavior:'smooth',block:'center'});
    $('edit-name').focus({preventScroll:true});
  }
  function quoteCsv(value){let s=String(value);if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function exportCsv(){
    const text='\uFEFFAd soyad,Masa,Gəlib\r\n'+rows.map(g=>[quoteCsv(g.name),g.tableNo,g.arrived?'Bəli':'Xeyr'].join(',')).join('\r\n');
    const link=document.createElement('a');const href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));link.href=href;link.download='firdovsi-aydan-qonaqlar.csv';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  function parseRows(text){
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
    if(lines.length>10001)throw new Error('Maksimum 10000 sətir qəbul edilir.');
    const delimiter=(lines[0]||'').includes('\t')?'\t':(lines[0]||'').includes(';')?';':',';
    const result=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];const pieces=[];let buf='',quoted=false;
      for(let j=0;j<line.length;j++){const c=line[j];if(c==='"'){if(quoted&&line[j+1]==='"'){buf+='"';j++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){pieces.push(buf.trim());buf='';}else buf+=c;}
      pieces.push(buf.trim());
      if(quoted)throw new Error(`Sətir ${i+1}: dırnaq işarələri düzgün deyil.`);
      if(i===0 && /^(masa|table)$/i.test(pieces[1]||''))continue;
      const name=pieces[0]||'',num=Number(pieces[1]);
      if(!name||name.length>150||!Number.isInteger(num)||num<1||num>30)throw new Error(`Sətir ${i+1}: ad və ya masa nömrəsi yanlışdır.`);
      const arrived=['bəli','beli','yes','true','1'].includes(norm(pieces[2]||''));
      result.push({name,tableNo:num,arrived});
    }
    return result;
  }
  function wiring(){
    $('query').addEventListener('input',()=>{
      if(admin)render();
      else {
        clearTimeout(inflight);
        inflight=setTimeout(()=>load(),250);
        if($('query').value.trim().length<2){rows=[];selection=null;render();}
      }
    });
    $('clear-query').addEventListener('click',()=>{$('query').value='';rows=admin?rows:[];selection=null;if(admin)render();else load();$('query').focus();});
    $('plan-toggle').addEventListener('click',()=>{showMap=!showMap;$('zal-plani').classList.toggle('map-hidden',!showMap);$('plan-toggle').setAttribute('aria-expanded',String(showMap));$('plan-toggle').querySelector('span:nth-child(2)').textContent=showMap?'Zal planını bağla':'Zal planı';if(showMap)$('zal-plani').scrollIntoView({behavior:'smooth',block:'start'});});
    $('login-form').addEventListener('submit',async event=>{
      event.preventDefault();const setup=$('login-form').dataset.initialized==='false';const password=$('password').value;
      if(setup&&password!==$('repeat').value){$('login-error').hidden=false;$('login-error').textContent='Parollar uyğun gəlmir.';return;}
      const submit=$('login-button');submit.disabled=true;
      try{await request(setup?'setup':'login',{password});$('login-error').hidden=true;$('password').value='';await initialize();}
      catch(e){$('login-error').textContent=e.message;$('login-error').hidden=false;}
      finally{submit.disabled=false;}
    });
    if(admin){
      $('edit-form').addEventListener('submit',async event=>{event.preventDefault();if(!editId)return;const ok=await mutate('edit',{id:editId,name:$('edit-name').value.trim(),tableNo:Number($('edit-table').value)},'Qonaq məlumatları yeniləndi.');if(ok){editId=null;$('edit-panel').hidden=true;}});
      $('edit-cancel').addEventListener('click',()=>{editId=null;$('edit-panel').hidden=true;});
      $('add-form').addEventListener('submit',async event=>{event.preventDefault();const name=$('guest-name').value.trim(),tableNo=Number($('guest-table').value);if(await mutate('add',{rows:[{name,tableNo}]},'Qonaq əlavə olundu.'))$('guest-name').value='';});
      $('import-toggle').addEventListener('click',()=>{$('import-panel').hidden=!$('import-panel').hidden;});
      $('import-file').addEventListener('change',async event=>{const f=event.target.files?.[0];if(f){if(f.size>500000){message('Fayl 500 KB-dan kiçik olmalıdır.');return;}$('import-text').value=await f.text();}});
      $('import-button').addEventListener('click',async()=>{
        try{const parsed=parseRows($('import-text').value);if(!parsed.length)throw new Error('Siyahı boşdur.');let saved=0;
          for(let i=0;i<parsed.length;i+=300){await request('add',{rows:parsed.slice(i,i+300)});saved+=Math.min(300,parsed.length-i);}
          await load();message(saved+' qonaq əlavə edildi.','notice');$('import-text').value='';$('import-panel').hidden=true;
        }catch(e){message(e.message);}
      });
      $('export-csv').addEventListener('click',exportCsv);
      $('logout').addEventListener('click',async()=>{try{await request('logout');rows=[];selection=null;await initialize();}catch(e){message(e.message);}});
    }
  }
  tables();wiring();initialize();
})();
