/**** =====================================================================
 * 03_reference_water_maps.js
 * ---------------------------------------------------------------------
 * PAPER SECTION: "Methods 3.2 - Independent reference water mapping"
 *
 * Builds, for any target month, FIVE independent water references used
 * to evaluate the OPERA products:
 *   R1) Sentinel-2 MNDWI with adaptive Otsu threshold,
 *   R2) Sentinel-2 AWEInsh (fixed 0 threshold, shadow-robust),
 *   R3) Sentinel-1 GRD VV (dB) with Otsu threshold (speckle-filtered),
 *   R4) Google Dynamic World water probability (>= 0.5),
 *   R5) Random Forest classification on an S2+S1 feature stack, trained
 *       on JRC GSW extremes (occurrence>90 water / <5 & WorldCover
 *       non-water strata), with an internal 70/30 hold-out report.
 * A consensus reference (majority of R1..R5) is also produced; pixels
 * without majority are flagged "uncertain" and excluded from accuracy
 * assessment (script 04) — this avoids circularity and single-reference
 * bias, a common reviewer criticism.
 *
 * Set TARGET_MONTH and SITE_KEY below; script 04 imports these builders.
 * ===================================================================== */
var cfg = require('users/melihaltay2017/earth101:00_config');

/* ---------------- user parameters (for interactive use) ------------- */
var SITE_KEY = 'burdur';        // burdur | tuz | kizilirmak | ataturk
var TARGET_MONTH = '2025-08-01';

/* ==================== builders (exported) ============================ */

/** Cloud-masked S2 SR monthly median for aoi/month. */
exports.s2Monthly = function (aoi, monthStart) {
  var m = ee.Date(monthStart);
  var s2 = ee.ImageCollection(cfg.DATASETS.S2_SR)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'));
  var clouds = ee.ImageCollection(cfg.DATASETS.S2_CLDPRB)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'));
  var joined = ee.Join.saveFirst('cloud_prob').apply({
    primary: s2, secondary: clouds,
    condition: ee.Filter.equals({
      leftField: 'system:index', rightField: 'system:index'})
  });
  var masked = ee.ImageCollection(joined).map(function (img) {
    img = ee.Image(img);
    var prob = ee.Image(img.get('cloud_prob')).select('probability');
    var scl = img.select('SCL');
    var mask = prob.lt(40)
        .and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
    return img.updateMask(mask);
  });
  return masked.median().clip(aoi);
};

/** R1: MNDWI + Otsu. Returns binary 'water_mndwi'. */
exports.refMndwiOtsu = function (aoi, monthStart) {
  var s2 = exports.s2Monthly(aoi, monthStart);
  var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('MNDWI');
  var t = cfg.otsu(mndwi, 'MNDWI', aoi, 30);
  return mndwi.gte(ee.Number(t)).rename('water_mndwi')
      .set('otsu_threshold', t);
};

/** R2: AWEInsh (Feyisa et al., 2014), threshold 0. */
exports.refAwei = function (aoi, monthStart) {
  var s2 = exports.s2Monthly(aoi, monthStart).divide(10000);
  var awei = s2.expression(
      '4*(G - SWIR1) - (0.25*NIR + 2.75*SWIR2)', {
        G: s2.select('B3'), NIR: s2.select('B8'),
        SWIR1: s2.select('B11'), SWIR2: s2.select('B12')
      }).rename('AWEI');
  return awei.gt(0).rename('water_awei');
};

/** R3: S1 GRD VV (dB) monthly mean + focal speckle filter + Otsu.
 *  Water = below threshold (low backscatter). */
exports.refS1Otsu = function (aoi, monthStart) {
  var m = ee.Date(monthStart);
  var s1 = ee.ImageCollection(cfg.DATASETS.S1_GRD)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'))
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains(
          'transmitterReceiverPolarisation', 'VV'))
      .select('VV');
  var vv = s1.mean().focalMedian(50, 'circle', 'meters')
      .clip(aoi).rename('VV');
  var t = cfg.otsu(vv, 'VV', aoi, 30);
  return vv.lt(ee.Number(t)).rename('water_s1grd')
      .set('otsu_threshold', t);
};

/** R4: Dynamic World monthly water probability >= 0.5. */
exports.refDynamicWorld = function (aoi, monthStart) {
  var m = ee.Date(monthStart);
  var dw = ee.ImageCollection(cfg.DATASETS.DW)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'))
      .select('water').mean().clip(aoi);
  return dw.gte(0.5).rename('water_dw');
};

/** JRC monthly history layer for the same month (context/consistency). */
exports.refJrcMonthly = function (aoi, monthStart) {
  var m = ee.Date(monthStart);
  var img = ee.ImageCollection(cfg.DATASETS.GSW_MONTHLY)
      .filter(ee.Filter.eq('year', m.get('year')))
      .filter(ee.Filter.eq('month', m.get('month')))
      .first();
  // JRC 'water': 0 no data | 1 not water | 2 water
  return ee.Image(img).select('water').eq(2)
      .rename('water_jrc').clip(aoi);
};

