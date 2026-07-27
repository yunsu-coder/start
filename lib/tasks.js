// lib/tasks.js - 待办任务存储
const fs = require('fs');
const path = require('path');

const TASKS_DIR = path.join(__dirname, '..', 'tasks');
const TASKS_FILE = path.join(TASKS_DIR, 'tasks.json');

// 确保目录存在
if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });

// 初始数据
const INITIAL = [];

function readAll() {
  try {
    if (!fs.existsSync(TASKS_FILE)) return INITIAL;
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

function writeAll(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function listTasks(status) {
  const tasks = readAll();
  if (status && status !== 'all') return tasks.filter(t => t.status === status);
  return tasks;
}

function createTask(data) {
  const tasks = readAll();
  const now = new Date().toISOString();
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    description: (data.description || '').trim(),
    category: (data.category || '').trim(),
    deadline: data.deadline || '',
    status: data.status || 'todo',
    notes: (data.notes || '').trim(),
    created: now,
    updated: now,
  };
  tasks.push(task);
  writeAll(tasks);
  return task;
}

function updateTask(id, data) {
  const tasks = readAll();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return { error: 'not found' };
  const task = tasks[idx];
  // 只更新传入的字段
  if (data.description !== undefined) task.description = data.description.trim();
  if (data.category !== undefined) task.category = data.category.trim();
  if (data.deadline !== undefined) task.deadline = data.deadline;
  if (data.status !== undefined) task.status = data.status;
  if (data.notes !== undefined) task.notes = data.notes.trim();
  task.updated = new Date().toISOString();
  tasks[idx] = task;
  writeAll(tasks);
  return task;
}

function deleteTask(id) {
  const tasks = readAll();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return { error: 'not found' };
  tasks.splice(idx, 1);
  writeAll(tasks);
  return { ok: true };
}

module.exports = { listTasks, createTask, updateTask, deleteTask };
