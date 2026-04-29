import React, { useEffect, useState, useCallback } from 'react';
import type { Task, TaskStep } from '../../shared/types';
import StepCard from '../components/StepCard';
import { useToast } from '../components/Toast';

const ActionsPage: React.FC = () => {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    window.electronAPI.tasks.list().then((t) => {
      setTasks(t);
      if (t.length > 0) setSelectedTaskId(t[0].id);
    }).catch(() => {
      setTasks([]);
      showToast('Failed to load tasks', 'error');
    });
  }, [showToast]);

  useEffect(() => {
    if (selectedTaskId === null) { setSteps([]); return; }
    setLoading(true);
    window.electronAPI.steps.list(selectedTaskId)
      .then(setSteps)
      .catch(() => {
        setSteps([]);
        showToast('Failed to load steps', 'error');
      })
      .finally(() => setLoading(false));
  }, [selectedTaskId]);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((s, i) => ({ ...s, step_order: i }));
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setSteps((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((s, i) => ({ ...s, step_order: i }));
    });
  }, []);

  const handleDragStart = useCallback((index: number) => setDragIndex(index), []);
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);
  const handleDrop = useCallback((dropIndex: number) => {
    setDragIndex((di) => {
      if (di === null || di === dropIndex) { setDragOverIndex(null); return null; }
      setSteps((prev) => {
        const next = [...prev];
        const [moved] = next.splice(di, 1);
        next.splice(dropIndex, 0, moved);
        return next.map((s, i) => ({ ...s, step_order: i }));
      });
      setDragOverIndex(null);
      return null;
    });
  }, []);
  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleSave = async () => {
    if (selectedTaskId === null) return;
    setSaving(true);
    try {
      await window.electronAPI.steps.save(
        selectedTaskId,
        steps.map((s, i) => ({ ...s, task_id: selectedTaskId, step_order: i }))
      );
      showToast('Step order saved!', 'success');
    } catch {
      showToast('Failed to save step order', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <div className="p-8 h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Actions</h2>
        <button
          onClick={handleSave}
          disabled={saving || selectedTaskId === null || steps.length === 0}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {saving ? 'Saving…' : 'Save Order'}
        </button>
      </div>

      {/* Task selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-400 whitespace-nowrap">Task:</label>
        <select
          value={selectedTaskId ?? ''}
          onChange={(e) => setSelectedTaskId(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm flex-1 max-w-sm focus:outline-none focus:border-blue-500"
        >
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {selectedTask && (
          <span className="text-xs text-gray-500">{selectedTask.description}</span>
        )}
      </div>

      {/* Steps list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {loading && (
          <div className="text-center text-gray-500 py-12">Loading steps…</div>
        )}
        {!loading && steps.length === 0 && selectedTaskId !== null && (
          <div className="text-center text-gray-500 py-12">
            <p>No steps found for this task.</p>
          </div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p>No tasks found. Create a task in Task Manager first.</p>
          </div>
        )}
        {!loading && steps.map((step, i) => (
          <StepCard
            key={step.id > 0 ? `step-${step.id}` : `step-order-${step.step_order}-${step.step_type}`}
            step={step}
            index={i}
            total={steps.length}
            isDragging={dragIndex === i}
            isDragOver={dragOverIndex === i && dragIndex !== i}
            onEdit={() => {/* editing handled in Task Builder */}}
            onDelete={() => {/* deletion handled in Task Builder */}}
            onCopy={() => {/* copying handled in Task Builder */}}
            onMoveUp={() => handleMoveUp(i)}
            onMoveDown={() => handleMoveDown(i)}
            onDragStart={() => handleDragStart(i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={() => handleDrop(i)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {!loading && steps.length > 1 && (
        <p className="text-xs text-gray-500">
          Drag steps or use ↑ ↓ buttons to reorder, then click <strong>Save Order</strong>.
        </p>
      )}
    </div>
  );
};

export default ActionsPage;
