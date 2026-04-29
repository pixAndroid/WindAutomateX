import React, { useEffect, useState } from 'react';
import type { Run, Task } from '../../shared/types';
import { useToast } from '../components/Toast';

type StatusFilter = 'all' | 'completed' | 'failed' | 'running' | 'stopped';

const StatusBadge: React.FC<{ status: Run['status'] }> = ({ status }) => {
  const colors: Record<Run['status'], string> = {
    running: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    stopped: 'bg-yellow-500',
  };
  return <span className={`${colors[status]} text-white text-xs px-2 py-1 rounded-full`}>{status}</span>;
};

const LogsPage: React.FC = () => {
  const { showToast } = useToast();
  const [runs, setRuns] = useState<(Run & { taskName?: string })[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async () => {
    const [allRuns, allTasks] = await Promise.all([
      window.electronAPI.runs.list(),
      window.electronAPI.tasks.list(),
    ]);
    const taskMap = new Map<number, string>(allTasks.map((t: Task) => [t.id, t.name]));
    setRuns(allRuns.map((r) => ({ ...r, taskName: taskMap.get(r.task_id) })));
  };

  useEffect(() => {
    load();
    const handleRunUpdate = (_e: Electron.IpcRendererEvent, run: import('../../shared/types').Run) => {
      setRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...run };
          return next;
        }
        return [run, ...prev];
      });
    };
    window.electronAPI.onRunUpdate(handleRunUpdate);
    return () => {
      window.electronAPI.offRunUpdate(handleRunUpdate);
    };
  }, []);

  const filtered = filter === 'all' ? runs : runs.filter((r) => r.status === filter);

  const getDuration = (run: Run): string => {
    if (!run.ended_at) return '—';
    const ms = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const handleClear = async () => {
    if (!confirm('Clear all logs?')) return;
    await window.electronAPI.runs.clear();
    showToast('Logs cleared', 'info');
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Logs</h2>
        <button onClick={handleClear} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm">
          Clear Logs
        </button>
      </div>

      <div className="flex gap-2">
        {(['all','running','completed','failed','stopped'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-sm ${filter === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-gray-800 rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left p-4">Task</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Started</th>
              <th className="text-left p-4">Ended</th>
              <th className="text-left p-4">Duration</th>
              <th className="text-left p-4">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-gray-400">No logs found</td></tr>
            )}
            {filtered.map((run) => (
              <React.Fragment key={run.id}>
                <tr
                  className="border-b border-gray-700 hover:bg-gray-700 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
                >
                  <td className="p-4">{run.taskName || `Task #${run.task_id}`}</td>
                  <td className="p-4"><StatusBadge status={run.status} /></td>
                  <td className="p-4 text-gray-400">{new Date(run.started_at).toLocaleString()}</td>
                  <td className="p-4 text-gray-400">{run.ended_at ? new Date(run.ended_at).toLocaleString() : '—'}</td>
                  <td className="p-4 text-gray-400">{getDuration(run)}</td>
                  <td className="p-4 text-blue-400 text-xs">{expandedId === run.id ? '▲ Hide' : '▼ Show'}</td>
                </tr>
                {expandedId === run.id && (
                  <tr className="border-b border-gray-700 bg-gray-900">
                    <td colSpan={6} className="p-4">
                      <pre className="text-xs text-green-400 whitespace-pre-wrap max-h-64 overflow-y-auto font-mono bg-black p-3 rounded-lg">
                        {run.log_text || '(no log output)'}
                      </pre>
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

export default LogsPage;
