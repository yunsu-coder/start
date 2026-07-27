// ===== 待办任务管理 =====
let taskFilter = 'all';
let taskKanbanMode = 0; // 0=list, 1=status kanban, 2=category kanban
let editingTaskId = null;
let allTasks = [];

// ===== 切换列表/状态看板/分类看板 =====
function toggleTaskView() {
  taskKanbanMode = (taskKanbanMode + 1) % 3;
  const btn = document.getElementById('taskViewToggle');
  const list = document.getElementById('todoList');
  const kanbanStatus = document.getElementById('todoKanbanStatus');
  const kanbanCat = document.getElementById('todoKanbanCat');
  list.style.display = 'none';
  kanbanStatus.style.display = 'none';
  kanbanCat.style.display = 'none';
  if (taskKanbanMode === 0) {
    btn.innerHTML = '<span class="mi">view_kanban</span> 看板';
    list.style.display = '';
    renderTaskList();
  } else if (taskKanbanMode === 1) {
    btn.innerHTML = '<span class="mi">category</span> 分类看板';
    kanbanStatus.style.display = '';
    renderStatusKanban();
  } else {
    btn.innerHTML = '<span class="mi">view_list</span> 列表';
    kanbanCat.style.display = '';
    renderCategoryKanban();
  }
}

// ===== 加载任务 =====
async function loadTasks() {
  try {
    const res = await fetch('/api/tasks?status=' + taskFilter);
    allTasks = await res.json();
    if (taskKanbanMode === 1) renderStatusKanban();
    else if (taskKanbanMode === 2) renderCategoryKanban();
    else renderTaskList();
    updateTaskCount();
  } catch (e) { console.warn('[Tasks] load failed', e.message); }
}

function updateTaskCount() {
  const total = allTasks.length;
  const doing = allTasks.filter(t => t.status === 'doing').length;
  const done = allTasks.filter(t => t.status === 'done').length;
  const overdue = allTasks.filter(t => t.overdue).length;
  const el = document.getElementById('taskCount');
  if (el) {
    el.textContent = '共 ' + total + ' 项 · ' + doing + ' 进行中 · ' + done + ' 已完成';
    if (overdue > 0) el.textContent += ' · ' + overdue + ' 逾期';
  }
}

// ===== 便利签颜色 + 旋转 =====
var NOTE_COLORS = ['#fef9e7','#fef0f0','#f0faf0','#f0f4fa','#f5f0fa','#fefce8','#fff7ed','#fdf2f8'];
function noteStyle(idx) {
  var rot = ((idx * 137) % 7 - 3) * 0.5; // -1.5 ~ +1.5 deg
  var bg = NOTE_COLORS[idx % NOTE_COLORS.length];
  return 'style="transform:rotate(' + rot.toFixed(1) + 'deg);--note-bg:' + bg + '"';
}

// ===== 渲染列表 =====
function renderTaskList() {
  var list = document.getElementById('todoList');
  if (!list) return;
  if (!allTasks.length) {
    list.innerHTML = '<div class="empty-state">还没有任务，在上面输入描述添加第一个吧</div>';
    return;
  }

  list.innerHTML = allTasks.map(function(t, i) {
    var statusIcon = { todo: 'radio_button_unchecked', doing: 'pending', done: 'check_circle' };
    var sc = 'todo-status-' + t.status;
    var startStr = t.startTime ? fmtTime(t.startTime) : '';
    var deadlineStr = t.deadline ? fmtTime(t.deadline) : '';
    var overdueCls = t.overdue ? ' todo-overdue' : '';
    var notStartedCls = t.notStarted ? ' todo-not-started' : '';
    var catHtml = t.category ? '<span class="todo-cat-badge">' + escHtml(t.category) + '</span>' : '';
    var notesHtml = t.notes ? '<div class="todo-notes-preview">' + escHtml(t.notes).slice(0, 120) + '</div>' : '';

    // 时间行
    var metaHtml = '<div class="todo-meta">';
    if (startStr) metaHtml += '<span class="todo-starttime"><span class="mi">play_arrow</span>' + startStr + '</span>';
    if (deadlineStr) {
      var dlCls = t.overdue ? ' todo-deadline-overdue' : '';
      metaHtml += '<span class="todo-deadline' + dlCls + '"><span class="mi">schedule</span>' + deadlineStr + '</span>';
    }
    metaHtml += '<span class="todo-status-tag ' + sc + '">' + { todo: '待开始', doing: '进行中', done: '已完成' }[t.status] + '</span>';
    if (t.overdue) metaHtml += '<span class="todo-overdue-badge">逾期</span>';
    metaHtml += '</div>';

    return '<div class="todo-item' + overdueCls + notStartedCls + '" ' + noteStyle(i) +
      ' onclick="openTaskEdit(\'' + t.id + '\')">' +
      '<button class="todo-check ' + sc + '" onclick="event.stopPropagation();cycleTaskStatus(\'' + t.id + '\')" title="切换状态">' +
        '<span class="mi">' + statusIcon[t.status] + '</span>' +
      '</button>' +
      '<div class="todo-body">' +
        '<div class="todo-desc">' + escHtml(t.description) + catHtml + '</div>' +
        metaHtml + notesHtml +
      '</div>' +
      '<button class="todo-del" onclick="event.stopPropagation();deleteTaskConfirm(\'' + t.id + '\')" title="删除"><span class="mi">close</span></button>' +
    '</div>';
  }).join('');
}

