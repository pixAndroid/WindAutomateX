import React, { useEffect, useState, useCallback } from 'react';
import type { Task, Run } from '../../shared/types';
import { useToast } from '../components/Toast';

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type ScheduleType = Task['schedule_type'];

interface EditState {
  type: ScheduleType;
  // once
  dateTime: string;
  // daily
  time: string;
  // weekly
  dow: string;
  weekTime: string;
  // monthly
  monthDay: string;
  monthTime: string;
  // hourly
  hourMinute: string;
  // minutely / interval
  intervalMins: string;
}

function buildScheduleValue(edit: EditState): string {
  switch (edit.type) {
    case 'once':
      // No schedule value needed — task runs immediately when triggered.
      return '';
    case 'daily':
      return edit.time;
    case 'weekly':
      return `${edit.dow} ${edit.weekTime}`;
    case 'monthly':
      return `${edit.monthDay} ${edit.monthTime}`;
    case 'hourly':
      return edit.hourMinute;
    case 'minutely':
      return edit.intervalMins;
    case 'interval':
      return edit.intervalMins;
    case 'startup':
      return '';
  }
}

function parseEditState(task: Task): EditState {
  const base: EditState = {
    type: task.schedule_type,
    dateTime: '',
    time: '09:00',
    dow: '1',
    weekTime: '09:00',
    monthDay: '1',
    monthTime: '09:00',
    hourMinute: '0',
    intervalMins: '30',
  };
  const v = task.schedule_value || '';
  switch (task.schedule_type) {
    case 'once':
      // No schedule value — task runs immediately on trigger.
      break;
    case 'daily':
      base.time = v || '09:00';
      break;
    case 'weekly': {
      const parts = v.split(' ');
      if (parts.length === 2) { base.dow = parts[0]; base.weekTime = parts[1]; }
      break;
    }
    case 'monthly': {
      const parts = v.split(' ');
      if (parts.length === 2) { base.monthDay = parts[0]; base.monthTime = parts[1]; }
      break;
    }
    case 'hourly':
      base.hourMinute = v || '0';
      break;
    case 'minutely':
      base.intervalMins = v || '1';
      break;
    case 'interval':
      base.intervalMins = v || '30';
      break;
    default:
      break;
  }
  return base;
}

function getNextRunLabel(task: Task): string {
  if (!task.enabled) return 'Disabled';
  const v = task.schedule_value || '';
  switch (task.schedule_type) {
    case 'startup':
      return 'On Startup';
    case 'once':
      return 'Immediately on trigger';
    case 'daily':
      return v ? `Daily at ${v}` : 'Scheduled';
    case 'weekly': {
      const parts = v.split(' ');
      if (parts.length === 2) {
        const dayName = DOW_NAMES[parseInt(parts[0], 10)] || parts[0];
        return `Weekly on ${dayName} at ${parts[1]}`;
      }
      return 'Scheduled';
    }
    case 'monthly': {
      const parts = v.split(' ');
      if (parts.length === 2) return `Monthly on day ${parts[0]} at ${parts[1]}`;
      return 'Scheduled';
    }
    case 'hourly':
      return v !== '' ? `Hourly at :${v.padStart(2, '0')}` : 'Hourly at :00';
    case 'minutely': {
      const mins = v ? parseInt(v, 10) : 1;
      return mins === 1 ? 'Every minute' : `Every ${mins} minutes`;
    }
    case 'interval':
      return v ? `Every ${v} min` : 'Scheduled';
    default:
      return 'Scheduled';
  }
}

