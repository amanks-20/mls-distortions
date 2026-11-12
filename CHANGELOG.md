# Changelog

## Unreleased

- Reset view button is hidden in the 2D view and shown only in 3D.
- Below 1340 px, the field panel now comes after the readouts (canvas, readouts, field panel).
- 3D: draw the selected scanner's scan plane, with an on/off toggle.
- 3D: scan-plane vertical tilt follows the mounting figure (upper half leans towards the direction of motion).
- Scanners are drawn at the mapper's rear-left and rear-right corners (2D and 3D), the non-selected one as a smaller solid marker in its own colour; the simulation is unchanged.
- Explorer intro, φv hint, limitations note and descriptions, and the Learn closing sentence, now describe the 3D view and the field examples.
- Field example F38 shows only the over-elongated car (points 0.5–3.5 m left of the mapper's path, 0.3–2 m above the road, in connected streaks), in a frame wide enough for both full streaks; `tools/render_field.py` gains the matching options.
- Field images: the dark versions of F36 and F08 use the dark-theme scanner colours (#ff6b6b left, #6e9bff right), like F38; crop and points unchanged.
- Field example F36: the caption notes that the simulator places the object on the mapper's left, while this oncoming vehicle is on its right.
- Mobile (up to 720 px): wide equations stay inside their cards (they scroll there instead of widening the page), equation numbers sit on their own row, and Eq. (5) is shown as two stacked lines; desktop is unchanged.
- Changed: shortened the explorer intro and the readout footnote.
- Changed: tightened the overview and the end of the primer.
- Changed: shortened the FAQ answers.
- Changed: in dark mode the simulation screenshot has a black frame instead of a white one (`static/images/sim-scene-dark.jpg`, made by `tools/make_sim_scene_dark.py`).
- Changed: field image F36 (B1) is rotated 180° (not mirrored) so the vehicle appears above the mapper's path, with the mapper's path inside the frame; `tools/render_field.py` gains `--rotate 180` and `--shift-left`.
- Changed: the three field images (F38, F08, F36; light and dark) share one layout: legend top centre, mapper arrow lower-left (pointing the way the mapper moves), scale bar lower-right, no north arrow. F36 is still rotated 180°; its crop moved to 1.53 m left of the original centre so the path clears the lower annotations, and the points on the far side of the mapper's path are left out (the vehicle's points are unchanged). `tools/render_field.py` gains `--no-north`, `--drop-left-of-path` and `--ground-shift-left`.
- Tests (dev only): the 2D canvas check pins the colour scheme and checks light and dark (headless Chrome had followed the macOS appearance, which made all 12 hashes fail), records the browser version in `tests/canvas-2d.json`, adds a browser-independent draw-call record (`tests/canvas-record.html`) that runs with the pixel hashes, waits for the explorer instead of a fixed delay, and serves the repo itself.
- Changed: corrected the acknowledgements; added a data note and a development note to the README.
- Changed: the mobile mapper is drawn as a car in the 2D and 3D views (the 3D note says the car is schematic); the point clouds and all results are unchanged.
- Tests (dev only): `tests/canvas-2d.json` re-recorded for the car (same browser and flags; only the mapper drawing changed).
- Changed: the 3D-view note is one short line: the scanner height, mounting position and car are illustrative, and the readouts are not computed from the 3D view (wording only).
- Changed: removed the 3D-view note about the illustrative scanner height, mounting position and car; the top-face warning under the canvas stays.
- Changed: wording checked against the paper and thesis: the length-ratio card, the side/distance results, the correction FAQ, the validation speed-ratio sentence, the residual-error sentence and the field-data limitation.
- Changed: field examples F36 and F38: shorter captions (the speeds, scanner colours and scale-bar lengths are already in the tag line or the image), no location in the tag line; F38 alt text no longer repeats that other objects were removed.
- Changed: the scan-line legend swatch is drawn in the selected scanner's colour (red left, blue right) at the canvas line's opacity, instead of grey.
- Changed: the recorded-points legend swatch is a row of three dots in the scanner's colour instead of a solid bar, so it matches the drawn cloud and is not mistaken for the scan line.
- 3D: the box during the scan has a light fill in the object colour (22%, as in 2D) on the faces turned to the camera; it is drawn under the point cloud, so the points keep their full colour. Display only.
- Changed: the "Why does it matter in practice?" FAQ says it is the length of an over-elongated cloud that cannot be recovered (the scanned length does not depend on the true length; wording only).

## v1.1.0

- Point density control (Dense / Medium / Sparse) for the explorer canvas; display only, the simulation and readouts are unchanged.
- "Observed in the field" panel: examples F38 (preset A2) and F36 (preset B1) from the Guwahati StreetMapper survey, with speeds estimated from the point clouds.
- 2D / 3D view toggle: a 3D scan of the box with a tilted scan plane, showing only the visible faces, with rotate and zoom controls. The scanner height (2.5 m) is illustrative, not from the thesis.
- Dev-only validation tests in `tests/`: a 2D regression baseline, checks of the 3D scan model, a comparison of the gamma, beta and alpha magnitudes from the 3D cloud with the equations, and a pixel comparison of the 2D canvas.
- MIT licence and `CITATION.cff`.
- The footnote under the explorer now says that the signs of γ, β and α follow the paper's equations.

## v1.0.0

- Project page with a five-step primer, the interactive 2D distortion explorer (closed-form equations next to an independent top-view scan simulation, with the thesis test cases as presets), and the equations.
