// routes/tasks.js - 待办任务
const { listTasks, createTask, updateTask, deleteTask } = require('../lib/tasks');
const { sendJSON, readBody, parseJSON } = require('../lib/http');

module.exports = {
  name: 'tasks',
  async handle(p, m, url, req, res) {
    if (p === '/api/tasks' && m === 'GET') {
      const status = url.searchParams.get('status') || 'all';
      sendJSON(res, 200, listTasks(status));
      return true;
    }
    if (p === '/api/tasks' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body || !body.description) { sendJSON(res, 400, { error: '请输入任务描述' }); return true; }
      sendJSON(res, 200, createTask(body));
      return true;
    }
    if (p.startsWith('/api/tasks/') && m === 'POST') {
      const id = p.slice('/api/tasks/'.length);
      const body = parseJSON(await readBody(req));
      const result = updateTask(id, body);
      if (result.error) { sendJSON(res, 404, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }
    if (p.startsWith('/api/tasks/') && m === 'DELETE') {
      const id = p.slice('/api/tasks/'.length);
      const result = deleteTask(id);
      if (result.error) { sendJSON(res, 404, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }
    return false;
  }
};
