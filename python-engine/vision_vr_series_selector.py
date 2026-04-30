"""
Vision Vr Series Selector — WindAutomateX helper module.

Captures a screen region (the open Vr Series dropdown list), runs OCR on it,
groups detected words into rows by Y-coordinate proximity, searches for a row
that matches the given Vr Series text, and clicks directly on that row.
If the match is not found on the current view the list is scrolled down using
Page Down and the scan is repeated until the entry is found or the list ends.

Public API
----------
run_vr_series_selector(config, engine=None) -> dict
    Main entry-point.  Returns a result dict with keys:
        success   – True when the match was found and clicked
        matched   – the matched row text (or empty string when not found)
        message   – human-readable summary
"""

import json
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Re-use shared OCR helpers from vision_row_selector
# ---------------------------------------------------------------------------

from vision_row_selector import (
    capture_table as _capture_region,
    preprocess_image,
    extract_text,
    group_rows,
    _normalise,
    _fuzzy_match,
    _images_are_same,
    highlight_row_on_screen,
)


# ---------------------------------------------------------------------------
# Match a single Vr Series text against OCR rows
# ---------------------------------------------------------------------------

def _match_vr_series_row(
    rows: list,
    vr_series_text: str,
    match_mode: str,
    table_region: Optional[dict],
) -> Optional[dict]:
    """Return the first row that contains *vr_series_text*, or None.

    Returns a dict with:
        clickX  – absolute screen X (centre of matched row text)
        clickY  – absolute screen Y (centre of matched row text)
        rowX    – absolute screen X of row bounding box left edge
        rowY    – absolute screen Y of row bounding box top edge
        rowWidth, rowHeight – bounding box dimensions
        rowText – joined OCR text for the row
    """
    region_x = int(table_region.get("x", 0)) if table_region else 0
    region_y = int(table_region.get("y", 0)) if table_region else 0

    norm_target = _normalise(vr_series_text)

    for row in rows:
        words_text = [_normalise(w["text"]) for w in row["words"]]
        full_row_text = " ".join(words_text)

        matched = False
        if match_mode == "fuzzy":
            matched = _fuzzy_match(norm_target, full_row_text) or any(
                _fuzzy_match(norm_target, w) for w in words_text
            )
        elif match_mode == "contains":
            matched = norm_target in full_row_text or any(
                norm_target in w for w in words_text
            )
        else:  # exact
            matched = norm_target in full_row_text or any(
                norm_target == w for w in words_text
            )

        if not matched:
            continue

        # Click in the horizontal centre of the row, at the row's Y centre
        row_x_min = min(w["x"] for w in row["words"])
        row_y_min = min(w["y"] for w in row["words"])
        row_x_max = max(w["x"] + w["w"] for w in row["words"])
        row_y_max = max(w["y"] + w["h"] for w in row["words"])

        row_cx = (row_x_min + row_x_max) // 2
        row_cy = int(row["y_center"])

        row_text = " ".join(w["text"] for w in row["words"])

        return {
            "clickX": region_x + row_cx,
            "clickY": region_y + row_cy,
            "rowX": region_x + row_x_min,
            "rowY": region_y + row_y_min,
            "rowWidth": row_x_max - row_x_min,
            "rowHeight": row_y_max - row_y_min,
            "rowText": row_text,
        }

    return None


# ---------------------------------------------------------------------------
# Scroll helper (reused from vision_row_selector)
# ---------------------------------------------------------------------------

def _scroll_list(scroll_x: int, scroll_y: int, scroll_step: int, delay_ms: int) -> None:
    """Press Page Down *scroll_step* times after giving focus to the list."""
    import pyautogui

    if scroll_x > 0 or scroll_y > 0:
        pyautogui.click(scroll_x, scroll_y)
        time.sleep(0.05)

    for _ in range(max(1, scroll_step)):
        pyautogui.press("pagedown")

    if delay_ms > 0:
        time.sleep(delay_ms / 1000.0)


# ---------------------------------------------------------------------------
# Main entry-point
# ---------------------------------------------------------------------------

