"""
Vision Row Selector — WindAutomateX helper module.

Captures a screen region, runs OCR on it, groups detected words into rows by
Y-coordinate proximity, matches each row against a list of VR numbers plus an
optional Item Code, and clicks the checkbox to the left of each matched row.
The process repeats after scrolling down until no new rows are found.

Public API
----------
run_vision_match(config, engine=None) -> dict
    Main entry-point.  Returns a result dict with keys:
        success   – True when the run completed without a fatal error
        matched   – list of (vrNo, itemCode) pairs that were clicked
        skipped   – list of (vrNo, itemCode) pairs not found on screen
        message   – human-readable summary
"""

import json
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step 1 — Capture screen region
# ---------------------------------------------------------------------------

def capture_table(table_region: Optional[dict]) -> "np.ndarray":  # type: ignore[name-defined]
    """Capture the table area and return a NumPy RGB array.

    Parameters
    ----------
    table_region:
        Dict with keys ``x``, ``y``, ``width``, ``height`` or ``None`` for
        full screen.
    """
    import numpy as np
    import pyautogui

    if table_region:
        x = int(table_region.get("x", 0))
        y = int(table_region.get("y", 0))
        w = int(table_region.get("width", 0))
        h = int(table_region.get("height", 0))
        if w > 0 and h > 0:
            img = pyautogui.screenshot(region=(x, y, w, h))
            return np.array(img)

    img = pyautogui.screenshot()
    return np.array(img)


# ---------------------------------------------------------------------------
# Step 2 — Preprocess image for better OCR accuracy
# ---------------------------------------------------------------------------

def preprocess_image(img_rgb: "np.ndarray") -> "np.ndarray":  # type: ignore[name-defined]
    """Convert to grayscale, enhance contrast, and threshold the image."""
    import cv2
    import numpy as np

    # Convert RGB → grayscale
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # CLAHE contrast enhancement
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Adaptive threshold — works better than a fixed threshold for mixed
    # lighting / gradient backgrounds typical in desktop UIs.
    thresh = cv2.adaptiveThreshold(
        enhanced,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=11,
        C=2,
    )
    return thresh


# ---------------------------------------------------------------------------
# Step 3 — Extract text via OCR (pytesseract primary, easyocr fallback)
# ---------------------------------------------------------------------------

def extract_text(img_preprocessed: "np.ndarray", use_easyocr: bool = False):  # type: ignore[name-defined]
    """Return a list of word-dicts with keys: text, x, y, w, h (absolute to img).

    Uses pytesseract by default.  When *use_easyocr* is True the function
    tries EasyOCR instead (slower but sometimes more accurate for stylised
    fonts).
    """
    results = []

    if use_easyocr:
        try:
            import easyocr
            reader = easyocr.Reader(["en"], gpu=False, verbose=False)
            ocr_results = reader.readtext(img_preprocessed)
            for (bbox, text, conf) in ocr_results:
                if not text.strip() or conf < 0.3:
                    continue
                xs = [int(p[0]) for p in bbox]
                ys = [int(p[1]) for p in bbox]
                x, y = min(xs), min(ys)
                w, h = max(xs) - x, max(ys) - y
                results.append({"text": text.strip(), "x": x, "y": y, "w": w, "h": h})
            return results
        except ImportError:
            logger.warning("easyocr not available, falling back to pytesseract")

    # pytesseract (with automatic EasyOCR fallback if Tesseract binary is missing)
    try:
        import pytesseract
        from pytesseract import Output

        data = pytesseract.image_to_data(img_preprocessed, output_type=Output.DICT)
        n = len(data["text"])
        for i in range(n):
            text = str(data["text"][i]).strip()
            if not text:
                continue
            conf = int(data["conf"][i])
            if conf < 0:
                continue
            results.append({
                "text": text,
                "x": int(data["left"][i]),
                "y": int(data["top"][i]),
                "w": int(data["width"][i]),
                "h": int(data["height"][i]),
            })
        return results
    except Exception as tess_err:
        if "tesseract is not installed" not in str(tess_err).lower() and "tesseractnotfound" not in type(tess_err).__name__.lower():
            raise
        logger.warning(
            "Tesseract not found (%s). Automatically falling back to EasyOCR.", tess_err
        )

    # EasyOCR fallback when Tesseract binary is absent
    try:
        import easyocr
    except ImportError:
        raise RuntimeError(
            "Tesseract is not installed and easyocr is not available. "
            "Install Tesseract (https://github.com/UB-Mannheim/tesseract/wiki) "
            "or run: pip install easyocr"
        )

    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    ocr_results = reader.readtext(img_preprocessed)
    for (bbox, text, conf) in ocr_results:
        if not text.strip() or conf < 0.3:
            continue
        xs = [int(p[0]) for p in bbox]
        ys = [int(p[1]) for p in bbox]
        x, y = min(xs), min(ys)
        w, h = max(xs) - x, max(ys) - y
        results.append({"text": text.strip(), "x": x, "y": y, "w": w, "h": h})
    return results


