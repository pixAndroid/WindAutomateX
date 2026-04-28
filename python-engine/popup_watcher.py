"""
Realtime popup watcher using pywinauto UIA.

Runs in a background daemon thread and polls for specific dialog windows
matching configured rules. When a match is found the configured action is
performed (e.g. click a button or run a linked task).

Gracefully degrades when pywinauto is not available.
"""
import json
import logging
import threading
import time
import webbrowser

logger = logging.getLogger(__name__)

try:
    from pywinauto import Desktop as _Desktop  # noqa: F401
    PYWINAUTO_AVAILABLE = True
except Exception:
    PYWINAUTO_AVAILABLE = False
    logger.warning("pywinauto not available — popup watcher is disabled")

try:
    import pyautogui as _pyautogui  # noqa: F401
    PYAUTOGUI_AVAILABLE = True
except Exception:
    PYAUTOGUI_AVAILABLE = False
    logger.warning("pyautogui not available — keyboard_shortcut action disabled")


class PopupWatcher:
    """
    Background watcher that polls for popup windows matching configured rules
    and performs handler actions when they are detected.

    Parameters
    ----------
    rules : list of dicts, each with:
        title_substring  (str)  – window title must contain this (case-insensitive).
        text_contains    (str)  – optional; at least one child control must contain this text.
        action           (str)  – "click_button" (default), "run_task", "open_url", or "keyboard_shortcut".
        button_title     (str)  – button title to click (default "OK").
        linked_task_id   (str)  – task ID to run when action == "run_task".
        url              (str)  – URL to open when action == "open_url".
        shortcut_keys    (str)  – keys to send when action == "keyboard_shortcut" (e.g. "alt+f4").
        monitor_mode     (str)  – "continuous" (default) keeps watching indefinitely;
                                  "once" deactivates the rule after the first match.
    poll_interval_ms : int
        How often (in ms) to poll for windows. Default 300.
    engine : WindAutomateXEngine or None
        Reference to the engine for resolving linked tasks. Required for
        action == "run_task".
    """

    def __init__(self, rules: list, poll_interval_ms: int = 300, engine=None):
        self.rules = rules
        self.poll_interval = max(50, poll_interval_ms) / 1000.0
        self.engine = engine
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        # Tracks indices of rules whose monitor_mode is "once" and have already fired
        self._completed_once_rules: set[int] = set()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self) -> bool:
        """
        Start the watcher thread.

        Returns False (and logs a warning) when pywinauto is not available
        so the calling code can decide whether to abort or continue without
        the watcher.
        """
        if not PYWINAUTO_AVAILABLE:
            logger.warning("PopupWatcher: pywinauto is not available — popup watcher disabled")
            print(json.dumps({
                "event": "popup_watcher",
                "status": "unavailable",
                "message": "pywinauto not available — popup watcher disabled",
            }), flush=True)
            return False

        if not self.rules:
            logger.info("PopupWatcher: no rules configured — watcher not started")
            print(json.dumps({
                "event": "popup_watcher",
                "status": "skipped",
                "message": "No popup rules configured",
            }), flush=True)
            return False

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="PopupWatcher"
        )
        self._thread.start()
        logger.info(
            f"PopupWatcher started — {len(self.rules)} rule(s), "
            f"poll interval {self.poll_interval * 1000:.0f} ms"
        )
        print(json.dumps({
            "event": "popup_watcher",
            "status": "started",
            "rules": len(self.rules),
            "poll_interval_ms": int(self.poll_interval * 1000),
        }), flush=True)
        return True

    def stop(self):
        """Signal the watcher thread to stop and wait for it to exit."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("PopupWatcher stopped")
        print(json.dumps({"event": "popup_watcher", "status": "stopped"}), flush=True)

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ------------------------------------------------------------------
    # Internal loop
    # ------------------------------------------------------------------

    def _run(self):
        """Main polling loop — runs in a daemon thread."""
        while not self._stop_event.is_set():
            # When every rule has monitor_mode "once" and has already fired,
            # there is nothing left to watch — stop automatically so that the
            # parent task can complete normally.
            if len(self.rules) > 0 and all(
                rule.get("monitor_mode", "continuous") == "once"
                and i in self._completed_once_rules
                for i, rule in enumerate(self.rules)
            ):
                logger.info("PopupWatcher: all once-rules have fired — stopping automatically")
                print(json.dumps({
                    "event": "popup_watcher",
                    "status": "all_rules_done",
                    "message": "All once-rules have fired — watcher stopped automatically",
                }), flush=True)
                break
            try:
                self._check_popups()
            except Exception as exc:
                logger.debug(f"PopupWatcher loop error (ignored): {exc}")
            self._stop_event.wait(self.poll_interval)

    def _check_popups(self):
        """Enumerate top-level windows and test each rule."""
        from pywinauto import Desktop

        try:
            windows = Desktop(backend="uia").windows()
        except Exception as exc:
            logger.debug(f"PopupWatcher: failed to enumerate windows: {exc}")
            return

        for rule_idx, rule in enumerate(self.rules):
            # Skip rules that already fired in "once" mode
            if rule_idx in self._completed_once_rules:
                continue

            title_sub = rule.get("title_substring", "").strip()
            text_contains = rule.get("text_contains", "").strip()
            action = rule.get("action", "click_button")
            button_title = rule.get("button_title", "OK").strip() or "OK"
            linked_task_id = str(rule.get("linked_task_id", "")).strip()
            url = str(rule.get("url", "")).strip()
            shortcut_keys = str(rule.get("shortcut_keys", "")).strip()
            monitor_mode = rule.get("monitor_mode", "continuous")

            if not title_sub:
                continue  # rule must have a title filter

            for win in windows:
                if self._stop_event.is_set():
                    return
                try:
                    win_title = (win.window_text() or "").strip()
                    if title_sub.lower() not in win_title.lower():
                        continue

                    # Optional text-content check
                    if text_contains:
                        if not self._window_contains_text(win, text_contains):
                            continue

                    # ---- Match found ----
                    logger.info(f"PopupWatcher: detected popup '{win_title}' — rule title='{title_sub}' mode='{monitor_mode}'")
                    print(json.dumps({
                        "event": "popup_detected",
                        "title": win_title,
                        "rule_title": title_sub,
                        "action": action,
                        "monitor_mode": monitor_mode,
                    }), flush=True)

                    self._handle_popup(win, win_title, action, button_title, linked_task_id, url, shortcut_keys)

                    # Deactivate this rule after the first match when mode is "once"
                    if monitor_mode == "once":
                        self._completed_once_rules.add(rule_idx)
                        logger.info(
                            f"PopupWatcher: rule {rule_idx} (title='{title_sub}') set to 'once' — deactivated after first match"
                        )
                        print(json.dumps({
                            "event": "popup_rule_done",
                            "rule_index": rule_idx,
                            "rule_title": title_sub,
                            "monitor_mode": "once",
                        }), flush=True)
                        # Break the inner window loop: the rule has fired and is now
                        # marked complete, so there is no need to inspect any further
                        # windows for it within the same polling cycle.
                        break

                except Exception as exc:
                    logger.debug(f"PopupWatcher: error inspecting window: {exc}")

    @staticmethod
    def _window_contains_text(win, text: str) -> bool:
        """Return True if any descendant control's text contains *text*."""
        try:
            for child in win.descendants():
                try:
                    t = child.window_text() or ""
                    if text.lower() in t.lower():
                        return True
                except Exception:
                    pass
        except Exception:
            pass
        return False

    def _handle_popup(
        self,
        win,
        win_title: str,
        action: str,
        button_title: str,
        linked_task_id: str,
        url: str = "",
        shortcut_keys: str = "",
    ):
        """Perform the configured handler action on a matched popup window."""
        # Bring the dialog to the foreground first
        try:
            win.set_focus()
            time.sleep(0.1)
        except Exception as exc:
            logger.debug(f"PopupWatcher: set_focus failed: {exc}")

        if action == "open_url" and url:
            self._open_url(win_title, url)
        elif action == "run_task" and linked_task_id:
            self._run_linked_task(win_title, linked_task_id)
        elif action == "keyboard_shortcut" and shortcut_keys:
            self._press_keyboard_shortcut(win_title, shortcut_keys)
        else:
            # Default: click the configured button (usually "OK")
            self._click_button(win, win_title, button_title)

    def _click_button(self, win, win_title: str, button_title: str):
        """Find and click *button_title* inside *win*."""
        try:
            btn = win.child_window(title=button_title, control_type="Button")
            btn.click_input()
            logger.info(f"PopupWatcher: clicked '{button_title}' on '{win_title}'")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "click_button",
                "button": button_title,
                "success": True,
            }), flush=True)
        except Exception as exc:
            logger.error(f"PopupWatcher: failed to click '{button_title}' on '{win_title}': {exc}")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "click_button",
                "button": button_title,
                "success": False,
                "message": str(exc),
            }), flush=True)

    def _press_keyboard_shortcut(self, win_title: str, shortcut_keys: str):
        """Send a keyboard shortcut to the focused window using pyautogui."""
        if not PYAUTOGUI_AVAILABLE:
            logger.error("PopupWatcher: pyautogui not available — cannot send keyboard shortcut")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "keyboard_shortcut",
                "keys": shortcut_keys,
                "success": False,
                "message": "pyautogui not available",
            }), flush=True)
            return
        try:
            import pyautogui
            keys = [k.strip() for k in shortcut_keys.split("+") if k.strip()]
            if not keys:
                logger.warning(f"PopupWatcher: shortcut_keys is empty for popup '{win_title}' — skipping")
                return
            if len(keys) == 1:
                pyautogui.press(keys[0])
            else:
                pyautogui.hotkey(*keys)
            logger.info(f"PopupWatcher: sent shortcut '{shortcut_keys}' for popup '{win_title}'")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "keyboard_shortcut",
                "keys": shortcut_keys,
                "success": True,
            }), flush=True)
        except Exception as exc:
            logger.error(f"PopupWatcher: failed to send shortcut '{shortcut_keys}' for '{win_title}': {exc}")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "keyboard_shortcut",
                "keys": shortcut_keys,
                "success": False,
                "message": str(exc),
            }), flush=True)

    def _open_url(self, win_title: str, url: str):
        """Open *url* in the default system browser."""
        try:
            webbrowser.open(url)
            logger.info(f"PopupWatcher: opened URL '{url}' triggered by popup '{win_title}'")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "open_url",
                "url": url,
                "success": True,
            }), flush=True)
        except Exception as exc:
            logger.error(f"PopupWatcher: failed to open URL '{url}': {exc}")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "open_url",
                "url": url,
                "success": False,
                "message": str(exc),
            }), flush=True)

    def _run_linked_task(self, win_title: str, linked_task_id: str):
        """Execute a linked child task via the engine."""
        if self.engine is None:
            logger.error("PopupWatcher: engine reference not set — cannot run linked task")
            return

        task_steps = self.engine.all_tasks.get(str(linked_task_id), [])
        if not task_steps:
            logger.warning(f"PopupWatcher: linked task {linked_task_id} not found or has no steps")
            print(json.dumps({
                "event": "popup_handled",
                "title": win_title,
                "action": "run_task",
                "task_id": linked_task_id,
                "success": False,
                "message": f"Linked task {linked_task_id} not found",
            }), flush=True)
            return

        logger.info(f"PopupWatcher: running linked task {linked_task_id} ({len(task_steps)} steps)")
        print(json.dumps({
            "event": "popup_handled",
            "title": win_title,
            "action": "run_task",
            "task_id": linked_task_id,
            "steps": len(task_steps),
        }), flush=True)

        for i, step in enumerate(task_steps):
            if self._stop_event.is_set():
                break
            try:
                result = self.engine.execute_step(step)
                if not result.get("success", False):
                    logger.error(
                        f"PopupWatcher: linked task {linked_task_id} step {i + 1} failed: "
                        f"{result.get('message')}"
                    )
                    break
            except Exception as exc:
                logger.error(f"PopupWatcher: linked task step {i + 1} raised: {exc}")
                break
