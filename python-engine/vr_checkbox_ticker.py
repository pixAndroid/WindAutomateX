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

Column-aware matching
---------------------
When *vr_col_header* and/or *item_code_col_header* are provided the
module first detects those column headers on-screen via OCR and then
restricts each search to the x-range of the appropriate column.  This
gives row-by-row, column-by-column precision: a VR number found in the
wrong column (e.g. a description that happens to contain the number) is
no longer a false positive.

Public API
----------
tick_checkboxes_by_vr(vr_list_str, *, window_title, grid_roi,
                      scroll_x, scroll_y, max_scroll_attempts,
                      scroll_step, checkbox_offset,
                      item_code, vr_col_header, item_code_col_header,
                      engine) -> dict
    Main entry-point.  Returns a result dict with keys:
        success            – True when at least one VR was checked without error
        checked            – list of VR numbers successfully ticked
        not_found          – list of VR numbers not found after full scroll
        errors             – list of per-VR error strings
        message            – human-readable summary
        checkbox_positions – {vr_number: (screen_x, screen_y)} for ticked rows
        checkbox_distance  – configured pixel distance from VR text to checkbox
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


def _detect_checkbox_column_x(screenshot) -> Optional[int]:
    """
    Detect the x-centre of the checkbox column in *screenshot* using
    morphological vertical-line detection.

    The checkbox column is the leftmost column in the grid (before the first
    text column, e.g. "Vr No").  Its position is derived by finding the gap
    between the first two detected vertical separator lines.

    Returns the x-coordinate (image-relative) of the column centre, or
    ``None`` when the table structure cannot be reliably determined.
    """
    import cv2
    import numpy as np

    gray = cv2.cvtColor(screenshot, cv2.COLOR_RGB2GRAY) if screenshot.ndim == 3 else screenshot
    img_h, img_w = gray.shape

    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15, C=4,
    )

    # Vertical lines: kernel spans at least 20 % of image height so only
    # genuine full-height column separators survive.
    v_kernel_h = max(img_h // 5, 15)
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_kernel_h))
    v_lines_img = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel)

    v_proj = np.sum(v_lines_img, axis=0).astype(np.float32)
    min_pixels = img_h * 0.20 * 255
    raw_v = [x for x in range(img_w) if v_proj[x] >= min_pixels]

    if len(raw_v) < 2:
        return None

    # Group adjacent pixels that belong to the same line
    groups: list = []
    current: list = [raw_v[0]]
    for x in raw_v[1:]:
        if x - current[-1] <= 6:
            current.append(x)
        else:
            groups.append(int(round(sum(current) / len(current))))
            current = [x]
    groups.append(int(round(sum(current) / len(current))))

    if len(groups) < 2:
        return None

    x_left, x_right = groups[0], groups[1]
    col_width = x_right - x_left
    if not (5 <= col_width <= 80):
        logger.debug(
            "_detect_checkbox_column_x: first column width %d px outside [5,80] — skipping",
            col_width,
        )
        return None

    cb_x = (x_left + x_right) // 2
    logger.debug(
        "_detect_checkbox_column_x: checkbox column x=[%d, %d] center=%d",
        x_left, x_right, cb_x,
    )
    return cb_x


