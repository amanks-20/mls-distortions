#!/usr/bin/env python3
"""Dev-only: make the dark-theme versions of the page's six line-art figures.

    tools/.venv/bin/python tools/make_dark_figures.py      # from the repo root

Writes static/images/<name>-dark.png next to each original (the originals are
read, never changed). A deterministic per-pixel recolouring in OKLab, nothing
is redrawn:

- lightness is inverted and remapped, so white becomes the dark card colour
  #161617 (--bg-alt in the dark theme, also the .fig-img background there) and
  black becomes the dark text colour #f5f5f7;
- a and b are kept, so every colour keeps its hue (scanner red stays red,
  blue stays blue, pink mapper, blue box, green face);
- saturated colours keep their light-mode lightness, lifted to at least
  LS_OK, so thin coloured lines stay visible on the dark card;
- tinted pixels get a lightness floor LF_OK that grows with chroma, so pale
  fills stay visible, while neutral pixels (white, greys, black) invert fully.

The remap is a smooth function of each pixel's colour, so anti-aliased edges
stay clean. sim-scene.jpg (a rendered photo) has no dark version.
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "static", "images")
LINE_ART = ["genesis.png", "layover.png", "scan-side.png", "scan-distance.png", "parallelepiped.png", "intersection.png"]

CARD = "#161617"      # dark card colour (--bg-alt), baked into the -dark.png background
TEXT = "#f5f5f7"      # dark text colour (--text)
C0, GAMMA, LIFT = 55.0, 1.5, 8.0      # chroma weight w = clip(C/C0, 0, 1) ** GAMMA; lift for dark saturated colours
CF = 14.0                              # chroma at which the tinted-fill floor is fully reached
LF_OK, LS_OK = 62.0, 63.8              # OKLab lightness floors: tinted fills, saturated colours
K = 100.0 / 32.0                       # OKLab chroma is ~1/3 of CIELAB's: rescales the chroma thresholds

M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])


def srgb_to_oklab(rgb):
    """sRGB in [0, 1] -> OKLab with L in 0-100 (a and b scaled alike)."""
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    lms = np.cbrt(lin @ M1.T)
    return (lms @ M2.T) * 100.0


def oklab_to_srgb(lab):
    """Inverse of srgb_to_oklab, clipped to the sRGB gamut."""
    lin = ((lab / 100.0) @ np.linalg.inv(M2).T) ** 3 @ np.linalg.inv(M1).T
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


def oklab_of(hex_):
    return srgb_to_oklab(np.array([[[int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]]]))[0, 0]


def recolour(rgb):
    """rgb: float array in [0, 1], shape (h, w, 3) -> the dark version in [0, 1]."""
    lab = srgb_to_oklab(rgb)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    c, t = oklab_of(CARD), oklab_of(TEXT)
    s = np.clip(L / 100.0, 0, 1)                                  # 1 = white end, 0 = black end
    L_inv = t[0] - (t[0] - c[0]) * s                              # white -> card, black -> text
    chroma = np.hypot(a, b) * K
    w = np.clip(chroma / C0, 0, 1) ** GAMMA
    L_keep = np.where(L < 50, L + LIFT * (1 - L / 50), L)
    L_keep = np.maximum(L_keep, LS_OK)
    L_new = (1 - w) * L_inv + w * L_keep                          # saturated colours keep their lightness
    L_new = np.maximum(L_new, LF_OK * np.clip(chroma / CF, 0, 1))  # pale tinted fills stay visible
    a_new = a + t[1] + (c[1] - t[1]) * s                          # neutral white -> card tint, black -> text tint
    b_new = b + t[2] + (c[2] - t[2]) * s
    out = oklab_to_srgb(np.stack([L_new, a_new, b_new], axis=-1))
    return np.clip(out, 0, 1)


def main():
    for name in LINE_ART:
        src = os.path.join(IMAGES, name)
        im = Image.open(src)
        has_alpha = "A" in im.getbands()
        rgba = np.asarray(im.convert("RGBA")).astype(float) / 255
        dark = recolour(rgba[..., :3])
        out = np.dstack([dark, rgba[..., 3]]) if has_alpha else dark
        dst = os.path.join(IMAGES, name.replace(".png", "-dark.png"))
        Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA" if has_alpha else "RGB").save(dst, optimize=True)
        print(f"{os.path.relpath(dst, ROOT)}  {im.size[0]}x{im.size[1]}  {os.path.getsize(dst) // 1024} KB (original {os.path.getsize(src) // 1024} KB)")


if __name__ == "__main__":
    main()