/** R5: Random Forest on an S2+S1 stack, trained from stable strata. */
exports.refRandomForest = function (aoi, monthStart) {
  var s2 = exports.s2Monthly(aoi, monthStart);
  var indices = ee.Image.cat([
    s2.normalizedDifference(['B3', 'B11']).rename('MNDWI'),
    s2.normalizedDifference(['B3', 'B8']).rename('NDWI'),
    s2.normalizedDifference(['B8', 'B4']).rename('NDVI')
  ]);
  var m = ee.Date(monthStart);
  var vv = ee.ImageCollection(cfg.DATASETS.S1_GRD)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'))
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains(
          'transmitterReceiverPolarisation', 'VV'))
      .select(['VV', 'VH']).mean()
      .focalMedian(50, 'circle', 'meters');
  var stack = s2.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
      .addBands(indices).addBands(vv).clip(aoi);

  // Training strata from long-term stable classes (independent of the
  // evaluated month, but spatially within the AOI):
  var gsw = ee.Image(cfg.DATASETS.GSW).select('occurrence').unmask(0);
  var wc = ee.ImageCollection(cfg.DATASETS.WORLDCOVER).first()
      .select('Map');
  var stableWater = gsw.gt(90);                       // class 1
  var stableLand = gsw.lt(5).and(wc.neq(80));         // class 0
  var strata = stableWater.rename('label')     // 1 = water, 0 = land
      .updateMask(stableWater.or(stableLand)).clip(aoi);

  var samples = stack.addBands(strata).stratifiedSample({
    numPoints: 1500, classBand: 'label', region: aoi,
    scale: cfg.SCALE, seed: cfg.SEED, geometries: false,
    classValues: [0, 1], classPoints: [1500, 1500]
  });
  // 70/30 split for an honest internal quality report of the reference.
  samples = samples.randomColumn('rnd', cfg.SEED);
  var train = samples.filter(ee.Filter.lt('rnd', 0.7));
  var test = samples.filter(ee.Filter.gte('rnd', 0.7));

  var rf = ee.Classifier.smileRandomForest({
    numberOfTrees: 200, minLeafPopulation: 2, seed: cfg.SEED
  }).train({
    features: train, classProperty: 'label',
    inputProperties: stack.bandNames()
  });
  var testCm = test.classify(rf).errorMatrix('label', 'classification');
  print('RF reference internal test — OA:', testCm.accuracy(),
        'Kappa:', testCm.kappa(), 'F1:', testCm.fscore());

  return stack.classify(rf).rename('water_rf');
};

/** Consensus of the five references:
 *  'consensus' = 1 water (>=4/5 agree), 0 land (<=1/5), masked otherwise.
 *  'votes'     = raw vote count 0..5 (kept for sensitivity analysis). */
exports.refConsensus = function (aoi, monthStart) {
  var votes = ee.Image.cat([
    exports.refMndwiOtsu(aoi, monthStart),
    exports.refAwei(aoi, monthStart),
    exports.refS1Otsu(aoi, monthStart),
    exports.refDynamicWorld(aoi, monthStart),
    exports.refRandomForest(aoi, monthStart)
  ]).reduce(ee.Reducer.sum()).rename('votes');
  var water = votes.gte(4);
  var land = votes.lte(1);
  var consensus = water.rename('consensus')
      .updateMask(water.or(land));
  return consensus.addBands(votes);
};

/* ==================== interactive demo =============================== */
var site = cfg.SITES[SITE_KEY];
Map.centerObject(site.aoi, site.zoom);
Map.addLayer(exports.s2Monthly(site.aoi, TARGET_MONTH),
    cfg.VIS.s2rgb, 'S2 median ' + TARGET_MONTH);
Map.addLayer(exports.refMndwiOtsu(site.aoi, TARGET_MONTH).selfMask(),
    {palette: ['00ffff']}, 'R1 MNDWI-Otsu', false);
Map.addLayer(exports.refAwei(site.aoi, TARGET_MONTH).selfMask(),
    {palette: ['00ff00']}, 'R2 AWEI', false);
Map.addLayer(exports.refS1Otsu(site.aoi, TARGET_MONTH).selfMask(),
    {palette: ['ff00ff']}, 'R3 S1-Otsu', false);
Map.addLayer(exports.refDynamicWorld(site.aoi, TARGET_MONTH).selfMask(),
    {palette: ['ffff00']}, 'R4 DynamicWorld', false);
Map.addLayer(exports.refConsensus(site.aoi, TARGET_MONTH)
    .select('consensus'), cfg.VIS.water, 'Consensus reference');