// ===== 渲染状态看板 =====
function renderStatusKanban() {
  _kbmCounter = 0;
  const cols = { todo: [], doing: [], done: [] };
  allTasks.forEach(t => { if (cols[t.status]) cols[t.status].push(t); });

  ['todo', 'doing', 'done'].forEach(status => {
    const el = document.getElementById('kanbanCol' + status.charAt(0).toUpperCase() + status.slice(1));
    const countEl = document.getElementById('kanbanCount' + status.charAt(0).toUpperCase() + status.slice(1));
    if (countEl) countEl.textContent = cols[status].length;
    if (!el) return;
    if (!cols[status].length) {
      el.innerHTML = '<div class="kanban-empty">拖拽任务到此处</div>';
      return;
    }
    el.innerHTML = cols[status].map(t => renderKanbanCard(t)).join('');
  });
}

// ===== 渲染分类看板 =====
function renderCategoryKanban() {
  var container = document.getElementById('todoKanbanCat');
  if (!container) return;

  // 按分类分组
  var cats = {};
  allTasks.forEach(function(t) {
    var cat = t.category || '未分类';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(t);
  });
  var catNames = Object.keys(cats).sort(function(a, b) {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    return a.localeCompare(b);
  });

  if (!catNames.length) {
    container.innerHTML = '<div class="kanban-empty" style="padding:3rem 1rem;text-align:center;color:var(--sub);">暂无任务</div>';
    return;
  }

  container.innerHTML = catNames.map(function(cat) {
    var tasks = cats[cat];
    var doneCount = tasks.filter(function(t) { return t.status === 'done'; }).length;
    var overdueCount = tasks.filter(function(t) { return t.overdue; }).length;
    return '<div class="kanban-col">' +
      '<div class="kanban-col-header">' +
        '<span class="mi">folder</span> ' + escHtml(cat) +
        '<span class="kanban-count">' + tasks.length + '</span>' +
        (overdueCount > 0 ? '<span class="kanban-overdue-dot" title="' + overdueCount + ' 项逾期">' + overdueCount + '</span>' : '') +
        '<span class="kanban-progress">' + (tasks.length ? Math.round(doneCount / tasks.length * 100) : 0) + '%</span>' +
      '</div>' +
      '<div class="kanban-col-body">' +
        tasks.map(function(t) { return renderKanbanCard(t); }).join('') +
      '</div>' +
    '</div>';
  }).join('');
}