def _detect_row_bounds(
    screenshot,
    approx_y: int,
    row_search_margin: int = 80,
) -> Optional[tuple[int, int]]:
    """
    Detect the top and bottom Y coordinates of the grid row that contains
    *approx_y*, using horizontal-line detection (OpenCV morphology).

    Algorithm
    ---------
    1. Restrict analysis to a vertical band ``[approx_y - margin, approx_y + margin]``
       for speed and to avoid picking up unrelated horizontal lines elsewhere.
    2. Convert the band to binary with adaptive thresholding.
    3. Apply a wide horizontal structuring element so that only long row-spanning
       lines survive the morphological opening.
    4. Reduce to a 1-D projection and group adjacent "hot" pixels into line centres.
    5. Return the nearest line above and the nearest line below *approx_y* as the
       row's top/bottom boundaries.

    Parameters
    ----------
    screenshot : numpy.ndarray
        Current screenshot (RGB or grayscale), image-relative.
    approx_y : int
        Approximate Y centre from OCR (image-relative).
    row_search_margin : int
        Vertical pixels above and below *approx_y* to include in the search band.

    Returns
    -------
    (top_y, bottom_y) – image-relative row boundary Y values, or ``None`` when
    row separators could not be reliably detected.
    """
    import cv2
    import numpy as np

    gray = cv2.cvtColor(screenshot, cv2.COLOR_RGB2GRAY) if screenshot.ndim == 3 else screenshot
    img_h, img_w = gray.shape

    y_lo = max(0, approx_y - row_search_margin)
    y_hi = min(img_h, approx_y + row_search_margin)
    band = gray[y_lo:y_hi]

    binary = cv2.adaptiveThreshold(
        band, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15, C=4,
    )

    # Wide horizontal kernel – only lines spanning ≥20 % of image width survive
    h_kernel_w = max(img_w // 5, 40)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_kernel_w, 1))
    h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel)

    h_proj = np.sum(h_lines, axis=1).astype(np.float32)
    min_pixels = img_w * 0.15 * 255
    raw_ys = [y for y in range(h_proj.shape[0]) if h_proj[y] >= min_pixels]

    if not raw_ys:
        logger.debug(
            "_detect_row_bounds: no horizontal lines found near approx_y=%d", approx_y
        )
        return None

    # Group adjacent pixels → line centres; translate back to image coordinates
    groups: list[int] = []
    current: list[int] = [raw_ys[0]]
    for y in raw_ys[1:]:
        if y - current[-1] <= 4:
            current.append(y)
        else:
            groups.append(int(round(sum(current) / len(current))) + y_lo)
            current = [y]
    groups.append(int(round(sum(current) / len(current))) + y_lo)

    logger.debug(
        "_detect_row_bounds: detected %d horizontal line(s) near approx_y=%d: %s",
        len(groups), approx_y, groups,
    )

    above = [g for g in groups if g <= approx_y]
    below = [g for g in groups if g > approx_y]

    if above and below:
        return (above[-1], below[0])

    # Only lines on one side – estimate the missing boundary from row height
    if above and len(above) >= 2:
        row_h = above[-1] - above[-2]
        return (above[-1], min(img_h - 1, above[-1] + row_h))
    if below and len(below) >= 2:
        row_h = below[1] - below[0]
        return (max(0, below[0] - row_h), below[0])

    # Single line detected – can't determine which side of the row we're on
    return None