const SchedulerPage: React.FC = () => {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const all = await window.electronAPI.tasks.list();
    setTasks(all);
  }, []);

  // Initialise running task IDs from persisted runs
  useEffect(() => {
    window.electronAPI.runs.list().then((runs: Run[]) => {
      const ids = new Set(
        runs.filter((r) => r.status === 'running').map((r) => r.task_id)
      );
      setRunningTaskIds(ids);
    });
  }, []);

  // Listen for live run updates to track running state
  const handleRunUpdate = useCallback((_event: Electron.IpcRendererEvent, run: Run) => {
    setRunningTaskIds((prev) => {
      const next = new Set(prev);
      if (run.status === 'running') {
        next.add(run.task_id);
      } else {
        next.delete(run.task_id);
      }
      return next;
    });
  }, []);

  // Reload tasks when main process pushes a task update (e.g. auto-disabling a 'once' task)
  const handleTaskUpdated = useCallback(() => { load(); }, [load]);

  useEffect(() => {
    load();
    window.electronAPI.onRunUpdate(handleRunUpdate);
    window.electronAPI.onTaskUpdated(handleTaskUpdated);
    return () => {
      window.electronAPI.offRunUpdate(handleRunUpdate);
      window.electronAPI.offTaskUpdated(handleTaskUpdated);
    };
  }, [handleRunUpdate, handleTaskUpdated, load]);

  const handleEdit = (task: Task) => {
    setEditingId(task.id);
    setEditState(parseEditState(task));
  };

  const updateEdit = (patch: Partial<EditState>) => {
    setEditState((prev) => prev ? { ...prev, ...patch } : prev);
  };

  const handleSave = async (id: number) => {
    if (!editState) return;
    const schedule_value = buildScheduleValue(editState);
    await window.electronAPI.tasks.update(id, { schedule_type: editState.type, schedule_value });
    showToast('Schedule saved', 'success');
    setEditingId(null);
    setEditState(null);
    load();
  };

  const handleToggle = async (task: Task) => {
    await window.electronAPI.tasks.update(task.id, { enabled: !task.enabled });
    showToast(`Task ${task.enabled ? 'disabled' : 'enabled'}`, 'info');
    load();
  };

  const handleStop = async (task: Task) => {
    try {
      await window.electronAPI.scheduler.stopTask(task.id);
      showToast(`Task "${task.name}" stopped`, 'info');
    } catch {
      showToast(`Failed to stop task "${task.name}"`, 'error');
    }
  };

  const ALL_TYPES: ScheduleType[] = ['once', 'daily', 'weekly', 'monthly', 'hourly', 'minutely', 'interval', 'startup'];

  const renderSchedulePicker = (edit: EditState) => {
    switch (edit.type) {
      case 'once':
        return (
          <div className="flex-1 flex items-center text-xs text-gray-400">
            Runs once immediately when enabled — no time value needed.
          </div>
        );
      case 'daily':
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Time (HH:MM)</label>
            <input
              type="time"
              value={edit.time}
              onChange={(e) => updateEdit({ time: e.target.value })}
              className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        );
      case 'weekly':
        return (
          <>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Day of Week</label>
              <select
                value={edit.dow}
                onChange={(e) => updateEdit({ dow: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                {DOW_NAMES.map((name, i) => (
                  <option key={i} value={String(i)}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Time (HH:MM)</label>
              <input
                type="time"
                value={edit.weekTime}
                onChange={(e) => updateEdit({ weekTime: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </>
        );
      case 'monthly':
        return (
          <>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Day of Month (1–31)</label>
              <input
                type="number"
                min={1}
                max={31}
                value={edit.monthDay}
                onChange={(e) => updateEdit({ monthDay: e.target.value })}
                className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Time (HH:MM)</label>
              <input
                type="time"
                value={edit.monthTime}
                onChange={(e) => updateEdit({ monthTime: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </>
        );
      case 'hourly':
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1">At Minute (0–59)</label>
            <input
              type="number"
              min={0}
              max={59}
              value={edit.hourMinute}
              onChange={(e) => updateEdit({ hourMinute: e.target.value })}
              className="w-24 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        );
      case 'minutely':
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Every N Minutes (1–60)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={edit.intervalMins}
              onChange={(e) => updateEdit({ intervalMins: e.target.value })}
              className="w-24 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        );
      case 'interval':
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Interval (minutes)</label>
            <input
              type="number"
              min={1}
              value={edit.intervalMins}
              onChange={(e) => updateEdit({ intervalMins: e.target.value })}
              className="w-24 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        );
      case 'startup':
        return (
          <div className="flex-1 flex items-center text-xs text-gray-400">
            Runs once at application startup — no time value needed.
          </div>
        );
      default:
        return null;
    }
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
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Enabled</th>
              <th className="text-left p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-gray-400">No tasks found</td></tr>
            )}
            {tasks.map((task) => (
              <React.Fragment key={task.id}>
                <tr className="border-b border-gray-700 hover:bg-gray-700 transition-colors">
                  <td className="p-4 font-medium">{task.name}</td>
                  <td className="p-4 text-gray-400">{task.schedule_type}</td>
                  <td className="p-4 text-gray-400 max-w-xs truncate">{task.schedule_value || '—'}</td>
                  <td className="p-4 text-gray-400">{getNextRunLabel(task)}</td>
                  <td className="p-4">
                    {runningTaskIds.has(task.id) ? (
                      <span className="inline-flex items-center gap-1.5 text-green-400 text-xs font-medium">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        Running
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">Idle</span>
                    )}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => handleToggle(task)}
                      className={`w-10 h-6 rounded-full transition-colors ${task.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                    >
                      <span className={`block w-4 h-4 bg-white rounded-full mx-1 transition-transform ${task.enabled ? 'translate-x-4' : ''}`} />
                    </button>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {runningTaskIds.has(task.id) && (
                        <button
                          onClick={() => handleStop(task)}
                          className="text-red-400 hover:text-red-300 text-sm font-medium"
                          title="Stop running task"
                        >
                          Stop
                        </button>
                      )}
                      <button onClick={() => handleEdit(task)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                    </div>
                  </td>
                </tr>
                {editingId === task.id && editState && (
                  <tr className="bg-gray-750 border-b border-gray-700">
                    <td colSpan={7} className="p-4">
                      <div className="flex items-end gap-4 flex-wrap">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Schedule Type</label>
                          <select
                            value={editState.type}
                            onChange={(e) => updateEdit({ type: e.target.value as ScheduleType })}
                            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                          >
                            {ALL_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        {renderSchedulePicker(editState)}
                        <button onClick={() => handleSave(task.id)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">Save</button>
                        <button onClick={() => { setEditingId(null); setEditState(null); }} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
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
