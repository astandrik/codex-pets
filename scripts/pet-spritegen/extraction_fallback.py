"""Conservative, offline separation of lightly touching poses in failed strips."""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from sprite_gen.frames.extract import connected_components, remove_chroma_background
from sprite_gen.frames.segment import segment_boundaries
from sprite_gen.spec.layout import raw_rel


def contour_seam(rgba: np.ndarray, center: int, radius: int) -> np.ndarray:
    height, width = rgba.shape[:2]
    left, right = max(1, center - radius), min(width - 1, center + radius + 1)
    alpha = rgba[:, left:right, 3]
    brightness = np.max(rgba[:, left:right, :3], axis=2) / 255
    # Prefer background, then dark outlines over painted body details. Adjacent
    # seam pixels remain 8-connected, separating the extractor's 4-connected mask.
    cost = (alpha > 16) * (.03 + brightness) ** 2 + alpha / 255000
    cost += (np.arange(left, right) - center) ** 2 * .000001
    distances = cost[0].copy()
    parents = np.zeros(alpha.shape, dtype=np.int16)
    columns = np.arange(right - left)
    for y in range(1, height):
        options = np.stack((np.r_[np.inf, distances[:-1]] + .0001,
                            distances, np.r_[distances[1:], np.inf] + .0001))
        choice = np.argmin(options, axis=0)
        parents[y] = columns + choice - 1
        distances = cost[y] + options[choice, columns]
    seam = np.zeros(height, dtype=int)
    seam[-1] = int(np.argmin(distances))
    for y in range(height - 1, 0, -1):
        seam[y - 1] = parents[y, seam[y]]
    return seam + left


def separate_touching_poses(image: Image.Image, frame_count: int) -> Image.Image | None:
    width, height = image.size
    if not 2 <= frame_count <= 8 or not frame_count * 32 <= width <= 1536 or not 32 <= height <= 512:
        return None
    keyed = remove_chroma_background(image, (255, 0, 255), 96, 180, 18,
                                    unmix_reach=4, spill_max_fraction=.005)
    components = connected_components(keyed)
    if not components or len(components) >= frame_count:
        return None
    boundaries, _ = segment_boundaries(keyed, frame_count)
    if boundaries is None:
        return None
    rgba = np.array(keyed)
    visible = int(np.count_nonzero(rgba[:, :, 3] > 16))
    slot_width = width / frame_count
    radius = max(2, min(32, round(slot_width / 8)))
    seams = []
    losses = []
    removed = 0
    ys = np.arange(height)
    for center in boundaries:
        seam = contour_seam(rgba, center, radius)
        loss = int(np.count_nonzero(rgba[ys, seam, 3] > 16))
        # A narrow touch is recoverable; cutting through a torso or a large
        # overlap must fail even if the path happens to follow a dark region.
        if loss > 24:
            return None
        removed += loss
        rgba[ys, seam, 3] = 0
        seams.append(seam)
        losses.append(loss)
    if removed == 0 or removed > visible * .001:
        return None
    separated = connected_components(Image.fromarray(rgba))
    minimum_area = max(120, visible / frame_count * .25)
    poses = sorted((item for item in separated if item["area"] >= minimum_area), key=lambda item: item["center_x"])
    if len(poses) != frame_count:
        return None
    if sum(item["area"] for item in poses) < (visible - removed) * .99:
        return None
    median_area = float(np.median([item["area"] for item in poses]))
    pose_heights = [item["bbox"][3] - item["bbox"][1] for item in poses]
    # Canvas height is not a safe denominator: a full-height cut through a
    # squat body can remove few pixels while destroying the entire connection.
    if any(loss > .06 * min(left, right) for loss, left, right in zip(losses, pose_heights, pose_heights[1:])):
        return None
    median_height = float(np.median(pose_heights))
    for index, pose in enumerate(poses):
        pose_height = pose["bbox"][3] - pose["bbox"][1]
        if not .5 * median_area <= pose["area"] <= 1.75 * median_area:
            return None
        if not .6 * median_height <= pose_height <= 1.4 * median_height:
            return None
        if abs(pose["center_x"] - (index + .5) * slot_width) > .35 * slot_width:
            return None
    # Preserve source RGB and dimensions. Only the accepted separators change
    # alpha; background removal and frame fitting still use the normal CLI.
    recovered = np.array(image.convert("RGBA"))
    for seam in seams:
        recovered[ys, seam, 3] = 0
    return Image.fromarray(recovered)


def recover_failed_strips(run: Path, rows: list[dict]) -> bool:
    try:
        failure = json.loads((run / "extract-failure.json").read_text())
    except (OSError, ValueError):
        return False
    if not isinstance(failure, dict) or failure.get("ok") is not False or failure.get("warnings") != []:
        return False
    errors = failure.get("errors")
    if not isinstance(errors, list) or not errors or not all(isinstance(error, str) for error in errors):
        return False
    expected = {f'{row["name"]}: could not extract {row["frames"]} sprite components': row for row in rows}
    if any(error not in expected for error in errors):
        return False
    request = json.loads((run / "sprite-request.json").read_text())
    replacements = []
    for error in dict.fromkeys(errors):
        row = expected[error]
        path = run / raw_rel(request, row["name"])
        with Image.open(path) as original:
            recovered = separate_touching_poses(original, row["frames"])
        if recovered is None:
            return False
        replacements.append((path, recovered))
    # Validate the whole candidate batch before touching any derived raw strip.
    for path, recovered in replacements:
        recovered.save(path)
    return True
