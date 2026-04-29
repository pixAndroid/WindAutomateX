import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Task, TaskStep, StepType } from '../../shared/types';
import StepCard from '../components/StepCard';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';

const ACTION_TYPE_COLORS: Record<string, { border: string; label: string }> = {
  coordinate: { border: 'border-purple-500', label: 'text-purple-400' },
  keyboard:   { border: 'border-yellow-500', label: 'text-yellow-400' },
  type_text:  { border: 'border-green-500',  label: 'text-green-400'  },
  delay:      { border: 'border-orange-500', label: 'text-orange-400' },
  tick_vr:    { border: 'border-teal-500',   label: 'text-teal-400'   },
};

const ALL_STEP_TYPES: StepType[] = [
  'launch_exe', 'wait_window', 'click_element', 'click_coordinate',
  'double_click_coordinate', 'right_click_coordinate', 'master_click_coordinate',
  'type_text', 'press_key', 'keyboard_shortcut', 'select_dropdown', 'upload_file',
  'download_file', 'wait_download', 'wait_upload', 'read_text',
  'if_condition', 'loop', 'delay', 'screenshot', 'close_app', 'kill_process',
  'excel_form_submit_loop', 'detect_image', 'run_task', 'switch_window', 'watch_popup',
  'tick_checkboxes_by_vr',
];

