"""
IPC handler: reads JSON commands from stdin and executes them.
Used by the Electron main process to communicate with the Python engine.
"""
import json
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)

logger = logging.getLogger(__name__)


def main():
    from executor import TaskExecutor
    executor = TaskExecutor()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"status": "failed", "message": f"Invalid JSON: {e}"}), flush=True)
            continue

        command = msg.get("command", "")

        if command == "execute":
            task_id = msg.get("task_id", 0)
            steps_json = msg.get("steps", "[]")
            executor.execute(task_id, steps_json)
        elif command == "get_headers":
            file_path = msg.get("file_path", "")
            sheet_name = msg.get("sheet_name") or None
            try:
                from excel_loop import get_excel_headers
                headers = get_excel_headers(file_path, sheet_name)
                print(json.dumps({"status": "ok", "headers": headers}), flush=True)
            except Exception as e:
                print(json.dumps({"status": "failed", "message": str(e)}), flush=True)
        elif command == "ping":
            print(json.dumps({"status": "pong"}), flush=True)
        else:
            print(json.dumps({"status": "failed", "message": f"Unknown command: {command}"}), flush=True)


if __name__ == "__main__":
    main()
