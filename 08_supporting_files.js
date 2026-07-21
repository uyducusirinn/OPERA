/**** =====================================================================
 * 08_supplement_s2.js  (STANDALONE — no require needed)
 * ---------------------------------------------------------------------
 * Exports T12_consensus_uncertain_fraction.csv: for each site and each
 * accuracy-evaluation month, the fraction of the AOI excluded from the
 * accuracy assessment because the five references did not reach a
 * >=4/5 majority (votes = 2 or 3). Feeds Supplementary Table S2 and the
 * bounded-domain statements in Sections 4.3 and 5.4.
 *
 * NOTE: reference builders are copied verbatim from
 * 03_reference_water_maps.js (standalone version) so results are
 * identical by construction. Runtime is heavy (RF per site-month);
 * expect the export task to take a while.
 * ===================================================================== */
var cfg = {};
cfg.SITES = {
  burdur: {name: 'Burdur Lake',
    aoi: ee.Geometry.Rectangle([29.93, 37.55, 30.36, 37.92])},
  tuz: {name: 'Tuz Lake',
    aoi: ee.Geometry.Rectangle([32.95, 38.35, 33.85, 39.20])},
  kizilirmak: {name: 'Kizilirmak Delta',
    aoi: ee.Geometry.Rectangle([35.75, 41.48, 36.40, 41.78])},
  ataturk: {name: 'Ataturk Reservoir',
    aoi: ee.Geometry.Rectangle([38.20, 37.45, 39.05, 38.30])}
};
cfg.DATASETS = {
  S2_SR: 'COPERNICUS/S2_SR_HARMONIZED',
  S2_CLDPRB: 'COPERNICUS/S2_CLOUD_PROBABILITY',
  S1_GRD: 'COPERNICUS/S1_GRD',
  GSW: 'JRC/GSW1_4/GlobalSurfaceWater',
  DW: 'GOOGLE/DYNAMICWORLD/V1',
  WORLDCOVER: 'ESA/WorldCover/v200'
};
cfg.SCALE = 30; cfg.SEED = 42;
cfg.EXPORT_FOLDER = 'OPERA_TR_exports';

var EVAL_MONTHS = ['2024-10-01', '2025-01-01', '2025-04-01',
  '2025-07-01', '2025-10-01', '2026-01-01', '2026-04-01'];

/* ---------- Otsu ------------------------------------------------------ */
cfg.otsu = function (image, band, region, scale) {
  var histDict = image.select(band).reduceRegion({
    reducer: ee.Reducer.histogram(255, null), geometry: region,
    scale: scale || cfg.SCALE, maxPixels: 1e13, bestEffort: true,
    tileScale: 4});
  var histogram = ee.Dictionary(histDict.get(band));
  var counts = ee.Array(histogram.get('histogram'));
  var means = ee.Array(histogram.get('bucketMeans'));
  var size = means.length().get([0]);
  var total = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
  var sum = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0]);
  var mean = sum.divide(total);
  var indices = ee.List.sequence(1, size);
  var bss = indices.map(function (i) {
    var aCounts = counts.slice(0, 0, i);
    var aCount = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
    var aMeans = means.slice(0, 0, i);
    var aMean = aMeans.multiply(aCounts)
        .reduce(ee.Reducer.sum(), [0]).get([0]).divide(aCount);
    var bCount = total.subtract(aCount);
    var bMean = sum.subtract(aCount.multiply(aMean)).divide(bCount);
    return aCount.multiply(aMean.subtract(mean).pow(2))
        .add(bCount.multiply(bMean.subtract(mean).pow(2)));
  });
  return means.sort(bss).get([-1]);
};

