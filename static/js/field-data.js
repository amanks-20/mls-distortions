/* ==========================================================================
   Field data for the distortion explorer (data only, nothing is drawn yet).
   Real MLS examples picked from the Guwahati traffic survey with
   tools/field_candidates.py and rendered with tools/render_field.py.

   FIELD_CASES   field examples keyed by their own id (F38, F08, F36).
                 `preset` names the explorer preset whose regime it shows,
                 or null when it is not tied to a preset.
   FIELD_DATA    preset id -> field example or null (no example yet).

   Speeds are ESTIMATES from the point clouds: the object's displacement
   between the left- and right-scanner clouds divided by the difference in
   their mean GPS times. ± is the bound from the two scanners sampling
   different parts of the object. Mapper speed is from the trajectory.
   θ follows the explorer: angle of the object's heading from the mapper's,
   counter-clockwise positive. Images are top views in the explorer's frame
   (mapper travels left to right, its left is up), points 0.5-3 m above ground.
   ========================================================================== */
(function () {
    'use strict';

    var SCANNERS = { left: { colour: 'red', hex: '#d93636' }, right: { colour: 'blue', hex: '#2f5bd3' } };
    var CREDIT = 'Field data: StreetMapper-V survey (two RIEGL VQ-450 scanners), Guwahati, from A. K. Singh, M.Tech thesis, IIT Kanpur, 2025.';

    var FIELD_CASES = {
        F38: {
            preset: 'A2',
            regime: 'Over-elongation (approximately)',
            image: 'static/images/field/F38.webp',
            imageDark: 'static/images/field/F38-dark.webp',
            width: 960, height: 600,
            alt: 'Top view of real mobile laser scanning data, showing only the points of one car in the lane just left of the mapper’s path. The car is smeared into long thin streaks by the left scanner (red) and the right scanner (blue), far longer than the car itself. Trees and other objects were removed. Scale bar 10 m.',
            caption: 'Over-elongation in the field. A car in the lane just left of the mapper drove at almost the mapper’s speed, so the scan lines kept sampling the same part of it and both scanners recorded a long streak instead of a car. Only the car’s points are shown (0.5–3.5 m left of the mapper’s path, 0.3–2 m above the road); trees, hedges and other objects were removed for clarity. Estimated speeds: mapper 30 km/h, car 31 ± 2 km/h, same direction (θ ≈ 0°). Red: left scanner; blue: right scanner.',
            vm: { kmh: 30 },
            vo: { kmh: 31, pm: 2 },
            theta: 0,
            location: 'Guwahati, Assam, India',
            date: null,
            gpsTime: 535418.9,
            scale: 'Top view, mapper travelling left to right. Grid 5 m, scale bar 10 m. Only the car’s points: 0.5–3.5 m left of the mapper’s path, 0.3–2 m above the road.',
            scanners: SCANNERS,
            credit: CREDIT
        },
        F08: {
            preset: null,
            regime: 'Elongation, near the over-elongation boundary',
            image: 'static/images/field/F08.webp',
            imageDark: 'static/images/field/F08-dark.webp',
            width: 960, height: 600,
            alt: 'Top view of real mobile laser scanning data. A vehicle in the lane just left of the mapper’s path appears as long overlapping streaks from the left scanner (red) and the right scanner (blue), much longer than a vehicle. Scale bar 4 m.',
            caption: 'Elongation, near the over-elongation boundary. A vehicle just left of the mapper moved in the same direction, a little slower than the mapper, so the scan lines overtook it only slowly and stretched it into streaks. Estimated speeds: mapper 21 km/h, vehicle 18 ± 3 km/h, same direction (θ ≈ 0°). Red: left scanner; blue: right scanner.',
            vm: { kmh: 21 },
            vo: { kmh: 18, pm: 3 },
            theta: 0,
            location: 'Guwahati, Assam, India',
            date: null,
            gpsTime: 535376.7,
            scale: 'Top view, mapper travelling left to right. Grid 2 m, scale bar 4 m. Points 0.5–3 m above the road.',
            scanners: SCANNERS,
            credit: CREDIT
        },
        F36: {
            preset: 'B1',
            regime: 'Contraction',
            image: 'static/images/field/F36.webp',
            imageDark: 'static/images/field/F36-dark.webp',
            width: 960, height: 600,
            alt: 'Top view of real mobile laser scanning data. An oncoming vehicle to the right of the mapper appears twice, side by side: the left scanner’s copy (red) is sheared into a parallelogram and the right scanner’s copy (blue) has a different shape. The map is rotated 180° (not mirrored), so the mapper travels right to left and the vehicle appears above its path. Scale bar 1 m.',
            caption: 'Contraction in the field. An oncoming vehicle to the right of the mapper met the scan lines head-on, so each scanner swept it quickly and recorded a shortened, sheared copy at a different place. The simulator always places the object on the mapper’s left; in this real example the oncoming vehicle is on the mapper’s right. The map is rotated 180° (not mirrored) so that the vehicle appears above the path. Estimated speeds: mapper 38 km/h, vehicle 30 ± 14 km/h, oncoming (θ ≈ 175°). Red: left scanner; blue: right scanner.',
            vm: { kmh: 38 },
            vo: { kmh: 30, pm: 14 },
            theta: -175,
            location: 'Guwahati, Assam, India',
            date: null,
            gpsTime: 535415.2,
            scale: 'Top view rotated 180°, mapper travelling right to left. Grid 1 m, scale bar 1 m. Points 0.5–3 m above the road.',
            scanners: SCANNERS,
            credit: CREDIT
        }
    };

    var FIELD_DATA = { A1: null, B1: null, A3: null, A2: null, C1: null, D2: null };
    Object.keys(FIELD_CASES).forEach(function (id) {
        var c = FIELD_CASES[id];
        if (c.preset && c.preset in FIELD_DATA) FIELD_DATA[c.preset] = Object.assign({ id: id }, c);
    });

    window.FIELD_CASES = FIELD_CASES;
    window.FIELD_DATA = FIELD_DATA;
})();
