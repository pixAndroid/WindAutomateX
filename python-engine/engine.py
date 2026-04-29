"""
Core automation engine for WindAutomateX.
Handles execution of individual automation steps.
"""
import json
import logging
import subprocess
import time
import os

from wait_utils import WaitUtils

logger = logging.getLogger(__name__)

# Brief pause after a window is found to allow it to finish rendering before the next step
_WINDOW_SETTLE_DELAY_SECONDS = 0.3


class WindAutomateXEngine:
    def __init__(self):
        self.variables: dict = {}
        self.all_tasks: dict = {}  # task_id (str) -> list of step dicts for run_task support
        self.active_popup_watcher = None  # PopupWatcher instance if running
        self._try_import_libraries()

    def _try_import_libraries(self):
        """Try to import optional automation libraries."""
        self.pywinauto_available = False
        self.pyautogui_available = False
        self.cv2_available = False

        try:
            import pywinauto  # noqa: F401
            self.pywinauto_available = True
        except ImportError:
            logger.warning("pywinauto not available")

        try:
            import pyautogui  # noqa: F401
            self.pyautogui_available = True
        except ImportError:
            logger.warning("pyautogui not available")

        try:
            import cv2  # noqa: F401
            self.cv2_available = True
        except ImportError:
            logger.warning("opencv (cv2) not available — detect_image step will not work")

    def execute_step(self, step: dict) -> dict:
        """Execute a single automation step. Returns {success, message}."""
        step_type = step.get("step_type", "")
        config_raw = step.get("config_json", "{}")

        try:
            config = json.loads(config_raw) if isinstance(config_raw, str) else config_raw
        except json.JSONDecodeError:
            config = {}

        logger.info(f"Executing step: {step_type} with config: {config}")

        handlers = {
            "launch_exe": self._launch_exe,
            "wait_window": self._wait_window,
            "click_element": self._click_element,
            "click_coordinate": self._click_coordinate,
            "double_click_coordinate": self._double_click_coordinate,
            "right_click_coordinate": self._right_click_coordinate,
            "master_click_coordinate": self._master_click_coordinate,
            "type_text": self._type_text,
            "press_key": self._press_key,
            "keyboard_shortcut": self._keyboard_shortcut,
            "select_dropdown": self._select_dropdown,
            "upload_file": self._upload_file,
            "download_file": self._download_file,
            "wait_download": self._wait_download,
            "wait_upload": self._wait_upload,
            "read_text": self._read_text,
            "if_condition": self._if_condition,
            "loop": self._loop,
            "delay": self._delay,
            "screenshot": self._screenshot,
            "close_app": self._close_app,
            "kill_process": self._kill_process,
            "excel_form_submit_loop": self._excel_form_submit_loop,
            "detect_image": self._detect_image,
            "run_task": self._run_task,
            "switch_window": self._switch_window,
            "watch_popup": self._watch_popup,
            "tick_checkboxes_by_vr": self._tick_checkboxes_by_vr,
            "process_grid_cv": self._process_grid_cv,
        }

        handler = handlers.get(step_type)
        if not handler:
            return {"success": False, "message": f"Unknown step type: {step_type}"}

        try:
            return handler(config)
        except Exception as e:
            logger.error(f"Step {step_type} failed: {e}")
            return {"success": False, "message": str(e)}

    def _launch_exe(self, config: dict) -> dict:
        exe_path = config.get("path", "")
        args = config.get("args", "")
        if not exe_path:
            return {"success": False, "message": "No path specified"}
        cmd = [exe_path] + (args.split() if args else [])
        subprocess.Popen(cmd)
        return {"success": True, "message": f"Launched: {exe_path}"}

    def _wait_window(self, config: dict) -> dict:
        title = config.get("window_title") if "window_title" in config else config.get("title", "")
        timeout = int(config.get("timeout", 30))
        if not title:
            WaitUtils.wait_seconds(timeout)
            return {"success": True, "message": f"Waited {timeout}s"}
        result = WaitUtils.wait_for_window(title, timeout)
        if result:
            # Small settle delay so the window is fully rendered before the next step
            WaitUtils.wait_seconds(_WINDOW_SETTLE_DELAY_SECONDS)
            return {"success": True, "message": f"Window found: {title}"}
        # Timeout is treated as a graceful wait — proceed to the next step regardless
        return {"success": True, "message": f"Timed out waiting for window '{title}' ({timeout}s), continuing"}

    def _click_element(self, config: dict) -> dict:
        if not self.pywinauto_available:
            return {"success": False, "message": "pywinauto not available"}
        from pywinauto import Application
        window_title = config.get("window_title", "")
        element_title = config.get("element_title", "")
        auto_id = config.get("auto_id", "")
        try:
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            win = app.top_window()
            if auto_id:
                win.child_window(auto_id=auto_id).click_input()
            elif element_title:
                win.child_window(title=element_title).click_input()
            return {"success": True, "message": f"Clicked element in {window_title}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _click_coordinate(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        x = int(config.get("x", 0))
        y = int(config.get("y", 0))
        pyautogui.click(x, y)
        return {"success": True, "message": f"Clicked at ({x}, {y})"}

    def _double_click_coordinate(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        x = int(config.get("x", 0))
        y = int(config.get("y", 0))
        pyautogui.doubleClick(x, y)
        return {"success": True, "message": f"Double-clicked at ({x}, {y})"}

    def _right_click_coordinate(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        x = int(config.get("x", 0))
        y = int(config.get("y", 0))
        pyautogui.click(x, y, button='right')
        return {"success": True, "message": f"Right-clicked at ({x}, {y})"}

    def _master_click_coordinate(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        x = int(config.get("x", 0))
        y = int(config.get("y", 0))
        click_type = config.get("click_type", "left")
        if click_type == "double":
            pyautogui.doubleClick(x, y)
            label = "Double-clicked"
        elif click_type == "right":
            pyautogui.click(x, y, button='right')
            label = "Right-clicked"
        else:
            # left / single — default
            pyautogui.click(x, y)
            label = "Left-clicked"
        return {"success": True, "message": f"{label} at ({x}, {y})"}

    def _type_text(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        text = config.get("text", "")
        interval = float(config.get("interval", 0.05))
        pyautogui.typewrite(text, interval=interval)
        return {"success": True, "message": f"Typed: {text[:30]}..."}

    def _press_key(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        key = config.get("key", "")
        pyautogui.press(key)
        return {"success": True, "message": f"Pressed key: {key}"}

    def _keyboard_shortcut(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        keys_str = config.get("keys", "")
        if not keys_str:
            return {"success": False, "message": "No keys specified"}
        keys = [k.strip() for k in keys_str.split("+") if k.strip()]
        if len(keys) == 1:
            pyautogui.press(keys[0])
        else:
            pyautogui.hotkey(*keys)
        return {"success": True, "message": f"Keyboard shortcut: {keys_str}"}

    def _select_dropdown(self, config: dict) -> dict:
        if not self.pywinauto_available:
            return {"success": False, "message": "pywinauto not available"}
        from pywinauto import Application
        window_title = config.get("window_title", "")
        element_title = config.get("element_title", "")
        value = config.get("value", "")
        try:
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            win = app.top_window()
            combo = win.child_window(title=element_title, control_type="ComboBox")
            combo.select(value)
            return {"success": True, "message": f"Selected '{value}' in dropdown"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _upload_file(self, config: dict) -> dict:
        if not self.pywinauto_available:
            return {"success": False, "message": "pywinauto not available"}
        from pywinauto import Application
        window_title = config.get("window_title", "")
        file_path = config.get("file_path", "")
        try:
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            win = app.top_window()
            edit = win.child_window(control_type="Edit")
            edit.set_text(file_path)
            return {"success": True, "message": f"Set file path: {file_path}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _download_file(self, config: dict) -> dict:
        import urllib.request
        url = config.get("url", "")
        save_path = config.get("save_path", "")
        if not url or not save_path:
            return {"success": False, "message": "url and save_path are required"}
        try:
            urllib.request.urlretrieve(url, save_path)
            return {"success": True, "message": f"Downloaded to {save_path}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _wait_download(self, config: dict) -> dict:
        folder = config.get("folder", "")
        timeout = int(config.get("timeout", 300))
        if not folder:
            return {"success": False, "message": "folder is required"}
        result = WaitUtils.wait_for_download(folder, timeout)
        if result:
            return {"success": True, "message": "Download completed"}
        return {"success": False, "message": f"Download did not complete within {timeout}s"}

    def _wait_upload(self, config: dict) -> dict:
        window_title = config.get("window_title", "")
        timeout = int(config.get("timeout", 60))
        result = WaitUtils.wait_for_upload(window_title, timeout)
        if result:
            return {"success": True, "message": "Upload completed"}
        return {"success": False, "message": f"Upload did not complete within {timeout}s"}

    def _read_text(self, config: dict) -> dict:
        if not self.pywinauto_available:
            return {"success": False, "message": "pywinauto not available"}
        from pywinauto import Application
        window_title = config.get("window_title", "")
        element_title = config.get("element_title", "")
        output_var = config.get("output_var", "result")
        try:
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            win = app.top_window()
            elem = win.child_window(title=element_title)
            text = elem.window_text()
            self.variables[output_var] = text
            return {"success": True, "message": f"Read text into '{output_var}': {text[:50]}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _if_condition(self, config: dict) -> dict:
        variable = config.get("variable", "")
        operator = config.get("operator", "==")
        value = config.get("value", "")
        actual = str(self.variables.get(variable, ""))
        result = False
        if operator == "==":
            result = actual == value
        elif operator == "!=":
            result = actual != value
        elif operator == "contains":
            result = value in actual
        elif operator == ">":
            try:
                result = float(actual) > float(value)
            except ValueError:
                result = False
        elif operator == "<":
            try:
                result = float(actual) < float(value)
            except ValueError:
                result = False
        return {"success": True, "message": f"Condition result: {result}", "condition_result": result}

    def _loop(self, config: dict) -> dict:
        count = int(config.get("count", 1))
        return {"success": True, "message": f"Loop {count} times", "loop_count": count}

    def _delay(self, config: dict) -> dict:
        seconds = float(config.get("seconds", 1))
        WaitUtils.wait_seconds(seconds)
        return {"success": True, "message": f"Waited {seconds}s"}

    def _screenshot(self, config: dict) -> dict:
        if not self.pyautogui_available:
            return {"success": False, "message": "pyautogui not available"}
        import pyautogui
        save_path = config.get("path", "screenshot.png")
        if not save_path:
            save_path = f"screenshot_{int(time.time())}.png"
        pyautogui.screenshot(save_path)
        return {"success": True, "message": f"Screenshot saved: {save_path}"}

    def _close_app(self, config: dict) -> dict:
        if not self.pywinauto_available:
            return {"success": False, "message": "pywinauto not available"}
        from pywinauto import Application
        window_title = config.get("window_title", "")
        try:
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            app.top_window().close()
            return {"success": True, "message": f"Closed: {window_title}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _kill_process(self, config: dict) -> dict:
        import psutil
        process_name = config.get("process_name", "")
        if not process_name:
            return {"success": False, "message": "process_name is required"}
        killed = 0
        for proc in psutil.process_iter(['name']):
            try:
                if process_name.lower() in proc.info['name'].lower():
                    proc.kill()
                    killed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return {"success": True, "message": f"Killed {killed} process(es) matching '{process_name}'"}

    def _excel_form_submit_loop(self, config: dict) -> dict:
        from excel_loop import run_excel_form_loop
        return run_excel_form_loop(config, self)

    def _detect_image(self, config: dict) -> dict:
        """
        Perform full-screen template matching using OpenCV.

        Config keys:
          template_path      (str)   – path to the reference image file.
          threshold          (float) – match confidence threshold (default 0.85).
          region             (dict)  – optional {x, y, width, height} to limit the search area.
          output_var         (str)   – optional variable name to store the boolean match result.
          on_success_task_id (str)   – optional task ID to run when the image is found.
          on_failure_task_id (str)   – optional task ID to run when the image is not found.

        Returns:
          success: True  (unless a real error occurs such as missing template or OpenCV not installed)
          matched: bool
          score:   float  – best normalised match score (0.0–1.0)
          found:   dict   – {x, y, w, h} of the best match location (present when matched is True)
        """
        if not self.cv2_available:
            return {
                "success": False,
                "message": (
                    "detect_image: OpenCV (cv2) is not installed. "
                    "Run: pip install opencv-python-headless"
                ),
            }

        if not self.pyautogui_available:
            return {"success": False, "message": "detect_image: pyautogui is not available for screenshot"}

        import cv2
        import numpy as np
        import pyautogui

        template_path = config.get("template_path", "")
        if not template_path:
            return {"success": False, "message": "detect_image: template_path is required"}

        if not os.path.isfile(template_path):
            return {"success": False, "message": f"detect_image: template file not found: {template_path}"}

        threshold = float(config.get("threshold", 0.85))
        output_var = config.get("output_var", "")
        region_cfg = config.get("region")

        try:
            # Take screenshot (full screen or restricted region)
            if region_cfg and isinstance(region_cfg, dict):
                rx = int(region_cfg.get("x", 0))
                ry = int(region_cfg.get("y", 0))
                rw = int(region_cfg.get("width", 0))
                rh = int(region_cfg.get("height", 0))
                if rw > 0 and rh > 0:
                    pil_img = pyautogui.screenshot(region=(rx, ry, rw, rh))
                else:
                    pil_img = pyautogui.screenshot()
            else:
                pil_img = pyautogui.screenshot()

            # Convert PIL image to OpenCV and then to grayscale for robust matching.
            # Grayscale avoids false negatives caused by minor color rendering
            # differences (sub-pixel font rendering, anti-aliasing, etc.).
            screen_np = np.array(pil_img)
            screen_bgr = cv2.cvtColor(screen_np, cv2.COLOR_RGB2BGR)
            screen_gray = cv2.cvtColor(screen_bgr, cv2.COLOR_BGR2GRAY)

            # Load template image and convert to grayscale
            template_bgr = cv2.imread(template_path, cv2.IMREAD_COLOR)
            if template_bgr is None:
                return {"success": False, "message": f"detect_image: failed to load template: {template_path}"}
            template_gray = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2GRAY)

            # Multi-scale template matching to handle DPI / resolution differences
            # between the captured template and the live screenshot.  On Windows,
            # display scaling (125%, 150%, 200%, ...) can cause pyautogui to return
            # screenshots at a different pixel size than the saved template, producing
            # near-zero correlation scores at 1x scale.  Trying a range of reciprocal
            # scales ensures we cover the most common mismatches in both directions.
            scales = [1.0, 0.5, 0.75, 0.8, 1.25, 1.5, 2.0]

            best_score = 0.0
            best_loc = (0, 0)
            best_scale = 1.0

            for scale in scales:
                if scale == 1.0:
                    tmpl = template_gray
                else:
                    new_w = max(1, int(template_gray.shape[1] * scale))
                    new_h = max(1, int(template_gray.shape[0] * scale))
                    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
                    tmpl = cv2.resize(template_gray, (new_w, new_h), interpolation=interp)

                # Skip scales where the resized template exceeds the screenshot
                # dimensions (cv2.matchTemplate would raise an error).
                if tmpl.shape[0] > screen_gray.shape[0] or tmpl.shape[1] > screen_gray.shape[1]:
                    continue

                result_mat = cv2.matchTemplate(screen_gray, tmpl, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, max_loc = cv2.minMaxLoc(result_mat)

                if max_val > best_score:
                    best_score = max_val
                    best_loc = max_loc
                    best_scale = scale

            score = best_score
            matched = score >= threshold

            response: dict = {
                "success": True,
                "matched": matched,
                "score": round(score, 4),
                "message": f"detect_image {'matched' if matched else 'not matched'} (score={score:.4f})",
            }

            if matched:
                th = int(template_bgr.shape[0] * best_scale)
                tw = int(template_bgr.shape[1] * best_scale)
                response["found"] = {
                    "x": best_loc[0],
                    "y": best_loc[1],
                    "w": tw,
                    "h": th,
                }

            # Store result in engine variable if requested
            if output_var:
                self.variables[output_var] = str(matched).lower()

            # Run linked success or failure task if configured
            if matched:
                linked_task_id = config.get("on_success_task_id", "")
            else:
                linked_task_id = config.get("on_failure_task_id", "")

            if linked_task_id and str(linked_task_id).strip():
                task_result = self._run_task({"task_id": linked_task_id})
                if not task_result.get("success", False):
                    return {
                        "success": False,
                        "matched": matched,
                        "score": response["score"],
                        "message": task_result.get("message", "Linked task failed"),
                    }

            return response

        except Exception as e:
            logger.error(f"detect_image error: {e}")
            return {"success": False, "message": f"detect_image error: {e}"}

    def _run_task(self, config: dict) -> dict:
        """
        Execute a linked child task and wait for it to finish before returning.

        Config keys:
          task_id (int|str) – the ID of the task to run.

        The child task's steps are looked up from ``self.all_tasks`` which is
        populated by the executor before execution begins.  If the child task
        is not found in the map the step fails immediately.
        """
        task_id_raw = config.get("task_id", "")
        if not task_id_raw and task_id_raw != 0:
            return {"success": False, "message": "run_task: task_id is required"}

        task_id_str = str(task_id_raw)
        child_steps = self.all_tasks.get(task_id_str)
        if child_steps is None:
            return {
                "success": False,
                "message": (
                    f"run_task: task {task_id_str} not found. "
                    "Make sure the task exists and was saved before running the parent task."
                ),
            }

        total = len(child_steps)
        logger.info(f"run_task: starting child task {task_id_str} ({total} steps)")

        for i, step in enumerate(child_steps):
            step_type = step.get("step_type", "unknown")
            logger.info(f"run_task: child task {task_id_str} step {i + 1}/{total}: {step_type}")
            result = self.execute_step(step)
            if not result.get("success", False):
                logger.error(
                    f"run_task: child task {task_id_str} failed at step {i + 1}: {result.get('message')}"
                )
                return {
                    "success": False,
                    "message": (
                        f"Linked task {task_id_str} failed at step {i + 1} ({step_type}): "
                        f"{result.get('message', '')}"
                    ),
                }

            # Apply per-step delay for the child step
            try:
                child_config = json.loads(step.get("config_json", "{}") or "{}")
            except json.JSONDecodeError:
                child_config = {}
            delay_ms = int(child_config.get("delay", 60))
            if delay_ms > 0:
                time.sleep(delay_ms / 1000.0)

        logger.info(f"run_task: child task {task_id_str} completed ({total} steps)")
        return {
            "success": True,
            "message": f"Linked task {task_id_str} completed successfully ({total} steps)",
        }

    def _switch_window(self, config: dict) -> dict:
        """
        Bring a running application window to the foreground.

        Config keys:
          window_title (str) – full or partial title of the target window (case-insensitive).
          timeout      (int) – seconds to wait for the window to appear (default 10).

        The step polls for the window until timeout, then fails if it is never found.
        It first tries pywinauto (Desktop UIA backend), then falls back to the
        Windows ctypes API so it works even when pywinauto is not available.
        """
        window_title = config.get("window_title", "").strip()
        timeout = int(config.get("timeout", 10))

        if not window_title:
            return {"success": False, "message": "switch_window: window_title is required"}

        deadline = time.time() + timeout

        # --- Attempt 1: pywinauto Desktop ---
        if self.pywinauto_available:
            import re
            from pywinauto import Desktop
            title_pattern = f".*{re.escape(window_title)}.*"
            while time.time() < deadline:
                try:
                    windows = Desktop(backend="uia").windows(title_re=title_pattern)
                    if windows:
                        windows[0].set_focus()
                        WaitUtils.wait_seconds(_WINDOW_SETTLE_DELAY_SECONDS)
                        return {"success": True, "message": f"Switched to window: {window_title}"}
                except Exception:
                    pass
                time.sleep(0.5)
            return {
                "success": False,
                "message": f"switch_window: window '{window_title}' not found within {timeout}s",
            }

        # --- Attempt 2: ctypes / Win32 fallback ---
        try:
            import ctypes
            import ctypes.wintypes

            EnumWindowsProc = ctypes.WINFUNCTYPE(
                ctypes.wintypes.BOOL,
                ctypes.wintypes.HWND,
                ctypes.wintypes.LPARAM,
            )

            while time.time() < deadline:
                found_hwnd: list = []

                def _enum_cb(hwnd, _lParam):
                    if ctypes.windll.user32.IsWindowVisible(hwnd):
                        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
                        if length > 0:
                            buf = ctypes.create_unicode_buffer(length + 1)
                            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
                            if window_title.lower() in buf.value.lower():
                                found_hwnd.append(hwnd)
                                return False  # stop enumeration
                    return True

                ctypes.windll.user32.EnumWindows(EnumWindowsProc(_enum_cb), 0)

                if found_hwnd:
                    hwnd = found_hwnd[0]
                    SW_RESTORE = 9
                    ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
                    ctypes.windll.user32.SetForegroundWindow(hwnd)
                    WaitUtils.wait_seconds(_WINDOW_SETTLE_DELAY_SECONDS)
                    return {"success": True, "message": f"Switched to window: {window_title}"}

                time.sleep(0.5)

            return {
                "success": False,
                "message": f"switch_window: window '{window_title}' not found within {timeout}s",
            }
        except Exception as e:
            return {"success": False, "message": f"switch_window error: {e}"}

    def _watch_popup(self, config: dict) -> dict:
        """
        Start (or stop) a background popup watcher.

        When ``enabled`` is True (the default) a :class:`PopupWatcher` daemon
        thread is launched that polls for windows matching the configured
        ``rules``.  Any previously running watcher is stopped first.

        When ``enabled`` is False any running watcher is stopped and the step
        succeeds immediately.

        Config keys
        -----------
        enabled          (bool)  – Whether to start the watcher. Default True.
        poll_interval_ms (int)   – Polling interval in ms. Default 300.
        rules            (list)  – List of rule dicts:
            title_substring (str) – Window title must contain this (required).
            text_contains   (str) – Optional; any child control text must contain this.
            action          (str) – "click_button" (default), "run_task", or "open_url".
            button_title    (str) – Button to click. Default "OK".
            linked_task_id  (str) – Task ID to run when action == "run_task".
            url             (str) – URL to open when action == "open_url".
        """
        from popup_watcher import PopupWatcher

        enabled = bool(config.get("enabled", True))

        # Stop any currently running watcher
        if self.active_popup_watcher is not None:
            try:
                self.active_popup_watcher.stop()
            except Exception:
                pass
            self.active_popup_watcher = None

        if not enabled:
            return {"success": True, "message": "watch_popup: watcher disabled / stopped"}

        poll_interval_ms = int(config.get("poll_interval_ms", 300))
        rules = config.get("rules", [])
        if not isinstance(rules, list):
            rules = []

        watcher = PopupWatcher(rules=rules, poll_interval_ms=poll_interval_ms, engine=self)
        started = watcher.start()

        if started:
            self.active_popup_watcher = watcher
            return {
                "success": True,
                "message": f"watch_popup: watcher started with {len(rules)} rule(s)",
            }

        # pywinauto unavailable — degrade gracefully
        return {
            "success": True,
            "message": "watch_popup: pywinauto not available — watcher skipped (non-fatal)",
        }

    def stop_popup_watcher(self):
        """Stop the active popup watcher if one is running."""
        if self.active_popup_watcher is not None:
            try:
                self.active_popup_watcher.stop()
            except Exception:
                pass
            self.active_popup_watcher = None

    def _tick_checkboxes_by_vr(self, config: dict) -> dict:
        """
        Tick checkboxes in a desktop grid for each VR number supplied.

        Config keys
        -----------
        vrColumn          (str)  – Excel column name (used when called from a
                                   loop row context via the engine variable).
                                   Ignored in standalone mode; use ``vrNumbers``
                                   instead.
        vrNumbers         (str)  – Literal comma-separated VR numbers.  Takes
                                   precedence over the ``vr_numbers`` engine
                                   variable.  Either this or an engine variable
                                   named ``vr_numbers`` must supply the list.
        itemCodeColumn    (str)  – Excel column name whose value is used as the
                                   Item Code filter (loop context only).
        itemCode          (str)  – Literal Item Code value.  When provided (or
                                   resolved from the ``item_code`` engine
                                   variable), a VR row is only ticked when both
                                   the VR number and this code appear on the
                                   same grid row.
        windowTitle       (str)  – Partial window title to activate before
                                   searching.  Blank = active window.
        gridRoi           (str)  – Screen region as "x,y,w,h".  Blank = full
                                   screen.
        scrollX           (int)  – X coordinate for scroll events.
        scrollY           (int)  – Y coordinate for scroll events.
        maxScrollAttempts (int)  – Maximum scroll steps per VR number. Default 20.
        scrollStep        (int)  – Mouse-wheel clicks per scroll. Default 3.
        checkboxOffset    (int)  – Pixels left of VR text for checkbox. Default 40.
        """
        from vr_checkbox_ticker import tick_checkboxes_by_vr

        # Resolve VR numbers string: explicit config first, then engine variable
        vr_list_str: str = str(config.get("vrNumbers", "")).strip()
        if not vr_list_str:
            vr_list_str = str(self.variables.get("vr_numbers", "")).strip()
        if not vr_list_str:
            return {
                "success": False,
                "message": (
                    "tick_checkboxes_by_vr: no VR numbers provided. "
                    "Set 'vrNumbers' in config or store them in the 'vr_numbers' engine variable."
                ),
            }

        # Resolve Item Code: explicit config first, then engine variable
        item_code: str = str(config.get("itemCode", "")).strip()
        if not item_code:
            item_code = str(self.variables.get("item_code", "")).strip()

        result = tick_checkboxes_by_vr(
            vr_list_str,
            window_title=str(config.get("windowTitle", "")),
            grid_roi=str(config.get("gridRoi", "")),
            scroll_x=int(config.get("scrollX", 0)),
            scroll_y=int(config.get("scrollY", 0)),
            max_scroll_attempts=int(config.get("maxScrollAttempts", 20)),
            scroll_step=int(config.get("scrollStep", 3)),
            checkbox_offset=int(config.get("checkboxOffset", 40)),
            item_code=item_code,
            vr_col_header=str(config.get("vrColumn", "")).strip(),
            item_code_col_header=str(config.get("itemCodeColumn", "")).strip(),
            row_tolerance=int(config.get("rowTolerance", 12)),
            engine=self,
        )

        return {"success": result.get("success", False), "message": result.get("message", "")}

    def _process_grid_cv(self, config: dict) -> dict:
        """
        Computer Vision batch fallback for ticking checkboxes.

        Reads all target (VR No, Item Code) pairs from an Excel file, then
        scans the desktop grid window using OpenCV row segmentation and
        column-targeted OCR to find and tick every matching checkbox in a
        single scrolling pass.

        Config keys
        -----------
        excelPath             (str)  – Path to the .xlsx / .csv file.
        sheetName             (str)  – Sheet name; default ``"Sheet1"``.
        startRow              (int)  – 1-based first data row; default 2.
        vrColumnName          (str)  – Excel column header for VR Nos.
        itemCodeColumnName    (str)  – Excel column header for Item Codes.
        windowTitle           (str)  – Partial window title to focus.
        gridRoi               (str)  – Screen region as ``"x,y,w,h"``.
        scrollX               (int)  – X coordinate for scroll events.
        scrollY               (int)  – Y coordinate for scroll events.
        maxScroll             (int)  – Maximum scroll attempts; default 20.
        scrollStep            (int)  – Wheel clicks per scroll; default 5.
        cbOffset              (int)  – Pixels left of VR text to checkbox; default 40.
        """
        from grid_cv_processor import process_grid_cv

        cv_config = {
            "excel_path":            str(config.get("excelPath", "")).strip(),
            "sheet_name":            str(config.get("sheetName", "Sheet1")).strip() or "Sheet1",
            "start_row":             int(config.get("startRow", 2)),
            "vr_column_name":        str(config.get("vrColumnName", "")).strip(),
            "item_code_column_name": str(config.get("itemCodeColumnName", "")).strip(),
            "window_title":          str(config.get("windowTitle", "")).strip(),
            "grid_roi":              config.get("gridRoi"),
            "scroll_x":              int(config.get("scrollX", 0)),
            "scroll_y":              int(config.get("scrollY", 0)),
            "max_scroll":            int(config.get("maxScroll", 20)),
            "scroll_step":           int(config.get("scrollStep", 5)),
            "cb_offset":             int(config.get("cbOffset", 40)),
            "click_delay_ms":        int(config.get("clickDelayMs", 150)),
            "scroll_delay_ms":       int(config.get("scrollDelayMs", 350)),
            # Pass the engine reference so the module can use pywinauto for window activation
            "_engine":               self,
        }

        result = process_grid_cv(cv_config)
        return {"success": result.get("success", False), "message": result.get("message", "")}
