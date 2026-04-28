export interface Task {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  schedule_type: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'startup';
  schedule_value: string;
  created_at: string;
  updated_at: string;
}

export interface TaskStep {
  id: number;
  task_id: number;
  step_order: number;
  step_type: StepType;
  config_json: string;
}

export type StepType =
  | 'launch_exe'
  | 'wait_window'
  | 'click_element'
  | 'click_coordinate'
  | 'type_text'
  | 'press_key'
  | 'select_dropdown'
  | 'upload_file'
  | 'download_file'
  | 'wait_download'
  | 'wait_upload'
  | 'read_text'
  | 'if_condition'
  | 'loop'
  | 'delay'
  | 'screenshot'
  | 'close_app'
  | 'kill_process'
  | 'keyboard_shortcut'
  | 'excel_form_submit_loop'
  | 'detect_image'
  | 'run_task'
  | 'switch_window'
  | 'watch_popup';

export interface Run {
  id: number;
  task_id: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  started_at: string;
  ended_at: string;
  log_text: string;
}

export interface Credential {
  id: number;
  name: string;
  username: string;
  password_encrypted: string;
}

export interface Settings {
  theme: 'dark' | 'light';
  download_folder: string;
  python_path: string;
  auto_start: boolean;
  notifications: boolean;
}

export interface ElectronAPI {
  tasks: {
    list: () => Promise<Task[]>;
    get: (id: number) => Promise<Task | undefined>;
    create: (task: Omit<Task, 'id' | 'created_at' | 'updated_at'>) => Promise<Task>;
    update: (id: number, task: Partial<Task>) => Promise<Task>;
    delete: (id: number) => Promise<void>;
  };
  steps: {
    list: (taskId: number) => Promise<TaskStep[]>;
    save: (taskId: number, steps: Omit<TaskStep, 'id'>[]) => Promise<TaskStep[]>;
  };
  runs: {
    list: (taskId?: number) => Promise<Run[]>;
    get: (id: number) => Promise<Run | undefined>;
    clear: () => Promise<void>;
  };
  credentials: {
    list: () => Promise<Credential[]>;
    create: (cred: Omit<Credential, 'id'>) => Promise<Credential>;
    delete: (id: number) => Promise<void>;
  };
  settings: {
    get: () => Promise<Settings>;
    save: (settings: Settings) => Promise<void>;
  };
  task: {
    run: (taskId: number) => Promise<void>;
    stop: (taskId: number) => Promise<void>;
    pause: (taskId: number) => Promise<void>;
  };
  onRunUpdate: (callback: (event: Electron.IpcRendererEvent, run: Run) => void) => void;
  offRunUpdate: (callback: (event: Electron.IpcRendererEvent, run: Run) => void) => void;
  onLogUpdate: (callback: (event: Electron.IpcRendererEvent, data: { runId: number; line: string }) => void) => void;
  dialog: {
    openFile: () => Promise<string | null>;
    openExcelFile: () => Promise<string | null>;
    openImageFile: () => Promise<string | null>;
    readExcelHeaders: (filePath: string, sheetName?: string) => Promise<string[]>;
  };
  picker: {
    coordinate: () => Promise<{ x: number; y: number } | null>;
    captureScreen: () => Promise<string | null>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
