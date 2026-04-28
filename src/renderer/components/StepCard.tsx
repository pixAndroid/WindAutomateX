import React from 'react';
import type { TaskStep, StepType } from '../../shared/types';

const stepIcons: Record<StepType, string> = {
  launch_exe: '🚀',
  wait_window: '🪟',
  click_element: '🖱️',
  click_coordinate: '📍',
  type_text: '⌨️',
  press_key: '🔑',
  keyboard_shortcut: '⌨️',
  select_dropdown: '📋',
  upload_file: '📤',
  download_file: '📥',
  wait_download: '⏳',
  wait_upload: '⏫',
  read_text: '📖',
  if_condition: '🔀',
  loop: '🔁',
  delay: '⏱️',
  screenshot: '📸',
  close_app: '❌',
  kill_process: '💀',
  excel_form_submit_loop: '📊',
  detect_image: '🔍',
  run_task: '▶️',
  switch_window: '🔄',
  watch_popup: '👁',
};

const stepLabels: Record<StepType, string> = {
  launch_exe: 'Launch EXE',
  wait_window: 'Wait Window',
  click_element: 'Click Element',
  click_coordinate: 'Click Coordinate',
  type_text: 'Type Text',
  press_key: 'Press Key',
  keyboard_shortcut: 'Keyboard Shortcut',
  select_dropdown: 'Select Dropdown',
  upload_file: 'Upload File',
  download_file: 'Download File',
  wait_download: 'Wait Download',
  wait_upload: 'Wait Upload',
  read_text: 'Read Text',
  if_condition: 'If Condition',
  loop: 'Loop',
  delay: 'Delay',
  screenshot: 'Screenshot',
  close_app: 'Close App',
  kill_process: 'Kill Process',
  excel_form_submit_loop: 'Excel Form Submit Loop',
  detect_image: 'Detect Image (Window)',
  run_task: 'Run Linked Task',
  switch_window: 'Switch Window',
  watch_popup: 'Watch Popup (Realtime)',
};

interface StepCardProps {
  step: TaskStep;
  index: number;
  total: number;
  isDragging?: boolean;
  isDragOver?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

const StepCard: React.FC<StepCardProps> = ({ step, index, total, isDragging, isDragOver, onEdit, onDelete, onCopy, onMoveUp, onMoveDown, onDragStart, onDragOver, onDrop, onDragEnd }) => {
  let configSummary = '';
  try {
    const config = JSON.parse(step.config_json);
    if (step.step_type === 'excel_form_submit_loop') {
      const fileName = config.filePath ? config.filePath.split(/[\\/]/).pop() : 'No file';
      const mappingCount = Array.isArray(config.mappings) ? config.mappings.length : 0;
      const rowRange = `Rows: ${config.startRow ?? 2} to ${config.endRow ?? 'End'}`;
      configSummary = `File: ${fileName} · Mappings: ${mappingCount} fields · ${rowRange}`;
    } else if (step.step_type === 'watch_popup') {
      const ruleCount = Array.isArray(config.rules) ? config.rules.length : 0;
      const enabled = config.enabled !== false;
      if (!enabled) {
        configSummary = 'Disabled';
      } else {
        const onceModes = Array.isArray(config.rules)
          ? (config.rules as { monitor_mode?: string }[]).filter((r) => r.monitor_mode === 'once').length
          : 0;
        const modeLabel = onceModes === ruleCount && ruleCount > 0
          ? '1× once'
          : onceModes > 0
            ? `${onceModes} once / ${ruleCount - onceModes} ♾`
            : '♾ continuous';
        configSummary = `${ruleCount} rule${ruleCount !== 1 ? 's' : ''} · ${config.poll_interval_ms ?? 300} ms · ${modeLabel}`;
      }
    } else {
      const entries = Object.entries(config).slice(0, 2);
      configSummary = entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
    }
  } catch {
    configSummary = step.config_json;
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        'bg-gray-700 rounded-lg p-3 flex items-center gap-3 group cursor-grab active:cursor-grabbing transition-opacity border-2',
        isDragging ? 'opacity-40' : 'opacity-100',
        isDragOver ? 'border-blue-500' : 'border-transparent',
      ].join(' ')}
    >
      <span className="text-gray-400 text-sm w-6 text-center">{index + 1}</span>
      <span className="text-lg">{stepIcons[step.step_type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{stepLabels[step.step_type]}</p>
        {configSummary && (
          <p className="text-xs text-gray-400 truncate">{configSummary}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move Up"
        >
          ↑
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move Down"
        >
          ↓
        </button>
        <button
          onClick={onEdit}
          className="p-1 text-blue-400 hover:text-blue-300"
          title="Edit"
        >
          ✏️
        </button>
        <button
          onClick={onCopy}
          className="p-1 text-green-400 hover:text-green-300"
          title="Copy Step"
        >
          📋
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-red-400 hover:text-red-300"
          title="Delete"
        >
          🗑️
        </button>
      </div>
    </div>
  );
};

export default StepCard;
