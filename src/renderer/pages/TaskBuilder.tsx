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
  'excel_form_submit_loop',
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
        {/* Steps Panel */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <select
              value={selectedStepType}
              onChange={(e) => setSelectedStepType(e.target.value as StepType)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-blue-500"
            >
              {ALL_STEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'excel_form_submit_loop' ? 'Excel Form Submit Loop (Business Automation)' : t.replace(/_/g, ' ')}
                </option>
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
                        dragOverActionIndex === ai && dragActionIndex !== ai ? 'border-blue-500' : 'border-gray-600',
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
                        </select>
                        <span className="text-xs text-gray-500 flex-1">Action {ai + 1}</span>
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
                    Add coordinate clicks, keyboard shortcuts, or "Type Text (Column Value)" actions to execute when submitting each row.
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
