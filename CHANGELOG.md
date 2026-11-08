# Changelog

## v1.1.0

- Point density control (Dense / Medium / Sparse) for the explorer canvas; display only, the simulation and readouts are unchanged.
- "Observed in the field" panel: examples F38 (preset A2) and F36 (preset B1) from the Guwahati StreetMapper survey, with speeds estimated from the point clouds.
- 2D / 3D view toggle: a 3D scan of the box with a tilted scan plane, showing only the visible faces, with rotate and zoom controls. The scanner height (2.5 m) is illustrative, not from the thesis.
- Dev-only validation tests in `tests/`: a 2D regression baseline, checks of the 3D scan model, a comparison of the gamma, beta and alpha magnitudes from the 3D cloud with the equations, and a pixel comparison of the 2D canvas.
- MIT licence and `CITATION.cff`.
- The footnote under the explorer now says that the signs of γ, β and α follow the paper's equations.

## v1.0.0

- Project page with a five-step primer, the interactive 2D distortion explorer (closed-form equations next to an independent top-view scan simulation, with the thesis test cases as presets), and the equations.
