/**** =====================================================================
 * 01_data_inventory.js
 * ---------------------------------------------------------------------
 * PAPER SECTION: "Data" + "Study area" (Table 1 / Table 2, Fig. 1)
 *
 * For each of the four study sites and each product (DSWx-HLS, DSWx-S1,
 * RTC-S1, S2 SR, S1 GRD), this script quantifies:
 *   - number of granules/scenes per month,
 *   - cloud statistics (DSWx-HLS CLOUD_COVERAGE property),
 *   - per-pixel clear-observation density (Fig.: observation count maps),
 * and exports a tidy CSV (site, product, year, month, n_images,
 * mean_cloud) ready for Table 2 and a data-density figure.
 * ===================================================================== */
var cfg = require('users/melihaltay2017/earth101:00_config');

var PERIOD = cfg.HLS_PERIOD; // widest common inventory window for DSWx
var months = cfg.monthList(PERIOD.start, PERIOD.end);

/* ---------- collections -------------------------------------------- */
function collFor(product, aoi) {
  if (product === 'DSWX_HLS') {
    return ee.ImageCollection(cfg.DATASETS.DSWX_HLS)
        .filterBounds(aoi).filterDate(PERIOD.start, PERIOD.end);
  } else if (product === 'DSWX_S1') {
    return ee.ImageCollection(cfg.DATASETS.DSWX_S1)
        .filterBounds(aoi).filterDate(PERIOD.start, PERIOD.end);
  } else if (product === 'RTC_S1') {
    return ee.ImageCollection(cfg.DATASETS.RTC_S1)
        .filterBounds(aoi).filterDate(PERIOD.start, PERIOD.end)
        .filter(ee.Filter.listContains('POLARIZATIONS', 'VV'));
  } else if (product === 'S2_SR') {
    return ee.ImageCollection(cfg.DATASETS.S2_SR)
        .filterBounds(aoi).filterDate(PERIOD.start, PERIOD.end);
  } else if (product === 'S1_GRD') {
    return ee.ImageCollection(cfg.DATASETS.S1_GRD)
        .filterBounds(aoi).filterDate(PERIOD.start, PERIOD.end)
        .filter(ee.Filter.eq('instrumentMode', 'IW'));
  }
}

var PRODUCTS = ['DSWX_HLS', 'DSWX_S1', 'RTC_S1', 'S2_SR', 'S1_GRD'];

/* ---------- monthly inventory table --------------------------------- */
var rows = ee.FeatureCollection([]);

cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  PRODUCTS.forEach(function (product) {
    var col = collFor(product, site.aoi);
    var feats = ee.FeatureCollection(months.map(function (m) {
      m = ee.Date(m);
      var sub = col.filterDate(m, m.advance(1, 'month'));
      var n = sub.size();
      // Cloud statistic only meaningful for DSWx-HLS
      var meanCloud = ee.Algorithms.If(
          ee.String(product).equals('DSWX_HLS'),
          sub.aggregate_mean('CLOUD_COVERAGE'),
          null);
      return ee.Feature(null, {
        site: site.name,
        product: product,
        date: m.format('YYYY-MM'),
        year: m.get('year'),
        month: m.get('month'),
        n_images: n,
        mean_cloud_pct: meanCloud
      });
    }));
    rows = rows.merge(feats);
  });
});

Export.table.toDrive({
  collection: rows,
  description: 'T01_data_inventory_monthly',
  folder: cfg.EXPORT_FOLDER,
  fileFormat: 'CSV',
  selectors: ['site', 'product', 'date', 'year', 'month',
              'n_images', 'mean_cloud_pct']
});

/* ---------- per-pixel clear-observation density maps ----------------- */
// Number of CLEAR observations per pixel over the common period —
// a key figure justifying the SAR product's added value in cloudy months.
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];

  var hlsClear = ee.ImageCollection(cfg.DATASETS.DSWX_HLS)
      .filterBounds(site.aoi)
      .filterDate(cfg.COMMON_PERIOD.start, cfg.COMMON_PERIOD.end)
      .map(cfg.hlsWaterValid)
      .select('valid').sum().clip(site.aoi).rename('hls_clear_obs');

  var s1Clear = ee.ImageCollection(cfg.DATASETS.DSWX_S1)
      .filterBounds(site.aoi)
      .filterDate(cfg.COMMON_PERIOD.start, cfg.COMMON_PERIOD.end)
      .map(cfg.s1WaterValid)
      .select('valid').sum().clip(site.aoi).rename('s1_valid_obs');

  Map.addLayer(hlsClear, {min: 0, max: 120,
      palette: ['black', 'purple', 'orange', 'yellow', 'white']},
      site.name + ' | HLS clear obs', false);
  Map.addLayer(s1Clear, {min: 0, max: 120,
      palette: ['black', 'purple', 'orange', 'yellow', 'white']},
      site.name + ' | S1 valid obs', false);

  Export.image.toDrive({
    image: hlsClear.addBands(s1Clear).toInt16(),
    description: 'IMG01_obs_density_' + key,
    folder: cfg.EXPORT_FOLDER,
    region: site.aoi,
    scale: cfg.SCALE,
    maxPixels: 1e13
  });
});

/* ---------- study area overview (Fig. 1 base) ------------------------ */
// Cloud-free S2 median composite per site for the overview figure.
function s2Median(aoi) {
  return ee.ImageCollection(cfg.DATASETS.S2_SR)
      .filterBounds(aoi)
      .filterDate('2025-05-01', '2025-09-30')
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
      .median().clip(aoi);
}
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  Map.addLayer(s2Median(site.aoi), cfg.VIS.s2rgb,
      site.name + ' | S2 RGB', false);
});

Map.setCenter(33.0, 39.0, 6);
print('Monthly inventory (first 20 rows):', rows.limit(20));