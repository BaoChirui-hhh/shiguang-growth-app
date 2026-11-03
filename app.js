const STORAGE_KEY = 'shiguang-growth-v1';
const DB_NAME = 'shiguang-growth-db';
const DB_STORE = 'app-data';
const DB_KEY = 'state';

const DEFAULT_MODULES = [
  { id: 'todo', name: '待办清单', icon: '✓', description: '论文、求职与生活安排', color: '#d9e8dc', fixed: true },
  { id: 'interview', name: '面试题库', icon: '◎', description: '问题、答案与面试复盘', color: '#edd8cd', fixed: true },
  { id: 'knowledge', name: '技术新知', icon: '⌘', description: '概念、代码与学习卡片', color: '#d6e2e9', fixed: true },
  { id: 'quotes', name: '重要话语', icon: '“', description: '不能忘记的话与提醒', color: '#eee3b9', fixed: true },
  { id: 'communication', name: '沟通表达', icon: '↔', description: '与人交流的常用表达', color: '#dfd9eb', fixed: true },
  { id: 'reflection', name: '心得复盘', icon: '✦', description: '体验、思考与阶段总结', color: '#d6e7e1', fixed: true }
];

const state = { entries: [], customModules: [], createdAt: new Date().toISOString() };
let currentFilter = 'all';
let currentModule = null;
let deferredInstallPrompt = null;

function loadLegacyState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.entries) && Array.isArray(saved.customModules)) return saved;
  } catch (_) {}
  return null;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDatabaseState() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const request = tx.objectStore(DB_STORE).get(DB_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function writeDatabaseState(value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(structuredClone(value), DB_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function hydrateState() {
  let saved = null;
  try { saved = await readDatabaseState(); } catch (_) {}
  const legacy = loadLegacyState();
  if (!saved && legacy) saved = legacy;
  if (saved && Array.isArray(saved.entries) && Array.isArray(saved.customModules)) Object.assign(state, saved);
  try { await writeDatabaseState(state); } catch (_) {}
  renderAll();
}

function saveState(message) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  writeDatabaseState(state).catch(() => {});
  renderAll();
  if (message) toast(message);
}

function allModules() { return [...DEFAULT_MODULES, ...state.customModules]; }
function moduleById(id) { return allModules().find(m => m.id === id) || DEFAULT_MODULES[0]; }
function fmtDate(value, includeYear = false) {
  if (!value) return '';
  const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) }).format(date);
}
function sameDay(a, b = new Date()) { const d = new Date(a); return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate(); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function renderAll() {
  renderHeader(); renderQuickGrid(); renderTodayTasks(); renderModules(); renderFilters(); renderRecords(); renderStats();
  if (currentModule) renderModuleDetail(currentModule);
}

function renderHeader() {
  const now = new Date();
  const weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][now.getDay()];
  document.querySelector('#todayLabel').textContent = `${now.getMonth()+1}月${now.getDate()}日 · ${weekday}`;
  const tasks = state.entries.filter(e => e.moduleId === 'todo' && (!e.due || sameDay(e.due)));
  const done = tasks.filter(e => e.status === 'done').length;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  document.querySelector('#progressValue').textContent = `${pct}%`;
  document.querySelector('#progressRing').style.setProperty('--progress', `${pct * 3.6}deg`);
  const next = tasks.find(e => e.status !== 'done');
  document.querySelector('#focusTitle').textContent = next ? next.title : (tasks.length ? '今天的任务已完成' : '从一件小事开始');
  document.querySelector('#focusHint').textContent = next ? (next.due ? `计划 ${fmtDate(next.due)} 完成，专注推进一点点。` : '把注意力放在下一步，而不是整个终点。') : '记录会让模糊的努力留下轨迹。';
}

function renderQuickGrid() {
  const ids = ['todo','interview','knowledge','reflection'];
  document.querySelector('#quickGrid').innerHTML = ids.map(id => { const m = moduleById(id); return `<button class="quick-card" data-quick-add="${id}"><span class="quick-icon" style="background:${m.color}">${m.icon}</span><b>${m.name.replace('清单','').replace('题库','').replace('新知','')}</b></button>`; }).join('');
}