// ===== 看板卡片渲染（共用）=====
var _kbmCounter = 0;
function renderKanbanCard(t) {
  var idx = _kbmCounter++;
  var startStr = t.startTime ? fmtTime(t.startTime) : '';
  var deadlineStr = t.deadline ? fmtTime(t.deadline) : '';
  var overdueClass = t.overdue ? ' kanban-card-overdue' : '';
  var catHtml = t.category ? '<span class="todo-cat-badge">' + escHtml(t.category) + '</span>' : '';
  var statusBadge = '';
  if (t.overdue) statusBadge = '<span class="todo-overdue-badge">逾期</span>';
  else if (t.status === 'done') statusBadge = '<span class="kanban-done-badge">✓</span>';
  else if (t.status === 'doing') statusBadge = '<span class="kanban-doing-badge">●</span>';

  var metaHtml = '';
  if (startStr) metaHtml += '<div class="kanban-card-meta"><span class="mi">play_arrow</span>' + startStr + '</div>';
  if (deadlineStr) {
    var dlClass2 = t.overdue ? ' kanban-card-meta-overdue' : '';
    metaHtml += '<div class="kanban-card-meta' + dlClass2 + '"><span class="mi">schedule</span>' + deadlineStr + '</div>';
  }

  var rot = ((idx * 173) % 5 - 2) * 0.7;
  var bg = NOTE_COLORS[idx % NOTE_COLORS.length];

  return '<div class="kanban-card' + overdueClass + '" ' +
    'style="transform:rotate(' + rot.toFixed(1) + 'deg);--note-bg:' + bg + '" ' +
    'draggable="true"' +
    ' ondragstart="kanbanDragStart(event,\'' + t.id + '\')"' +
    ' ondragover="kanbanDragOver(event)"' +
    ' ondrop="kanbanDrop(event,\'' + t.id + '\')"' +
    ' ondragend="kanbanDragEnd(event)"' +
    ' onclick="openTaskEdit(\'' + t.id + '\')">' +
    '<div class="kanban-card-desc">' + escHtml(t.description) + catHtml + statusBadge + '</div>' +
    metaHtml +
    (t.notes ? '<div class="kanban-card-notes">' + escHtml(t.notes).slice(0, 60) + '</div>' : '') +
  '</div>';
}

// ===== 看板拖拽 =====
let kanbanDragId = null;

function kanbanDragStart(e, id) {
  kanbanDragId = id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
}

function kanbanDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function kanbanDrop(e) {
  e.preventDefault();
  const card = document.querySelector('.kanban-card.dragging');
  if (card) card.classList.remove('dragging');
  // 只在状态看板支持拖拽改状态
  const col = e.target.closest('.kanban-col');
  if (!col) return;
  const newStatus = col.dataset.status;
  if (!newStatus) return;
  const task = allTasks.find(t => t.id === kanbanDragId);
  if (!task || task.status === newStatus) return;
  updateTaskStatus(kanbanDragId, newStatus);
  kanbanDragId = null;
}

function kanbanDragEnd(e) {
  e.target.classList.remove('dragging');
  kanbanDragId = null;
}

// ===== API 操作 =====

async function addTask() {
  var descEl = document.getElementById('taskDescInput');
  var catEl = document.getElementById('taskCatInput');
  var startEl = document.getElementById('taskStartInput');
  var deadlineEl = document.getElementById('taskDeadlineInput');
  var statusEl = document.getElementById('taskStatusInput');
  var desc = descEl.value.trim();
  if (!desc) return;
  try {
    var res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: desc,
        category: catEl.value.trim(),
        startTime: startEl && startEl.value ? new Date(startEl.value).toISOString() : '',
        deadline: deadlineEl && deadlineEl.value ? new Date(deadlineEl.value).toISOString() : '',
        status: statusEl.value,
      }),
    });
    if (res.ok) {
      descEl.value = '';
      if (startEl) { startEl.value = ''; if (fpStart) fpStart.clear(); }
      if (deadlineEl) { deadlineEl.value = ''; if (fpDeadline) fpDeadline.clear(); }
      descEl.focus();
      loadTasks();
    }
  } catch (e) { console.warn('[Tasks] add failed', e.message); }
}

async function updateTaskStatus(id, status) {
  try {
    await fetch('/api/tasks/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    loadTasks();
  } catch (e) { console.warn('[Tasks] update failed', e.message); }
}

async function cycleTaskStatus(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  const order = ['todo', 'doing', 'done', 'todo'];
  const next = order[order.indexOf(task.status) + 1];
  await updateTaskStatus(id, next);
}

async function deleteTaskConfirm(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm('删除任务：' + task.description + '？')) return;
  try {
    await fetch('/api/tasks/' + id, { method: 'DELETE' });
    loadTasks();
  } catch (e) { console.warn('[Tasks] delete failed', e.message); }
}

