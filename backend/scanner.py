"""OpenCV processing pipeline for ESPScanCam — CamScanner-quality document scanning.

Detection inspired by SwiftCamScanner (multi-channel + multi-threshold)
and suhren/camscan (Hough lines, sharpen + adaptive threshold).
"""

import asyncio
import json
import math
import os
import time

import cv2
import numpy as np
from PIL import Image

from config import get_data_dir


# ---------------------------------------------------------------------------
# Profile loader
# ---------------------------------------------------------------------------

async def get_profile_options(db, profile_name: str) -> dict:
    """Fetch processing profile options from the database."""
    cursor = await db.execute(
        "SELECT options FROM profiles WHERE id = ?", (profile_name,)
    )
    row = await cursor.fetchone()

    if row is None:
        cursor = await db.execute(
            "SELECT options FROM profiles WHERE name = ?", (profile_name,)
        )
        row = await cursor.fetchone()

    if row is None:
        cursor = await db.execute(
            "SELECT options FROM profiles WHERE id = 'default'"
        )
        row = await cursor.fetchone()

    if row is None:
        return {
            "auto_crop": {"enabled": True, "sensitivity": 50},
            "deskew": {"enabled": True, "max_angle": 15},
            "denoise": {"enabled": True, "strength": 7},
            "clahe": {"enabled": True, "clip_limit": 2.0, "grid_size": 8},
            "sharpen": {"enabled": True, "amount": 1.5},
            "white_balance": {"enabled": True},
            "bw_mode": {
                "enabled": False,
                "method": "adaptive",
                "block_size": 21,
                "constant": 15,
            },
            "output": {"format": "pdf", "quality": 85, "dpi": 300},
        }

    options = row["options"]
    if isinstance(options, str):
        options = json.loads(options)
    return options


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _cos_angle(pt1, pt2, pt0):
    """Cosine of angle at pt0 formed by pt1-pt0-pt2 (SwiftCamScanner)."""
    dx1 = float(pt1[0] - pt0[0])
    dy1 = float(pt1[1] - pt0[1])
    dx2 = float(pt2[0] - pt0[0])
    dy2 = float(pt2[1] - pt0[1])
    denom = math.sqrt((dx1 * dx1 + dy1 * dy1) * (dx2 * dx2 + dy2 * dy2))
    if denom < 1e-10:
        return 0.0
    return (dx1 * dx2 + dy1 * dy2) / denom


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order four points: top-left, top-right, bottom-right, bottom-left."""
    pts = pts.reshape(4, 2).astype("float32")
    # Top-left has smallest sum x+y
    i0 = int(np.argmin(np.sum(pts, axis=1)))
    x0, y0 = pts[i0]
    candidates = []
    for i in range(4):
        if i == i0:
            continue
        x, y = pts[i]
        candidates.append((math.atan2(y - y0, x - x0), i))
    idxs = [i for _, i in sorted(candidates)]
    return np.array([pts[i0], pts[idxs[0]], pts[idxs[1]], pts[idxs[2]]], dtype="float32")


def _four_point_transform(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Perspective warp to a clean rectangle (SwiftCamScanner style)."""
    rect = _order_points(pts)
    (tl, tr, br, bl) = rect

    wA = np.linalg.norm(br - bl)
    wB = np.linalg.norm(tr - tl)
    maxW = max(int(wA), int(wB))

    hA = np.linalg.norm(tr - br)
    hB = np.linalg.norm(tl - bl)
    maxH = max(int(hA), int(hB))

    if maxW < 100 or maxH < 100:
        return image

    dst = np.array([
        [0, 0], [maxW - 1, 0],
        [maxW - 1, maxH - 1], [0, maxH - 1],
    ], dtype="float32")

    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (maxW, maxH))


# ---------------------------------------------------------------------------
# Document detection — SwiftCamScanner approach
#
# For each color channel (B, G, R), run Canny + threshold at multiple levels,
# find contours, approxPolyDP with eps=0.02*perimeter, keep 4-point convex
# quads with angles close to 90°. Pick the largest valid rectangle.
# ---------------------------------------------------------------------------

RESCALED_HEIGHT = 500.0