function taskHtml(entry) {
  const overdue = entry.due && new Date(entry.due + 'T23:59:59') < new Date() && entry.status !== 'done';
  return `<article class="task-item" data-entry-id="${entry.id}">
    <button class="task-check ${entry.status === 'done' ? 'done' : ''}" data-toggle-task="${entry.id}" aria-label="${entry.status === 'done' ? '标记为未完成' : '标记为完成'}">${entry.status === 'done' ? '✓' : ''}</button>
    <div class="task-copy" data-edit-entry="${entry.id}"><h3 class="${entry.status === 'done' ? 'done' : ''}">${escapeHtml(entry.title)}</h3><div class="task-meta">${entry.due ? `<span style="color:${overdue ? '#b34f2d' : 'inherit'}">${overdue ? '已逾期 · ' : ''}${fmtDate(entry.due)}</span>` : '<span>未设日期</span>'}<span class="pill ${entry.priority || ''}">${{high:'重要',medium:'普通',low:'稍后'}[entry.priority] || '普通'}</span></div></div>
    <button class="more-button" data-delete-entry="${entry.id}" aria-label="删除">×</button>
  </article>`;
}

function renderTodayTasks() {
  const tasks = state.entries.filter(e => e.moduleId === 'todo' && (!e.due || sameDay(e.due))).sort((a,b) => (a.status === 'done') - (b.status === 'done')).slice(0,4);
  document.querySelector('#todayTasks').innerHTML = tasks.length ? tasks.map(taskHtml).join('') : `<button class="empty-state" data-quick-add="todo"><b>今天还没有待办</b>点这里写下最重要的一件事</button>`;
}

function renderModules() {
  document.querySelector('#moduleGrid').innerHTML = allModules().map(m => {
    const count = state.entries.filter(e => e.moduleId === m.id).length;
    return `<button class="module-card" style="background:${m.color}" data-open-module="${m.id}"><span class="module-icon">${m.icon}</span><div><h3>${escapeHtml(m.name)}</h3><p>${escapeHtml(m.description)}</p><div class="module-count">${count} 条记录 →</div></div></button>`;
  }).join('');
}

function renderFilters() {
  const filters = [{id:'all',name:'全部'}, ...allModules().map(m => ({id:m.id,name:m.name}))];
  document.querySelector('#filterChips').innerHTML = filters.map(f => `<button class="filter-chip ${currentFilter === f.id ? 'active' : ''}" data-filter="${f.id}">${escapeHtml(f.name)}</button>`).join('');
}

