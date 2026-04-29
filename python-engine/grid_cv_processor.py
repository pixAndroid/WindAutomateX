"""
Grid CV Processor — WindAutomateX Computer Vision Fallback module.

Provides :func:`process_grid_cv`, a batch Computer Vision approach for
finding rows in a desktop application grid and ticking their corresponding
checkboxes.  Unlike the word-by-word OCR approach in
:mod:`vr_checkbox_ticker`, this module:

* Reads **all** target pairs (VR No + Item Code) from an Excel file
  upfront via ``pandas``.
* Segments the grid screenshot into individual **row images** using
  OpenCV horizontal-projection profiling or contour detection.
* Runs OCR **only on the narrow column slices** (not the full screenshot)
  which keeps each OCR call fast even on machines without a GPU.
* Processes every pending target in a **single scrolling pass** — when a
  match is found the row is clicked and removed from the pending list
  immediately; there is no need to restart the scroll from the top for
  each target.
* Implements a **deduplication check**: a hash of the bottom row of the
  current screenshot is stored before each scroll.  After scrolling,
  the hash of the new top row area is compared with the stored value.
  If they match (the grid didn't move) the loop is broken immediately so
  we never get stuck in an infinite scroll at the bottom of the list.

OCR engine priority
-------------------
1. ``easyocr`` — preferred; handles varied fonts well and needs no
   separate binary installation.
2. ``pytesseract`` — fallback; requires the Tesseract binary to be on
   ``PATH`` but is already listed in *requirements.txt*.

Public API
----------
process_grid_cv(config: dict) -> dict
    Main entry-point.  Returns::

        {
            "success":           bool,
            "checked":           [(vr_no, item_code), ...],
            "not_found":         [(vr_no, item_code), ...],
            "errors":            [str, ...],
            "message":           str,
            "checkbox_positions": {(vr_no, item_code): (screen_x, screen_y)},
        }

Config dictionary keys
-----------------------
excel_path          (str)   Path to the .xlsx / .csv file.
sheet_name          (str)   Sheet to read; default ``"Sheet1"``.
start_row           (int)   1-based data row to start from (header is
                            row 1 when ``has_header=True``); default 2.
vr_column_name      (str)   Header of the VR No column in the Excel file.
item_code_column_name (str) Header of the Item Code column.
window_title        (str)   Partial title of the target window.
                            Leave blank to use the active window.
grid_roi            (tuple | str | None)
                            (x, y, w, h) screen region of the grid table.
                            Pass ``None`` / ``""`` to use the full screen.
scroll_x            (int)   X coordinate for scroll events.
scroll_y            (int)   Y coordinate for scroll events.
max_scroll          (int)   Maximum scroll attempts; default 20.
scroll_step         (int)   Mouse-wheel clicks per scroll event; default 5.
cb_offset           (int)   Horizontal pixels to the *left* of the start
                            of the row (or VR text) where the checkbox
                            lives; default 40.
"""

from __future__ import annotations

import hashlib
import logging
import time
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------
_Roi = tuple[int, int, int, int]   # (x, y, w, h) in screen coordinates
_Pair = tuple[str, str]            # (vr_no, item_code)

# ---------------------------------------------------------------------------
# Excel ingestion
# ---------------------------------------------------------------------------

