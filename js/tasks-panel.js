// ===== 待办任务管理 =====
let taskFilter = 'all';
let taskKanbanView = false;
let editingTaskId = null;
let allTasks = [];

// ===== 切换列表/看板视图 =====
function toggleTaskView() {
  taskKanbanView = !taskKanbanView;
  const btn = document.getElementById('taskViewToggle');
  const list = document.getElementById('taskList');
  const kanban = document.getElementById('taskKanban');
  if (taskKanbanView) {
    btn.innerHTML = '<span class="mi">view_list</span> 列表';
    list.style.display = 'none';
    kanban.style.display = '';
    renderKanban();
  } else {
    btn.innerHTML = '<span class="mi">view_kanban</span> 看板';
    list.style.display = '';
    kanban.style.display = 'none';
    renderTaskList();
  }
}

// ===== 加载任务 =====
async function loadTasks() {
  try {
    const res = await fetch('/api/tasks?status=' + taskFilter);
    allTasks = await res.json();
    if (taskKanbanView) renderKanban();
    else renderTaskList();
    updateTaskCount();
  } catch (e) { console.warn('[Tasks] load failed', e.message); }
}

function updateTaskCount() {
  const total = allTasks.length;
  const doing = allTasks.filter(t => t.status === 'doing').length;
  const done = allTasks.filter(t => t.status === 'done').length;
  const el = document.getElementById('taskCount');
  if (el) el.textContent = `共 ${total} 项 · ${doing} 进行中 · ${done} 已完成`;
}

// ===== 渲染列表 =====
function renderTaskList() {
  const list = document.getElementById('taskList');
  if (!list) return;
  if (!allTasks.length) {
    list.innerHTML = '<div class="empty-state">还没有任务，在上面输入描述添加第一个吧</div>';
    return;
  }

  list.innerHTML = allTasks.map(t => {
    const statusIcon = { todo: 'radio_button_unchecked', doing: 'pending', done: 'check_circle' };
    const statusClass = 'task-status-' + t.status;
    const deadlineStr = t.deadline ? fmtDeadline(t.deadline) : '';
    const overdueClass = t.deadline && t.status !== 'done' && new Date(t.deadline) < new Date() ? ' task-overdue' : '';
    const catHtml = t.category ? '<span class="task-cat-badge">' + escHtml(t.category) + '</span>' : '';
    const notesPreview = t.notes ? '<div class="task-notes-preview">' + escHtml(t.notes).slice(0, 100) + '</div>' : '';

    return '<div class="task-item' + overdueClass + '" onclick="openTaskEdit(\'' + t.id + '\')">' +
      '<button class="task-check ' + statusClass + '" onclick="event.stopPropagation();cycleTaskStatus(\'' + t.id + '\')" title="切换状态">' +
        '<span class="mi">' + statusIcon[t.status] + '</span>' +
      '</button>' +
      '<div class="task-body">' +
        '<div class="task-desc">' + escHtml(t.description) + catHtml + '</div>' +
        '<div class="task-meta">' +
          (deadlineStr ? '<span class="task-deadline"><span class="mi">schedule</span> ' + deadlineStr + '</span>' : '') +
          '<span class="task-status-tag ' + statusClass + '">' +
            { todo: '待开始', doing: '进行中', done: '已完成' }[t.status] +
          '</span>' +
        '</div>' +
        notesPreview +
      '</div>' +
      '<button class="task-del" onclick="event.stopPropagation();deleteTaskConfirm(\'' + t.id + '\')" title="删除"><span class="mi">close</span></button>' +
    '</div>';
  }).join('');
}

// ===== 渲染看板 =====
function renderKanban() {
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
    el.innerHTML = cols[status].map(t => {
      const deadlineStr = t.deadline ? fmtDeadline(t.deadline) : '';
      const overdueClass = t.deadline && t.status !== 'done' && new Date(t.deadline) < new Date() ? ' task-overdue' : '';
      const catHtml = t.category ? '<span class="task-cat-badge">' + escHtml(t.category) + '</span>' : '';
      return '<div class="kanban-card' + overdueClass + '" draggable="true"' +
        ' ondragstart="kanbanDragStart(event,\'' + t.id + '\')"' +
        ' ondragover="kanbanDragOver(event)"' +
        ' ondrop="kanbanDrop(event,\'' + t.id + '\')"' +
        ' ondragend="kanbanDragEnd(event)"' +
        ' onclick="openTaskEdit(\'' + t.id + '\')">' +
        '<div class="kanban-card-desc">' + escHtml(t.description) + catHtml + '</div>' +
        (deadlineStr ? '<div class="kanban-card-meta"><span class="mi">schedule</span> ' + deadlineStr + '</div>' : '') +
        (t.notes ? '<div class="kanban-card-notes">' + escHtml(t.notes).slice(0, 60) + '</div>' : '') +
      '</div>';
    }).join('');
  });
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

function kanbanDrop(e, id) {
  e.preventDefault();
  const card = document.querySelector('.kanban-card.dragging');
  if (card) card.classList.remove('dragging');
  // 找到 drop 目标列
  const col = e.target.closest('.kanban-col');
  if (!col) return;
  const newStatus = col.dataset.status;
  if (!newStatus) return;
  // 更新状态
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
  const descEl = document.getElementById('taskDescInput');
  const catEl = document.getElementById('taskCatInput');
  const deadlineEl = document.getElementById('taskDeadlineInput');
  const statusEl = document.getElementById('taskStatusInput');
  const desc = descEl.value.trim();
  if (!desc) return;
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: desc,
        category: catEl.value.trim(),
        deadline: deadlineEl.value ? new Date(deadlineEl.value).toISOString() : '',
        status: statusEl.value,
      }),
    });
    if (res.ok) {
      descEl.value = '';
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
  document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.remove('active'));
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
  const deadlineVal = document.getElementById('taskEditDeadline').value;
  try {
    await fetch('/api/tasks/' + editingTaskId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: document.getElementById('taskEditDesc').value.trim(),
        category: document.getElementById('taskEditCat').value.trim(),
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

// ===== 工具函数 =====
function fmtDeadline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // 当天显示时间
  if (dateStr === now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())) {
    return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr = yesterday.getFullYear() + '-' + pad(yesterday.getMonth() + 1) + '-' + pad(yesterday.getDate());
  if (dateStr === yestStr) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  // 明天
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomStr = tomorrow.getFullYear() + '-' + pad(tomorrow.getMonth() + 1) + '-' + pad(tomorrow.getDate());
  if (dateStr === tomStr) return '明天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  // 今年
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  return dateStr;
}

// ===== 键盘提交 =====
document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('taskDescInput');
  if (!input) return;
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addTask(); }
  });
  // 面板切换时加载
  const taskPanel = document.getElementById('panel-tasks');
  if (taskPanel) {
    const origSwitch = window.switchPanel;
    // 观察面板激活
    const observer = new MutationObserver(function() {
      if (taskPanel.classList.contains('active')) loadTasks();
    });
    observer.observe(taskPanel, { attributes: true, attributeFilter: ['class'] });
  }
});
