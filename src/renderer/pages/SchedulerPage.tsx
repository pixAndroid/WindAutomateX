import React, { useEffect, useState } from 'react';
import type { Task } from '../../shared/types';
import { useToast } from '../components/Toast';

const SchedulerPage: React.FC = () => {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scheduleType, setScheduleType] = useState<Task['schedule_type']>('daily');
  const [scheduleValue, setScheduleValue] = useState('');

  const load = async () => {
    const all = await window.electronAPI.tasks.list();
    setTasks(all);
  };

  useEffect(() => { load(); }, []);

  const handleEdit = (task: Task) => {
    setEditingId(task.id);
    setScheduleType(task.schedule_type);
    setScheduleValue(task.schedule_value);
  };

  const handleSave = async (id: number) => {
    await window.electronAPI.tasks.update(id, { schedule_type: scheduleType, schedule_value: scheduleValue });
    showToast('Schedule saved', 'success');
    setEditingId(null);
    load();
  };

  const handleToggle = async (task: Task) => {
    await window.electronAPI.tasks.update(task.id, { enabled: !task.enabled });
    showToast(`Task ${task.enabled ? 'disabled' : 'enabled'}`, 'info');
    load();
  };

  const getNextRun = (task: Task): string => {
    if (!task.enabled) return 'Disabled';
    if (task.schedule_type === 'startup') return 'On Startup';
    if (task.schedule_type === 'once' && task.schedule_value) {
      return new Date(task.schedule_value).toLocaleString();
    }
    return 'Scheduled';
  };

  const scheduleValueLabel: Record<Task['schedule_type'], string> = {
    once: 'Date & Time (ISO)',
    daily: 'Time (HH:MM)',
    weekly: 'Day Time (1 09:00)',
    monthly: 'Day Time (15 09:00)',
    interval: 'Interval (minutes)',
    startup: 'N/A',
  };

  return (
    <div className="p-8 space-y-6">
      <h2 className="text-2xl font-bold">Scheduler</h2>
      <div className="bg-gray-800 rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left p-4">Task</th>
              <th className="text-left p-4">Type</th>
              <th className="text-left p-4">Value</th>
              <th className="text-left p-4">Next Run</th>
              <th className="text-left p-4">Enabled</th>
              <th className="text-left p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-gray-400">No tasks found</td></tr>
            )}
            {tasks.map((task) => (
              <React.Fragment key={task.id}>
                <tr className="border-b border-gray-700 hover:bg-gray-700 transition-colors">
                  <td className="p-4 font-medium">{task.name}</td>
                  <td className="p-4 text-gray-400">{task.schedule_type}</td>
                  <td className="p-4 text-gray-400">{task.schedule_value || '—'}</td>
                  <td className="p-4 text-gray-400">{getNextRun(task)}</td>
                  <td className="p-4">
                    <button
                      onClick={() => handleToggle(task)}
                      className={`w-10 h-6 rounded-full transition-colors ${task.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                    >
                      <span className={`block w-4 h-4 bg-white rounded-full mx-1 transition-transform ${task.enabled ? 'translate-x-4' : ''}`} />
                    </button>
                  </td>
                  <td className="p-4">
                    <button onClick={() => handleEdit(task)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                  </td>
                </tr>
                {editingId === task.id && (
                  <tr className="bg-gray-750 border-b border-gray-700">
                    <td colSpan={6} className="p-4">
                      <div className="flex items-end gap-4">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Schedule Type</label>
                          <select
                            value={scheduleType}
                            onChange={(e) => setScheduleType(e.target.value as Task['schedule_type'])}
                            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                          >
                            {(['once','daily','weekly','monthly','interval','startup'] as Task['schedule_type'][]).map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        {scheduleType !== 'startup' && (
                          <div className="flex-1">
                            <label className="block text-xs text-gray-400 mb-1">{scheduleValueLabel[scheduleType]}</label>
                            <input
                              value={scheduleValue}
                              onChange={(e) => setScheduleValue(e.target.value)}
                              placeholder={scheduleValueLabel[scheduleType]}
                              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        )}
                        <button onClick={() => handleSave(task.id)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">Save</button>
                        <button onClick={() => setEditingId(null)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SchedulerPage;