def run_vr_series_selector(config: dict, engine=None) -> dict:
    """Scan the Vr Series dropdown list on screen and click the matching entry.

    Parameters
    ----------
    config : dict
        vrSeriesText       (str)   – Vr Series text to find. Required.
        listRegion         (dict)  – {x, y, width, height} of the list area.
                                     Blank = full screen.
        scrollEnabled      (bool)  – Whether to page-down scroll. Default True.
        scrollStep         (int)   – Page Down presses per scroll. Default 1.
        matchMode          (str)   – "exact", "contains", or "fuzzy". Default "exact".
        delayBetweenScroll (int)   – ms to wait after each scroll. Default 800.
        scrollX            (int)   – X coordinate clicked to give list focus.
        scrollY            (int)   – Y coordinate clicked to give list focus.
        maxScrollAttempts  (int)   – Scroll-attempt cap. Default 20.
        clickDelay         (int)   – ms after click. Default 100.
        rowTolerance       (int)   – Y-centre tolerance for row grouping. Default 8.
        useEasyOcr         (bool)  – Use EasyOCR instead of pytesseract. Default False.
    engine : optional
        Engine reference (unused directly, available for future extensions).

    Returns
    -------
    dict
        success (bool), matched (str), message (str)
    """
    vr_series_text: str = str(config.get("vrSeriesText", "")).strip()
    if not vr_series_text:
        return {
            "success": False,
            "matched": "",
            "message": "vision_vr_series_selector: vrSeriesText is required",
        }

    list_region: Optional[dict] = config.get("listRegion")
    scroll_enabled: bool = bool(config.get("scrollEnabled", True))
    scroll_step: int = int(config.get("scrollStep", 1))
    match_mode: str = str(config.get("matchMode", "exact"))
    delay_between_scroll: int = int(config.get("delayBetweenScroll", 800))
    scroll_x: int = int(config.get("scrollX", 0))
    scroll_y: int = int(config.get("scrollY", 0))
    max_scroll_attempts: int = int(config.get("maxScrollAttempts", 20))
    click_delay: int = int(config.get("clickDelay", 100))
    row_tolerance: int = int(config.get("rowTolerance", 8))
    use_easyocr: bool = bool(config.get("useEasyOcr", False))

    # Default scroll focus point to the centre of the list region when not set
    if scroll_x == 0 and scroll_y == 0 and list_region:
        scroll_x = (int(list_region.get("x", 0)) + int(list_region.get("width", 0))) // 2
        scroll_y = (int(list_region.get("y", 0)) + int(list_region.get("height", 0))) // 2

    import pyautogui

    prev_img = None
    scroll_count = 0

    print(json.dumps({
        "event": "vr_series_selector_start",
        "vrSeriesText": vr_series_text,
    }), flush=True)
    logger.info(f"vision_vr_series_selector: starting — vrSeriesText={vr_series_text!r}")

    while True:
        # --- Capture ---
        img_rgb = _capture_region(list_region)

        # --- End-of-scroll detection ---
        if _images_are_same(prev_img, img_rgb):
            logger.info("vision_vr_series_selector: screen unchanged after scroll — end of list")
            print(json.dumps({"event": "vr_series_selector_end_of_list"}), flush=True)
            break

        prev_img = img_rgb.copy()

        # --- Preprocess & OCR ---
        img_processed = preprocess_image(img_rgb)
        words = extract_text(img_processed, use_easyocr=use_easyocr)

        if not words:
            logger.warning(
                "vision_vr_series_selector: OCR returned no words at scroll position %d",
                scroll_count,
            )
            print(json.dumps({"event": "vr_series_selector_no_text", "scroll": scroll_count}), flush=True)
        else:
            rows = group_rows(words, row_tolerance=row_tolerance)
            logger.info(
                "vision_vr_series_selector: detected %d row(s) at scroll %d",
                len(rows),
                scroll_count,
            )
            print(json.dumps({
                "event": "vr_series_selector_rows_detected",
                "count": len(rows),
                "scroll": scroll_count,
            }), flush=True)

            # Log each row for debugging
            region_x_dbg = int(list_region.get("x", 0)) if list_region else 0
            region_y_dbg = int(list_region.get("y", 0)) if list_region else 0
            for row_idx, row in enumerate(rows):
                row_text = " ".join(w["text"] for w in row["words"])
                row_cx = region_x_dbg + (
                    min(w["x"] for w in row["words"]) + max(w["x"] + w["w"] for w in row["words"])
                ) // 2
                row_cy = region_y_dbg + int(row["y_center"])
                logger.debug(
                    "vision_vr_series_selector: row %d: text=%r click=(%d, %d)",
                    row_idx, row_text, row_cx, row_cy,
                )
                print(json.dumps({
                    "event": "vr_series_selector_row_scanned",
                    "scroll": scroll_count,
                    "row": row_idx,
                    "text": row_text,
                    "clickX": row_cx,
                    "clickY": row_cy,
                }), flush=True)

            # --- Match ---
            match = _match_vr_series_row(rows, vr_series_text, match_mode, list_region)

            if match is not None:
                logger.info(
                    "vision_vr_series_selector: matched %r → clicking at (%d, %d)",
                    match["rowText"], match["clickX"], match["clickY"],
                )
                print(json.dumps({
                    "event": "vr_series_selector_row_found",
                    "rowText": match["rowText"],
                    "x": match["clickX"],
                    "y": match["clickY"],
                }), flush=True)

                # Highlight the matched row
                highlight_row_on_screen(
                    x=match["rowX"],
                    y=match["rowY"],
                    width=match["rowWidth"],
                    height=match["rowHeight"],
                    duration_ms=800,
                    color="lime",
                    checkbox_pos=(match["clickX"], match["clickY"]),
                )

                # Click directly on the text
                pyautogui.click(match["clickX"], match["clickY"])
                if click_delay > 0:
                    time.sleep(click_delay / 1000.0)

                summary = f"Vr Series '{vr_series_text}' matched and clicked."
                logger.info("vision_vr_series_selector: %s", summary)
                print(json.dumps({
                    "event": "vr_series_selector_complete",
                    "matched": match["rowText"],
                }), flush=True)
                return {"success": True, "matched": match["rowText"], "message": summary}

        # --- Not found on this page; scroll if allowed ---
        if not scroll_enabled:
            break

        if scroll_count >= max_scroll_attempts:
            logger.info(
                "vision_vr_series_selector: reached max scroll attempts (%d)",
                max_scroll_attempts,
            )
            print(json.dumps({"event": "vr_series_selector_max_scroll"}), flush=True)
            break

        logger.info("vision_vr_series_selector: scrolling (attempt %d)", scroll_count + 1)
        print(json.dumps({
            "event": "vr_series_selector_scrolling",
            "attempt": scroll_count + 1,
        }), flush=True)
        _scroll_list(scroll_x, scroll_y, scroll_step, delay_between_scroll)
        scroll_count += 1

    # Fell through — not found
    summary = f"Vr Series '{vr_series_text}' not found in the list."
    logger.warning("vision_vr_series_selector: %s", summary)
    print(json.dumps({
        "event": "vr_series_selector_complete",
        "matched": "",
        "not_found": vr_series_text,
    }), flush=True)
    return {"success": False, "matched": "", "message": summary}