def _load_targets(
    excel_path: str,
    sheet_name: str,
    start_row: int,
    vr_col: str,
    item_code_col: str,
) -> list[_Pair]:
    """
    Read *excel_path* with ``pandas`` and return a list of
    ``(vr_no, item_code)`` tuples for every data row from *start_row*
    onwards that has non-empty values in both target columns.

    Parameters
    ----------
    excel_path : str
        Path to ``.xlsx`` or ``.csv`` file.
    sheet_name : str
        Sheet name (ignored for CSV files).
    start_row : int
        1-based row number of the first data row (typically 2 when row 1
        is the header).
    vr_col : str
        Header name of the VR No column.
    item_code_col : str
        Header name of the Item Code column.

    Returns
    -------
    list of (vr_no, item_code) tuples — preserves source order, deduped.
    """
    try:
        import pandas as pd
    except ImportError as exc:
        raise ImportError(
            "pandas is required for process_grid_cv. "
            "Install it with: pip install pandas openpyxl"
        ) from exc

    ext = excel_path.rsplit(".", 1)[-1].lower()
    try:
        if ext == "csv":
            df = pd.read_csv(excel_path, header=0, dtype=str)
        else:
            df = pd.read_excel(
                excel_path,
                sheet_name=sheet_name,
                header=0,
                dtype=str,
                engine="openpyxl",
            )
    except Exception as exc:
        raise IOError(f"Failed to open '{excel_path}': {exc}") from exc

    # Validate columns
    for col in (vr_col, item_code_col):
        if col not in df.columns:
            raise ValueError(
                f"Column '{col}' not found in '{excel_path}'. "
                f"Available columns: {list(df.columns)}"
            )

    # Convert start_row (1-based, counting header as row 1) to 0-based index
    data_start_index = max(0, start_row - 2)  # header = row 1, first data = row 2
    df = df.iloc[data_start_index:]

    # Build deduplicated list of (vr_no, item_code) pairs
    seen: set[_Pair] = set()
    pairs: list[_Pair] = []
    for _, row in df.iterrows():
        vr = str(row[vr_col]).strip()
        code = str(row[item_code_col]).strip()
        if vr and code and vr.lower() != "nan" and code.lower() != "nan":
            pair: _Pair = (vr, code)
            if pair not in seen:
                seen.add(pair)
                pairs.append(pair)

    logger.info("_load_targets: loaded %d unique target pair(s)", len(pairs))
    return pairs


# ---------------------------------------------------------------------------
# Screenshot helpers
# ---------------------------------------------------------------------------

def _capture_roi(roi: Optional[_Roi], pyautogui) -> np.ndarray:
    """Return an RGB NumPy array of *roi* (or the whole screen if None)."""
    if roi:
        x, y, w, h = roi
        img = pyautogui.screenshot(region=(x, y, w, h))
    else:
        img = pyautogui.screenshot()
    return np.array(img)


def _row_hash(row_img: np.ndarray) -> str:
    """Return a quick MD5 hex-digest of a row image for deduplication."""
    return hashlib.md5(row_img.tobytes()).hexdigest()  # noqa: S324


def _images_nearly_equal(img_a: np.ndarray, img_b: np.ndarray, threshold: float = 0.995) -> bool:
    """
    Return True when *img_a* and *img_b* have the same shape and are
    visually almost identical (pixel-level similarity ≥ *threshold*).
    Used as a guard against infinite scrolling at the grid bottom.
    """
    import cv2
    if img_a is None or img_b is None:
        return False
    if img_a.shape != img_b.shape:
        return False
    diff = cv2.absdiff(img_a, img_b)
    non_zero_ratio = np.count_nonzero(diff) / max(diff.size, 1)
    return non_zero_ratio < (1.0 - threshold)


# ---------------------------------------------------------------------------
# Row segmentation
# ---------------------------------------------------------------------------