/* ---------- reference builders (verbatim logic from script 03) ------- */
function s2Monthly(aoi, monthStart) {
  var m = ee.Date(monthStart);
  var s2 = ee.ImageCollection(cfg.DATASETS.S2_SR)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'));
  var clouds = ee.ImageCollection(cfg.DATASETS.S2_CLDPRB)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'));
  var joined = ee.Join.saveFirst('cloud_prob').apply({
    primary: s2, secondary: clouds,
    condition: ee.Filter.equals({
      leftField: 'system:index', rightField: 'system:index'})});
  var masked = ee.ImageCollection(joined).map(function (img) {
    img = ee.Image(img);
    var prob = ee.Image(img.get('cloud_prob')).select('probability');
    var scl = img.select('SCL');
    var mask = prob.lt(40)
        .and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
    return img.updateMask(mask);
  });
  return masked.median().clip(aoi);
}
function refMndwiOtsu(aoi, m) {
  var s2 = s2Monthly(aoi, m);
  var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('MNDWI');
  var t = cfg.otsu(mndwi, 'MNDWI', aoi, 30);
  return mndwi.gte(ee.Number(t)).rename('w1');
}
function refAwei(aoi, m) {
  var s2 = s2Monthly(aoi, m).divide(10000);
  var awei = s2.expression(
      '4*(G - SWIR1) - (0.25*NIR + 2.75*SWIR2)', {
        G: s2.select('B3'), NIR: s2.select('B8'),
        SWIR1: s2.select('B11'), SWIR2: s2.select('B12')}).rename('AWEI');
  return awei.gt(0).rename('w2');
}
function refS1Otsu(aoi, m) {
  m = ee.Date(m);
  var s1 = ee.ImageCollection(cfg.DATASETS.S1_GRD)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'))
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains(
          'transmitterReceiverPolarisation', 'VV'))
      .select('VV');
  var vv = s1.mean().focalMedian(50, 'circle', 'meters')
      .clip(aoi).rename('VV');
  var t = cfg.otsu(vv, 'VV', aoi, 30);
  return vv.lt(ee.Number(t)).rename('w3');
}
function refDynamicWorld(aoi, m) {
  m = ee.Date(m);
  return ee.ImageCollection(cfg.DATASETS.DW)
      .filterBounds(aoi).filterDate(m, m.advance(1, 'month'))
      .select('water').mean().gte(0.5).rename('w4').clip(aoi);
}
function refRandomForest(aoi, m) {
  var s2 = s2Monthly(aoi, m);
  var indices = ee.Image.cat([
    s2.normalizedDifference(['B3', 'B11']).rename('MNDWI'),
    s2.normalizedDifference(['B3', 'B8']).rename('NDWI'),
    s2.normalizedDifference(['B8', 'B4']).rename('NDVI')]);
  var md = ee.Date(m);
  var vv = ee.ImageCollection(cfg.DATASETS.S1_GRD)
      .filterBounds(aoi).filterDate(md, md.advance(1, 'month'))
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains(
          'transmitterReceiverPolarisation', 'VV'))
      .select(['VV', 'VH']).mean()
      .focalMedian(50, 'circle', 'meters');
  var stack = s2.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
      .addBands(indices).addBands(vv).clip(aoi);
  var gsw = ee.Image(cfg.DATASETS.GSW).select('occurrence').unmask(0);
  var wc = ee.ImageCollection(cfg.DATASETS.WORLDCOVER).first()
      .select('Map');
  var stableWater = gsw.gt(90);
  var stableLand = gsw.lt(5).and(wc.neq(80));
  var strata = stableWater.rename('label')
      .updateMask(stableWater.or(stableLand)).clip(aoi);
  var samples = stack.addBands(strata).stratifiedSample({
    numPoints: 1500, classBand: 'label', region: aoi,
    scale: cfg.SCALE, seed: cfg.SEED, geometries: false,
    classValues: [0, 1], classPoints: [1500, 1500]});
  samples = samples.randomColumn('rnd', cfg.SEED);
  var train = samples.filter(ee.Filter.lt('rnd', 0.7));
  var rf = ee.Classifier.smileRandomForest({
    numberOfTrees: 200, minLeafPopulation: 2, seed: cfg.SEED
  }).train({features: train, classProperty: 'label',
    inputProperties: stack.bandNames()});
  return stack.classify(rf).rename('w5');
}

/* ---------- uncertain fraction per site-month ------------------------- */
var rows = [];
Object.keys(cfg.SITES).forEach(function (key) {
  var site = cfg.SITES[key];
  EVAL_MONTHS.forEach(function (m) {
    var votes = ee.Image.cat([
      refMndwiOtsu(site.aoi, m), refAwei(site.aoi, m),
      refS1Otsu(site.aoi, m), refDynamicWorld(site.aoi, m),
      refRandomForest(site.aoi, m)
    ]).reduce(ee.Reducer.sum()).rename('votes');
    var uncertain = votes.eq(2).or(votes.eq(3));
    var waterConsensus = votes.gte(4);
    var stats = uncertain.rename('unc')
        .addBands(waterConsensus.rename('wat')).reduceRegion({
          reducer: ee.Reducer.mean(), geometry: site.aoi,
          scale: 90, maxPixels: 1e13, tileScale: 4});
    rows.push(ee.Feature(null, {
      site: site.name, date: m,
      uncertain_fraction: stats.get('unc'),
      consensus_water_fraction: stats.get('wat')
    }));
  });
});
Export.table.toDrive({
  collection: ee.FeatureCollection(rows),
  description: 'T12_consensus_uncertain_fraction',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'date', 'uncertain_fraction',
              'consensus_water_fraction']
});
print('Export task created: T12_consensus_uncertain_fraction');