import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Task, TaskStep, StepType } from '../../shared/types';
import StepCard from '../components/StepCard';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';

const ALL_STEP_TYPES: StepType[] = [
  'launch_exe', 'wait_window', 'click_element', 'click_coordinate',
  'type_text', 'press_key', 'select_dropdown', 'upload_file',
  'download_file', 'wait_download', 'wait_upload', 'read_text',
  'if_condition', 'loop', 'delay', 'screenshot', 'close_app', 'kill_process',
];

const defaultConfig: Record<StepType, Record<string, unknown>> = {
  launch_exe: { path: '', args: '' },
  wait_window: { title: '', timeout: 30 },
  click_element: { window_title: '', element_title: '', auto_id: '' },
  click_coordinate: { x: 0, y: 0 },
  type_text: { text: '', interval: 0.05 },
  press_key: { key: '' },
  select_dropdown: { window_title: '', element_title: '', value: '' },
  upload_file: { window_title: '', file_path: '' },
  download_file: { url: '', save_path: '' },
  wait_download: { folder: '', timeout: 300 },
  wait_upload: { window_title: '', timeout: 60 },
  read_text: { window_title: '', element_title: '', output_var: 'result' },
  if_condition: { variable: '', operator: '==', value: '' },
  loop: { count: 3 },
  delay: { seconds: 1 },
  screenshot: { path: '' },
  close_app: { window_title: '' },
  kill_process: { process_name: '' },
};

interface EditingStep {
  index: number | null;
  step: Partial<TaskStep>;
  config: Record<string, unknown>;
}

const TaskBuilder: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isEdit = Boolean(id);

  const [name, setName] = useState('New Task');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [editingStep, setEditingStep] = useState<EditingStep | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [selectedStepType, setSelectedStepType] = useState<StepType>('launch_exe');

  useEffect(() => {
    if (isEdit && id) {
      window.electronAPI.tasks.get(parseInt(id)).then((task) => {
        if (task) {
          setName(task.name);
          setDescription(task.description);
        }
      });
      window.electronAPI.steps.list(parseInt(id)).then(setSteps);
    }
  }, [id, isEdit]);

  const handleAddStep = () => {
    setEditingStep({
      index: null,
      step: { step_type: selectedStepType },
      config: { ...defaultConfig[selectedStepType] },
    });
  };

  const handleEditStep = (index: number) => {
    const step = steps[index];
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(step.config_json); } catch { config = {}; }
    setEditingStep({ index, step: { ...step }, config });
  };

  const handleSaveStep = () => {
    if (!editingStep) return;
    const stepType = (editingStep.step.step_type as StepType) || selectedStepType;
    const newStep: TaskStep = {
      id: 0,
      task_id: id ? parseInt(id) : 0,
      step_order: editingStep.index !== null ? steps[editingStep.index].step_order : steps.length,
      step_type: stepType,
      config_json: JSON.stringify(editingStep.config),
    };

    if (editingStep.index !== null) {
      setSteps((prev) => {
        const next = [...prev];
        next[editingStep.index!] = { ...next[editingStep.index!], ...newStep };
        return next;
      });
    } else {
      setSteps((prev) => [...prev, { ...newStep, step_order: prev.length }]);
    }
    setEditingStep(null);
  };

  const handleDeleteStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i })));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((s, i) => ({ ...s, step_order: i }));
    });
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((s, i) => ({ ...s, step_order: i }));
    });
  };

  const handleSave = async () => {
    if (!name.trim()) { showToast('Task name is required', 'error'); return; }
    try {
      let task: Task;
      if (isEdit && id) {
        task = await window.electronAPI.tasks.update(parseInt(id), { name, description });
      } else {
        task = await window.electronAPI.tasks.create({
          name,
          description,
          enabled: true,
          schedule_type: 'once',
          schedule_value: '',
        });
      }
      await window.electronAPI.steps.save(
        task.id,
        steps.map((s, i) => ({ ...s, task_id: task.id, step_order: i }))
      );
      showToast('Task saved!', 'success');
      navigate('/tasks');
    } catch {
      showToast('Failed to save task', 'error');
    }
  };

  return (
    <div className="p-8 h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{isEdit ? 'Edit Task' : 'New Task'}</h2>
        <div className="flex gap-3">
          <button onClick={() => setShowJson(!showJson)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">
            {showJson ? 'Hide JSON' : 'View JSON'}
          </button>
          <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Save Task
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Task Name"
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm flex-1 focus:outline-none focus:border-blue-500"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm flex-1 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Steps Panel */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <select
              value={selectedStepType}
              onChange={(e) => setSelectedStepType(e.target.value as StepType)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-blue-500"
            >
              {ALL_STEP_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              onClick={handleAddStep}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap"
            >
              + Add Step
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {steps.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                <p>No steps yet.</p>
                <p className="text-sm">Add steps to build your automation task.</p>
              </div>
            )}
            {steps.map((step, i) => (
              <StepCard
                key={i}
                step={step}
                index={i}
                total={steps.length}
                onEdit={() => handleEditStep(i)}
                onDelete={() => handleDeleteStep(i)}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
              />
            ))}
          </div>
        </div>

        {/* JSON Preview */}
        {showJson && (
          <div className="w-96 bg-gray-800 rounded-xl p-4 overflow-y-auto">
            <h3 className="text-sm font-medium text-gray-400 mb-2">JSON Preview</h3>
            <pre className="text-xs text-green-400 whitespace-pre-wrap">
              {JSON.stringify(steps, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Step Edit Modal */}
      <Modal
        isOpen={editingStep !== null}
        onClose={() => setEditingStep(null)}
        title={`Configure Step: ${editingStep?.step.step_type?.replace(/_/g, ' ') ?? ''}`}
        width="max-w-xl"
      >
        {editingStep && (
          <div className="space-y-4">
            {Object.entries(editingStep.config).map(([key, value]) => (
              <div key={key}>
                <label className="block text-sm text-gray-400 mb-1">{key.replace(/_/g, ' ')}</label>
                <input
                  type={typeof value === 'number' ? 'number' : 'text'}
                  value={String(value)}
                  onChange={(e) =>
                    setEditingStep((prev) =>
                      prev
                        ? {
                            ...prev,
                            config: {
                              ...prev.config,
                              [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value,
                            },
                          }
                        : null
                    )
                  }
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditingStep(null)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button onClick={handleSaveStep} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
                Save Step
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TaskBuilder;