def _segment_rows(
    screenshot: np.ndarray,
    min_row_height: int = 8,
    max_row_height: int = 60,
) -> list[tuple[int, int]]:
    """
    Detect individual row boundaries in a grid screenshot using a
    **horizontal projection profile**.

    The algorithm works as follows:

    1. Convert the screenshot to grayscale and apply adaptive thresholding
       to produce a binary image (white text/lines on black background).
    2. Compute the horizontal projection — the sum of *white* pixels per
       row in the binary image.
    3. Rows of the table manifest as bands of *lower* projection values
       (dark content areas) separated by high-projection bands (bright
       horizontal cell borders or blank space).
    4. Locate the transitions from high to low and vice versa to extract
       (y_top, y_bottom) spans for each detected row.

    Falls back to ``cv2.findContours`` on the Canny-edged image if the
    projection profile approach returns fewer than 2 rows.

    Parameters
    ----------
    screenshot : np.ndarray
        RGB image of the captured grid region.
    min_row_height : int
        Rows shorter than this pixel height are discarded as noise.
    max_row_height : int
        Rows taller than this are trimmed / kept as-is but treated as a
        single logical row.

    Returns
    -------
    list of (y_top, y_bottom) pairs in ascending order.
    """
    import cv2

    gray = cv2.cvtColor(screenshot, cv2.COLOR_RGB2GRAY)

    # ---- Binary image: adaptive threshold to highlight lines & text ----
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15, C=4,
    )

    # ---- Horizontal projection profile ----
    h_profile = np.sum(binary, axis=1).astype(np.float32)

    # Normalise to [0, 1]
    max_val = h_profile.max()
    if max_val > 0:
        h_profile /= max_val

    # Detect *separator* lines (high projection = lots of white = border/gap)
    # using a rolling-mean to smooth out noise
    kernel_size = max(3, min_row_height // 2)
    smoothed = np.convolve(h_profile, np.ones(kernel_size) / kernel_size, mode="same")

    separator_threshold = 0.3  # rows above this are treated as separators

    rows: list[tuple[int, int]] = []
    in_row = False
    row_start = 0
    img_h = screenshot.shape[0]

    for y in range(img_h):
        is_separator = smoothed[y] >= separator_threshold
        if not in_row and not is_separator:
            row_start = y
            in_row = True
        elif in_row and (is_separator or y == img_h - 1):
            row_end = y
            height = row_end - row_start
            if min_row_height <= height <= max_row_height:
                rows.append((row_start, row_end))
            in_row = False

    logger.debug("_segment_rows (projection): found %d candidate row(s)", len(rows))

    # ---- Fallback: contour-based segmentation ----
    if len(rows) < 2:
        logger.debug("_segment_rows: projection gave <2 rows — trying contour fallback")
        rows = _segment_rows_contour(binary, min_row_height, max_row_height)

    return rows


def _segment_rows_contour(
    binary: np.ndarray,
    min_row_height: int,
    max_row_height: int,
) -> list[tuple[int, int]]:
    """
    Contour-based row segmentation fallback.

    Dilates the binary image horizontally to merge text fragments within
    the same cell, then finds contours and groups them by vertical span
    to recover logical row extents.
    """
    import cv2

    # Horizontal dilation merges fragments within the same row
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (binary.shape[1] // 2, 1))
    dilated = cv2.dilate(binary, kernel, iterations=2)

    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    spans: list[tuple[int, int]] = []
    for cnt in contours:
        _x, y, _w, h = cv2.boundingRect(cnt)
        if min_row_height <= h <= max_row_height:
            spans.append((y, y + h))

    # Merge overlapping spans into distinct rows
    spans.sort()
    merged: list[tuple[int, int]] = []
    for span in spans:
        if merged and span[0] <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], span[1]))
        else:
            merged.append(list(span))  # type: ignore[arg-type]

    logger.debug("_segment_rows_contour: found %d row(s)", len(merged))
    return [(s[0], s[1]) for s in merged]


# ---------------------------------------------------------------------------
# Column header detection
# ---------------------------------------------------------------------------

def _detect_column_x_ranges(
    screenshot: np.ndarray,
    vr_header: str,
    item_code_header: str,
    ocr_fn,
) -> tuple[Optional[tuple[int, int]], Optional[tuple[int, int]]]:
    """
    Detect the on-screen X-ranges for the VR No and Item Code columns by
    running OCR on the top portion of the screenshot (where headers live)
    and returning ``(x_min, x_max)`` bands centred on each header.

    Only the top 15 % of the screenshot (or 80 px, whichever is greater)
    is scanned to keep this call fast.

    Returns ``(vr_x_range, item_code_x_range)`` — either element may be
    ``None`` when the corresponding header text is not detected.
    """
    header_height = max(80, int(screenshot.shape[0] * 0.15))
    header_strip = screenshot[:header_height, :]

    words = ocr_fn(header_strip)  # list of {"text": str, "x": int, "y": int, "w": int, "h": int}

    def _find_range(target: str) -> Optional[tuple[int, int]]:
        needle = target.lower()
        best: Optional[dict] = None
        for word in words:
            if needle in word["text"].lower():
                best = word
                break
        if best is None:
            return None
        col_center = best["x"] + best["w"] // 2
        half_width = max(best["w"] * 2, 60)
        return (max(0, col_center - half_width), col_center + half_width)

    vr_range = _find_range(vr_header)
    ic_range = _find_range(item_code_header)

    logger.debug(
        "_detect_column_x_ranges: VR '%s' → %s | ItemCode '%s' → %s",
        vr_header, vr_range, item_code_header, ic_range,
    )
    return vr_range, ic_range


# ---------------------------------------------------------------------------
# OCR engines
# ---------------------------------------------------------------------------

