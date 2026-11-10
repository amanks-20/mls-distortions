# Motion-Induced Point Cloud Distortions in Mobile Laser Scanning

When a mobile laser scanner and the objects it scans are both moving, the resulting point clouds are distorted. This research studies those distortions systematically and derives closed-form equations that describe them:

- **Length distortion:** moving objects appear shorter or longer than they are, depending on the relative direction of motion. A special case is **layover**, where the rear of an object appears in place of its front.
- **Parallelepiped distortion:** the point cloud of a cuboid-shaped object becomes a skewed parallelepiped, with a skew that depends on the scanning plane and the directions of motion.

The equations are verified through simulation.

## Publications

- **Journal article** (★ Editor's Choice): Singh, A. K., & Lohani, B. (2026). Modeling Point Cloud Distortions in Mobile Laser Scanning for Surveying. *Journal of Surveying Engineering*, 152(3), 04026006. https://doi.org/10.1061/JSUED2.SUENG-1663
- **Thesis:** Singh, A. K. (2025). *Understanding and Modeling Motion-Induced Point Cloud Distortions in Mobile Laser Scanning.* B.Tech–M.Tech (Dual Degree) Thesis, IIT Kanpur. https://doi.org/10.6084/m9.figshare.32005947
- **Defense slides:** https://doi.org/10.5281/zenodo.23734352
- **Posters:** GeodCon-26, INSA New Delhi, 2026 (https://doi.org/10.6084/m9.figshare.32005995) · Geospatial Technologies and Smart Cities Workshop, IIT Kanpur & University of Melbourne, 2025 (https://doi.org/10.6084/m9.figshare.28200089)

## Project page

**https://amanks-20.github.io/mls-distortions/**: a five-step primer, an interactive distortion explorer, the equations, and the validation results.

The page is static HTML, CSS and JavaScript, with no build step and no dependencies. Open `index.html` locally, or serve it with GitHub Pages from the `main` branch root. Explorer links such as `?case=A3` or `?case=B1&side=L` open a thesis test case directly.

### Features

- **Distortion explorer:** the closed-form equations next to an independent scan simulation, with the thesis test cases as presets and a choice of left or right scanner. **Play scan** animates the scan.
- **Point density control (Dense / Medium / Sparse):** display only. It thins the points drawn on the canvas; the simulation and the readouts are unchanged.
- **Observed in the field:** for presets A2 and B1, a panel next to the simulation (below it on narrow screens) shows a moving vehicle from the Guwahati StreetMapper survey in the same regime (examples F38 and F36). The vehicle and mapper speeds shown there are estimates from the point clouds, not measured values. The field images are renderings of short sections of a survey; the underlying data are not part of this repository and are not publicly available (see the paper's Data Availability Statement).
- **2D / 3D view:** the 3D view scans the box with a tilted scan plane and shows only the faces the scanner sees; drag, pinch, scroll or use the arrow keys to rotate and zoom. The scanner height of 2.5 m is illustrative, not from the thesis; it shifts where the plane cuts the box but not its length or order. The readouts still describe the 2D model.
- **Scan plane toggle:** in the 3D view, the scan plane of the selected scanner is drawn through the scanner and moves with the scan; the **Scan plane** button (3D only) shows or hides it.
- **Scanner positions:** both scanners are drawn at the mapper's rear-left and rear-right corners, the selected one larger, in 2D and 3D. The mounting position is illustrative, not from the thesis, like the scanner height, and it is display only: the drawing is shifted, the simulated cloud is not.

### Files

```
index.html                page
static/css/style.css      styles (same tokens as amanks-20.github.io)
static/js/explorer.js     closed-form model + independent top-view scan simulation
static/js/simulate3d.js   3D scan of the box with a tilted scan plane
static/js/view3d.js       2D/3D toggle and the 3D renderer
static/js/field-data.js   field examples (FIELD_CASES, FIELD_DATA)
static/js/field-panel.js  "Observed in the field" panel
static/images/            figures from the thesis; field/ holds the field examples
tests/                    dev-only checks (see Checks below)
tools/                    dev-only scripts that pick and render the field examples
CITATION.cff, LICENSE, CHANGELOG.md
```

### Checks

Dev-only; the page does not use them. They need Python 3 and either Node.js or macOS JavaScriptCore.

```
python3 tests/check.py           # 2D model() and simulate() against tests/golden.json
python3 tests/check3d.py         # 3D scan model against the 2D simulation and model()
python3 tests/check3d_angles.py  # gamma, beta, alpha magnitudes from the 3D cloud vs model()
                                 # (--xlsx PATH for the Results.xlsx cases; skipped if absent)
```

The 2D canvas comparison needs Google Chrome and a local server in the repository root:

```
python3 -m http.server 8765                                  # separate terminal
python3 tests/canvas_capture.py --compare tests/canvas-2d.json
```

`tools/` is dev-only: it needs the survey's `.laz` files (not in this repository) and a Python environment with laspy, and it is not needed to run the page.

Code for the analysis is in preparation.

## Cite this software

If you use the project page or the distortion explorer, please cite the software release **and** the journal article below. Citation metadata is in [`CITATION.cff`](CITATION.cff) (GitHub shows a "Cite this repository" button for it).

> **TODO: Zenodo DOI not minted yet.** Replace `10.5281/zenodo.XXXXXXX` below with the concept DOI once a release has been archived on Zenodo.

```bibtex
@software{singh2026mlsdistortions,
  title   = {Motion-Induced Point Cloud Distortions in Mobile Laser Scanning: project page and distortion explorer},
  author  = {Singh, Aman Kumar and Lohani, Bharat},
  version = {1.1.0},
  year    = {2026},
  doi     = {10.5281/zenodo.XXXXXXX},
  url     = {https://github.com/amanks-20/mls-distortions}
}
```

## Citation

```bibtex
@article{singh2026modeling,
  title   = {Modeling Point Cloud Distortions in Mobile Laser Scanning for Surveying},
  author  = {Singh, Aman Kumar and Lohani, Bharat},
  journal = {Journal of Surveying Engineering},
  volume  = {152},
  number  = {3},
  pages   = {04026006},
  year    = {2026},
  doi     = {10.1061/JSUED2.SUENG-1663}
}
```

## Licence

The source code is released under the [MIT Licence](LICENSE): the files under `static/js/`, `tools/` and `tests/`, and the page's HTML and CSS (`index.html`, `static/css/`).

The following are **not** covered by this licence and remain with their respective owners (see the credits above and on the project page):

- figures from the paper and the thesis (in `static/images/`),
- the field-data images in `static/images/field/`,
- the written text of the page and this README.

## Author

[Aman Kumar Singh](https://amanks-20.github.io/), IIT Kanpur. Supervised by [Prof. Bharat Lohani](https://home.iitk.ac.in/~blohani/).

Developed by A. K. Singh with coding assistance from Claude (Anthropic).
