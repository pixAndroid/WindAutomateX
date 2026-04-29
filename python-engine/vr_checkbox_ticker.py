"""
VR Checkbox Ticker — WindAutomateX helper module.

Reads a comma-separated list of VR numbers, finds each one in a desktop
grid window using OCR, and ticks its corresponding checkbox.  If a VR
number is not currently visible the grid is auto-scrolled until it is
found or the scroll limit is reached.

When an optional *item_code* is supplied, the row is only ticked when
**both** the VR number and the Item Code appear on the same grid row
(matching y-centre within a small tolerance).  This prevents accidentally
ticking a duplicate VR number that belongs to a different item.

Public API
----------
tick_checkboxes_by_vr(vr_list_str, *, window_title, grid_roi,
                      scroll_x, scroll_y, max_scroll_attempts,
                      scroll_step, checkbox_offset, item_code, engine) -> dict
    Main entry-point.  Returns a result dict with keys:
        success      – True when at least one VR was checked without error
        checked      – list of VR numbers successfully ticked
        not_found    – list of VR numbers not found after full scroll
        errors       – list of per-VR error strings
        message      – human-readable summary
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# VR list parsing
# ---------------------------------------------------------------------------

def parse_vr_list(vr_list_str: str) -> list[str]:
    """Split *vr_list_str* on commas and return a deduplicated, trimmed list."""
    if not vr_list_str:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for item in vr_list_str.split(","):
        token = item.strip()
        if token and token not in seen:
            seen.add(token)
            result.append(token)
    return result


# ---------------------------------------------------------------------------
# Screenshot helpers
# ---------------------------------------------------------------------------

def _capture_roi(roi: Optional[tuple], pyautogui):
    """Return a NumPy RGB array of either the full screen or *roi*."""
    import numpy as np
    if roi:
        x, y, w, h = roi
        img = pyautogui.screenshot(region=(x, y, w, h))
    else:
        img = pyautogui.screenshot()
    return np.array(img)


def _images_are_same(img1, img2, threshold: float = 0.995) -> bool:
    """Return True when *img1* and *img2* are nearly identical (end-of-scroll)."""
    import numpy as np
    if img1 is None:
        return False
    if img1.shape != img2.shape:
        return False
    import cv2
    diff = cv2.absdiff(img1, img2)
    non_zero_ratio = np.count_nonzero(diff) / diff.size
    return non_zero_ratio < (1.0 - threshold)


# ---------------------------------------------------------------------------
# OCR helpers
# ---------------------------------------------------------------------------

def _ocr_get_data(image):
    """
    Run pytesseract on *image* and return the raw data dict.

    Raises ``ImportError`` when pytesseract is not installed so the caller
    can surface a clear message to the user.
    """
    try:
        import pytesseract
    except ImportError as exc:
        raise ImportError(
            "pytesseract is required for the 'Tick Checkboxes by VR Nos' action. "
            "Install it with: pip install pytesseract  "
            "(Tesseract OCR engine must also be installed on the system)"
        ) from exc

    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) if image.ndim == 3 else image
    return pytesseract.image_to_data(gray, output_type=pytesseract.Output.DICT)


def _find_all_bboxes(ocr_data: dict, search_text: str) -> list[tuple[int, int, int, int]]:
    """
    Return **all** bounding boxes whose OCR word contains *search_text*
    (case-insensitive sub-string match).

    Each entry is an ``(x, y, w, h)`` tuple relative to the captured image.
    """
    needle = search_text.lower()
    results: list[tuple[int, int, int, int]] = []
    for i, word in enumerate(ocr_data["text"]):
        if not word:
            continue
        if needle in word.lower():
            x = int(ocr_data["left"][i])
            y = int(ocr_data["top"][i])
            w = int(ocr_data["width"][i])
            h = int(ocr_data["height"][i])
            if w > 0 and h > 0:
                results.append((x, y, w, h))
    return results


def _ocr_find_text(image, search_text: str) -> Optional[tuple]:
    """
    Use pytesseract to locate the **first** occurrence of *search_text* in
    *image*.

    Returns an (x, y, w, h) bounding box **relative to image**, or None.
    The search is case-insensitive and also matches when *search_text* is a
    sub-string of a recognised word (handles slight OCR mis-reads).
    """
    data = _ocr_get_data(image)
    bboxes = _find_all_bboxes(data, search_text)
    return bboxes[0] if bboxes else None


def _ocr_find_text_with_item_code(
    image, vr_text: str, item_code: str, row_tolerance: int = 12
) -> Optional[tuple]:
    """
    Locate *vr_text* in *image* **only when** *item_code* also appears on
    the same grid row (y-centres within *row_tolerance* pixels).

    Returns the VR text bounding box ``(x, y, w, h)`` if a matching pair is
    found, otherwise ``None``.
    """
    data = _ocr_get_data(image)
    vr_bboxes = _find_all_bboxes(data, vr_text)
    code_bboxes = _find_all_bboxes(data, item_code)

    if not vr_bboxes or not code_bboxes:
        return None

    for vr_bbox in vr_bboxes:
        vr_cy = vr_bbox[1] + vr_bbox[3] // 2
        for code_bbox in code_bboxes:
            code_cy = code_bbox[1] + code_bbox[3] // 2
            if abs(vr_cy - code_cy) <= row_tolerance:
                return vr_bbox
    return None


# ---------------------------------------------------------------------------
# Window activation
# ---------------------------------------------------------------------------

def _activate_window(window_title: str, engine) -> None:
    """Bring *window_title* to the foreground using pywinauto if available."""
    if not window_title:
        return
    try:
        if engine is not None and getattr(engine, "pywinauto_available", False):
            from pywinauto import Application
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            app.top_window().set_focus()
            time.sleep(0.3)
        else:
            import pyautogui
            # Fallback: use Alt+Tab heuristic is not reliable; just log a warning
            logger.warning(
                "pywinauto not available — cannot reliably activate window '%s'",
                window_title,
            )
    except Exception as exc:
        logger.warning("Could not activate window '%s': %s", window_title, exc)


# ---------------------------------------------------------------------------
# ROI parsing
# ---------------------------------------------------------------------------

def _parse_roi(grid_roi: str) -> Optional[tuple[int, int, int, int]]:
    """Parse 'x,y,w,h' string → tuple or None."""
    if not grid_roi:
        return None
    try:
        parts = [int(p.strip()) for p in grid_roi.split(",")]
        if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
            return (parts[0], parts[1], parts[2], parts[3])
    except (ValueError, IndexError):
        logger.warning("Invalid gridRoi '%s' — ignoring", grid_roi)
    return None


# ---------------------------------------------------------------------------
# Main public function
# ---------------------------------------------------------------------------

def tick_checkboxes_by_vr(
    vr_list_str: str,
    *,
    window_title: str = "",
    grid_roi: str = "",
    scroll_x: int = 0,
    scroll_y: int = 0,
    max_scroll_attempts: int = 20,
    scroll_step: int = 3,
    checkbox_offset: int = 40,
    item_code: str = "",
    engine=None,
) -> dict:
    """
    Tick checkboxes for every VR number in *vr_list_str*.

    Parameters
    ----------
    vr_list_str : str
        Comma-separated VR numbers, e.g. ``"EZ25Y-042, EZ25Y-047, EZ25Y-050"``.
    window_title : str
        Partial title of the target desktop window.  Leave blank to use the
        currently active window.
    grid_roi : str
        Screen region for OCR as ``"x,y,width,height"``.  Leave blank for
        full-screen capture.
    scroll_x, scroll_y : int
        Screen coordinates where mouse scroll events are sent.  When both are
        0 **and** a ROI is given the centre of the ROI is used instead.
    max_scroll_attempts : int
        Maximum number of scroll steps per VR number before giving up.
    scroll_step : int
        Mouse-wheel click count per scroll event (positive = down).
    checkbox_offset : int
        Horizontal pixels to the **left** of the detected VR text where the
        checkbox column lives.
    item_code : str
        When provided, a VR number is only ticked when both the VR number
        **and** this item code appear on the same grid row.  Rows where only
        the VR number matches (but the item code differs) are skipped.
    engine : WindAutomateXEngine | None
        Shared engine instance used for pywinauto window activation.

    Returns
    -------
    dict
        ``{"success": bool, "checked": [...], "not_found": [...],
           "errors": [...], "message": str}``
    """
    try:
        import pyautogui
    except ImportError:
        return {
            "success": False,
            "checked": [],
            "not_found": [],
            "errors": ["pyautogui is required but not installed"],
            "message": "pyautogui is required",
        }

    vr_numbers = parse_vr_list(vr_list_str)
    if not vr_numbers:
        return {
            "success": False,
            "checked": [],
            "not_found": [],
            "errors": [],
            "message": "No VR numbers to process (empty or blank input)",
        }

    logger.info("tick_checkboxes_by_vr: processing %d VR number(s): %s", len(vr_numbers), vr_numbers)

    # Activate target window
    _activate_window(window_title, engine)

    # Parse ROI
    roi = _parse_roi(grid_roi)

    # Resolve scroll coordinates
    eff_scroll_x, eff_scroll_y = scroll_x, scroll_y
    if eff_scroll_x == 0 and eff_scroll_y == 0 and roi is not None:
        rx, ry, rw, rh = roi
        eff_scroll_x = rx + rw // 2
        eff_scroll_y = ry + rh // 2

    checked: list[str] = []
    not_found: list[str] = []
    errors: list[str] = []

    for vr_number in vr_numbers:
        found = False
        prev_screenshot = None

        for attempt in range(max_scroll_attempts + 1):
            # --- Capture current view ---
            try:
                screenshot = _capture_roi(roi, pyautogui)
            except Exception as exc:
                msg = f"{vr_number}: screenshot failed — {exc}"
                logger.error(msg)
                errors.append(msg)
                break

            # --- Detect end-of-scroll ---
            if attempt > 0 and _images_are_same(prev_screenshot, screenshot):
                logger.info("%s: end of scroll reached after %d attempt(s)", vr_number, attempt)
                break

            prev_screenshot = screenshot.copy()

            # --- OCR search ---
            try:
                if item_code:
                    bbox = _ocr_find_text_with_item_code(screenshot, vr_number, item_code)
                else:
                    bbox = _ocr_find_text(screenshot, vr_number)
            except ImportError as exc:
                msg = f"{vr_number}: OCR unavailable — {exc}"
                logger.error(msg)
                errors.append(msg)
                not_found.append(vr_number)
                break
            except Exception as exc:
                msg = f"{vr_number}: OCR error — {exc}"
                logger.error(msg)
                errors.append(msg)
                break

            if bbox is not None:
                bx, by, bw, bh = bbox

                # Translate image-relative coords to absolute screen coords
                if roi is not None:
                    rx, ry, _rw, _rh = roi
                    screen_x = rx + bx - checkbox_offset
                    screen_y = ry + by + bh // 2
                else:
                    screen_x = bx - checkbox_offset
                    screen_y = by + bh // 2

                # Clamp to a sensible range to avoid accidental off-screen clicks
                screen_x = max(0, screen_x)
                screen_y = max(0, screen_y)

                try:
                    pyautogui.click(screen_x, screen_y)
                    time.sleep(0.15)
                    checked.append(vr_number)
                    found = True
                    logger.info(
                        "%s: checkbox clicked at (%d, %d)", vr_number, screen_x, screen_y
                    )
                except Exception as exc:
                    msg = f"{vr_number}: click failed — {exc}"
                    logger.error(msg)
                    errors.append(msg)
                break  # done with this VR regardless of click outcome

            # --- Scroll down and try again ---
            if attempt < max_scroll_attempts:
                try:
                    if eff_scroll_x > 0 or eff_scroll_y > 0:
                        pyautogui.moveTo(eff_scroll_x, eff_scroll_y, duration=0.1)
                    pyautogui.scroll(-scroll_step)
                    time.sleep(0.3)
                except Exception as exc:
                    msg = f"{vr_number}: scroll failed — {exc}"
                    logger.error(msg)
                    errors.append(msg)
                    break

        if not found and vr_number not in not_found:
            not_found.append(vr_number)

    success = len(checked) > 0 and len(errors) == 0
    parts = [f"Checked: {checked}"]
    if not_found:
        parts.append(f"Not found: {not_found}")
    if errors:
        parts.append(f"Errors: {errors}")
    message = "; ".join(parts)

    logger.info("tick_checkboxes_by_vr: %s", message)
    return {
        "success": success,
        "checked": checked,
        "not_found": not_found,
        "errors": errors,
        "message": message,
    }