const defaultConfig: Record<StepType, Record<string, unknown>> = {
  launch_exe: { path: '', args: '', delay: 60 },
  wait_window: { window_title: '', timeout: 30, delay: 60 },
  click_element: { window_title: '', element_title: '', auto_id: '', delay: 60 },
  click_coordinate: { x: 0, y: 0, delay: 60 },
  double_click_coordinate: { x: 0, y: 0, delay: 60 },
  right_click_coordinate: { x: 0, y: 0, delay: 60 },
  master_click_coordinate: { x: 0, y: 0, click_type: 'left', delay: 60 },
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
  excel_form_submit_loop: {
    filePath: '',
    sheetName: 'Sheet1',
    hasHeader: true,
    startRow: 2,
    endRow: null,
    mappings: [] as { column: string; selector: string; inputType: string }[],
    submitActions: [] as { type: string; value: string }[],
    waitAfterSubmit: 1500,
    successText: '',
    clearFormBeforeNextRow: false,
    continueOnError: true,
    retryCount: 2,
    delayBetweenRows: 1000,
    saveScreenshotOnFailure: false,
    resumeFromLastRow: false,
    delay: 60,
  },
  detect_image: { template_path: '', threshold: 0.85, output_var: 'detected', on_success_task_id: '', on_failure_task_id: '', delay: 60 },
  run_task: { task_id: '', delay: 60 },
  switch_window: { window_title: '', timeout: 10, delay: 60 },
  watch_popup: {
    enabled: true,
    poll_interval_ms: 300,
    rules: [] as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[],
    delay: 60,
  },
  tick_checkboxes_by_vr: {
    vrColumn: '',
    windowTitle: '',
    gridRoi: '',
    scrollX: 0,
    scrollY: 0,
    maxScrollAttempts: 20,
    scrollStep: 3,
    checkboxOffset: 25,
    delay: 60,
  },
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
  const [dragActionIndex, setDragActionIndex] = useState<number | null>(null);
  const [dragOverActionIndex, setDragOverActionIndex] = useState<number | null>(null);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [stepTypes, setStepTypes] = useState<StepType[]>(() => {
    try {
      const saved = localStorage.getItem('stepTypeOrder');
      if (saved) {
        const parsed: StepType[] = JSON.parse(saved);
        // Merge: keep saved order, append any new types not yet saved
        const merged = parsed.filter((t) => ALL_STEP_TYPES.includes(t));
        ALL_STEP_TYPES.forEach((t) => { if (!merged.includes(t)) merged.push(t); });
        return merged;
      }
    } catch { /* ignore */ }
    return ALL_STEP_TYPES;
  });
  const [dragTypeIndex, setDragTypeIndex] = useState<number | null>(null);
  const [dragOverTypeIndex, setDragOverTypeIndex] = useState<number | null>(null);

  useEffect(() => {
    window.electronAPI.tasks.list().then(setAllTasks).catch(() => setAllTasks([]));
  }, []);

  useEffect(() => {
    localStorage.setItem('stepTypeOrder', JSON.stringify(stepTypes));
  }, [stepTypes]);

  const getStepTypeLabel = (t: StepType): string => {
    if (t === 'excel_form_submit_loop') return 'Excel Form Submit Loop (Business Automation)';
    if (t === 'detect_image') return 'Detect Image (Window/Screen)';
    if (t === 'run_task') return 'Run Linked Task';
    if (t === 'switch_window') return 'Switch Window';
    if (t === 'watch_popup') return 'Watch Popup (Realtime Dialog Watcher)';
    if (t === 'double_click_coordinate') return 'Double Click Coordinates';
    if (t === 'right_click_coordinate') return 'Right Click Coordinates';
    if (t === 'master_click_coordinate') return 'Master Click Coordinates';
    return t.replace(/_/g, ' ');
  };

  const handleTypeDragStart = (index: number) => {
    setDragTypeIndex(index);
  };

  const handleTypeDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverTypeIndex !== index) setDragOverTypeIndex(index);
  };

  const handleTypeDrop = (dropIndex: number) => {
    if (dragTypeIndex === null || dragTypeIndex === dropIndex) {
      setDragTypeIndex(null);
      setDragOverTypeIndex(null);
      return;
    }
    setStepTypes((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragTypeIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
    setDragTypeIndex(null);
    setDragOverTypeIndex(null);
  };

  const handleTypeDragEnd = () => {
    setDragTypeIndex(null);
    setDragOverTypeIndex(null);
  };

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

  useEffect(() => {
    if (editingStep?.step.step_type !== 'excel_form_submit_loop') {
      setExcelColumns([]);
      return;
    }
    const filePath = String(editingStep.config.filePath ?? '').trim();
    if (!filePath) {
      setExcelColumns([]);
      return;
    }
    const sheetName = String(editingStep.config.sheetName ?? 'Sheet1');
    window.electronAPI.dialog.readExcelHeaders(filePath, sheetName).then(setExcelColumns).catch(() => setExcelColumns([]));
  }, [editingStep?.config?.filePath, editingStep?.config?.sheetName, editingStep?.step.step_type]);

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
    // Migrate old submitSelector to submitActions for excel_form_submit_loop
    if (step.step_type === 'excel_form_submit_loop' && config.submitSelector !== undefined && !Array.isArray(config.submitActions)) {
      const sel = String(config.submitSelector ?? '').trim();
      if (sel) {
        // Detect if it looks like "x,y" coordinates; otherwise treat as element selector → coordinate pick placeholder
        const isCoord = /^-?\d+\s*,\s*-?\d+$/.test(sel);
        config.submitActions = [{ type: isCoord ? 'coordinate' : 'coordinate', value: sel }];
      } else {
        config.submitActions = [];
      }
      delete config.submitSelector;
    }
    if (step.step_type === 'excel_form_submit_loop' && !Array.isArray(config.submitActions)) {
      config.submitActions = [];
    }
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
        {/* Step Type Picker */}
        <div className="w-56 flex flex-col flex-shrink-0">
          <p className="text-xs text-gray-500 mb-1 select-none">Action types — drag to reorder</p>
          <div className="flex-1 overflow-y-auto bg-gray-800 rounded-lg border border-gray-700">
            {stepTypes.map((t, ti) => (
              <div
                key={t}
                draggable
                onDragStart={() => handleTypeDragStart(ti)}
                onDragOver={(e) => handleTypeDragOver(e, ti)}
                onDrop={() => handleTypeDrop(ti)}
                onDragEnd={handleTypeDragEnd}
                onClick={() => setSelectedStepType(t)}
                className={[
                  'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none text-sm border-l-2 transition-colors',
                  selectedStepType === t
                    ? 'bg-blue-600 text-white border-blue-400'
                    : 'text-gray-300 hover:bg-gray-700 border-transparent',
                  dragTypeIndex === ti ? 'opacity-40' : 'opacity-100',
                  dragOverTypeIndex === ti && dragTypeIndex !== ti ? 'border-l-blue-400 bg-gray-700' : '',
                ].join(' ')}
              >
                <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" className="flex-shrink-0 opacity-40">
                  <circle cx="2" cy="2"  r="1"/>
                  <circle cx="6" cy="2"  r="1"/>
                  <circle cx="2" cy="6"  r="1"/>
                  <circle cx="6" cy="6"  r="1"/>
                  <circle cx="2" cy="10" r="1"/>
                  <circle cx="6" cy="10" r="1"/>
                </svg>
                <span className="truncate">{getStepTypeLabel(t)}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleAddStep}
            className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap w-full"
          >
            + Add Step
          </button>
        </div>

        {/* Steps Panel */}
        <div className="flex-1 flex flex-col">
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
            ) : editingStep.step.step_type === 'double_click_coordinate' ? (
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
                  Performs a double-click at the specified coordinates. Click "Pick from Screen" to capture the position.
                </p>
              </>
            ) : editingStep.step.step_type === 'right_click_coordinate' ? (
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
                  Performs a right-click at the specified coordinates. Click "Pick from Screen" to capture the position.
                </p>
              </>
            ) : editingStep.step.step_type === 'master_click_coordinate' ? (
              <>
                {/* Click Type selector */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Click Type</label>
                  <select
                    value={String(editingStep.config.click_type ?? 'left')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, click_type: e.target.value } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="left">Left Click (single)</option>
                    <option value="right">Right Click</option>
                    <option value="double">Double Click</option>
                  </select>
                </div>
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
                  Master click handles all click types — left (single), right, or double — at the specified coordinates. Click "Pick from Screen" to capture the position.
                </p>
              </>
            ) : editingStep.step.step_type === 'keyboard_shortcut' ? (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Keyboard Shortcut</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={String(editingStep.config.keys ?? '')}
                      placeholder="Click here and press keys… or type manually (e.g. alt+tab)"
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, keys: e.target.value } } : null
                        )
                      }
                      onKeyDown={(e) => {
                        // Allow normal typing (e.g. manual "alt+tab") when no modifier except shift is held,
                        // or when the key itself is a printable character typed without modifiers.
                        // Auto-capture combos when a modifier (ctrl/alt/meta) is involved.
                        const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
                        const KEY_MAP: Record<string, string> = {
                          // Modifier-only keys are handled via e.ctrlKey/altKey/shiftKey/metaKey above;
                          // map them to '' so they are filtered out and don't appear as a trailing key.
                          Control: '', Alt: '', Shift: '', Meta: '',
                          ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                          Escape: 'esc', Enter: 'enter', Tab: 'tab', Delete: 'delete',
                          Backspace: 'backspace', Insert: 'insert', Home: 'home', End: 'end',
                          PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space',
                          F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
                          F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
                        };
                        const isSpecialKey = e.key in KEY_MAP && KEY_MAP[e.key] !== '';
                        // Auto-capture when a modifier key is held or a special key is pressed alone
                        if (hasModifier || isSpecialKey) {
                          e.preventDefault();
                          const parts: string[] = [];
                          if (e.ctrlKey) parts.push('ctrl');
                          if (e.altKey) parts.push('alt');
                          if (e.shiftKey) parts.push('shift');
                          if (e.metaKey) parts.push('win');
                          const mappedKey = e.key in KEY_MAP ? KEY_MAP[e.key] : e.key.toLowerCase();
                          if (mappedKey) parts.push(mappedKey);
                          if (parts.length > 0) {
                            setEditingStep((prev) =>
                              prev ? { ...prev, config: { ...prev.config, keys: parts.join('+') } } : null
                            );
                          }
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
                    Press a key combination to auto-capture (e.g. Ctrl+C, Alt+F4, Ctrl+Shift+S), or type it manually for OS-level shortcuts like Alt+Tab.
                  </p>
                </div>
              </>
            ) : editingStep.step.step_type === 'excel_form_submit_loop' ? (
              <>
                {/* ── Data Source ── */}
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Data Source</p>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">File Path (xlsx / csv)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={String(editingStep.config.filePath ?? '')}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, filePath: e.target.value } } : null)}
                      placeholder="C:\data\customers.xlsx"
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={async () => {
                        const fp = await window.electronAPI.dialog.openExcelFile();
                        if (fp) {
                          setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, filePath: fp } } : null);
                          const sheetName = String(editingStep?.config.sheetName ?? 'Sheet1');
                          window.electronAPI.dialog.readExcelHeaders(fp, sheetName).then(setExcelColumns).catch(() => setExcelColumns([]));
                        }
                      }}
                      className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-sm whitespace-nowrap"
                    >
                      Browse…
                    </button>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Sheet Name</label>
                    <input
                      type="text"
                      value={String(editingStep.config.sheetName ?? 'Sheet1')}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, sheetName: e.target.value } } : null)}
                      placeholder="Sheet1"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Start Row</label>
                    <input
                      type="number"
                      value={String(editingStep.config.startRow ?? 2)}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, startRow: Number(e.target.value) } } : null)}
                      min={1}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">End Row (optional)</label>
                    <input
                      type="number"
                      value={editingStep.config.endRow != null ? String(editingStep.config.endRow) : ''}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, endRow: e.target.value === '' ? null : Number(e.target.value) } } : null)}
                      placeholder="Leave empty for all"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingStep.config.hasHeader)}
                    onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, hasHeader: e.target.checked } } : null)}
                    className="accent-blue-500"
                  />
                  Has Header Row
                </label>

                {/* ── Field Mappings ── */}
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider pt-1">Field Mappings</p>
                {excelColumns.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {excelColumns.length} columns detected — click the Excel Column field to pick a column.
                  </p>
                )}
                <div className="space-y-2">
                  {(editingStep.config.mappings as { column: string; selector: string; inputType: string }[]).map((m, mi) => (
                    <div key={mi} className="flex flex-col gap-1">
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          list={`excel-cols-mapping-${mi}`}
                          value={m.column}
                          onChange={(e) => {
                            const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[])];
                            mappings[mi] = { ...mappings[mi], column: e.target.value };
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                          }}
                          placeholder={excelColumns.length > 0 ? 'Pick or type column name…' : 'Excel Column'}
                          className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                        {excelColumns.length > 0 && (
                          <datalist id={`excel-cols-mapping-${mi}`}>
                            {excelColumns.map((col) => <option key={col} value={col} />)}
                          </datalist>
                        )}
                        <select
                          value={m.inputType}
                          onChange={(e) => {
                            const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[])];
                            mappings[mi] = { ...mappings[mi], inputType: e.target.value, selector: '' };
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                          }}
                          className="bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        >
                          <option value="text">text</option>
                          <option value="dropdown">dropdown</option>
                          <option value="checkbox">checkbox</option>
                          <option value="coordinate">coordinate</option>
                        </select>
                        <button
                          onClick={() => {
                            const mappings = (editingStep.config.mappings as { column: string; selector: string; inputType: string }[]).filter((_, i) => i !== mi);
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                          }}
                          className="text-red-400 hover:text-red-300 px-1 text-sm"
                          title="Remove mapping"
                        >
                          ✕
                        </button>
                      </div>
                      {m.inputType === 'coordinate' ? (
                        <div className="flex gap-2 items-center pl-1">
                          <input
                            type="number"
                            value={m.selector ? (parseInt(m.selector.split(',')[0], 10) || 0) : 0}
                            onChange={(e) => {
                              const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[])];
                              const parts = (mappings[mi].selector || '0,0').split(',');
                              parts[0] = e.target.value;
                              mappings[mi] = { ...mappings[mi], selector: parts.join(',') };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                            }}
                            placeholder="X"
                            className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          <input
                            type="number"
                            value={m.selector ? (parseInt(m.selector.split(',')[1] ?? '0', 10) || 0) : 0}
                            onChange={(e) => {
                              const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[])];
                              const parts = (mappings[mi].selector || '0,0').split(',');
                              parts[1] = e.target.value;
                              mappings[mi] = { ...mappings[mi], selector: parts.join(',') };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                            }}
                            placeholder="Y"
                            className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={async () => {
                              const coords = await window.electronAPI.picker.coordinate();
                              if (coords) {
                                const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[])];
                                mappings[mi] = { ...mappings[mi], selector: `${coords.x},${coords.y}` };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                              }
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 whitespace-nowrap"
                          >
                            🎯 Pick
                          </button>
                          <span className="text-xs text-gray-500">
                            {m.selector ? `(${m.selector})` : 'not set'}
                          </span>
                        </div>
                      ) : (
                        <div className="pl-1">
                          <input
                            type="text"
                            value={m.selector}
                            onChange={(e) => {
                              const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[])];
                              mappings[mi] = { ...mappings[mi], selector: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                            }}
                            placeholder="Field Selector (auto_id or title)"
                            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const mappings = [...(editingStep.config.mappings as { column: string; selector: string; inputType: string }[]), { column: '', selector: '', inputType: 'text' }];
                      setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, mappings } } : null);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    + Add Mapping
                  </button>
                </div>

                {/* ── Submit Actions ── */}
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider pt-1">Submit Actions</p>
                <div className="space-y-2">
                  {(editingStep.config.submitActions as { type: string; value: string }[]).map((action, ai) => (
                    <div
                      key={ai}
                      draggable
                      onDragStart={() => setDragActionIndex(ai)}
                      onDragOver={(e) => { e.preventDefault(); if (dragOverActionIndex !== ai) setDragOverActionIndex(ai); }}
                      onDrop={() => {
                        if (dragActionIndex === null || dragActionIndex === ai) return;
                        const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                        const [moved] = submitActions.splice(dragActionIndex, 1);
                        submitActions.splice(ai, 0, moved);
                        setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                        setDragActionIndex(null);
                        setDragOverActionIndex(null);
                      }}
                      onDragEnd={() => { setDragActionIndex(null); setDragOverActionIndex(null); }}
                      className={[
                        'flex flex-col gap-1 bg-gray-750 rounded-lg p-2 border cursor-grab active:cursor-grabbing transition-opacity',
                        dragActionIndex === ai ? 'opacity-40' : 'opacity-100',
                        dragOverActionIndex === ai && dragActionIndex !== ai
                          ? 'border-blue-500'
                          : (ACTION_TYPE_COLORS[action.type]?.border ?? 'border-gray-600'),
                      ].join(' ')}
                    >
                      <div className="flex gap-2 items-center">
                        <span className="text-gray-500 text-xs select-none" aria-label="Drag to reorder">⠿</span>
                        <select
                          value={action.type}
                          onChange={(e) => {
                            const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                            submitActions[ai] = { type: e.target.value, value: '' };
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                          }}
                          className="bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        >
                          <option value="coordinate">Coordinate Click</option>
                          <option value="keyboard">Keyboard Shortcut</option>
                          <option value="type_text">Type Text (Column Value)</option>
                          <option value="delay">Delay</option>
                          <option value="tick_vr">Tick Checkboxes by VR Nos (Excel)</option>
                        </select>
                        <span className={`text-xs flex-1 font-semibold ${ACTION_TYPE_COLORS[action.type]?.label ?? 'text-gray-500'}`}>Action {ai + 1}</span>
                        <button
                          onClick={() => {
                            const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                            submitActions.splice(ai + 1, 0, { ...submitActions[ai] });
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                          }}
                          className="text-green-400 hover:text-green-300 px-1 text-sm"
                          aria-label="Copy action"
                          title="Copy action"
                        >
                          📋
                        </button>
                        <button
                          onClick={() => {
                            const submitActions = (editingStep.config.submitActions as { type: string; value: string }[]).filter((_, i) => i !== ai);
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                          }}
                          className="text-red-400 hover:text-red-300 px-1 text-sm"
                          title="Remove action"
                        >
                          ✕
                        </button>
                      </div>
                      {action.type === 'coordinate' ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="number"
                            value={action.value ? (parseInt(action.value.split(',')[0], 10) || 0) : 0}
                            onChange={(e) => {
                              const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                              const parts = (submitActions[ai].value || '0,0').split(',');
                              parts[0] = e.target.value;
                              submitActions[ai] = { ...submitActions[ai], value: parts.join(',') };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                            }}
                            placeholder="X"
                            className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          <input
                            type="number"
                            value={action.value ? (parseInt(action.value.split(',')[1] ?? '0', 10) || 0) : 0}
                            onChange={(e) => {
                              const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                              const parts = (submitActions[ai].value || '0,0').split(',');
                              parts[1] = e.target.value;
                              submitActions[ai] = { ...submitActions[ai], value: parts.join(',') };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                            }}
                            placeholder="Y"
                            className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={async () => {
                              const coords = await window.electronAPI.picker.coordinate();
                              if (coords) {
                                const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                                submitActions[ai] = { ...submitActions[ai], value: `${coords.x},${coords.y}` };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                              }
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 whitespace-nowrap"
                          >
                            🎯 Pick
                          </button>
                          <span className="text-xs text-gray-500">
                            {action.value ? `(${action.value})` : 'not set'}
                          </span>
                        </div>
                      ) : action.type === 'type_text' ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            list={`excel-cols-action-${ai}`}
                            value={action.value}
                            onChange={(e) => {
                              const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                              submitActions[ai] = { ...submitActions[ai], value: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                            }}
                            placeholder={excelColumns.length > 0 ? 'Pick column to type…' : 'Column name'}
                            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          {excelColumns.length > 0 && (
                            <datalist id={`excel-cols-action-${ai}`}>
                              {excelColumns.map((col) => <option key={col} value={col} />)}
                            </datalist>
                          )}
                        </div>
                      ) : action.type === 'delay' ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="number"
                            min={0}
                            value={action.value === '' ? '' : Number(action.value) || 0}
                            onChange={(e) => {
                              const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                              submitActions[ai] = { ...submitActions[ai], value: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                            }}
                            placeholder="1000"
                            className="w-32 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          <span className="text-xs text-gray-400">ms</span>
                        </div>
                      ) : action.type === 'tick_vr' ? (
                        <div className="flex flex-col gap-2">
                          {/* VR Column */}
                          <div className="flex gap-2 items-center">
                            <label className="text-xs text-gray-400 w-28 shrink-0">VR Column</label>
                            <input
                              type="text"
                              list={`excel-cols-vr-action-${ai}`}
                              value={action.value}
                              onChange={(e) => {
                                const submitActions = [...(editingStep.config.submitActions as { type: string; value: string; [key: string]: unknown }[])];
                                submitActions[ai] = { ...submitActions[ai], value: e.target.value };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                              }}
                              placeholder={excelColumns.length > 0 ? 'Pick column…' : 'Column name'}
                              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                            />
                            {excelColumns.length > 0 && (
                              <datalist id={`excel-cols-vr-action-${ai}`}>
                                {excelColumns.map((col) => <option key={col} value={col} />)}
                              </datalist>
                            )}
                          </div>
                          {/* Item Code Column */}
                          <div className="flex gap-2 items-center">
                            <label className="text-xs text-gray-400 w-28 shrink-0">Item Code Column</label>
                            <input
                              type="text"
                              list={`excel-cols-item-code-action-${ai}`}
                              value={String((action as { type: string; value: string; itemCodeColumn?: string }).itemCodeColumn ?? '')}
                              onChange={(e) => {
                                const submitActions = [...(editingStep.config.submitActions as { type: string; value: string; [key: string]: unknown }[])];
                                submitActions[ai] = { ...submitActions[ai], itemCodeColumn: e.target.value };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                              }}
                              placeholder={excelColumns.length > 0 ? 'Pick column…' : 'Column name (optional)'}
                              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                            />
                            {excelColumns.length > 0 && (
                              <datalist id={`excel-cols-item-code-action-${ai}`}>
                                {excelColumns.map((col) => <option key={col} value={col} />)}
                              </datalist>
                            )}
                          </div>
                          {/* Window Title */}
                          <div className="flex gap-2 items-center">
                            <label className="text-xs text-gray-400 w-28 shrink-0">Window Title</label>
                            <input
                              type="text"
                              value={String((action as { type: string; value: string; windowTitle?: string }).windowTitle ?? '')}
                              onChange={(e) => {
                                const submitActions = [...(editingStep.config.submitActions as { type: string; value: string; [key: string]: unknown }[])];
                                submitActions[ai] = { ...submitActions[ai], windowTitle: e.target.value };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                              }}
                              placeholder="e.g. My SAP Grid (blank = active window)"
                              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                            />
                          </div>
                          {/* Grid ROI */}
                          <div className="flex gap-2 items-center">
                            <label className="text-xs text-gray-400 w-28 shrink-0">Grid ROI</label>
                            <input
                              type="text"
                              value={String((action as { type: string; value: string; gridRoi?: string }).gridRoi ?? '')}
                              onChange={(e) => {
                                const submitActions = [...(editingStep.config.submitActions as { type: string; value: string; [key: string]: unknown }[])];
                                submitActions[ai] = { ...submitActions[ai], gridRoi: e.target.value };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                              }}
                              placeholder="x,y,w,h (blank = full screen)"
                              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-teal-500"
                            />
                          </div>
                          {/* Scroll & offset row */}
                          <div className="flex gap-2 flex-wrap">
                            {([
                              { key: 'scrollX', label: 'Scroll X', placeholder: '0' },
                              { key: 'scrollY', label: 'Scroll Y', placeholder: '0' },
                              { key: 'maxScrollAttempts', label: 'Max Scroll', placeholder: '20' },
                              { key: 'scrollStep', label: 'Scroll Step', placeholder: '3' },
                              { key: 'checkboxOffset', label: 'CB Offset', placeholder: '40' },
                            ] as { key: string; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                              <div key={key} className="flex flex-col gap-0.5">
                                <label className="text-xs text-gray-500">{label}</label>
                                <input
                                  type="number"
                                  value={String((action as Record<string, unknown>)[key] ?? '')}
                                  onChange={(e) => {
                                    const submitActions = [...(editingStep.config.submitActions as { type: string; value: string; [key: string]: unknown }[])];
                                    submitActions[ai] = { ...submitActions[ai], [key]: e.target.value === '' ? '' : Number(e.target.value) };
                                    setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                                  }}
                                  placeholder={placeholder}
                                  className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={action.value}
                            onChange={(e) => {
                              const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                              submitActions[ai] = { ...submitActions[ai], value: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                            }}
                            onKeyDown={(e) => {
                              const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
                              const KEY_MAP: Record<string, string> = {
                                Control: '', Alt: '', Shift: '', Meta: '',
                                ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                                Escape: 'esc', Enter: 'enter', Tab: 'tab', Delete: 'delete',
                                Backspace: 'backspace', Insert: 'insert', Home: 'home', End: 'end',
                                PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space',
                                F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
                                F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
                              };
                              const isSpecialKey = e.key in KEY_MAP && KEY_MAP[e.key] !== '';
                              if (hasModifier || isSpecialKey) {
                                e.preventDefault();
                                const parts: string[] = [];
                                if (e.ctrlKey) parts.push('ctrl');
                                if (e.altKey) parts.push('alt');
                                if (e.shiftKey) parts.push('shift');
                                if (e.metaKey) parts.push('win');
                                const mappedKey = e.key in KEY_MAP ? KEY_MAP[e.key] : e.key.toLowerCase();
                                if (mappedKey) parts.push(mappedKey);
                                if (parts.length > 0) {
                                  const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                                  submitActions[ai] = { ...submitActions[ai], value: parts.join('+') };
                                  setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                                }
                              }
                            }}
                            placeholder="Press keys or type manually (e.g. enter, ctrl+s)"
                            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 font-mono cursor-pointer"
                          />
                          <button
                            onClick={() => {
                              const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[])];
                              submitActions[ai] = { ...submitActions[ai], value: '' };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                            }}
                            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1.5 rounded-lg text-xs"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const submitActions = [...(editingStep.config.submitActions as { type: string; value: string }[]), { type: 'coordinate', value: '' }];
                      setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, submitActions } } : null);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    + Add Submit Action
                  </button>
                  <p className="text-xs text-gray-500">
                    Add coordinate clicks, keyboard shortcuts, "Type Text (Column Value)", "Delay", or "Tick Checkboxes by VR Nos (Excel)" actions to execute when submitting each row.
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Wait After Submit (ms)</label>
                    <input
                      type="number"
                      value={String(editingStep.config.waitAfterSubmit ?? 1500)}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, waitAfterSubmit: Number(e.target.value) } } : null)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Success Text (optional)</label>
                    <input
                      type="text"
                      value={String(editingStep.config.successText ?? '')}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, successText: e.target.value } } : null)}
                      placeholder="e.g. Submitted successfully"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingStep.config.clearFormBeforeNextRow)}
                    onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, clearFormBeforeNextRow: e.target.checked } } : null)}
                    className="accent-blue-500"
                  />
                  Clear Form Before Next Row
                </label>

                {/* ── Error Handling ── */}
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider pt-1">Error Handling</p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Retry Count</label>
                    <input
                      type="number"
                      value={String(editingStep.config.retryCount ?? 2)}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, retryCount: Number(e.target.value) } } : null)}
                      min={0}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Delay Between Rows (ms)</label>
                    <input
                      type="number"
                      value={String(editingStep.config.delayBetweenRows ?? 1000)}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, delayBetweenRows: Number(e.target.value) } } : null)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingStep.config.continueOnError)}
                    onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, continueOnError: e.target.checked } } : null)}
                    className="accent-blue-500"
                  />
                  Continue On Error
                </label>

                {/* ── Advanced ── */}
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider pt-1">Advanced</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingStep.config.saveScreenshotOnFailure)}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, saveScreenshotOnFailure: e.target.checked } } : null)}
                      className="accent-blue-500"
                    />
                    Save Screenshot On Failure
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingStep.config.resumeFromLastRow)}
                      onChange={(e) => setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, resumeFromLastRow: e.target.checked } } : null)}
                      className="accent-blue-500"
                    />
                    Resume From Last Processed Row
                  </label>
                </div>
              </>
            ) : editingStep.step.step_type === 'detect_image' ? (
              <>
                {/* Template Image */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Template Image</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={String(editingStep.config.template_path ?? '')}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, template_path: e.target.value } } : null
                        )
                      }
                      placeholder="C:\screenshots\expected_window.png"
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={async () => {
                        const fp = await window.electronAPI.dialog.openImageFile();
                        if (fp) {
                          setEditingStep((prev) =>
                            prev ? { ...prev, config: { ...prev.config, template_path: fp } } : null
                          );
                        }
                      }}
                      className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-sm whitespace-nowrap"
                    >
                      Browse…
                    </button>
                    <button
                      onClick={async () => {
                        const fp = await window.electronAPI.picker.captureScreen();
                        if (fp) {
                          setEditingStep((prev) =>
                            prev ? { ...prev, config: { ...prev.config, template_path: fp } } : null
                          );
                        }
                      }}
                      title="Choose a save location, then the window minimizes for 3 s so you can navigate to the target screen before the screenshot is taken."
                      className="bg-blue-700 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm whitespace-nowrap"
                    >
                      📸 Capture
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Browse for an existing PNG/JPG, or click <strong className="text-gray-400">📸 Capture</strong> to screenshot the target screen now (window minimizes for 3 s so you can navigate to it first).
                  </p>
                </div>

                {/* Threshold */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Match Threshold: {Number(editingStep.config.threshold ?? 0.85).toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={1.0}
                    step={0.01}
                    value={Number(editingStep.config.threshold ?? 0.85)}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, threshold: Number(e.target.value) } } : null
                      )
                    }
                    className="w-full accent-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Confidence level for a positive match (0.50–1.00). Default: 0.85. Higher = stricter.
                  </p>
                </div>

                {/* Output variable */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Output Variable (optional)</label>
                  <input
                    type="text"
                    value={String(editingStep.config.output_var ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, output_var: e.target.value } } : null
                      )
                    }
                    placeholder="e.g. detected"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    If set, stores <code className="text-gray-400">true</code> or <code className="text-gray-400">false</code> in this variable so an <em>if_condition</em> step can branch on the result.
                  </p>
                </div>

                {/* Search region (optional) */}
                <div>
                  <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Search Region (optional — leave at 0 for full screen)</p>
                  <div className="grid grid-cols-4 gap-2">
                    {(['x', 'y', 'width', 'height'] as const).map((field) => (
                      <div key={field}>
                        <label className="block text-xs text-gray-400 mb-1">{field}</label>
                        <input
                          type="number"
                          value={String(
                            (editingStep.config.region as Record<string, number> | undefined)?.[field] ?? 0
                          )}
                          onChange={(e) => {
                            const region = {
                              ...((editingStep.config.region as Record<string, number>) ?? {}),
                              [field]: Number(e.target.value),
                            };
                            setEditingStep((prev) =>
                              prev ? { ...prev, config: { ...prev.config, region } } : null
                            );
                          }}
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Restrict template search to this screen region. Width and Height must be &gt; 0 to apply.
                  </p>
                </div>

                {/* On Success / On Failure task linking */}
                <div>
                  <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">On Success — Run Task (optional)</p>
                  <select
                    value={String(editingStep.config.on_success_task_id ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, on_success_task_id: e.target.value } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                  >
                    <option value="">— None —</option>
                    {allTasks
                      .filter((t) => String(t.id) !== id)
                      .map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name} (#{t.id})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Task to run when the image <strong className="text-gray-400">is found</strong>. Leave blank to continue to the next step.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">On Failure — Run Task (optional)</p>
                  <select
                    value={String(editingStep.config.on_failure_task_id ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, on_failure_task_id: e.target.value } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                  >
                    <option value="">— None —</option>
                    {allTasks
                      .filter((t) => String(t.id) !== id)
                      .map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name} (#{t.id})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Task to run when the image is <strong className="text-gray-400">not found</strong>. Leave blank to continue to the next step.
                  </p>
                </div>
              </>
            ) : editingStep.step.step_type === 'switch_window' ? (
              <>
                <p className="text-xs text-gray-400 bg-gray-750 border border-gray-600 rounded-lg px-3 py-2">
                  🔄 <strong className="text-white">Switch Window</strong> brings a running application to the foreground so subsequent steps can interact with it.
                  Use this to switch from Chrome to File Explorer, or from any app to another.
                </p>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Window Title</label>
                  <input
                    type="text"
                    value={String(editingStep.config.window_title ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, window_title: e.target.value } } : null
                      )
                    }
                    placeholder="e.g. File Explorer, Chrome, Notepad, Calculator"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the full or partial title of the target window. For example, type <code className="text-gray-400">File Explorer</code> to switch to Windows Explorer, or <code className="text-gray-400">Chrome</code> to switch to Google Chrome.
                    The match is case-insensitive and partial — any visible window whose title <em>contains</em> this text will be focused.
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Timeout (seconds)</label>
                  <input
                    type="number"
                    min={1}
                    value={String(editingStep.config.timeout ?? 10)}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, timeout: Number(e.target.value) } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    How long (in seconds) to wait for the target window to appear before failing. Default: 10. Useful when the app is still loading.
                  </p>
                </div>
              </>
            ) : editingStep.step.step_type === 'run_task' ? (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Linked Task</label>
                  <select
                    value={String(editingStep.config.task_id ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, task_id: e.target.value } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">— Select a task —</option>
                    {allTasks
                      .filter((t) => String(t.id) !== id)
                      .map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name} (#{t.id})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    When this step runs the selected task will execute completely before the parent task continues to the next step.
                  </p>
                </div>
              </>
            ) : editingStep.step.step_type === 'watch_popup' ? (
              <>
                <p className="text-xs text-gray-400 bg-gray-750 border border-blue-700 rounded-lg px-3 py-2">
                  👁 <strong className="text-white">Watch Popup</strong> starts a background watcher that monitors for
                  specific dialog windows by title/text using UI Automation (pywinauto). Place this step early in your
                  task so the watcher runs for the entire task duration. It stops automatically when the task ends.
                </p>

                {/* Enabled toggle */}
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingStep.config.enabled ?? true)}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, enabled: e.target.checked } } : null
                      )
                    }
                    className="accent-blue-500"
                  />
                  Enable Popup Watcher
                </label>

                {/* Poll interval */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Poll Interval (ms)</label>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={String(editingStep.config.poll_interval_ms ?? 300)}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, poll_interval_ms: Number(e.target.value) } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    How often (in ms) to check for popup windows. Default: 300 ms. Lower = faster detection, slightly more CPU.
                  </p>
                </div>

                {/* Rules */}
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider pt-1">Popup Rules</p>
                <div className="space-y-3">
                  {(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[]).map((rule, ri) => (
                    <div key={ri} className="bg-gray-700 rounded-lg p-3 space-y-2 border border-gray-600">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-300">Rule {ri + 1}</span>
                        <button
                          onClick={() => {
                            const rules = (editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[]).filter((_, i) => i !== ri);
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                          }}
                          className="text-red-400 hover:text-red-300 text-sm px-1"
                          title="Remove rule"
                        >✕</button>
                      </div>

                      <div>
                        <label htmlFor={`rule-title-${ri}`} className="block text-xs text-gray-400 mb-1">Window Title Contains <span className="text-red-400">*</span></label>
                        <input
                          id={`rule-title-${ri}`}
                          type="text"
                          value={rule.title_substring ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEditingStep((prev) => {
                              if (!prev) return null;
                              const rules = [...(prev.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], title_substring: value };
                              return { ...prev, config: { ...prev.config, rules } };
                            });
                          }}
                          placeholder='e.g. Idle timer expired'
                          className="w-full bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label htmlFor={`rule-text-${ri}`} className="block text-xs text-gray-400 mb-1">Message/Text Contains (optional)</label>
                        <input
                          id={`rule-text-${ri}`}
                          type="text"
                          value={rule.text_contains ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEditingStep((prev) => {
                              if (!prev) return null;
                              const rules = [...(prev.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], text_contains: value };
                              return { ...prev, config: { ...prev.config, rules } };
                            });
                          }}
                          placeholder='e.g. Session has been idle'
                          className="w-full bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Action</label>
                        <select
                          value={rule.action}
                          onChange={(e) => {
                            const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                            rules[ri] = { ...rules[ri], action: e.target.value };
                            setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                          }}
                          className="w-full bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        >
                          <option value="click_button">Click Button</option>
                          <option value="run_task">Run Linked Task</option>
                          <option value="open_url">Open URL (Away Link)</option>
                          <option value="keyboard_shortcut">Keyboard Shortcut</option>
                        </select>
                      </div>

                      {rule.action !== 'run_task' && rule.action !== 'open_url' && rule.action !== 'keyboard_shortcut' && (
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Button Title</label>
                          <input
                            type="text"
                            value={rule.button_title ?? ''}
                            onChange={(e) => {
                              const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], button_title: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                            }}
                            placeholder='OK'
                            className="w-full bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      )}

                      {rule.action === 'run_task' && (
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Linked Task</label>
                          <select
                            value={String(rule.linked_task_id ?? '')}
                            onChange={(e) => {
                              const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], linked_task_id: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                            }}
                            className="w-full bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          >
                            <option value="">— Select a task —</option>
                            {allTasks
                              .filter((t) => String(t.id) !== id)
                              .map((t) => (
                                <option key={t.id} value={String(t.id)}>
                                  {t.name} (#{t.id})
                                </option>
                              ))}
                          </select>
                        </div>
                      )}

                      {rule.action === 'open_url' && (
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">URL <span className="text-red-400">*</span></label>
                          <input
                            type="text"
                            value={rule.url ?? ''}
                            onChange={(e) => {
                              const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], url: e.target.value };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                            }}
                            placeholder='https://example.com'
                            className="w-full bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                          />
                          <p className="text-xs text-gray-500 mt-1">Opens this URL in the default browser when the popup is detected.</p>
                        </div>
                      )}

                      {rule.action === 'keyboard_shortcut' && (
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Shortcut Keys <span className="text-red-400">*</span></label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={rule.shortcut_keys ?? ''}
                              placeholder="Click here and press keys… or type (e.g. alt+tab)"
                              onChange={(e) => {
                                const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                                rules[ri] = { ...rules[ri], shortcut_keys: e.target.value };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                              }}
                              onKeyDown={(e) => {
                                const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
                                const KEY_MAP: Record<string, string> = {
                                  Control: '', Alt: '', Shift: '', Meta: '',
                                  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                                  Escape: 'esc', Enter: 'enter', Tab: 'tab', Delete: 'delete',
                                  Backspace: 'backspace', Insert: 'insert', Home: 'home', End: 'end',
                                  PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space',
                                  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
                                  F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
                                };
                                const isSpecialKey = e.key in KEY_MAP && KEY_MAP[e.key] !== '';
                                if (hasModifier || isSpecialKey) {
                                  e.preventDefault();
                                  const parts: string[] = [];
                                  if (e.ctrlKey) parts.push('ctrl');
                                  if (e.altKey) parts.push('alt');
                                  if (e.shiftKey) parts.push('shift');
                                  if (e.metaKey) parts.push('win');
                                  const mappedKey = e.key in KEY_MAP ? KEY_MAP[e.key] : e.key.toLowerCase();
                                  if (mappedKey) parts.push(mappedKey);
                                  if (parts.length > 0) {
                                    const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                                    rules[ri] = { ...rules[ri], shortcut_keys: parts.join('+') };
                                    setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                                  }
                                }
                              }}
                              className="flex-1 bg-gray-600 border border-gray-500 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                                rules[ri] = { ...rules[ri], shortcut_keys: '' };
                                setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                              }}
                              className="bg-gray-500 hover:bg-gray-400 text-white px-2 py-1.5 rounded-lg text-xs"
                            >
                              Clear
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Sends this keyboard shortcut to the popup window (e.g. <span className="font-mono">enter</span>, <span className="font-mono">alt+f4</span>).</p>
                        </div>
                      )}

                      {/* Monitor Mode toggle */}
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Monitor Mode</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], monitor_mode: 'continuous' };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                            }}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${(rule.monitor_mode ?? 'continuous') === 'continuous' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-600 border-gray-500 text-gray-300 hover:bg-gray-500'}`}
                          >
                            ♾ Continuous
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const rules = [...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[])];
                              rules[ri] = { ...rules[ri], monitor_mode: 'once' };
                              setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                            }}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${rule.monitor_mode === 'once' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-600 border-gray-500 text-gray-300 hover:bg-gray-500'}`}
                          >
                            1× Once
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {rule.monitor_mode === 'once'
                            ? 'Rule fires once — deactivated after the first match.'
                            : 'Rule keeps monitoring for the entire task duration.'}
                        </p>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      const rules = [
                        ...(editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[]),
                        { title_substring: '', text_contains: '', action: 'click_button', button_title: 'OK', linked_task_id: '', url: '', shortcut_keys: '', monitor_mode: 'continuous' },
                      ];
                      setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    + Add Rule
                  </button>

                  {/* Quick-add built-in rule for "Idle timer expired" */}
                  <button
                    onClick={() => {
                      const existing = editingStep.config.rules as { title_substring: string; text_contains: string; action: string; button_title: string; linked_task_id: string; url: string; shortcut_keys: string; monitor_mode: string }[];
                      const alreadyAdded = existing.some((r) => r.title_substring === 'Idle timer expired');
                      if (!alreadyAdded) {
                        const rules = [
                          ...existing,
                          { title_substring: 'Idle timer expired', text_contains: 'Session has been idle', action: 'click_button', button_title: 'OK', linked_task_id: '', url: '', shortcut_keys: '', monitor_mode: 'continuous' },
                        ];
                        setEditingStep((prev) => prev ? { ...prev, config: { ...prev.config, rules } } : null);
                      }
                    }}
                    className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
                  >
                    ⚡ Add built-in rule: "Idle timer expired → click OK"
                  </button>

                  <p className="text-xs text-gray-500">
                    Each rule watches for a dialog whose title contains the specified text. When found, the watcher
                    brings it to the foreground and performs the configured action. Runs concurrently with the task.
                  </p>
                </div>
              </>
            ) : editingStep.step.step_type === 'tick_checkboxes_by_vr' ? (
              <>
                <p className="text-xs text-gray-400 bg-gray-750 border border-teal-700 rounded-lg px-3 py-2">
                  ☑️ <strong className="text-white">Tick Checkboxes by VR Nos</strong> reads a comma-separated list of VR numbers
                  from an Excel column and ticks the matching checkbox in a desktop grid window.
                  It automatically scrolls the grid to find VR numbers not currently visible.
                </p>

                {/* VR Column */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">VR Numbers Column (Excel)</label>
                  <input
                    type="text"
                    list="excel-cols-vr"
                    value={String(editingStep.config.vrColumn ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, vrColumn: e.target.value } } : null
                      )
                    }
                    placeholder="e.g. VR_Numbers"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                  />
                  {excelColumns.length > 0 && (
                    <datalist id="excel-cols-vr">
                      {excelColumns.map((col) => <option key={col} value={col} />)}
                    </datalist>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Name of the Excel column containing VR numbers separated by commas (e.g. <code className="text-gray-400">EZ25Y-042, EZ25Y-047</code>).
                    Used when this step runs inside an Excel Form Submit Loop.
                    Leave blank to pass VR numbers from an engine variable named <code className="text-gray-400">vr_numbers</code>.{' '}
                    <strong className="text-gray-400">Also used as the on-screen grid column header</strong> so OCR matching is restricted to that column only (column-aware precision).
                  </p>
                </div>

                {/* Item Code Column */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Item Code Column (Excel) — optional</label>
                  <input
                    type="text"
                    list="excel-cols-item-code"
                    value={String(editingStep.config.itemCodeColumn ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, itemCodeColumn: e.target.value } } : null
                      )
                    }
                    placeholder="e.g. Item_Code"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                  />
                  {excelColumns.length > 0 && (
                    <datalist id="excel-cols-item-code">
                      {excelColumns.map((col) => <option key={col} value={col} />)}
                    </datalist>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    When set, a grid row is only ticked when <strong className="text-gray-400">both</strong> the VR number and this Item Code appear on the same row.
                    Leave blank to match by VR number alone; the engine will also check for a variable named <code className="text-gray-400">item_code</code> if one is set.{' '}
                    <strong className="text-gray-400">Also used as the on-screen grid column header</strong> to constrain OCR matching to the Item Code column only.
                  </p>
                </div>

                {/* Target Window */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Target Window Title</label>
                  <input
                    type="text"
                    value={String(editingStep.config.windowTitle ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, windowTitle: e.target.value } } : null
                      )
                    }
                    placeholder="e.g. My SAP Grid"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Partial or full title of the window containing the grid. Leave blank to use the currently active window.
                  </p>
                </div>

                {/* Grid ROI */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Grid Region (ROI) — optional</label>
                  <input
                    type="text"
                    value={String(editingStep.config.gridRoi ?? '')}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, gridRoi: e.target.value } } : null
                      )
                    }
                    placeholder="x,y,width,height  e.g. 100,200,800,600"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Limit OCR and click to this screen region. Leave blank for full screen.
                  </p>
                </div>

                {/* Scroll Config */}
                <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider pt-1">Scroll Settings</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Scroll X</label>
                    <input
                      type="number"
                      value={String(editingStep.config.scrollX ?? 0)}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, scrollX: Number(e.target.value) } } : null
                        )
                      }
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Scroll Y</label>
                    <input
                      type="number"
                      value={String(editingStep.config.scrollY ?? 0)}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, scrollY: Number(e.target.value) } } : null
                        )
                      }
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max Scroll Attempts</label>
                    <input
                      type="number"
                      min={1}
                      value={String(editingStep.config.maxScrollAttempts ?? 20)}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, maxScrollAttempts: Number(e.target.value) } } : null
                        )
                      }
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Scroll Step (wheel clicks)</label>
                    <input
                      type="number"
                      min={1}
                      value={String(editingStep.config.scrollStep ?? 3)}
                      onChange={(e) =>
                        setEditingStep((prev) =>
                          prev ? { ...prev, config: { ...prev.config, scrollStep: Number(e.target.value) } } : null
                        )
                      }
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  X/Y is the screen coordinate where mouse scroll events are sent. Leave at 0,0 to use the centre of the grid region. Set Max Scroll Attempts to cap how far the grid is scrolled before giving up.
                </p>

                {/* Checkbox Offset */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Checkbox X Offset (pixels left of VR text)</label>
                  <input
                    type="number"
                    value={String(editingStep.config.checkboxOffset ?? 40)}
                    onChange={(e) =>
                      setEditingStep((prev) =>
                        prev ? { ...prev, config: { ...prev.config, checkboxOffset: Number(e.target.value) } } : null
                      )
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    How many pixels to the <strong className="text-gray-400">left</strong> of the detected VR number text to click (where the checkbox column is). Calibrate once for your grid layout.
                    The actual pixel distance from the VR text to the checkbox click position is logged after each successful tick.
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
