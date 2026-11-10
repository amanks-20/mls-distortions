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

## v1.1.0

- Point density control (Dense / Medium / Sparse) for the explorer canvas; display only, the simulation and readouts are unchanged.
- "Observed in the field" panel: examples F38 (preset A2) and F36 (preset B1) from the Guwahati StreetMapper survey, with speeds estimated from the point clouds.
- 2D / 3D view toggle: a 3D scan of the box with a tilted scan plane, showing only the visible faces, with rotate and zoom controls. The scanner height (2.5 m) is illustrative, not from the thesis.
- Dev-only validation tests in `tests/`: a 2D regression baseline, checks of the 3D scan model, a comparison of the gamma, beta and alpha magnitudes from the 3D cloud with the equations, and a pixel comparison of the 2D canvas.
- MIT licence and `CITATION.cff`.
- The footnote under the explorer now says that the signs of γ, β and α follow the paper's equations.

## v1.0.0

- Project page with a five-step primer, the interactive 2D distortion explorer (closed-form equations next to an independent top-view scan simulation, with the thesis test cases as presets), and the equations.