def _build_ocr_fn():
    """
    Return a callable ``ocr(image) -> list[dict]`` that uses the best
    available OCR library.

    The returned list items have the keys::

        {"text": str, "x": int, "y": int, "w": int, "h": int}

    Priority: ``easyocr`` → ``pytesseract``.
    Raises ``ImportError`` when neither is installed.
    """
    # --- Try easyocr first ---
    try:
        import easyocr  # noqa: F401

        _reader_cache: dict = {}  # module-level cache via closure

        def _easyocr_fn(image: np.ndarray) -> list[dict]:
            import cv2
            if "reader" not in _reader_cache:
                logger.debug("_build_ocr_fn: initialising EasyOCR reader (first call)")
                _reader_cache["reader"] = easyocr.Reader(["en"], gpu=False, verbose=False)
            reader = _reader_cache["reader"]
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) if image.ndim == 3 else image
            results = reader.readtext(gray, detail=1, paragraph=False)
            words: list[dict] = []
            for (bbox_pts, text, _conf) in results:
                xs = [int(p[0]) for p in bbox_pts]
                ys = [int(p[1]) for p in bbox_pts]
                words.append({
                    "text": text.strip(),
                    "x": min(xs),
                    "y": min(ys),
                    "w": max(xs) - min(xs),
                    "h": max(ys) - min(ys),
                })
            return words

        logger.debug("_build_ocr_fn: using easyocr")
        return _easyocr_fn

    except ImportError:
        pass

    # --- Fall back to pytesseract ---
    try:
        import pytesseract  # noqa: F401

        def _pytesseract_fn(image: np.ndarray) -> list[dict]:
            import cv2
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) if image.ndim == 3 else image
            data = pytesseract.image_to_data(gray, output_type=pytesseract.Output.DICT)
            words: list[dict] = []
            for i, word in enumerate(data["text"]):
                if not word or not word.strip():
                    continue
                w = int(data["width"][i])
                h = int(data["height"][i])
                if w <= 0 or h <= 0:
                    continue
                words.append({
                    "text": word.strip(),
                    "x": int(data["left"][i]),
                    "y": int(data["top"][i]),
                    "w": w,
                    "h": h,
                })
            return words

        logger.debug("_build_ocr_fn: using pytesseract")
        return _pytesseract_fn

    except ImportError:
        pass

    raise ImportError(
        "Neither easyocr nor pytesseract is installed. "
        "Install one with:\n"
        "  pip install easyocr\n"
        "  -- or --\n"
        "  pip install pytesseract  (and install the Tesseract binary)"
    )


# ---------------------------------------------------------------------------
# Per-row OCR extraction
# ---------------------------------------------------------------------------

def _ocr_row_columns(
    row_img: np.ndarray,
    vr_x_range: Optional[tuple[int, int]],
    item_code_x_range: Optional[tuple[int, int]],
    ocr_fn,
) -> tuple[str, str]:
    """
    Extract VR No and Item Code text from a single row image by running
    OCR only on the relevant column slices.

    When *vr_x_range* or *item_code_x_range* is ``None`` the full row
    image is searched for the corresponding text (slower but graceful).

    Returns ``(vr_text, item_code_text)`` — both may be empty strings.
    """
    row_h, row_w = row_img.shape[:2]

    def _slice_and_ocr(x_range: Optional[tuple[int, int]]) -> str:
        if x_range is None:
            words = ocr_fn(row_img)
        else:
            x0 = max(0, x_range[0])
            x1 = min(row_w, x_range[1])
            if x1 <= x0:
                return ""
            cell_crop = row_img[:, x0:x1]
            words = ocr_fn(cell_crop)
        # Join all words found in the slice — they form the cell value
        return " ".join(w["text"] for w in words if w["text"]).strip()

    vr_text = _slice_and_ocr(vr_x_range)
    ic_text = _slice_and_ocr(item_code_x_range)
    return vr_text, ic_text


# ---------------------------------------------------------------------------
# Window activation
# ---------------------------------------------------------------------------

def _activate_window(window_title: str, engine=None) -> None:
    """Bring the window whose title contains *window_title* to the foreground."""
    if not window_title:
        return
    try:
        if engine is not None and getattr(engine, "pywinauto_available", False):
            from pywinauto import Application
            app = Application(backend="uia").connect(title_re=f".*{window_title}.*")
            app.top_window().set_focus()
            time.sleep(0.3)
        else:
            logger.warning(
                "_activate_window: pywinauto not available — cannot reliably "
                "focus window '%s'", window_title,
            )
    except Exception as exc:
        logger.warning("_activate_window: could not focus '%s': %s", window_title, exc)


