import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Run, Task } from '../../shared/types';

interface Stats {
  total: number;
  running: number;
  failed: number;
  completedToday: number;
}

const StatusBadge: React.FC<{ status: Run['status'] }> = ({ status }) => {
  const colors: Record<Run['status'], string> = {
    running: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    stopped: 'bg-yellow-500',
  };
  return (
    <span className={`${colors[status]} text-white text-xs px-2 py-1 rounded-full`}>
      {status}
    </span>
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ total: 0, running: 0, failed: 0, completedToday: 0 });
  const [recentRuns, setRecentRuns] = useState<(Run & { taskName?: string })[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const load = async () => {
      const [allTasks, allRuns] = await Promise.all([
        window.electronAPI.tasks.list(),
        window.electronAPI.runs.list(),
      ]);
      setTasks(allTasks);

      const today = new Date().toDateString();
      const newStats: Stats = {
        total: allTasks.length,
        running: allRuns.filter((r) => r.status === 'running').length,
        failed: allRuns.filter((r) => r.status === 'failed').length,
        completedToday: allRuns.filter(
          (r) => r.status === 'completed' && new Date(r.started_at).toDateString() === today
        ).length,
      };
      setStats(newStats);

      const taskMap = new Map(allTasks.map((t) => [t.id, t.name]));
      const recent = allRuns.slice(0, 10).map((r) => ({ ...r, taskName: taskMap.get(r.task_id) }));
      setRecentRuns(recent);
    };
    load();

    window.electronAPI.onRunUpdate((_e, run) => {
      setRecentRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...run };
          return next;
        }
        return [run, ...prev].slice(0, 10);
      });
    });
  }, []);

  const statCards = [
    { label: 'Total Tasks', value: stats.total, color: 'text-blue-400' },
    { label: 'Running', value: stats.running, color: 'text-green-400' },
    { label: 'Failed', value: stats.failed, color: 'text-red-400' },
    { label: 'Completed Today', value: stats.completedToday, color: 'text-purple-400' },
  ];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <button
          onClick={() => navigate('/tasks/new')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Task
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-gray-800 rounded-xl p-5 shadow">
            <p className="text-gray-400 text-sm">{card.label}</p>
            <p className={`text-3xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-800 rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Runs</h3>
        {recentRuns.length === 0 ? (
          <p className="text-gray-400 text-sm">No runs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left pb-3">Task</th>
                <th className="text-left pb-3">Status</th>
                <th className="text-left pb-3">Started</th>
                <th className="text-left pb-3">Ended</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id} className="border-b border-gray-700 hover:bg-gray-700 transition-colors">
                  <td className="py-3">{run.taskName || `Task #${run.task_id}`}</td>
                  <td className="py-3"><StatusBadge status={run.status} /></td>
                  <td className="py-3 text-gray-400">{new Date(run.started_at).toLocaleString()}</td>
                  <td className="py-3 text-gray-400">{run.ended_at ? new Date(run.ended_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-gray-800 rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="flex gap-3 flex-wrap">
          {tasks.slice(0, 5).map((task) => (
            <button
              key={task.id}
              onClick={() => window.electronAPI.task.run(task.id)}
              className="bg-gray-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              ▶ {task.name}
            </button>
          ))}
          {tasks.length === 0 && (
            <p className="text-gray-400 text-sm">Create tasks to see quick actions.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
