# WindAutomateX

A production-ready **Windows Desktop Automation** application built with Electron + React + TypeScript and a Python automation engine.

## Features

- 🤖 **Visual Task Builder** — drag-and-drop step editor with 20 automation step types
- 📅 **Scheduler** — run tasks once, daily, weekly, monthly, on interval, or at startup
- 📊 **Dashboard** — real-time stats, recent runs, and quick-launch buttons
- 📄 **Logs** — filterable run history with expandable log output
- 🔐 **Credentials Manager** — AES-encrypted credential storage
- ⚙️ **Settings** — theme, download folder, Python path, notifications
- 🐍 **Python Engine** — pywinauto + pyautogui + OpenCV for native Windows UI automation
- 🔍 **Image-based Window Detection** — template matching to detect the expected screen state
- ▶️ **Linked Task Execution** — run a child task and resume the parent after it completes

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 29 |
| UI | React 18 + TypeScript 5 + Tailwind CSS 3 |
| Database | SQLite via better-sqlite3 |
| Scheduler | node-cron |
| Automation | Python 3 + pywinauto + pyautogui + OpenCV |
| Build | Webpack 5 + electron-builder |

## Prerequisites

- **Node.js** 18+
- **Python** 3.8+ (with pip)
- **Windows** 10/11 (for full automation features)

## Quick Start

```bash
# 1. Install Node dependencies
npm install

# 2. Install Python dependencies
pip install -r python-engine/requirements.txt

# 3. Build and run in development mode
npm run build
npx electron .
```

## Development

```bash
# Watch mode (rebuilds on file changes)
npm run dev
```

## Build for Production

```bash
# Package as Windows installer + portable exe
npm run dist
```

Output will be in the `release/` directory.

## Project Structure

```
WindAutomateX/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry point
│   │   ├── preload.ts  # Context bridge
│   │   ├── ipc.ts      # IPC handlers
│   │   ├── database.ts # SQLite CRUD
│   │   └── scheduler.ts# Cron scheduler
│   ├── renderer/       # React UI
│   │   ├── pages/      # Dashboard, Tasks, Logs, Settings…
│   │   └── components/ # Sidebar, Modal, Toast, StepCard
│   └── shared/
│       └── types.ts    # Shared TypeScript types
├── python-engine/      # Python automation backend
│   ├── ipc_handler.py  # stdin/stdout IPC
│   ├── executor.py     # Step runner
│   ├── engine.py       # Step implementations
│   └── wait_utils.py   # UI wait helpers
├── database/
│   └── init.sql        # Schema
└── assets/             # Icons
```

## Automation Step Types

| Step | Description |
|------|-------------|
| `launch_exe` | Launch an executable |
| `wait_window` | Wait for a window to appear |
| `click_element` | Click a UI element by name/AutomationId |
| `click_coordinate` | Click at (x, y) screen coordinates |
| `type_text` | Type text into the focused field |
| `press_key` | Press a keyboard key |
| `keyboard_shortcut` | Press a keyboard shortcut combination |
| `select_dropdown` | Select a value in a ComboBox |
| `upload_file` | Set a file path in an upload dialog |
| `download_file` | Download a file from a URL |
| `wait_download` | Wait for a download to complete |
| `wait_upload` | Wait for an upload dialog to close |
| `read_text` | Read text from a UI element into a variable |
| `if_condition` | Branch on a variable value |
| `loop` | Repeat N times |
| `delay` | Wait N seconds |
| `screenshot` | Save a screenshot |
| `close_app` | Close a window |
| `kill_process` | Kill a process by name |
| `excel_form_submit_loop` | Iterate an Excel/CSV file and fill a form for each row |
| `detect_image` | **[NEW]** Take a screenshot and check if a reference image is present (OpenCV template matching). Returns `matched` (true/false) and `score`. |
| `run_task` | **[NEW]** Execute a linked child task and wait for it to finish before continuing. |

### `detect_image` step

Performs full-screen (or region-restricted) template matching using OpenCV.

**Config fields:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `template_path` | string | — | Path to the reference PNG/JPG image |
| `threshold` | float | `0.85` | Minimum match confidence (0.50–1.00). Higher = stricter |
| `output_var` | string | — | Variable name to store `"true"` / `"false"` for downstream `if_condition` step |
| `region.x/y/width/height` | int | `0` | Restrict search to a screen sub-region. `width`/`height` must be > 0 to apply |

**Result keys available in log:**
```json
{ "success": true, "matched": true, "score": 0.92, "found": { "x": 120, "y": 80, "w": 1280, "h": 720 } }
```

**Dependencies:** Requires `opencv-python-headless` (included in `requirements.txt`). If OpenCV is not installed the step returns `success: false` with an install hint.

### `run_task` step

Executes a saved task by its ID and blocks until it finishes. After the child task completes, the parent task continues to the next step.

**Config fields:**
| Field | Type | Description |
|-------|------|-------------|
| `task_id` | int | ID of the task to execute |

- If the child task fails, the parent task also fails at this step.
- All child steps are logged to stderr (visible in the run log).
- The child task runs within the **same Python process** — there is no separate run record for the child execution.

## License

MIT
