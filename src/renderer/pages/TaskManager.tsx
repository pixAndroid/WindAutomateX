import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task } from '../../shared/types';
import { useToast } from '../components/Toast';

const TaskManager: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // Maps taskId -> runId for currently running tasks
  const [runningTasks, setRunningTasks] = useState<Map<number, number>>(new Map());

  const load = async () => {
    const all = await window.electronAPI.tasks.list();
    setTasks(all);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handleRunUpdate = (_event: Electron.IpcRendererEvent, run: import('../../shared/types').Run) => {
      setRunningTasks((prev) => {
        const next = new Map(prev);
        if (run.status === 'running') {
          next.set(run.task_id, run.id);
        } else {
          next.delete(run.task_id);
        }
        return next;
      });
    };
    window.electronAPI.onRunUpdate(handleRunUpdate);
    return () => {
      window.electronAPI.offRunUpdate(handleRunUpdate);
    };
  }, []);

  const filtered = tasks.filter((t) => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all' ||
      (filter === 'active' && t.enabled) ||
      (filter === 'inactive' && !t.enabled);
    return matchSearch && matchFilter;
  });

  const handleRun = async (id: number) => {
    try {
      await window.electronAPI.task.run(id);
      showToast('Task started', 'success');
    } catch {
      showToast('Failed to start task', 'error');
    }
  };

  const handleStop = async (runId: number) => {
    try {
      await window.electronAPI.task.stop(runId);
      showToast('Task stopped', 'info');
    } catch {
      showToast('Failed to stop task', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this task?')) return;
    await window.electronAPI.tasks.delete(id);
    showToast('Task deleted', 'info');
    load();
  };

  const handleToggle = async (task: Task) => {
    await window.electronAPI.tasks.update(task.id, { enabled: !task.enabled });
    showToast(`Task ${task.enabled ? 'disabled' : 'enabled'}`, 'info');
    load();
  };

  const handleDuplicate = async (task: Task) => {
    const steps = await window.electronAPI.steps.list(task.id);
    const newTask = await window.electronAPI.tasks.create({
      ...task,
      name: `${task.name} (copy)`,
    });
    if (steps.length > 0) {
      await window.electronAPI.steps.save(
        newTask.id,
        steps.map((s) => ({ ...s, task_id: newTask.id }))
      );
    }
    showToast('Task duplicated', 'success');
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Task Manager</h2>
        <button
          onClick={() => navigate('/tasks/new')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Task
        </button>
      </div>

      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm flex-1 focus:outline-none focus:border-blue-500"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="bg-gray-800 rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left p-4">Name</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Schedule</th>
              <th className="text-left p-4">Updated</th>
              <th className="text-left p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-400">
                  No tasks found
                </td>
              </tr>
            )}
            {filtered.map((task) => (
              <tr key={task.id} className="border-b border-gray-700 hover:bg-gray-700 transition-colors">
                <td className="p-4">
                  <p className="font-medium">{task.name}</p>
                  <p className="text-gray-400 text-xs">{task.description}</p>
                </td>
                <td className="p-4">
                  <span className={`text-xs px-2 py-1 rounded-full ${task.enabled ? 'bg-green-600' : 'bg-gray-600'}`}>
                    {task.enabled ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-4 text-gray-400">{task.schedule_type}</td>
                <td className="p-4 text-gray-400">{new Date(task.updated_at).toLocaleDateString()}</td>
                <td className="p-4">
                  <div className="flex gap-2">
                    {runningTasks.has(task.id) ? (
                      <button onClick={() => handleStop(runningTasks.get(task.id)!)} title="Stop" className="text-red-500 hover:text-red-400 text-lg">⏹</button>
                    ) : (
                      <button onClick={() => handleRun(task.id)} title="Run" className="text-green-400 hover:text-green-300 text-lg">▶</button>
                    )}
                    <button onClick={() => navigate(`/tasks/${task.id}/edit`)} title="Edit" className="text-blue-400 hover:text-blue-300">✏️</button>
                    <button onClick={() => handleDuplicate(task)} title="Duplicate" className="text-yellow-400 hover:text-yellow-300">📋</button>
                    <button onClick={() => handleToggle(task)} title={task.enabled ? 'Disable' : 'Enable'} className="text-gray-400 hover:text-white">
                      {task.enabled ? '⏸' : '▶'}
                    </button>
                    <button onClick={() => handleDelete(task.id)} title="Delete" className="text-red-400 hover:text-red-300">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TaskManager;