def _find_rectangles(image):
    """Find all rectangular 4-point contours in the image.
    Searches across all 3 color channels with multiple threshold levels
    (SwiftCamScanner / OpenCV squares.cpp approach).

    Uses multiple Canny parameter sets and threshold levels for robustness
    across different lighting and contrast conditions.
    """
    rectangles = []
    blurred = cv2.GaussianBlur(image, (11, 11), 0)

    for c in range(3):  # B, G, R channels
        channel = blurred[:, :, c]

        # Level 0: sensitive Canny (good for high-contrast edges)
        # Level 1: stronger Canny (good for close-up photos)
        # Level 2-4: direct thresholds at different brightness levels
        threshold_levels = 5
        for level in range(threshold_levels):
            if level == 0:
                gray = cv2.Canny(channel, 10, 20, apertureSize=3)
                gray = cv2.dilate(gray, None)
            elif level == 1:
                gray = cv2.Canny(channel, 50, 150, apertureSize=3)
                gray = cv2.dilate(gray, None)
            else:
                # Direct thresholds at 33%, 50%, 66% brightness
                thresh_val = (level - 1) * 255 // (threshold_levels - 1)
                _, gray = cv2.threshold(
                    channel, thresh_val, 255, cv2.THRESH_BINARY
                )

            contours, _ = cv2.findContours(
                gray, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
            )

            for cnt in contours:
                peri = cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

                if (len(approx) == 4
                        and abs(cv2.contourArea(approx)) > 1000
                        and cv2.isContourConvex(approx)):
                    pts = approx.reshape(4, 2)
                    max_cos = 0
                    for j in range(2, 5):
                        cos = abs(_cos_angle(
                            pts[j % 4], pts[j - 2], pts[j - 1]
                        ))
                        max_cos = max(max_cos, cos)

                    # Relaxed from 0.3 to 0.4 for slightly skewed documents
                    if max_cos < 0.4:
                        rectangles.append(pts)

    return rectangles


def _get_largest_rectangle(rectangles, min_area_ratio, img_area):
    """Pick the largest rectangle that covers at least min_area_ratio of image."""
    if not rectangles:
        return None

    best = None
    best_area = 0

    for rect in rectangles:
        br = cv2.boundingRect(rect)
        area = br[2] * br[3]
        if area > best_area and area >= img_area * min_area_ratio:
            best_area = area
            best = rect

    return best