function recordHtml(entry) {
  if (entry.moduleId === 'todo') return taskHtml(entry);
  const m = moduleById(entry.moduleId);
  return `<article class="record-item" data-entry-id="${entry.id}">
    <div class="record-head"><span class="record-module">${m.icon} ${escapeHtml(m.name)}</span><button class="more-button" data-delete-entry="${entry.id}" aria-label="删除">×</button></div>
    <div data-edit-entry="${entry.id}"><h3>${escapeHtml(entry.title)}</h3>${entry.content ? `<p>${escapeHtml(entry.content)}</p>` : ''}</div>
    <div class="record-foot"><div class="tag-row">${(entry.tags || []).slice(0,3).map(t => `<span class="pill">#${escapeHtml(t)}</span>`).join('')}</div><span>${fmtDate(entry.updatedAt || entry.createdAt, true)}</span></div>
  </article>`;
}

function filteredEntries() {
  const query = document.querySelector('#searchInput')?.value.trim().toLowerCase() || '';
  return state.entries.filter(e => (currentFilter === 'all' || e.moduleId === currentFilter) && (!query || [e.title,e.content,...(e.tags||[])].join(' ').toLowerCase().includes(query))).sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function renderRecords() {
  const list = filteredEntries();
  document.querySelector('#recordList').innerHTML = list.length ? list.map(recordHtml).join('') : `<div class="empty-state"><b>还没有找到记录</b>换个关键词，或新增一条记录吧</div>`;
}

function renderStats() {
  const done = state.entries.filter(e => e.moduleId === 'todo' && e.status === 'done').length;
  const today = state.entries.filter(e => sameDay(e.createdAt)).length;
  const days = new Set(state.entries.map(e => new Date(e.createdAt).toDateString())).size;
  document.querySelector('#statsGrid').innerHTML = `<div class="stat-card"><strong>${state.entries.length}</strong><span>全部记录</span></div><div class="stat-card"><strong>${done}</strong><span>完成待办</span></div><div class="stat-card"><strong>${days}</strong><span>记录天数</span></div>`;
  document.querySelector('#profileSummary').textContent = today ? `今天已经留下 ${today} 条成长轨迹。` : '每一次记录，都在帮未来的你。';
}

function openEntryModal(moduleId = 'todo', entry = null) {
  const select = document.querySelector('#entryModule');
  select.innerHTML = allModules().map(m => `<option value="${m.id}">${m.icon} ${escapeHtml(m.name)}</option>`).join('');
  const form = document.querySelector('#entryForm'); form.reset();
  document.querySelector('#entryId').value = entry?.id || '';
  select.value = entry?.moduleId || moduleId;
  document.querySelector('#entryTitle').value = entry?.title || '';
  document.querySelector('#entryContent').value = entry?.content || '';
  document.querySelector('#entryTags').value = (entry?.tags || []).join(', ');
  document.querySelector('#entryDue').value = entry?.due || '';
  document.querySelector('#entryPriority').value = entry?.priority || 'medium';
  document.querySelector('#entryStatus').value = entry?.status || 'open';
  document.querySelector('#entryModalTitle').textContent = entry ? '编辑记录' : '新建记录';
  updateEntryFields(); openModal('entryModal');
  setTimeout(() => document.querySelector('#entryTitle').focus(), 180);
}

function updateEntryFields() {
  const isTask = document.querySelector('#entryModule').value === 'todo';
  document.querySelector('#taskExtras').style.display = isTask ? 'grid' : 'none';
  document.querySelector('#dueDateWrap').style.display = isTask ? 'grid' : 'none';
}

function openModal(id) { const el = document.querySelector('#'+id); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeModals() { document.querySelectorAll('.modal-backdrop.open').forEach(el => { el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }); document.body.style.overflow=''; }
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 1900); }

function openModule(id) { currentModule = id; renderModuleDetail(id); const el = document.querySelector('#moduleDetail'); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeModule() { currentModule = null; document.querySelector('#moduleDetail').classList.remove('open'); document.querySelector('#moduleDetail').setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
function renderModuleDetail(id) {
  const m = moduleById(id); const entries = state.entries.filter(e => e.moduleId === id).sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  document.querySelector('#detailEyebrow').textContent = m.description;
  document.querySelector('#detailTitle').textContent = `${m.icon} ${m.name}`;
  const secondary = id === 'todo' ? `${entries.filter(e => e.status === 'done').length} 项已完成` : '沉淀在这个模块中';
  document.querySelector('#detailSummary').innerHTML = `<div><strong>${entries.length}</strong>条记录</div><span>${secondary}</span>`;
  document.querySelector('#detailRecordList').innerHTML = entries.length ? entries.map(recordHtml).join('') : `<button class="empty-state" data-quick-add="${id}"><b>这里还是空的</b>写下第一条${escapeHtml(m.name)}记录</button>`;
}

function switchView(target) {
  closeModule();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === target));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.target === target));
  const titles = {home:'今天，先做重要的事',modules:'建立自己的知识地图',records:'找到你记录的一切',profile:'看见自己的积累'};
  document.querySelector('#pageTitle').textContent = titles[target];
  window.scrollTo({top:0,behavior:'smooth'});
  if (target === 'records') setTimeout(() => document.querySelector('#searchInput').focus(), 120);
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-target]'); if (nav) switchView(nav.dataset.target);
  const quick = event.target.closest('[data-quick-add]'); if (quick) openEntryModal(quick.dataset.quickAdd);
  const module = event.target.closest('[data-open-module]'); if (module) openModule(module.dataset.openModule);
  const toggle = event.target.closest('[data-toggle-task]'); if (toggle) { const e = state.entries.find(x => x.id === toggle.dataset.toggleTask); if (e) { e.status = e.status === 'done' ? 'open' : 'done'; e.updatedAt = new Date().toISOString(); saveState(e.status === 'done' ? '完成一项，做得不错' : '已恢复为待完成'); } }
  const edit = event.target.closest('[data-edit-entry]'); if (edit) { const e = state.entries.find(x => x.id === edit.dataset.editEntry); if (e) openEntryModal(e.moduleId,e); }
  const del = event.target.closest('[data-delete-entry]'); if (del) { const e = state.entries.find(x => x.id === del.dataset.deleteEntry); if (e && confirm(`删除「${e.title}」？`)) { state.entries = state.entries.filter(x => x.id !== e.id); saveState('记录已删除'); } }
  if (event.target.classList.contains('close-modal') || event.target.classList.contains('modal-backdrop')) closeModals();
  const filter = event.target.closest('[data-filter]'); if (filter) { currentFilter = filter.dataset.filter; renderFilters(); renderRecords(); }
});

document.querySelector('#mainAddButton').addEventListener('click', () => openEntryModal(currentModule || 'todo'));
document.querySelector('#searchButton').addEventListener('click', () => switchView('records'));
document.querySelector('#closeModuleButton').addEventListener('click', closeModule);
document.querySelector('#detailAddButton').addEventListener('click', () => openEntryModal(currentModule || 'todo'));
document.querySelector('#entryModule').addEventListener('change', updateEntryFields);
document.querySelector('#searchInput').addEventListener('input', renderRecords);

document.querySelector('#entryForm').addEventListener('submit', event => {
  event.preventDefault();
  const id = document.querySelector('#entryId').value;
  const moduleId = document.querySelector('#entryModule').value;
  const existing = state.entries.find(e => e.id === id);
  const entry = {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
    moduleId,
    title: document.querySelector('#entryTitle').value.trim(),
    content: document.querySelector('#entryContent').value.trim(),
    tags: document.querySelector('#entryTags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean),
    due: moduleId === 'todo' ? document.querySelector('#entryDue').value : '',
    priority: moduleId === 'todo' ? document.querySelector('#entryPriority').value : '',
    status: moduleId === 'todo' ? document.querySelector('#entryStatus').value : '',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existing) Object.assign(existing, entry); else state.entries.unshift(entry);
  closeModals(); saveState(existing ? '修改已保存' : '记录已保存');
});

const emojis = ['✎','⚑','♡','☕','◈','♬','☀','⌁','⚙','✈']; let chosenEmoji = emojis[0];
function renderEmojiPicker() { document.querySelector('#emojiPicker').innerHTML = emojis.map(e => `<button type="button" class="emoji-choice ${e===chosenEmoji?'active':''}" data-emoji="${e}">${e}</button>`).join(''); }
document.querySelector('#addModuleButton').addEventListener('click', () => { document.querySelector('#moduleForm').reset(); chosenEmoji=emojis[0]; renderEmojiPicker(); openModal('moduleModal'); });
document.querySelector('#emojiPicker').addEventListener('click', e => { const b=e.target.closest('[data-emoji]'); if(b){chosenEmoji=b.dataset.emoji;renderEmojiPicker();} });
document.querySelector('#moduleForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = document.querySelector('#moduleName').value.trim();
  const colors = ['#dbe7d7','#e8d8d0','#d3e2e8','#e9dfb9','#dcd7e9'];
  state.customModules.push({ id:'custom-'+Date.now().toString(36), name, icon:chosenEmoji, description:document.querySelector('#moduleDescription').value.trim() || `关于${name}的记录`, color:colors[state.customModules.length%colors.length] });
  closeModals(); saveState('新模块已创建');
});

document.querySelector('#exportButton').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({...state, exportedAt:new Date().toISOString()}, null, 2)], {type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`拾光备份-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); toast('备份已导出');
});
document.querySelector('#importInput').addEventListener('change', async event => {
  const file=event.target.files[0]; if(!file)return;
  try { const data=JSON.parse(await file.text()); if(!Array.isArray(data.entries)||!Array.isArray(data.customModules)) throw new Error(); if(confirm(`将导入 ${data.entries.length} 条记录并替换当前数据，继续吗？`)){state.entries=data.entries;state.customModules=data.customModules;state.createdAt=data.createdAt||new Date().toISOString();saveState('数据已恢复');} } catch(_){toast('备份文件格式不正确');} event.target.value='';
});

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt=event; });
document.querySelector('#installButton').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    return;
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  alert(isIOS ? '请点击 Safari 底部的“分享”按钮，然后选择“添加到主屏幕”。' : '请打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。');
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
if (navigator.storage?.persist) navigator.storage.persist().catch(()=>{});

renderEmojiPicker(); hydrateState();
