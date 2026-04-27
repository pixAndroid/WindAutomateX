import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Task, TaskStep, StepType } from '../../shared/types';
import StepCard from '../components/StepCard';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';

const ALL_STEP_TYPES: StepType[] = [
  'launch_exe', 'wait_window', 'click_element', 'click_coordinate',
  'type_text', 'press_key', 'keyboard_shortcut', 'select_dropdown', 'upload_file',
  'download_file', 'wait_download', 'wait_upload', 'read_text',
  'if_condition', 'loop', 'delay', 'screenshot', 'close_app', 'kill_process',
];

const defaultConfig: Record<StepType, Record<string, unknown>> = {
  launch_exe: { path: '', args: '', delay: 60 },
  wait_window: { window_title: '', timeout: 30, delay: 60 },
  click_element: { window_title: '', element_title: '', auto_id: '', delay: 60 },
  click_coordinate: { x: 0, y: 0, delay: 60 },
  type_text: { text: '', interval: 0.05, delay: 60 },
  press_key: { key: '', delay: 60 },
  keyboard_shortcut: { keys: '', delay: 60 },
  select_dropdown: { window_title: '', element_title: '', value: '', delay: 60 },
  upload_file: { window_title: '', file_path: '', delay: 60 },
  download_file: { url: '', save_path: '', delay: 60 },
  wait_download: { folder: '', timeout: 300, delay: 60 },
  wait_upload: { window_title: '', timeout: 60, delay: 60 },
  read_text: { window_title: '', element_title: '', output_var: 'result', delay: 60 },
  if_condition: { variable: '', operator: '==', value: '', delay: 60 },
  loop: { count: 3, delay: 60 },
  delay: { seconds: 1, delay: 60 },
  screenshot: { path: '', delay: 60 },
  close_app: { window_title: '', delay: 60 },
  kill_process: { process_name: '', delay: 60 },
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
    if (config.delay === undefined) config.delay = 60;
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

  const handleCopyStep = (index: number) => {
    setSteps((prev) => {
      const step = prev[index];
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(step.config_json); } catch { config = {}; }
      if (config.delay === undefined) config.delay = 60;
      const copy: TaskStep = {
        ...step,
        id: 0,
        config_json: JSON.stringify(config),
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next.map((s, i) => ({ ...s, step_order: i }));
    });
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next.map((s, i) => ({ ...s, step_order: i }));
    });
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
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
                isDragging={dragIndex === i}
                isDragOver={dragOverIndex === i && dragIndex !== i}
                onEdit={() => handleEditStep(i)}
                onDelete={() => handleDeleteStep(i)}
                onCopy={() => handleCopyStep(i)}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
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
            {editingStep.step.step_type === 'launch_exe' ? (
              <>
                {/* Path field with Browse button */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">path</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={String(editingStep.config.path ?? '')}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, path: e.target.value } } : null
                        )
                      }
                      placeholder="C:\Program Files\App\app.exe"
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={async () => {
                        const filePath = await window.electronAPI.dialog.openFile();
                        if (filePath) {
                          setEditingStep((prev) =>
                            prev ? { ...prev, config: { ...prev.config, path: filePath } } : null
                          );
                        }
                      }}
                      className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-sm whitespace-nowrap"
                    >
                      Browse…
                    </button>
                  </div>
                </div>
                {/* Args field with hint */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">args</label>
                  <input
                    type="text"
                    value={String(editingStep.config.args ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, args: e.target.value } } : null
                      )
                    }
                    placeholder="e.g. --headless --no-sandbox"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Space-separated command-line arguments. Examples: <code className="text-gray-400">--flag</code>, <code className="text-gray-400">--key value</code>, <code className="text-gray-400">/silent /norestart</code>
                  </p>
                </div>
              </>
            ) : editingStep.step.step_type === 'click_coordinate' ? (
              <>
                {/* X and Y fields with Pick from Screen button */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">x</label>
                    <input
                      type="number"
                      value={String(editingStep.config.x ?? 0)}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, x: Number(e.target.value) } } : null
                        )
                      }
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">y</label>
                    <input
                      type="number"
                      value={String(editingStep.config.y ?? 0)}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, y: Number(e.target.value) } } : null
                        )
                      }
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const coords = await window.electronAPI.picker.coordinate();
                    if (coords) {
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, x: coords.x, y: coords.y } } : null
                      );
                    }
                  }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
                >
                  🎯 Pick from Screen
                </button>
                <p className="text-xs text-gray-500">
                  Click "Pick from Screen" to open an overlay — then click anywhere on screen to capture absolute screen coordinates.
                </p>
              </>
            ) : editingStep.step.step_type === 'keyboard_shortcut' ? (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">keyboard shortcut</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={String(editingStep.config.keys ?? '')}
                      placeholder="Click here and press keys…"
                      onKeyDown={(e) => {
                        e.preventDefault();
                        const parts: string[] = [];
                        if (e.ctrlKey) parts.push('ctrl');
                        if (e.altKey) parts.push('alt');
                        if (e.shiftKey) parts.push('shift');
                        if (e.metaKey) parts.push('win');
                        const KEY_MAP: Record<string, string> = {
                          Control: '', Alt: '', Shift: '', Meta: '',
                          ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                          Escape: 'esc', Enter: 'enter', Tab: 'tab', Delete: 'delete',
                          Backspace: 'backspace', Insert: 'insert', Home: 'home', End: 'end',
                          PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space',
                          F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
                          F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
                        };
                        const mappedKey = e.key in KEY_MAP ? KEY_MAP[e.key] : e.key.toLowerCase();
                        if (mappedKey) parts.push(mappedKey);
                        if (parts.length > 0) {
                          setEditingStep((prev) =>
                            prev ? { ...prev, config: { ...prev.config, keys: parts.join('+') } } : null
                          );
                        }
                      }}
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 cursor-pointer font-mono"
                    />
                    <button
                      onClick={() =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, keys: '' } } : null
                        )
                      }
                      className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-sm"
                    >
                      Clear
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Click the field and press your desired key combination (e.g. Ctrl+C, Alt+F4, Ctrl+Shift+S).
                  </p>
                </div>
              </>
            ) : (
              Object.entries(editingStep.config).filter(([key]) => key !== 'delay').map(([key, value]) => (
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
              ))
            )}
            {/* Delay field shown for all step types */}
            <div className="border-t border-gray-600 pt-3">
              <label className="block text-sm text-gray-400 mb-1">delay (ms)</label>
              <input
                type="number"
                value={String(editingStep.config.delay ?? 60)}
                onChange={(e) =>
                  setEditingStep((prev) =>
                    prev ? { ...prev, config: { ...prev.config, delay: Number(e.target.value) } } : null
                  )
                }
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Delay in milliseconds after this step executes. Default: 60</p>
            </div>
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
