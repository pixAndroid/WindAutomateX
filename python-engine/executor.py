"""
Executor: runs a list of task steps sequentially using the engine.
"""
import json
import logging
import sys
import time

from engine import WindAutomateXEngine

logger = logging.getLogger(__name__)


class TaskExecutor:
    def __init__(self):
        self.engine = WindAutomateXEngine()

    def execute(self, task_id: int, steps_json: str) -> dict:
        """Execute all steps for a task. Returns final status dict."""
        try:
            steps = json.loads(steps_json)
        except json.JSONDecodeError as e:
            return {"status": "failed", "message": f"Invalid steps JSON: {e}"}

        if not isinstance(steps, list):
            return {"status": "failed", "message": "Steps must be a list"}

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
                return {"status": "failed", "step": i + 1, "message": result.get("message", "")}

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

        logger.info(f"Task {task_id} completed successfully")
        print(json.dumps({"status": "completed", "task_id": task_id, "steps_run": total}), flush=True)
        return {"status": "completed"}