def _detect_document(small):
    """Detect document in a downscaled image. Returns 4 ordered points or None."""
    sh, sw = small.shape[:2]
    img_area = sh * sw

    # SwiftCamScanner approach: multi-channel multi-threshold rectangle detection
    rectangles = _find_rectangles(small)
    quad = _get_largest_rectangle(rectangles, 0.15, img_area)

    if quad is not None:
        return _order_points(quad)

    # Fallback: color segmentation for high-contrast cases (receipt on dark bg)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    _, paper = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    paper = cv2.morphologyEx(paper, cv2.MORPH_CLOSE, k, iterations=3)
    paper = cv2.morphologyEx(paper, cv2.MORPH_OPEN, k, iterations=2)

    contours, _ = cv2.findContours(paper, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    for c in contours[:5]:
        area = cv2.contourArea(c)
        if area < img_area * 0.10 or area > img_area * 0.95:
            continue
        hull = cv2.convexHull(c)
        peri = cv2.arcLength(hull, True)
        if peri < 10:
            continue
        for eps in np.arange(0.01, 0.10, 0.005):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                return _order_points(approx.reshape(4, 2))

    return None


# ---------------------------------------------------------------------------
# Processing steps
# ---------------------------------------------------------------------------

def _step_auto_crop(image: np.ndarray, opts: dict) -> np.ndarray:
    """Step 1 -- Document detection + perspective correction to rectangle."""
    h, w = image.shape[:2]
    ratio = h / RESCALED_HEIGHT
    new_w = int(w / ratio)
    small = cv2.resize(image, (new_w, int(RESCALED_HEIGHT)), interpolation=cv2.INTER_AREA)

    quad = _detect_document(small)
    if quad is None:
        return image

    # Scale corners back to original resolution
    pts = quad.reshape(4, 2).astype("float32") * ratio
    return _four_point_transform(image, pts)


def _step_deskew(image: np.ndarray, opts: dict) -> np.ndarray:
    """Step 2 -- Deskew via minAreaRect rotation."""
    max_angle = opts.get("max_angle", 15)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    coords = cv2.findNonZero(thresh)
    if coords is None or len(coords) < 100:
        return image

    rect = cv2.minAreaRect(coords)
    (_, (w_r, h_r), angle) = rect

    if w_r < h_r:
        angle = angle + 90

    if abs(angle) > max_angle or abs(angle) < 0.3:
        return image

    (h_img, w_img) = image.shape[:2]
    center = (w_img // 2, h_img // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)

    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])
    new_w = int(h_img * sin + w_img * cos)
    new_h = int(h_img * cos + w_img * sin)
    matrix[0, 2] += (new_w - w_img) / 2
    matrix[1, 2] += (new_h - h_img) / 2

    return cv2.warpAffine(
        image, matrix, (new_w, new_h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _step_denoise(image: np.ndarray, opts: dict) -> np.ndarray:
    """Step 3 -- Light Gaussian denoise."""
    strength = opts.get("strength", 7)
    ksize = max(3, min(7, strength)) | 1
    return cv2.GaussianBlur(image, (ksize, ksize), 0)


def _step_clahe(image: np.ndarray, opts: dict) -> np.ndarray:
    """Step 4 -- CLAHE contrast enhancement on L channel."""
    clip_limit = opts.get("clip_limit", 2.0)
    grid_size = opts.get("grid_size", 8)

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(grid_size, grid_size))
    l_ch = clahe.apply(l_ch)
    return cv2.cvtColor(cv2.merge([l_ch, a_ch, b_ch]), cv2.COLOR_LAB2BGR)


def _step_sharpen(image: np.ndarray, opts: dict) -> np.ndarray:
    """Step 5 -- Unsharp mask sharpening (suhren/camscan style)."""
    amount = opts.get("amount", 1.8)
    blurred = cv2.GaussianBlur(image, (0, 0), 3)
    sharpened = cv2.addWeighted(image, amount, blurred, 1.0 - amount, 0)
    return np.clip(sharpened, 0, 255).astype(np.uint8)


def _step_white_balance(image: np.ndarray, _opts: dict) -> np.ndarray:
    """Step 6 -- Document illumination normalization.

    Estimates the local paper background via a large Gaussian blur
    then divides by it so the paper becomes pure white and shadows /
    lighting gradients are removed.  This is the key step that makes
    a phone photo look like a real flatbed scan.
    """
    h, w = image.shape[:2]

    # --- fast background estimation: downscale → blur → upscale ----------
    ds = 8
    small = cv2.resize(image, (max(w // ds, 1), max(h // ds, 1)),
                       interpolation=cv2.INTER_AREA)
    bg_small = cv2.GaussianBlur(small.astype(np.float32), (0, 0), sigmaX=20)
    bg = cv2.resize(bg_small, (w, h), interpolation=cv2.INTER_LINEAR)

    # normalise: paper → 255, text stays dark  (SIMD-optimised divide)
    result = cv2.divide(image.astype(np.float32), bg + 1.0, scale=255.0)
    result = cv2.convertScaleAbs(result)          # clip + uint8 in one op

    # --- light gamma correction to push paper toward pure white -----------
    gamma = 0.85          # <1 brightens mid-tones / paper
    lut = np.array([((i / 255.0) ** gamma) * 255
                     for i in range(256)], dtype=np.uint8)
    return cv2.LUT(result, lut)


def _step_bw_mode(image: np.ndarray, opts: dict) -> np.ndarray:
    """Step 7 -- B&W conversion (suhren/camscan approach).
    Grayscale -> sharpen -> adaptive threshold = clean scan look."""
    method = opts.get("method", "adaptive")
    block_size = opts.get("block_size", 21)
    constant = opts.get("constant", 15)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (0, 0), 3)
    sharp = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)

    if method == "adaptive":
        if block_size % 2 == 0:
            block_size += 1
        if block_size < 3:
            block_size = 3
        bw = cv2.adaptiveThreshold(
            sharp, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, block_size, constant,
        )
    elif method == "otsu":
        _, bw = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        _, bw = cv2.threshold(sharp, 127, 255, cv2.THRESH_BINARY)

    return cv2.cvtColor(bw, cv2.COLOR_GRAY2BGR)


# ---------------------------------------------------------------------------
# Output generation
# ---------------------------------------------------------------------------

def _save_output(image: np.ndarray, output_path: str, opts: dict) -> int:
    """Save the processed image to disk. Returns file size in bytes."""
    fmt = opts.get("format", "pdf")
    quality = opts.get("quality", 85)
    dpi = opts.get("dpi", 300)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb)

    if fmt == "pdf":
        pil_image.save(output_path, "PDF", resolution=dpi, quality=quality)
    elif fmt in ("jpeg", "jpg"):
        pil_image.save(output_path, "JPEG", quality=quality, dpi=(dpi, dpi))
    elif fmt == "png":
        compress = min(9, max(0, (100 - quality) // 10))
        pil_image.save(output_path, "PNG", compress_level=compress, dpi=(dpi, dpi))
    else:
        pil_image.save(output_path, "JPEG", quality=quality, dpi=(dpi, dpi))

    return os.path.getsize(output_path)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

PIPELINE_STEPS = [
    ("auto_crop", _step_auto_crop),
    ("deskew", _step_deskew),
    ("denoise", _step_denoise),
    ("clahe", _step_clahe),
    ("sharpen", _step_sharpen),
    ("white_balance", _step_white_balance),
    ("bw_mode", _step_bw_mode),
]


def _run_pipeline(
    image_path: str,
    batch_id: str,
    page_index: int,
    profile_options: dict,
    progress_callback=None,
) -> tuple[str, dict, int]:
    """Execute the full processing pipeline synchronously (CPU-bound)."""
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Cannot read image: {image_path}")

    original_h, original_w = image.shape[:2]
    total_steps = len(PIPELINE_STEPS) + 1
    step_details = []
    pipeline_start = time.monotonic()

    for step_idx, (step_name, step_func) in enumerate(PIPELINE_STEPS):
        step_opts = profile_options.get(step_name, {})
        enabled = step_opts.get("enabled", False)

        if not enabled:
            step_details.append({"name": step_name, "duration_ms": 0, "skipped": True})
            if progress_callback is not None:
                progress_callback(step_name, step_idx, total_steps)
            continue

        step_start = time.monotonic()
        try:
            image = step_func(image, step_opts)
        except Exception as exc:
            print(f"WARNING: Step '{step_name}' failed: {exc} -- skipping")
            step_details.append({
                "name": step_name,
                "duration_ms": int((time.monotonic() - step_start) * 1000),
                "skipped": True, "error": str(exc),
            })
            if progress_callback is not None:
                progress_callback(step_name, step_idx, total_steps)
            continue

        duration_ms = int((time.monotonic() - step_start) * 1000)
        step_details.append({"name": step_name, "duration_ms": duration_ms, "skipped": False})

        if progress_callback is not None:
            progress_callback(step_name, step_idx, total_steps)

    # --- Output generation ---
    output_opts = profile_options.get("output", {})
    fmt = output_opts.get("format", "pdf")
    ext_map = {"pdf": "pdf", "jpeg": "jpg", "jpg": "jpg", "png": "png"}
    ext = ext_map.get(fmt, "pdf")

    data_dir = get_data_dir()
    processed_dir = os.path.join(data_dir, "scans", batch_id, "processed")
    output_path = os.path.join(processed_dir, f"{page_index}.{ext}")

    output_start = time.monotonic()
    try:
        file_size = _save_output(image, output_path, output_opts)
        if ext == "pdf":
            preview_path = os.path.join(processed_dir, f"{page_index}.jpg")
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            Image.fromarray(rgb).save(preview_path, "JPEG", quality=85)
    except Exception as exc:
        print(f"WARNING: Output generation failed: {exc} -- falling back to JPEG")
        output_path = os.path.join(processed_dir, f"{page_index}.jpg")
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        Image.fromarray(rgb).save(output_path, "JPEG", quality=85)
        file_size = os.path.getsize(output_path)

    step_details.append({
        "name": "output",
        "duration_ms": int((time.monotonic() - output_start) * 1000),
        "skipped": False,
    })

    if progress_callback is not None:
        progress_callback("output", len(PIPELINE_STEPS), total_steps)

    total_ms = int((time.monotonic() - pipeline_start) * 1000)
    processed_h, processed_w = image.shape[:2]

    return os.path.abspath(output_path), {
        "steps": step_details,
        "total_ms": total_ms,
        "original_size": [original_w, original_h],
        "processed_size": [processed_w, processed_h],
    }, file_size


# ---------------------------------------------------------------------------
# Public async entry point
# ---------------------------------------------------------------------------

async def process_page(
    original_path: str,
    batch_id: str,
    page_index: int,
    profile_options: dict,
    progress_callback=None,
) -> tuple[str, dict, int]:
    """Process a single page through the OpenCV pipeline."""
    loop = asyncio.get_running_loop()

    def _threadsafe_callback(step, step_idx, total_steps):
        if progress_callback is not None:
            coro = progress_callback(step, step_idx, total_steps)
            if coro is not None:
                asyncio.run_coroutine_threadsafe(coro, loop)

    return await asyncio.to_thread(
        _run_pipeline,
        original_path,
        batch_id,
        page_index,
        profile_options,
        _threadsafe_callback,
    )
