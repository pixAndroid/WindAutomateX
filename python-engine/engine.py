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
        self._try_import_libraries()

    def _try_import_libraries(self):
        """Try to import optional automation libraries."""
        self.pywinauto_available = False
        self.pyautogui_available = False

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