# ---------------------------------------------------------------------------
# ROI parsing
# ---------------------------------------------------------------------------

def _parse_roi(grid_roi) -> Optional[_Roi]:
    """
    Accept either a 4-tuple ``(x, y, w, h)`` or a ``"x,y,w,h"`` string
    and return a validated ``(x, y, w, h)`` tuple, or ``None``.
    """
    if not grid_roi:
        return None
    if isinstance(grid_roi, (list, tuple)) and len(grid_roi) == 4:
        try:
            parts = [int(v) for v in grid_roi]
            if parts[2] > 0 and parts[3] > 0:
                return (parts[0], parts[1], parts[2], parts[3])
        except (TypeError, ValueError):
            pass
    if isinstance(grid_roi, str):
        try:
            parts = [int(p.strip()) for p in grid_roi.split(",")]
            if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
                return (parts[0], parts[1], parts[2], parts[3])
        except (ValueError, IndexError):
            pass
    logger.warning("_parse_roi: invalid grid_roi '%s' — using full screen", grid_roi)
    return None


# ---------------------------------------------------------------------------
# Main public function
# ---------------------------------------------------------------------------

def process_grid_cv(config: dict) -> dict:
    """
    Computer Vision batch fallback: find every (VR No, Item Code) pair
    from an Excel file in a desktop grid window and tick its checkbox.

    See module docstring for the full description of *config* keys.

    Returns
    -------
    dict with keys:
        ``success``           – ``True`` when at least one row was ticked
                                without an unrecoverable error.
        ``checked``           – list of ``(vr_no, item_code)`` ticked.
        ``not_found``         – list of ``(vr_no, item_code)`` pairs that
                                were never matched after full scrolling.
        ``errors``            – list of human-readable error strings.
        ``message``           – short human-readable summary.
        ``checkbox_positions``– ``{(vr_no, item_code): (screen_x, screen_y)}``.
    """
    # ------------------------------------------------------------------
    # 0.  Import required libraries early so we fail fast with clear messages
    # ------------------------------------------------------------------
    try:
        import pyautogui
    except ImportError as exc:
        return _error_result("pyautogui is required but not installed", str(exc))

    try:
        import cv2  # noqa: F401
    except ImportError as exc:
        return _error_result("opencv-python is required but not installed", str(exc))

    # Build the OCR callable (easyocr > pytesseract)
    try:
        ocr_fn = _build_ocr_fn()
    except ImportError as exc:
        return _error_result(str(exc))

    # ------------------------------------------------------------------
    # 1.  Parse config
    # ------------------------------------------------------------------
    excel_path: str = str(config.get("excel_path", "")).strip()
    sheet_name: str = str(config.get("sheet_name", "Sheet1")).strip() or "Sheet1"
    start_row: int = int(config.get("start_row", 2))
    vr_col: str = str(config.get("vr_column_name", "")).strip()
    item_code_col: str = str(config.get("item_code_column_name", "")).strip()
    window_title: str = str(config.get("window_title", "")).strip()
    grid_roi_raw = config.get("grid_roi")
    scroll_x: int = int(config.get("scroll_x", 0))
    scroll_y: int = int(config.get("scroll_y", 0))
    max_scroll: int = int(config.get("max_scroll", 20))
    scroll_step: int = int(config.get("scroll_step", 5))
    cb_offset: int = int(config.get("cb_offset", 40))

    if not excel_path:
        return _error_result("'excel_path' is required in config")
    if not vr_col:
        return _error_result("'vr_column_name' is required in config")
    if not item_code_col:
        return _error_result("'item_code_column_name' is required in config")

    # ------------------------------------------------------------------
    # 2.  Load target pairs from Excel
    # ------------------------------------------------------------------
    try:
        pending: list[_Pair] = _load_targets(
            excel_path, sheet_name, start_row, vr_col, item_code_col
        )
    except Exception as exc:
        return _error_result(f"Failed to load Excel targets: {exc}")

    if not pending:
        return {
            "success": False,
            "checked": [],
            "not_found": [],
            "errors": [],
            "message": "No target rows found in the specified Excel range",
            "checkbox_positions": {},
        }

    logger.info(
        "process_grid_cv: %d target pair(s) to find and tick", len(pending)
    )

    # ------------------------------------------------------------------
    # 3.  Environment setup
    # ------------------------------------------------------------------
    _activate_window(window_title, config.get("_engine"))

    roi = _parse_roi(grid_roi_raw)

    # Resolve scroll coordinates — default to the centre of the ROI
    eff_scroll_x, eff_scroll_y = scroll_x, scroll_y
    if eff_scroll_x == 0 and eff_scroll_y == 0 and roi is not None:
        rx, ry, rw, rh = roi
        eff_scroll_x = rx + rw // 2
        eff_scroll_y = ry + rh // 2

    # ------------------------------------------------------------------
    # 4.  Accumulate results
    # ------------------------------------------------------------------
    checked: list[_Pair] = []
    errors: list[str] = []
    checkbox_positions: dict[_Pair, tuple[int, int]] = {}

    # Mutable copy so we can pop items as they're found
    remaining: list[_Pair] = list(pending)

    # Column x-ranges determined once from the first screenshot (they
    # don't change as we scroll vertically)
    vr_x_range: Optional[tuple[int, int]] = None
    item_code_x_range: Optional[tuple[int, int]] = None
    columns_detected = False

    # Deduplication: hash of the bottom row from the previous screenshot
    prev_bottom_hash: Optional[str] = None
    prev_screenshot: Optional[np.ndarray] = None

    # ------------------------------------------------------------------
    # 5.  Main vision loop
    # ------------------------------------------------------------------
    for scroll_count in range(max_scroll + 1):

        # ---- 5a. Capture current grid view ----
        try:
            screenshot = _capture_roi(roi, pyautogui)
        except Exception as exc:
            msg = f"Screenshot failed on scroll {scroll_count}: {exc}"
            logger.error(msg)
            errors.append(msg)
            break

        img_h, img_w = screenshot.shape[:2]

        # ---- 5b. End-of-scroll detection (whole screenshot unchanged) ----
        if _images_nearly_equal(prev_screenshot, screenshot):
            logger.info(
                "process_grid_cv: screen unchanged after scroll — reached "
                "the bottom of the grid (scroll %d)", scroll_count
            )
            break

        # ---- 5c. Detect column headers once (first visible screenshot) ----
        if not columns_detected:
            try:
                vr_x_range, item_code_x_range = _detect_column_x_ranges(
                    screenshot, vr_col, item_code_col, ocr_fn
                )
                columns_detected = True
                logger.info(
                    "process_grid_cv: column headers detected — VR x=%s, IC x=%s",
                    vr_x_range, item_code_x_range,
                )
            except Exception as exc:
                logger.warning(
                    "process_grid_cv: column header detection failed (%s) — "
                    "will search full row width", exc
                )
                columns_detected = True  # don't retry every iteration

        # ---- 5d. Segment the screenshot into individual rows ----
        try:
            row_spans = _segment_rows(screenshot)
        except Exception as exc:
            msg = f"Row segmentation failed on scroll {scroll_count}: {exc}"
            logger.warning(msg)
            errors.append(msg)
            # Fall back: treat the entire screenshot as one block
            row_spans = [(0, img_h)]

        if not row_spans:
            logger.debug(
                "process_grid_cv: no rows segmented on scroll %d", scroll_count
            )
        else:
            logger.debug(
                "process_grid_cv: scroll %d — %d row segment(s) found",
                scroll_count, len(row_spans),
            )

        # ---- 5e. Process each row: OCR → match → click ----
        for y_top, y_bottom in row_spans:
            if not remaining:
                break  # all targets ticked — no need to examine more rows

            row_img = screenshot[y_top:y_bottom, :]
            if row_img.size == 0:
                continue

            # Run OCR on the two column slices only
            try:
                vr_text, ic_text = _ocr_row_columns(
                    row_img, vr_x_range, item_code_x_range, ocr_fn
                )
            except Exception as exc:
                logger.debug("process_grid_cv: OCR error on row y=%d–%d: %s", y_top, y_bottom, exc)
                continue

            if not vr_text and not ic_text:
                continue  # blank / separator row

            logger.debug(
                "process_grid_cv: row y=%d–%d → VR='%s' IC='%s'",
                y_top, y_bottom, vr_text, ic_text,
            )

            # Check against every remaining target (case-insensitive substring)
            for pair in list(remaining):
                target_vr, target_ic = pair
                vr_match = target_vr.lower() in vr_text.lower() or vr_text.lower() in target_vr.lower()
                ic_match = target_ic.lower() in ic_text.lower() or ic_text.lower() in target_ic.lower()

                if vr_match and ic_match:
                    # ---- Click the checkbox ----
                    row_center_y = y_top + (y_bottom - y_top) // 2

                    # X-coordinate: left edge of the row minus cb_offset,
                    # or left edge of the VR column minus cb_offset
                    if vr_x_range is not None:
                        row_left_x = vr_x_range[0]
                    else:
                        row_left_x = 0

                    # Image-relative checkbox position
                    img_cb_x = max(0, row_left_x - cb_offset)
                    img_cb_y = row_center_y

                    # Translate to absolute screen coordinates
                    if roi is not None:
                        rx, ry, _rw, _rh = roi
                        screen_cb_x = rx + img_cb_x
                        screen_cb_y = ry + img_cb_y
                    else:
                        screen_cb_x = img_cb_x
                        screen_cb_y = img_cb_y

                    # Clamp to safe screen region
                    screen_cb_x = max(0, screen_cb_x)
                    screen_cb_y = max(0, screen_cb_y)

                    logger.info(
                        "process_grid_cv: match %s — clicking checkbox at (%d, %d) "
                        "(offset=%d px, scroll=%d)",
                        pair, screen_cb_x, screen_cb_y, cb_offset, scroll_count,
                    )

                    try:
                        pyautogui.click(screen_cb_x, screen_cb_y)
                        time.sleep(0.15)  # brief pause for UI to register the click
                        checked.append(pair)
                        checkbox_positions[pair] = (screen_cb_x, screen_cb_y)
                        remaining.remove(pair)
                    except Exception as exc:
                        msg = f"Click failed for {pair}: {exc}"
                        logger.error(msg)
                        errors.append(msg)
                    break  # move to the next row once a pair is matched

        # ---- 5f. Early exit when all targets are found ----
        if not remaining:
            logger.info("process_grid_cv: all targets found — stopping early")
            break

        # ---- 5g. Deduplication via bottom-row hash ----
        # Store a hash of the bottom row image region before scrolling.
        # After the scroll we compare the hash of the top row area against
        # the stored value.  If they match the grid didn't move.
        bottom_row_height = max(30, img_h // 15)
        bottom_strip = screenshot[img_h - bottom_row_height:, :]
        current_bottom_hash = _row_hash(bottom_strip)

        if prev_bottom_hash is not None and current_bottom_hash == prev_bottom_hash:
            logger.info(
                "process_grid_cv: bottom-row hash unchanged — grid has not moved "
                "(scroll %d) — stopping", scroll_count
            )
            break

        prev_bottom_hash = current_bottom_hash
        prev_screenshot = screenshot.copy()

        # ---- 5h. Scroll down ----
        if scroll_count < max_scroll:
            try:
                if eff_scroll_x > 0 or eff_scroll_y > 0:
                    pyautogui.moveTo(eff_scroll_x, eff_scroll_y, duration=0.1)
                pyautogui.click(eff_scroll_x, eff_scroll_y, clicks=scroll_step)
                time.sleep(0.35)  # wait for the grid to repaint
            except Exception as exc:
                msg = f"Scroll failed on attempt {scroll_count}: {exc}"
                logger.error(msg)
                errors.append(msg)
                break

    # ------------------------------------------------------------------
    # 6.  Build and return result
    # ------------------------------------------------------------------
    not_found: list[_Pair] = list(remaining)

    success = bool(checked) and not errors
    parts: list[str] = [f"Checked: {checked}"]
    if not_found:
        parts.append(f"Not found: {not_found}")
    if errors:
        parts.append(f"Errors: {errors}")
    message = "; ".join(parts)

    logger.info("process_grid_cv: %s", message)
    return {
        "success": success,
        "checked": checked,
        "not_found": not_found,
        "errors": errors,
        "message": message,
        "checkbox_positions": {str(k): v for k, v in checkbox_positions.items()},
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _error_result(*messages: str) -> dict:
    """Construct a failed result dict from one or more error messages."""
    msg = "; ".join(m for m in messages if m)
    logger.error("process_grid_cv: %s", msg)
    return {
        "success": False,
        "checked": [],
        "not_found": [],
        "errors": [msg],
        "message": msg,
        "checkbox_positions": {},
    }