def _save_debug_screenshot(
    screenshot,
    vr_number: str,
    vr_bbox: tuple[int, int, int, int],
    click_xy: tuple[int, int],
    row_bounds: Optional[tuple[int, int]],
    roi: Optional[tuple[int, int, int, int]],
    debug_dir: str = "",
) -> None:
    """
    Save an annotated screenshot for checkbox-click debugging.

    Annotations
    -----------
    - Green rectangle : OCR bounding box for the VR text
    - Blue horizontal lines : detected row boundaries (when available)
    - Red cross + circle : the final checkbox click point (image-relative)

    Parameters
    ----------
    screenshot : numpy.ndarray
        ROI-relative screenshot (RGB).
    vr_number : str
        VR number label (used in the output filename).
    vr_bbox : (x, y, w, h)
        Image-relative OCR bounding box for the VR text.
    click_xy : (screen_x, screen_y)
        Absolute screen click coordinates.
    row_bounds : (top_y, bottom_y) | None
        Image-relative row boundary Y values from :func:`_detect_row_bounds`.
    roi : (rx, ry, rw, rh) | None
        Screen ROI used for the capture (needed to translate screen coords back
        to image coords for drawing).
    debug_dir : str
        Directory where debug images are saved.  Defaults to the current
        working directory when empty.
    """
    import os
    import cv2

    try:
        img = cv2.cvtColor(screenshot, cv2.COLOR_RGB2BGR) if screenshot.ndim == 3 else \
              cv2.cvtColor(screenshot, cv2.COLOR_GRAY2BGR)

        # Green rectangle: OCR VR text bounding box
        bx, by, bw, bh = vr_bbox
        cv2.rectangle(img, (bx, by), (bx + bw, by + bh), (0, 200, 0), 2)
        cv2.putText(img, "VR text", (bx, max(by - 4, 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 0), 1)

        # Blue lines: detected row boundaries
        if row_bounds is not None:
            top_y, bottom_y = row_bounds
            cv2.line(img, (0, top_y), (img.shape[1], top_y), (200, 130, 0), 1)
            cv2.line(img, (0, bottom_y), (img.shape[1], bottom_y), (200, 130, 0), 1)
            mid_y = (top_y + bottom_y) // 2
            cv2.line(img, (0, mid_y), (img.shape[1], mid_y), (200, 200, 0), 1)

        # Red cross + circle: checkbox click point (image-relative)
        roi_x = roi[0] if roi else 0
        roi_y = roi[1] if roi else 0
        cx = click_xy[0] - roi_x
        cy = click_xy[1] - roi_y
        if 0 <= cx < img.shape[1] and 0 <= cy < img.shape[0]:
            cv2.circle(img, (cx, cy), 7, (0, 0, 220), 2)
            cv2.drawMarker(img, (cx, cy), (0, 0, 220), cv2.MARKER_CROSS, 12, 2)
            cv2.putText(
                img, f"click ({click_xy[0]},{click_xy[1]})",
                (max(cx - 40, 0), max(cy - 10, 10)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 220), 1,
            )

        safe_vr = vr_number.replace("/", "_").replace("\\", "_").replace(":", "_")
        ts = int(time.time() * 1000)
        filename = os.path.join(debug_dir or ".", f"debug_cb_{safe_vr}_{ts}.png")
        cv2.imwrite(filename, img)
        logger.info("_save_debug_screenshot: saved %s", filename)
    except Exception as exc:
        logger.warning("_save_debug_screenshot: failed — %s", exc)


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


def _find_all_bboxes(
    ocr_data: dict,
    search_text: str,
    x_range: Optional[tuple[int, int]] = None,
) -> list[tuple[int, int, int, int]]:
    """
    Return **all** bounding boxes whose OCR word (or word group) contains
    *search_text* (case-insensitive sub-string match).

    Parameters
    ----------
    ocr_data : dict
        Raw dict returned by :func:`_ocr_get_data`.
    search_text : str
        Text to search for (case-insensitive sub-string).
    x_range : (x_min, x_max) | None
        When provided, only bounding boxes whose left edge falls within
        ``[x_min, x_max]`` are returned.  Pass the result of
        :func:`_get_column_x_range` to restrict the search to a single
        grid column and avoid false positives in other columns.

    Returns
    -------
    list of (x, y, w, h) tuples relative to the captured image.

    Notes
    -----
    Tesseract often splits hyphenated values (e.g. ``"EZ25Y-060"``) or
    multi-word column headers (e.g. ``"DI No"``) into separate tokens.
    This function therefore also searches groups of 2–3 consecutive tokens
    that share the same OCR line, joining them with ``""``, ``"-"``, and
    ``" "`` before matching.  Merged bounding boxes are computed for
    multi-token matches.
    """
    needle = search_text.lower()
    words = ocr_data["text"]
    n = len(words)

    results: list[tuple[int, int, int, int]] = []
    seen: set[tuple[int, int, int, int]] = set()

    def _add(bbox: tuple[int, int, int, int]) -> None:
        if bbox[2] > 0 and bbox[3] > 0 and bbox not in seen:
            seen.add(bbox)
            results.append(bbox)

    def _same_line(indices: list[int]) -> bool:
        ref = indices[0]
        return all(
            ocr_data["block_num"][k] == ocr_data["block_num"][ref]
            and ocr_data["par_num"][k] == ocr_data["par_num"][ref]
            and ocr_data["line_num"][k] == ocr_data["line_num"][ref]
            for k in indices[1:]
        )

    def _merge_bboxes(indices: list[int]) -> Optional[tuple[int, int, int, int]]:
        valid = [
            k for k in indices
            if words[k] and int(ocr_data["width"][k]) > 0 and int(ocr_data["height"][k]) > 0
        ]
        if not valid:
            return None
        lefts   = [int(ocr_data["left"][k])                                for k in valid]
        tops    = [int(ocr_data["top"][k])                                  for k in valid]
        bottoms = [int(ocr_data["top"][k]) + int(ocr_data["height"][k])    for k in valid]
        rights  = [int(ocr_data["left"][k]) + int(ocr_data["width"][k])    for k in valid]
        merged_x = min(lefts)
        merged_y = min(tops)
        return (merged_x, merged_y, max(rights) - merged_x, max(bottoms) - merged_y)

    for i in range(n):
        w1 = words[i]
        if not w1:
            continue

        # --- Single-word match ---
        if needle in w1.lower():
            x = int(ocr_data["left"][i])
            y = int(ocr_data["top"][i])
            w = int(ocr_data["width"][i])
            h = int(ocr_data["height"][i])
            if w > 0 and h > 0:
                if x_range is None or (x_range[0] <= x <= x_range[1]):
                    _add((x, y, w, h))

        # --- Multi-word match: spans of 2 and 3 consecutive tokens ---
        # Handles hyphenated VR numbers split by OCR (e.g. "EZ25Y" + "060")
        # and multi-word headers (e.g. "DI" + "No", "Item" + "Code").
        for span in (2, 3):
            end = i + span
            if end > n:
                break
            indices = list(range(i, end))
            if not _same_line(indices):
                break  # if the pair isn't on one line, the triple won't be either
            segment = [words[k] for k in indices if words[k]]
            if len(segment) < 2:
                continue
            matched = any(needle in sep.join(segment).lower() for sep in ("", "-", " "))
            if matched:
                bbox = _merge_bboxes(indices)
                if bbox:
                    if x_range is None or (x_range[0] <= bbox[0] <= x_range[1]):
                        _add(bbox)

    return results


def _get_column_x_range(
    ocr_data: dict,
    header_text: str,
    col_width_factor: float = 1.5,
    min_half_width: int = 40,
) -> Optional[tuple[int, int]]:
    """
    Detect the horizontal extent of a grid column by locating its header.

    The function finds the first OCR match for *header_text* and returns an
    ``(x_min, x_max)`` range centred on the header bounding box.  The range
    is wide enough to capture full cell values even when the column is narrow.

    Parameters
    ----------
    ocr_data : dict
        Raw OCR data for the current screenshot.
    header_text : str
        Column header as it appears on screen (e.g. ``"DI No"`` or
        ``"Item Code"``).  A sub-string match is used so abbreviated or
        partially recognised headers are still found.
    col_width_factor : float
        Multiplier applied to the detected header width to derive the column
        half-width.  Values > 1 give a generous band that accounts for cells
        whose text is wider than the header.
    min_half_width : int
        Floor value for the column half-width in pixels.  Prevents an
        excessively narrow band when the header is very short.

    Returns
    -------
    (x_min, x_max) or None when the header is not found in *ocr_data*.
    """
    bboxes = _find_all_bboxes(ocr_data, header_text)
    if not bboxes:
        logger.debug("_get_column_x_range: header '%s' not found in OCR data", header_text)
        return None
    hx, _hy, hw, _hh = bboxes[0]
    col_center = hx + hw // 2
    half_width = int(max(hw * col_width_factor, min_half_width))
    x_min = max(0, col_center - half_width)
    x_max = col_center + half_width
    logger.debug(
        "_get_column_x_range: header '%s' → center=%d half_width=%d range=[%d, %d]",
        header_text, col_center, half_width, x_min, x_max,
    )
    return (x_min, x_max)


def _ocr_find_text(
    image,
    search_text: str,
    col_header: str = "",
) -> Optional[tuple]:
    """
    Use pytesseract to locate the **first** occurrence of *search_text* in
    *image*.

    Returns an (x, y, w, h) bounding box **relative to image**, or None.
    The search is case-insensitive and also matches when *search_text* is a
    sub-string of a recognised word (handles slight OCR mis-reads).

    Parameters
    ----------
    image : numpy.ndarray
        Screenshot to search.
    search_text : str
        Text to find.
    col_header : str
        When non-empty, the search is restricted to the x-range of the column
        whose on-screen header matches this string.  Pass the value of
        ``vrColumn`` (e.g. ``"DI No"``) to avoid picking up the same number
        appearing in a different grid column.
    """
    data = _ocr_get_data(image)
    x_range: Optional[tuple[int, int]] = None
    if col_header:
        x_range = _get_column_x_range(data, col_header)
        if x_range is None:
            logger.debug(
                "_ocr_find_text: column header '%s' not detected — searching full width",
                col_header,
            )
    bboxes = _find_all_bboxes(data, search_text, x_range=x_range)
    return bboxes[0] if bboxes else None


def _ocr_find_text_with_item_code(
    image,
    vr_text: str,
    item_code: str,
    row_tolerance: int = 12,
    vr_col_header: str = "",
    item_code_col_header: str = "",
) -> Optional[tuple]:
    """
    Locate *vr_text* in *image* **only when** *item_code* also appears on
    the same grid row (y-centres within *row_tolerance* pixels).

    Column-aware matching
    ~~~~~~~~~~~~~~~~~~~~~
    When *vr_col_header* is provided the search for *vr_text* is restricted
    to the x-range of the column whose header matches that string.  Likewise
    *item_code_col_header* restricts the Item Code search to its own column.
    This ensures row-by-row, column-by-column precision: a value that appears
    in a different column on the same row is not treated as a match.

    Returns the VR text bounding box ``(x, y, w, h)`` if a matching pair is
    found, otherwise ``None``.
    """
    data = _ocr_get_data(image)

    # Resolve column x-ranges from on-screen column headers
    vr_x_range: Optional[tuple[int, int]] = None
    if vr_col_header:
        vr_x_range = _get_column_x_range(data, vr_col_header)
        if vr_x_range is None:
            logger.debug(
                "_ocr_find_text_with_item_code: VR column header '%s' not detected — searching full width",
                vr_col_header,
            )

    code_x_range: Optional[tuple[int, int]] = None
    if item_code_col_header:
        code_x_range = _get_column_x_range(data, item_code_col_header)
        if code_x_range is None:
            logger.debug(
                "_ocr_find_text_with_item_code: Item Code column header '%s' not detected — searching full width",
                item_code_col_header,
            )

    vr_bboxes = _find_all_bboxes(data, vr_text, x_range=vr_x_range)
    # Fall back to full-width VR search when column restriction yields nothing
    if not vr_bboxes and vr_x_range is not None:
        logger.debug(
            "_ocr_find_text_with_item_code: VR '%s' not found in column x-range — "
            "retrying full-width",
            vr_text,
        )
        vr_bboxes = _find_all_bboxes(data, vr_text)

    code_bboxes = _find_all_bboxes(data, item_code, x_range=code_x_range)
    # Fall back to full-width item-code search when column restriction yields nothing
    if not code_bboxes and code_x_range is not None:
        logger.debug(
            "_ocr_find_text_with_item_code: item code '%s' not found in column x-range — "
            "retrying full-width",
            item_code,
        )
        code_bboxes = _find_all_bboxes(data, item_code)

    if not vr_bboxes or not code_bboxes:
        return None

    for vr_bbox in vr_bboxes:
        vr_cy = vr_bbox[1] + vr_bbox[3] // 2
        for code_bbox in code_bboxes:
            code_cy = code_bbox[1] + code_bbox[3] // 2
            if abs(vr_cy - code_cy) <= row_tolerance:
                logger.debug(
                    "_ocr_find_text_with_item_code: matched VR '%s' + item code '%s' "
                    "at y-centres %d / %d (diff=%d px)",
                    vr_text, item_code, vr_cy, code_cy, abs(vr_cy - code_cy),
                )
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
    vr_col_header: str = "",
    item_code_col_header: str = "",
    row_tolerance: int = 12,
    checkbox_y_offset: int = 0,
    debug_screenshots: bool = False,
    debug_dir: str = "",
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
        checkbox column lives.  The actual click position and distance from
        the VR text are both logged and included in the returned dict.
        Only used when the checkbox column cannot be detected via table-structure
        analysis.
    item_code : str
        When provided, a VR number is only ticked when both the VR number
        **and** this item code appear on the same grid row.  Rows where only
        the VR number matches (but the item code differs) are skipped.
    vr_col_header : str
        On-screen column header for the VR / DI No column (e.g. ``"DI No"``).
        When supplied, VR number searches are restricted to the x-range of
        that column so that the same number appearing in a different column
        does not cause a false match.  Typically the same value as the Excel
        ``vrColumn`` field.
    item_code_col_header : str
        On-screen column header for the Item Code column.  When supplied,
        item code searches are restricted to that column's x-range.
        Typically the same value as the Excel ``itemCodeColumn`` field.
    row_tolerance : int
        Maximum pixel difference between the y-centres of the VR text and
        the Item Code text for them to be considered on the same grid row.
        Increase this value for grids with taller or inconsistently-sized
        rows.  Default is ``12``.
    checkbox_y_offset : int
        Signed vertical adjustment (pixels) applied **on top of** the
        dynamically detected row-centre Y.  Positive values move the click
        down; negative values move it up.  Default is ``0`` (no correction).
        Use this to fine-tune when the checkbox is not exactly at the row
        centre (e.g. ``-2`` or ``+3`` to account for row padding).
    debug_screenshots : bool
        When ``True``, an annotated PNG is saved after each checkbox click
        attempt.  The image shows the OCR bounding box (green), detected row
        boundaries (blue), and the final click point (red).  Useful for
        diagnosing incorrect click coordinates without live access to the
        machine.  Default is ``False``.
    debug_dir : str
        Directory where debug screenshots are saved when *debug_screenshots*
        is ``True``.  Defaults to the current working directory when empty.
    engine : WindAutomateXEngine | None
        Shared engine instance used for pywinauto window activation.

    Returns
    -------
    dict
        ``{"success": bool, "checked": [...], "not_found": [...],
           "errors": [...], "message": str,
           "checkbox_positions": {vr: (x, y)},
           "checkbox_distance": int}``
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
    if debug_screenshots:
        logger.info(
            "tick_checkboxes_by_vr: debug mode ON — annotated screenshots will be saved to '%s'",
            debug_dir or ".",
        )

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
    checkbox_positions: dict[str, tuple[int, int]] = {}

    if vr_col_header or item_code_col_header:
        logger.info(
            "tick_checkboxes_by_vr: column-aware mode — VR col header='%s', "
            "Item Code col header='%s'",
            vr_col_header, item_code_col_header,
        )

    # Detect the checkbox column X position once from the initial screenshot.
    # The checkbox column is the leftmost grid column (before "Vr No" / "DI No").
    # This avoids relying on a fixed pixel offset from the VR text, which can be
    # inaccurate when the VR text is close to the left edge of the ROI.
    checkbox_col_x: Optional[int] = None
    try:
        _init_shot = _capture_roi(roi, pyautogui)
        checkbox_col_x = _detect_checkbox_column_x(_init_shot)
        if checkbox_col_x is not None:
            logger.info(
                "tick_checkboxes_by_vr: detected checkbox column center at x=%d "
                "(table structure detection)",
                checkbox_col_x,
            )
        else:
            logger.info(
                "tick_checkboxes_by_vr: checkbox column not detected via CV — "
                "will use offset-based fallback (offset=%d px)",
                checkbox_offset,
            )
    except Exception as _exc:
        logger.warning(
            "tick_checkboxes_by_vr: initial checkbox column detection failed (%s) — "
            "using offset-based fallback",
            _exc,
        )

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

            # --- OCR search (column-aware when headers are provided) ---
            try:
                if item_code:
                    bbox = _ocr_find_text_with_item_code(
                        screenshot, vr_number, item_code,
                        row_tolerance=row_tolerance,
                        vr_col_header=vr_col_header,
                        item_code_col_header=item_code_col_header,
                    )
                    if bbox is None:
                        logger.debug(
                            "%s: VR+item-code pair not found on this scroll page "
                            "(item_code=%s, row_tolerance=%d)",
                            vr_number, item_code, row_tolerance,
                        )
                else:
                    bbox = _ocr_find_text(
                        screenshot, vr_number,
                        col_header=vr_col_header,
                    )
                    if bbox is None:
                        logger.debug("%s: VR text not found on this scroll page", vr_number)
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

                roi_origin_x = roi[0] if roi is not None else 0
                roi_origin_y = roi[1] if roi is not None else 0

                # --- X coordinate ---
                # Prefer the table-structure-detected checkbox column centre;
                # fall back to the fixed offset from VR text left edge.
                if checkbox_col_x is not None:
                    screen_x = roi_origin_x + checkbox_col_x
                    x_method = f"table-detected col x={checkbox_col_x}"
                else:
                    screen_x = roi_origin_x + bx - checkbox_offset
                    x_method = f"offset={checkbox_offset} px"

                # --- Y coordinate (dynamic row-centre detection) ---
                # Use horizontal-line detection to find the true row boundaries
                # and click the row centre.  This is more reliable than the OCR
                # bbox centre, which can be skewed by multi-line text, row
                # padding, or OCR bounding-box inconsistencies.
                ocr_center_y = by + bh // 2  # image-relative OCR bbox centre
                row_bounds = _detect_row_bounds(screenshot, ocr_center_y)

                if row_bounds is not None:
                    row_top, row_bottom = row_bounds
                    img_y = (row_top + row_bottom) // 2 + checkbox_y_offset
                    y_method = (
                        f"row-centre (lines top={row_top} bottom={row_bottom})"
                        + (f" + y_offset={checkbox_y_offset}" if checkbox_y_offset else "")
                    )
                else:
                    img_y = ocr_center_y + checkbox_y_offset
                    y_method = (
                        "OCR-bbox-centre (row-line detection failed)"
                        + (f" + y_offset={checkbox_y_offset}" if checkbox_y_offset else "")
                    )

                screen_y = roi_origin_y + img_y
                vr_screen_x = roi_origin_x + bx + bw // 2  # centre of VR text

                # Clamp to avoid accidental off-screen clicks
                screen_x = max(0, screen_x)
                screen_y = max(0, screen_y)

                distance_px = vr_screen_x - screen_x
                logger.info(
                    "%s: VR text centre at (%d, %d), checkbox click at (%d, %d), "
                    "x-dist=%d px — x:%s | y:%s",
                    vr_number,
                    vr_screen_x, roi_origin_y + ocr_center_y,
                    screen_x, screen_y,
                    distance_px,
                    x_method, y_method,
                )

                if debug_screenshots:
                    _save_debug_screenshot(
                        screenshot, vr_number,
                        vr_bbox=bbox,
                        click_xy=(screen_x, screen_y),
                        row_bounds=row_bounds,
                        roi=roi,
                        debug_dir=debug_dir,
                    )

                try:
                    pyautogui.click(screen_x, screen_y)
                    time.sleep(0.15)
                    checked.append(vr_number)
                    checkbox_positions[vr_number] = (screen_x, screen_y)
                    found = True
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
        "checkbox_positions": checkbox_positions,
        "checkbox_distance": checkbox_offset,
    }
