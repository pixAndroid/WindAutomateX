"""
Utility functions for waiting on Windows UI elements and conditions.
"""
import time
import logging

logger = logging.getLogger(__name__)


class WaitUtils:
    @staticmethod
    def wait_for_window(title: str, timeout: int = 30) -> bool:
        """Wait for a window with the given title to appear."""
        try:
            from pywinauto import Desktop
            end_time = time.time() + timeout
            while time.time() < end_time:
                try:
                    windows = Desktop(backend="uia").windows()
                    for w in windows:
                        try:
                            if title.lower() in w.window_text().lower():
                                return True
                        except Exception:
                            pass
                except Exception:
                    pass
                time.sleep(0.5)
            return False
        except ImportError:
            logger.warning("pywinauto not available - simulating wait_for_window")
            time.sleep(1)
            return True

    @staticmethod
    def wait_for_download(folder: str, timeout: int = 300) -> bool:
        """Wait for a file to finish downloading in the given folder."""
        import os
        end_time = time.time() + timeout
        while time.time() < end_time:
            try:
                files = os.listdir(folder)
                downloading = [f for f in files if f.endswith('.crdownload') or f.endswith('.part')]
                if not downloading and len(files) > 0:
                    return True
            except Exception:
                pass
            time.sleep(1)
        return False

    @staticmethod
    def wait_for_upload(window_title: str, timeout: int = 60) -> bool:
        """Wait for an upload dialog to close."""
        try:
            from pywinauto import Desktop
            end_time = time.time() + timeout
            while time.time() < end_time:
                try:
                    windows = Desktop(backend="uia").windows()
                    found = any(
                        window_title.lower() in w.window_text().lower()
                        for w in windows
                    )
                    if not found:
                        return True
                except Exception:
                    pass
                time.sleep(0.5)
            return False
        except ImportError:
            logger.warning("pywinauto not available - simulating wait_for_upload")
            time.sleep(1)
            return True

    @staticmethod
    def wait_seconds(seconds: float) -> None:
        """Simple delay."""
        time.sleep(seconds)