# ---------------------------------------------------------------------------
# Step 4 — Group OCR words into rows by Y-coordinate proximity
# ---------------------------------------------------------------------------

def group_rows(words: list, row_tolerance: int = 8) -> list:
    """Group *words* into rows where all words share a similar Y centre.

    Parameters
    ----------
    words:
        List of word-dicts from ``extract_text``.
    row_tolerance:
        Maximum pixel difference in Y-centre for two words to be on the
        same row.

    Returns
    -------
    List of row-dicts, each containing ``words`` (sorted by x) and
    ``y_center`` (average Y centre for the row).
    """
    if not words:
        return []

    # Compute Y-centre for each word and sort by it
    enriched = sorted(
        [{"word": w, "yc": w["y"] + w["h"] // 2} for w in words],
        key=lambda e: e["yc"],
    )

    rows: list = []
    current_row_words: list = []
    current_yc: float = enriched[0]["yc"]

    for entry in enriched:
        if abs(entry["yc"] - current_yc) <= row_tolerance:
            current_row_words.append(entry["word"])
            # Update running average
            current_yc = sum(w["y"] + w["h"] // 2 for w in current_row_words) / len(
                current_row_words
            )
        else:
            if current_row_words:
                rows.append({
                    "words": sorted(current_row_words, key=lambda w: w["x"]),
                    "y_center": current_yc,
                })
            current_row_words = [entry["word"]]
            current_yc = float(entry["yc"])

    if current_row_words:
        rows.append({
            "words": sorted(current_row_words, key=lambda w: w["x"]),
            "y_center": current_yc,
        })

    return rows


# ---------------------------------------------------------------------------
# Step 5 — Column identification (relative X positions)
# ---------------------------------------------------------------------------

def _detect_checkbox_column_x(screenshot_rgb) -> Optional[int]:
    """Detect the X-centre of the checkbox column using vertical-line morphology."""
    try:
        import cv2
        import numpy as np

        gray = cv2.cvtColor(screenshot_rgb, cv2.COLOR_RGB2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Find vertical lines
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, gray.shape[0] // 4))
        vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

        col_sum = np.sum(vertical == 0, axis=0)
        threshold_val = gray.shape[0] * 0.5
        line_positions = [i for i, v in enumerate(col_sum) if v > threshold_val]

        if len(line_positions) >= 2:
            groups: list = []
            current_group = [line_positions[0]]
            for pos in line_positions[1:]:
                if pos - current_group[-1] <= 3:
                    current_group.append(pos)
                else:
                    groups.append(current_group)
                    current_group = [pos]
            groups.append(current_group)

            if len(groups) >= 2:
                centre0 = int(sum(groups[0]) / len(groups[0]))
                centre1 = int(sum(groups[1]) / len(groups[1]))
                mid = (centre0 + centre1) // 2
                return mid
    except Exception as e:
        logger.debug(f"_detect_checkbox_column_x: {e}")
    return None


# ---------------------------------------------------------------------------
# Step 6 — Matching logic
# ---------------------------------------------------------------------------

def _normalise(text: str) -> str:
    """Normalise OCR text for comparison — strip whitespace, collapse spaces."""
    return " ".join(text.strip().split()).upper()


def _fuzzy_score(a: str, b: str) -> float:
    """Return character-level Levenshtein similarity [0.0, 1.0] between a and b."""
    a, b = a.upper(), b.upper()
    if a == b:
        return 1.0
    m, n = len(a), len(b)
    if m == 0 or n == 0:
        return 0.0
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, n + 1):
            temp = dp[j]
            if a[i - 1] == b[j - 1]:
                dp[j] = prev
            else:
                dp[j] = 1 + min(prev, dp[j], dp[j - 1])
            prev = temp
    dist = dp[n]
    return 1.0 - dist / max(m, n)


def _fuzzy_match(a: str, b: str, threshold: float = 0.8) -> bool:
    """Simple character-level Levenshtein similarity check."""
    return _fuzzy_score(a, b) >= threshold


def match_rows(
    rows: list,
    vr_nos: list,
    item_code: str,
    match_mode: str = "exact",
    table_region: Optional[dict] = None,
    checkbox_offset_x: int = 30,
) -> list:
    """Find rows that match any of the VR numbers (and optionally the item code).

    Parameters
    ----------
    rows:
        Grouped rows from ``group_rows``.
    vr_nos:
        List of VR number strings to search for.
    item_code:
        Item Code to search for within the same row.  Empty string → skip
        item-code check.
    match_mode:
        ``"exact"`` (default) or ``"fuzzy"``.
    table_region:
        The screen region that was captured.  Used to convert relative image
        coordinates back to absolute screen coordinates.
    checkbox_offset_x:
        Pixels to the left of the leftmost word on the row to place the
        checkbox click X.

    Returns
    -------
    List of match-dicts:
        vrNo         – matched VR number string
        itemCode     – matched item code (or "" if not checked)
        checkboxX    – absolute screen X for checkbox click
        checkboxY    – absolute screen Y for checkbox click
    """
    region_x = int(table_region.get("x", 0)) if table_region else 0
    region_y = int(table_region.get("y", 0)) if table_region else 0

    normalised_vrs = {v: _normalise(v) for v in vr_nos}
    normalised_item = _normalise(item_code) if item_code else ""

    matches = []
    # Track VRs already assigned in this scan so that similar VR numbers
    # (e.g. EZ26Y-011 vs EZ26Y-012) cannot "steal" each other's rows.
    matched_vrs: set = set()

    for row in rows:
        words_text = [_normalise(w["text"]) for w in row["words"]]
        full_row_text = " ".join(words_text)

        # Find a matching VR number in this row
        matched_vr: Optional[str] = None
        if match_mode == "fuzzy":
            # For each unmatched VR, compute the best similarity score against
            # any individual word in the row.  Picking the highest-scoring VR
            # prevents similar numbers (e.g. EZ26Y-011 vs EZ26Y-012, similarity
            # ≈ 0.89) from incorrectly matching the wrong row when only the
            # first-above-threshold VR was taken.
            best_score: float = -1.0
            for vr, norm_vr in normalised_vrs.items():
                if vr in matched_vrs:
                    continue
                score = max((_fuzzy_score(norm_vr, w) for w in words_text), default=0.0)
                if score >= 0.8 and score > best_score:
                    best_score = score
                    matched_vr = vr
        else:
            # Exact: look for norm_vr as a substring of any word or the
            # entire row text — handles cases where OCR merges/splits tokens
            for vr, norm_vr in normalised_vrs.items():
                if vr in matched_vrs:
                    continue
                if norm_vr in full_row_text or any(norm_vr == w for w in words_text):
                    matched_vr = vr
                    break

        if matched_vr is None:
            continue

        # If item_code filter is active, verify it also appears on this row
        if normalised_item:
            if match_mode == "fuzzy":
                item_ok = _fuzzy_match(normalised_item, full_row_text) or any(
                    _fuzzy_match(normalised_item, w) for w in words_text
                )
            else:
                item_ok = normalised_item in full_row_text or any(
                    normalised_item == w for w in words_text
                )
            if not item_ok:
                continue

        # Mark this VR as assigned so it cannot match a second row in this scan.
        matched_vrs.add(matched_vr)

        # Compute checkbox click position
        leftmost_word = min(row["words"], key=lambda w: w["x"])
        cb_img_x = max(0, leftmost_word["x"] - checkbox_offset_x)
        cb_img_y = int(row["y_center"])

        # Compute row bounding box (relative to captured image, then offset to screen)
        row_x_min = min(w["x"] for w in row["words"])
        row_y_min = min(w["y"] for w in row["words"])
        row_x_max = max(w["x"] + w["w"] for w in row["words"])
        row_y_max = max(w["y"] + w["h"] for w in row["words"])

        matches.append({
            "vrNo": matched_vr,
            "itemCode": item_code,
            "checkboxX": region_x + cb_img_x,
            "checkboxY": region_y + cb_img_y,
            "rowX": region_x + row_x_min,
            "rowY": region_y + row_y_min,
            "rowWidth": row_x_max - row_x_min,
            "rowHeight": row_y_max - row_y_min,
        })

    return matches


# ---------------------------------------------------------------------------
# Step 7 — Highlight matched row on screen
# ---------------------------------------------------------------------------

def highlight_row_on_screen(
    x: int,
    y: int,
    width: int,
    height: int,
    duration_ms: int = 800,
    color: str = "red",
    thickness: int = 3,
    checkbox_pos: Optional[tuple] = None,
    checkbox_size: int = 18,
) -> None:
    """Draw a coloured rectangle border on screen over the matched row.

    When *checkbox_pos* ``(screen_x, screen_y)`` is provided a second small
    rectangle of *checkbox_size* × *checkbox_size* pixels is drawn centred on
    that point (using a cyan border) in the same overlay window so both
    highlights appear at the same time without extra blocking calls.

    Creates a transparent tkinter overlay window whose only visible pixels are
    the rectangle borders, then destroys it after *duration_ms* milliseconds.
    Failures are silently logged so automation is never blocked by UI errors.
    """
    try:
        import threading
        import tkinter as tk

        done = threading.Event()

        def _show() -> None:
            try:
                # Compute the bounding box that must contain *both* the row
                # rectangle and, when present, the checkbox rectangle so a
                # single window covers everything.
                pad = thickness + 2
                all_left   = x - pad
                all_top    = y - pad
                all_right  = x + width + pad
                all_bottom = y + height + pad

                if checkbox_pos is not None:
                    cb_x, cb_y = int(checkbox_pos[0]), int(checkbox_pos[1])
                    half = checkbox_size // 2 + thickness + 2
                    all_left   = min(all_left,   cb_x - half)
                    all_top    = min(all_top,    cb_y - half)
                    all_right  = max(all_right,  cb_x + half)
                    all_bottom = max(all_bottom, cb_y + half)

                win_x = max(0, all_left)
                win_y = max(0, all_top)
                win_w = all_right - all_left
                win_h = all_bottom - all_top

                # Helper: convert screen coordinates to canvas-local coordinates.
                def _to_canvas(sx: int, sy: int) -> tuple:
                    return sx - win_x, sy - win_y

                root = tk.Tk()
                root.overrideredirect(True)
                root.attributes("-topmost", True)
                # "black" pixels become transparent — the rectangle outlines
                # (drawn in *color*) stay visible.
                root.wm_attributes("-transparentcolor", "black")
                root.geometry(f"{win_w}x{win_h}+{win_x}+{win_y}")

                canvas = tk.Canvas(
                    root,
                    width=win_w,
                    height=win_h,
                    bg="black",
                    highlightthickness=0,
                )
                canvas.pack()

                # Row rectangle (red by default)
                rx1, ry1 = _to_canvas(x - pad, y - pad)
                rx2, ry2 = _to_canvas(x + width + pad, y + height + pad)
                canvas.create_rectangle(
                    rx1, ry1, rx2, ry2,
                    outline=color,
                    width=thickness,
                    fill="black",
                )

                # Checkbox rectangle (cyan), drawn on the same overlay
                if checkbox_pos is not None:
                    cb_x, cb_y = int(checkbox_pos[0]), int(checkbox_pos[1])
                    half = checkbox_size // 2
                    cx1, cy1 = _to_canvas(cb_x - half, cb_y - half)
                    cx2, cy2 = _to_canvas(cb_x + half, cb_y + half)
                    canvas.create_rectangle(
                        cx1, cy1, cx2, cy2,
                        outline="cyan",
                        width=2,
                        fill="black",
                    )

                root.after(duration_ms, root.destroy)
                root.mainloop()
            except Exception as exc:
                logger.debug(f"highlight_row_on_screen._show: {exc}")
            finally:
                done.set()

        t = threading.Thread(target=_show, daemon=True)
        t.start()
        # Wait for the overlay to close, with a 1-second buffer beyond the display duration
        done.wait(timeout=(duration_ms + 1000) / 1000.0)
    except Exception as e:
        logger.debug(f"highlight_row_on_screen: {e}")


# ---------------------------------------------------------------------------
# Step 8 — Click checkbox
# ---------------------------------------------------------------------------

def click_checkbox(match: dict, click_delay_ms: int = 100) -> None:
    """Click the checkbox for *match* using pyautogui."""
    import pyautogui

    x, y = int(match["checkboxX"]), int(match["checkboxY"])
    pyautogui.click(x, y)
    if click_delay_ms > 0:
        time.sleep(click_delay_ms / 1000.0)
    logger.info(f"Clicked checkbox at ({x}, {y}) for VR={match['vrNo']!r}")


# ---------------------------------------------------------------------------
# Step 9 — Scroll logic
# ---------------------------------------------------------------------------

def scroll_table(
    scroll_x: int,
    scroll_y: int,
    scroll_step: int = 1,
    delay_ms: int = 800,
) -> None:
    """Press the Page Down key *scroll_step* times to scroll the table down.

    The mouse is first moved to (scroll_x, scroll_y) and clicked so the
    target widget receives keyboard focus before the key presses are sent.
    """
    import pyautogui

    # Give the target widget keyboard focus by clicking inside the table region
    if scroll_x > 0 or scroll_y > 0:
        pyautogui.click(scroll_x, scroll_y)
        time.sleep(0.05)

    presses = max(1, scroll_step)
    for _ in range(presses):
        pyautogui.press("pagedown")

    if delay_ms > 0:
        time.sleep(delay_ms / 1000.0)


# ---------------------------------------------------------------------------
# Image comparison helper (end-of-scroll detection)
# ---------------------------------------------------------------------------

def _images_are_same(img1, img2, threshold: float = 0.995) -> bool:
    """Return True when img1 and img2 are nearly identical."""
    try:
        import cv2
        import numpy as np

        if img1 is None or img2 is None:
            return False
        if img1.shape != img2.shape:
            return False
        diff = cv2.absdiff(img1, img2)
        non_zero_ratio = float(np.count_nonzero(diff)) / float(diff.size)
        return non_zero_ratio < (1.0 - threshold)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Step 10 — Main loop: run_vision_match
# ---------------------------------------------------------------------------

def run_vision_match(config: dict, engine=None) -> dict:
    """Main entry-point: capture, OCR, match, click, scroll, repeat.

    Parameters
    ----------
    config:
        Dict with the following keys (all optional unless noted):

        vrNos               (list|str)  – VR numbers to match (required).
                                          If a string, comma-separated.
        itemCode            (str)       – Item Code to also match (optional).
        tableRegion         (dict)      – {x, y, width, height} of table area.
        scrollEnabled       (bool)      – Whether to scroll. Default True.
        scrollStep          (int)       – Number of Page Down key presses per
                                          scroll. Default 1.
        matchMode           (str)       – "exact" or "fuzzy". Default "exact".
        delayBetweenScroll  (int)       – ms between scrolls. Default 800.
        scrollX             (int)       – X coordinate for scroll events.
        scrollY             (int)       – Y coordinate for scroll events.
        maxScrollAttempts   (int)       – Scroll attempts before giving up. Default 20.
        checkboxOffset      (int)       – Pixels left of row text for checkbox. Default 30.
        clickDelay          (int)       – ms between clicks. Default 100.
        rowTolerance        (int)       – Y-centre tolerance for row grouping. Default 8.
        useEasyOcr          (bool)      – Use EasyOCR instead of pytesseract. Default False.
        highlightRow        (bool)      – Draw a red rectangle around each matched row
                                          before clicking. Default True.
        highlightDuration   (int)       – How long (ms) to show the highlight. Default 800.
    engine:
        Optional engine reference (not used directly but available for extensions).

    Returns
    -------
    dict with keys:
        success, matched, not_found, message
    """
    # Parse VR numbers
    vr_nos_raw = config.get("vrNos", [])
    if isinstance(vr_nos_raw, str):
        vr_nos = [v.strip() for v in vr_nos_raw.split(",") if v.strip()]
    else:
        vr_nos = [str(v).strip() for v in vr_nos_raw if str(v).strip()]

    if not vr_nos:
        return {"success": False, "matched": [], "not_found": [], "message": "vision_row_match: vrNos is required"}

    item_code: str = str(config.get("itemCode", "")).strip()
    table_region: Optional[dict] = config.get("tableRegion")
    scroll_enabled: bool = bool(config.get("scrollEnabled", True))
    scroll_step: int = int(config.get("scrollStep", 1))
    match_mode: str = str(config.get("matchMode", "exact"))
    delay_between_scroll: int = int(config.get("delayBetweenScroll", 800))
    scroll_x: int = int(config.get("scrollX", 0))
    scroll_y: int = int(config.get("scrollY", 0))
    max_scroll_attempts: int = int(config.get("maxScrollAttempts", 20))
    checkbox_offset: int = int(config.get("checkboxOffset", 30))
    click_delay: int = int(config.get("clickDelay", 100))
    row_tolerance: int = int(config.get("rowTolerance", 8))
    use_easyocr: bool = bool(config.get("useEasyOcr", False))
    highlight_row: bool = bool(config.get("highlightRow", True))
    highlight_duration: int = int(config.get("highlightDuration", 800))

    # If scrollX/Y not provided, default to the centre of the table region
    if scroll_x == 0 and scroll_y == 0 and table_region:
        scroll_x = (int(table_region.get("x", 0)) + int(table_region.get("width", 0))) // 2
        scroll_y = (int(table_region.get("y", 0)) + int(table_region.get("height", 0))) // 2

    remaining_vrs = set(vr_nos)
    processed_keys: set = set()  # vrNo_itemCode strings already clicked
    matched_list: list = []

    prev_img = None
    scroll_count = 0

    print(json.dumps({"event": "vision_match_start", "vrNos": vr_nos, "itemCode": item_code}), flush=True)
    logger.info(f"vision_row_match: starting — vrNos={vr_nos!r} itemCode={item_code!r}")

    while True:
        # --- Capture ---
        img_rgb = capture_table(table_region)

        # --- End-of-scroll detection ---
        if _images_are_same(prev_img, img_rgb):
            logger.info("vision_row_match: screen unchanged after scroll — reached end of table")
            print(json.dumps({"event": "vision_match_end_of_table"}), flush=True)
            break

        prev_img = img_rgb.copy()

        # --- Preprocess & OCR ---
        img_processed = preprocess_image(img_rgb)
        words = extract_text(img_processed, use_easyocr=use_easyocr)

        if not words:
            logger.warning("vision_row_match: OCR returned no words on this scroll position")
            print(json.dumps({"event": "vision_match_no_text", "scroll": scroll_count}), flush=True)
        else:
            # --- Group rows ---
            rows = group_rows(words, row_tolerance=row_tolerance)
            logger.info(f"vision_row_match: detected {len(rows)} row(s) at scroll {scroll_count}")
            print(json.dumps({"event": "vision_match_rows_detected", "count": len(rows), "scroll": scroll_count}), flush=True)

            # --- Log each row's OCR text and checkbox position (debug) ---
            region_x_dbg = int(table_region.get("x", 0)) if table_region else 0
            region_y_dbg = int(table_region.get("y", 0)) if table_region else 0
            for row_idx, row in enumerate(rows):
                row_text = " ".join(w["text"] for w in row["words"])
                leftmost = min(row["words"], key=lambda w: w["x"])
                cb_img_x = max(0, leftmost["x"] - checkbox_offset)
                cb_img_y = int(row["y_center"])
                cb_screen_x = region_x_dbg + cb_img_x
                cb_screen_y = region_y_dbg + cb_img_y
                logger.debug(
                    f"vision_row_match: row {row_idx}: text={row_text!r} "
                    f"checkbox=({cb_screen_x}, {cb_screen_y})"
                )
                print(json.dumps({
                    "event": "vision_match_row_scanned",
                    "scroll": scroll_count,
                    "row": row_idx,
                    "text": row_text,
                    "checkboxX": cb_screen_x,
                    "checkboxY": cb_screen_y,
                }), flush=True)

            # --- Match & click ---
            current_vrs_list = list(remaining_vrs)
            matches = match_rows(
                rows,
                vr_nos=current_vrs_list,
                item_code=item_code,
                match_mode=match_mode,
                table_region=table_region,
                checkbox_offset_x=checkbox_offset,
            )

            for match in matches:
                row_key = f"{match['vrNo']}_{match['itemCode']}"
                if row_key in processed_keys:
                    logger.info(f"vision_row_match: duplicate row skipped: {row_key}")
                    continue

                processed_keys.add(row_key)
                matched_list.append(match)
                remaining_vrs.discard(match["vrNo"])

                print(json.dumps({
                    "event": "vision_match_row_found",
                    "vrNo": match["vrNo"],
                    "itemCode": match["itemCode"],
                    "x": match["checkboxX"],
                    "y": match["checkboxY"],
                }), flush=True)
                logger.info(f"Row found: {match['vrNo']} → MATCHED → clicking at ({match['checkboxX']}, {match['checkboxY']})")

                if highlight_row:
                    highlight_row_on_screen(
                        x=match["rowX"],
                        y=match["rowY"],
                        width=match["rowWidth"],
                        height=match["rowHeight"],
                        duration_ms=highlight_duration,
                        checkbox_pos=(match["checkboxX"], match["checkboxY"]),
                    )

                click_checkbox(match, click_delay_ms=click_delay)

        # Stop if all VR numbers have been matched
        if not remaining_vrs:
            logger.info("vision_row_match: all VR numbers matched")
            break

        # Stop if scrolling is disabled or limit reached
        if not scroll_enabled:
            break

        if scroll_count >= max_scroll_attempts:
            logger.info(f"vision_row_match: reached max scroll attempts ({max_scroll_attempts})")
            print(json.dumps({"event": "vision_match_max_scroll"}), flush=True)
            break

        # --- Scroll ---
        logger.info(f"vision_row_match: scrolling (attempt {scroll_count + 1})")
        print(json.dumps({"event": "vision_match_scrolling", "attempt": scroll_count + 1}), flush=True)
        scroll_table(scroll_x, scroll_y, scroll_step=scroll_step, delay_ms=delay_between_scroll)
        scroll_count += 1

    not_found = list(remaining_vrs)
    total_matched = len(matched_list)

    summary = (
        f"Total matched: {total_matched}. "
        + (f"Not found: {not_found}" if not_found else "All VR numbers matched.")
    )
    logger.info(f"vision_row_match: {summary}")
    print(json.dumps({"event": "vision_match_complete", "matched": total_matched, "not_found": not_found}), flush=True)

    return {
        "success": True,
        "matched": [m["vrNo"] for m in matched_list],
        "not_found": not_found,
        "message": summary,
    }