function setTaskFilter(status, btn) {
  taskFilter = status;
  document.querySelectorAll('.todo-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadTasks();
}

// ===== 编辑弹窗 =====
function openTaskEdit(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('taskEditTitle').textContent = '编辑任务';
  document.getElementById('taskEditDesc').value = task.description;
  document.getElementById('taskEditCat').value = task.category || '';
  document.getElementById('taskEditStartTime').value = task.startTime ? task.startTime.slice(0, 16) : '';
  document.getElementById('taskEditDeadline').value = task.deadline ? task.deadline.slice(0, 16) : '';
  document.getElementById('taskEditStatus').value = task.status;
  document.getElementById('taskEditNotes').value = task.notes || '';
  document.getElementById('taskDeleteBtn').style.display = '';
  document.getElementById('taskEditModal').classList.add('show');
}

function closeTaskEdit() {
  document.getElementById('taskEditModal').classList.remove('show');
  editingTaskId = null;
}

async function saveTaskEdit() {
  if (!editingTaskId) return;
  const startVal = document.getElementById('taskEditStartTime').value;
  const deadlineVal = document.getElementById('taskEditDeadline').value;
  try {
    await fetch('/api/tasks/' + editingTaskId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: document.getElementById('taskEditDesc').value.trim(),
        category: document.getElementById('taskEditCat').value.trim(),
        startTime: startVal ? new Date(startVal).toISOString() : '',
        deadline: deadlineVal ? new Date(deadlineVal).toISOString() : '',
        status: document.getElementById('taskEditStatus').value,
        notes: document.getElementById('taskEditNotes').value.trim(),
      }),
    });
    closeTaskEdit();
    loadTasks();
  } catch (e) { console.warn('[Tasks] save failed', e.message); }
}

async function deleteCurrentTask() {
  if (!editingTaskId) return;
  if (!confirm('确定删除此任务？')) return;
  try {
    await fetch('/api/tasks/' + editingTaskId, { method: 'DELETE' });
    closeTaskEdit();
    loadTasks();
  } catch (e) { console.warn('[Tasks] delete failed', e.message); }
}

// ===== Flatpickr 日期时间选择器 =====
var fpStart, fpDeadline;

function initFlatpickr() {
  var base = {
    locale: 'zh',
    enableTime: true,
    dateFormat: 'Y-m-d H:i',
    time_24hr: true,
    minuteIncrement: 1,
    allowInput: false,
    clickOpens: true,
  };
  var startEl = document.getElementById('taskStartInput');
  var deadlineEl = document.getElementById('taskDeadlineInput');
  if (startEl && !fpStart) fpStart = flatpickr(startEl, base);
  if (deadlineEl && !fpDeadline) fpDeadline = flatpickr(deadlineEl, base);
}

// ===== 工具函数 =====
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const timeStr = pad(d.getHours()) + ':' + pad(d.getMinutes());
  // 当天
  if (dateStr === now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())) {
    return '今天 ' + timeStr;
  }
  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr = yesterday.getFullYear() + '-' + pad(yesterday.getMonth() + 1) + '-' + pad(yesterday.getDate());
  if (dateStr === yestStr) return '昨天 ' + timeStr;
  // 明天
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomStr = tomorrow.getFullYear() + '-' + pad(tomorrow.getMonth() + 1) + '-' + pad(tomorrow.getDate());
  if (dateStr === tomStr) return '明天 ' + timeStr;
  // 今年
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + timeStr;
  return dateStr + ' ' + timeStr;
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('taskDescInput');
  if (!input) return;
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addTask(); }
  });
  // Flatpickr 延迟初始化（等待库加载）
  setTimeout(initFlatpickr, 300);
  // 面板切换时加载
  var taskPanel = document.getElementById('panel-tasks');
  if (taskPanel) {
    var observer = new MutationObserver(function() {
      if (taskPanel.classList.contains('active')) {
        loadTasks();
        // 确保 Flatpickr 已初始化
        if (!fpStart || !fpDeadline) initFlatpickr();
      }
    });
    observer.observe(taskPanel, { attributes: true, attributeFilter: ['class'] });
  }
});
