#!/usr/bin/env python3
"""Dev-only: make the dark-theme version of the simulation screenshot.

    tools/.venv/bin/python tools/make_sim_scene_dark.py      # from the repo root

static/images/sim-scene.jpg is an Unreal Engine window on a white frame that is
baked into the JPEG (12-14 px on each side, square corners). This writes
static/images/sim-scene-dark.jpg in which only that frame becomes the dark
card colour of .fig-img.photo (#000, read from static/css/style.css):

- the frame is found by flood-filling near-white pixels (every channel >= TOL)
  from the image border, inside a band BAND px wide, so nothing inside the
  window is reached (the window's own edge, including its light-grey bottom
  border, seals it off);
- frame pixels are replaced by the card colour; every other pixel is copied
  unchanged. The JPEG is re-encoded with the original's quantisation tables and
  chroma subsampling, so the window content only gets re-encoding noise.

Deterministic: the same input always gives the same file.
"""
import os
import re

import numpy as np
from PIL import Image, JpegImagePlugin
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "static", "images", "sim-scene.jpg")
DST = os.path.join(ROOT, "static", "images", "sim-scene-dark.jpg")
TOL = 225     # every channel at least this: the frame's JPEG ringing dips to 231, the window's grey bottom border stays <= 224
BAND = 24     # the flood fill may not go further than this from the border (frame is 12-14 px)


def card_colour():
    """Background of .fig-img.photo in static/css/style.css."""
    css = open(os.path.join(ROOT, "static", "css", "style.css")).read()
    m = re.search(r"\.fig-img\.photo\s*\{[^}]*background:\s*#([0-9a-fA-F]{3,6})", css)
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.uint8)


def frame_mask(rgb):
    h, w, _ = rgb.shape
    white = rgb.min(axis=2) >= TOL
    band = np.zeros((h, w), bool)
    band[:BAND] = band[-BAND:] = True
    band[:, :BAND] = band[:, -BAND:] = True
    lab, _ = ndimage.label(white & band)
    edge = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    return np.isin(lab, edge[edge > 0])


def main():
    im = Image.open(SRC)
    rgb = np.asarray(im.convert("RGB")).copy()
    mask = frame_mask(rgb)
    rgb[mask] = card_colour()
    Image.fromarray(rgb, "RGB").save(DST, "JPEG", qtables=im.quantization,
                                     subsampling=JpegImagePlugin.get_sampling(im), optimize=True)
    print(f"{os.path.relpath(DST, ROOT)}  {rgb.shape[1]}x{rgb.shape[0]}  frame pixels {int(mask.sum())}"
          f"  {os.path.getsize(DST) // 1024} KB (original {os.path.getsize(SRC) // 1024} KB)")


if __name__ == "__main__":
    main()
