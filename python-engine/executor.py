"""
Executor: runs a list of task steps sequentially using the engine.

When the task contains an ``excel_form_submit_loop`` step the executor
switches to *loop mode*: it runs the steps that come before the loop step
**once**, then iterates the ``excel_form_submit_loop`` step once per Excel
data row, and finally runs any steps after the loop step **once**.  Main
setup steps (e.g. launch_exe, click_coordinate) are therefore not repeated
for every row.
"""
import json
import logging
import time

from engine import WindAutomateXEngine

logger = logging.getLogger(__name__)


class TaskExecutor:
    def __init__(self):
        self.engine = WindAutomateXEngine()

    # ------------------------------------------------------------------
    # Public entry-point
    # ------------------------------------------------------------------

    def execute(self, task_id: int, steps_json: str, all_tasks: dict | None = None) -> dict:
        """Execute all steps for a task. Returns final status dict."""
        try:
            steps = json.loads(steps_json)
        except json.JSONDecodeError as e:
            return {"status": "failed", "message": f"Invalid steps JSON: {e}"}

        if not isinstance(steps, list):
            return {"status": "failed", "message": "Steps must be a list"}

        # Propagate the all_tasks map so run_task steps can resolve child tasks
        if all_tasks:
            self.engine.all_tasks = all_tasks

        # If the task contains an excel_form_submit_loop step, run pre/post
        # steps once and iterate only the loop step per Excel row.
        loop_step_index = next(
            (i for i, s in enumerate(steps) if s.get("step_type") == "excel_form_submit_loop"),
            None,
        )
        if loop_step_index is not None:
            return self._run_with_excel_row_loop(task_id, steps, loop_step_index)

        return self._run_sequential(task_id, steps)

    # ------------------------------------------------------------------
    # Sequential (no Excel loop) execution
    # ------------------------------------------------------------------

    def _run_sequential(self, task_id: int, steps: list) -> dict:
        """Run all steps in order, stopping on the first failure."""
        total = len(steps)
        logger.info(f"Starting task {task_id} with {total} steps")
        print(json.dumps({"event": "start", "task_id": task_id, "total_steps": total}), flush=True)

        for i, step in enumerate(steps):
            step_type = step.get("step_type", "unknown")
            logger.info(f"Step {i + 1}/{total}: {step_type}")
            print(json.dumps({"event": "step_start", "step": i + 1, "type": step_type}), flush=True)

            result = self.engine.execute_step(step)

            print(json.dumps({
                "event": "step_done",
                "step": i + 1,
                "type": step_type,
                "success": result.get("success", False),
                "message": result.get("message", ""),
            }), flush=True)

            if not result.get("success", False):
                logger.error(f"Step {i + 1} failed: {result.get('message')}")
                print(json.dumps({"status": "failed", "message": result.get("message", "Step failed")}), flush=True)
                self.engine.stop_popup_watcher()
                return {"status": "failed", "step": i + 1, "message": result.get("message", "")}

            self._apply_step_delay(step)

        logger.info(f"Task {task_id} completed all {total} steps")
        self._wait_for_popup_watcher(task_id)
        logger.info(f"Task {task_id} completed successfully")
        print(json.dumps({"status": "completed", "task_id": task_id, "steps_run": total}), flush=True)
        self.engine.stop_popup_watcher()
        return {"status": "completed"}

    # ------------------------------------------------------------------
    # Loop (per-Excel-row) execution
    # ------------------------------------------------------------------

    def _run_with_excel_row_loop(self, task_id: int, steps: list, loop_step_index: int) -> dict:
        """
        Execute the task in loop mode:

        1. Run all steps **before** the ``excel_form_submit_loop`` step once.
        2. Iterate the ``excel_form_submit_loop`` step once per Excel data row.
        3. Run all steps **after** the loop step once.

        Main setup steps (e.g. launch_exe, click_coordinate) are therefore
        not repeated for every data row.

        The ``continueOnError`` and ``delayBetweenRows`` settings from the
        loop step's configuration are respected across rows.
        """
        from excel_loop import load_excel_rows, run_excel_form_loop_for_row

        loop_step = steps[loop_step_index]
        pre_steps = steps[:loop_step_index]
        post_steps = steps[loop_step_index + 1:]

        try:
            loop_config = json.loads(loop_step.get("config_json", "{}") or "{}")
        except json.JSONDecodeError:
            loop_config = {}

        file_path: str = loop_config.get("filePath", "")
        if not file_path:
            msg = "excel_form_submit_loop: filePath is required"
            print(json.dumps({"status": "failed", "message": msg}), flush=True)
            return {"status": "failed", "message": msg}

        sheet_name: str = loop_config.get("sheetName", "Sheet1")
        has_header: bool = bool(loop_config.get("hasHeader", True))
        start_row: int = int(loop_config.get("startRow", 2))
        end_row_raw = loop_config.get("endRow")
        end_row: int | None = int(end_row_raw) if end_row_raw is not None else None
        continue_on_error: bool = bool(loop_config.get("continueOnError", True))
        delay_between_rows: int = int(loop_config.get("delayBetweenRows", 1000))

        try:
            rows = load_excel_rows(file_path, sheet_name, has_header, start_row, end_row)
        except Exception as e:
            msg = f"excel_form_submit_loop: Failed to load file: {e}"
            print(json.dumps({"status": "failed", "message": msg}), flush=True)
            return {"status": "failed", "message": msg}

        if not rows:
            msg = "excel_form_submit_loop: No data rows found in the specified range"
            print(json.dumps({"status": "failed", "message": msg}), flush=True)
            return {"status": "failed", "message": msg}

        total_rows = len(rows)
        total_steps = len(steps)
        logger.info(
            f"Starting task {task_id} in loop mode: {total_rows} rows, {total_steps} steps"
        )
        print(
            json.dumps({
                "event": "start",
                "task_id": task_id,
                "total_steps": total_steps,
                "total_rows": total_rows,
            }),
            flush=True,
        )

        # --- Phase 1: run pre-loop steps once ---
        for step_idx, step in enumerate(pre_steps):
            step_type = step.get("step_type", "unknown")
            logger.info(f"Pre-loop Step {step_idx + 1}/{len(pre_steps)}: {step_type}")
            print(
                json.dumps({"event": "step_start", "step": step_idx + 1, "type": step_type}),
                flush=True,
            )

            result = self.engine.execute_step(step)

            print(
                json.dumps({
                    "event": "step_done",
                    "step": step_idx + 1,
                    "type": step_type,
                    "success": result.get("success", False),
                    "message": result.get("message", ""),
                }),
                flush=True,
            )

            if not result.get("success", False):
                logger.error(f"Pre-loop step {step_idx + 1} failed: {result.get('message')}")
                print(
                    json.dumps({"status": "failed", "message": result.get("message", "Step failed")}),
                    flush=True,
                )
                self.engine.stop_popup_watcher()
                return {"status": "failed", "step": step_idx + 1, "message": result.get("message", "")}

            self._apply_step_delay(step)

        # --- Phase 2: loop the excel_form_submit_loop step per row ---
        rows_succeeded = 0
        rows_failed = 0
        for row_idx, row in enumerate(rows):
            logger.info(f"Row {row_idx + 1}/{total_rows}")
            print(
                json.dumps({"event": "row_start", "row": row_idx + 1, "total_rows": total_rows}),
                flush=True,
            )

            step_type = loop_step.get("step_type", "excel_form_submit_loop")
            print(
                json.dumps({
                    "event": "step_start",
                    "step": loop_step_index + 1,
                    "type": step_type,
                    "row": row_idx + 1,
                }),
                flush=True,
            )

            result = run_excel_form_loop_for_row(loop_config, row, row_idx, self.engine)

            print(
                json.dumps({
                    "event": "step_done",
                    "step": loop_step_index + 1,
                    "type": step_type,
                    "row": row_idx + 1,
                    "success": result.get("success", False),
                    "message": result.get("message", ""),
                }),
                flush=True,
            )

            row_failed = not result.get("success", False)
            if row_failed:
                rows_failed += 1
                logger.error(f"Row {row_idx + 1} failed: {result.get('message')}")
                if not continue_on_error:
                    print(
                        json.dumps({"status": "failed", "message": result.get("message", "Row failed")}),
                        flush=True,
                    )
                    self.engine.stop_popup_watcher()
                    return {
                        "status": "failed",
                        "row": row_idx + 1,
                        "step": loop_step_index + 1,
                        "message": result.get("message", ""),
                    }

            else:
                rows_succeeded += 1

            print(
                json.dumps({"event": "row_done", "row": row_idx + 1, "success": not row_failed}),
                flush=True,
            )

            # Delay between rows (skip after the last row)
            if row_idx < total_rows - 1 and delay_between_rows > 0:
                time.sleep(delay_between_rows / 1000.0)

        # --- Phase 3: run post-loop steps once ---
        for step_idx, step in enumerate(post_steps):
            global_step_idx = loop_step_index + 1 + step_idx
            step_type = step.get("step_type", "unknown")
            logger.info(f"Post-loop Step {step_idx + 1}/{len(post_steps)}: {step_type}")
            print(
                json.dumps({"event": "step_start", "step": global_step_idx + 1, "type": step_type}),
                flush=True,
            )

            result = self.engine.execute_step(step)

            print(
                json.dumps({
                    "event": "step_done",
                    "step": global_step_idx + 1,
                    "type": step_type,
                    "success": result.get("success", False),
                    "message": result.get("message", ""),
                }),
                flush=True,
            )

            if not result.get("success", False):
                logger.error(f"Post-loop step {step_idx + 1} failed: {result.get('message')}")
                print(
                    json.dumps({"status": "failed", "message": result.get("message", "Step failed")}),
                    flush=True,
                )
                self.engine.stop_popup_watcher()
                return {"status": "failed", "step": global_step_idx + 1, "message": result.get("message", "")}

            self._apply_step_delay(step)

        logger.info(
            f"Task {task_id} completed all rows: {rows_succeeded}/{total_rows} rows succeeded, "
            f"{rows_failed} failed"
        )
        self._wait_for_popup_watcher(task_id)
        logger.info(
            f"Task {task_id} completed: {rows_succeeded}/{total_rows} rows succeeded, "
            f"{rows_failed} failed"
        )
        print(
            json.dumps({
                "status": "completed",
                "task_id": task_id,
                "rows_run": total_rows,
                "rows_succeeded": rows_succeeded,
                "rows_failed": rows_failed,
            }),
            flush=True,
        )
        self.engine.stop_popup_watcher()
        return {"status": "completed"}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _wait_for_popup_watcher(self, task_id: int) -> None:
        """Block until the active popup watcher has stopped, if one is running.

        A "continuous" watcher will block here until the task is externally
        stopped (e.g. via SIGTERM when the user clicks Stop).  A "once"-only
        watcher will have already stopped itself once all its rules have fired,
        so this call returns immediately in that case.
        """
        watcher = self.engine.active_popup_watcher
        if not (watcher and watcher.is_running()):
            return

        logger.info(f"Task {task_id}: popup watcher active — keeping task alive until stopped")
        print(json.dumps({
            "status": "running",
            "task_id": task_id,
            "message": "Popup watcher active — task running continuously until stopped",
        }), flush=True)
        try:
            while watcher.is_running():
                time.sleep(0.5)
        except (KeyboardInterrupt, SystemExit):
            pass

    @staticmethod
    def _apply_step_delay(step: dict) -> None:
        """Sleep for the per-step delay configured in *step*'s config_json."""
        try:
            config = json.loads(step.get("config_json", "{}") or "{}")
        except json.JSONDecodeError:
            config = {}
        try:
            delay_ms = int(config.get("delay", 60))
        except (TypeError, ValueError):
            delay_ms = 60
        if delay_ms > 0:
            time.sleep(delay_ms / 1000.0)
