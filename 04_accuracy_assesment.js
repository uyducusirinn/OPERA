/**** =====================================================================
 * 04_accuracy_assessment.js
 * ---------------------------------------------------------------------
 * PAPER SECTION: "Methods 3.3 - Accuracy assessment" and
 * "Results 4.2 - Product accuracy" (Tables 4-5, Fig. 5)
 *
 * Design (follows good-practice recommendations of Olofsson et al. 2014
 * and Stehman & Foody 2019):
 *   - Response design : consensus reference (script 03), pixels without
 *     a >=4/5 majority are EXCLUDED (uncertain stratum reported).
 *   - Sampling design : stratified random sampling on the reference
 *     (equal allocation water/land, n = N_PER_CLASS per class per month
 *     per site), fixed seed for reproducibility.
 *   - Analysis        : error matrix, OA, kappa, per-class UA/PA, F1 for
 *     (a) DSWx-HLS monthly water, (b) DSWx-S1 monthly water.
 *   - Paired samples are exported so that McNemar's test between the two
 *     products can be computed offline (R/Python) on identical points —
 *     the statistically correct way to compare two classifiers.
 *
 * Months: a season-spanning evaluation set within the common period.
 * ===================================================================== */
var cfg = require('users/melihaltay2017/earth101:00_config');
var ref = require('users/melihaltay2017/earth101:03_reference_water_maps');

var N_PER_CLASS = 500;
var EVAL_MONTHS = [                // 4 seasons x 2 years where possible
  '2024-10-01', '2025-01-01', '2025-04-01', '2025-07-01',
  '2025-10-01', '2026-01-01', '2026-04-01'
];

/* ---------- monthly DSWx binaries ------------------------------------ */
function hlsMonthlyWater(aoi, m) {
  var col = ee.ImageCollection(cfg.DATASETS.DSWX_HLS)
      .filterBounds(aoi)
      .filterDate(ee.Date(m), ee.Date(m).advance(1, 'month'))
      .map(cfg.hlsWaterValid);
  return cfg.monthlyWaterComposite(col, m).select('water')
      .rename('hls_water');
}
function s1MonthlyWater(aoi, m) {
  var col = ee.ImageCollection(cfg.DATASETS.DSWX_S1)
      .filterBounds(aoi)
      .filterDate(ee.Date(m), ee.Date(m).advance(1, 'month'))
      .map(cfg.s1WaterValid);
  return cfg.monthlyWaterComposite(col, m).select('water')
      .rename('s1_water');
}

/* ---------- per site / per month evaluation --------------------------- */
var allSamples = ee.FeatureCollection([]);
var metricRows = [];

cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  EVAL_MONTHS.forEach(function (m) {

    var consensus = ref.refConsensus(site.aoi, m).select('consensus');
    var stack = consensus
        .addBands(hlsMonthlyWater(site.aoi, m))
        .addBands(s1MonthlyWater(site.aoi, m));

    // Stratified random sample on the reference; only pixels where
    // BOTH products have a valid observation are retained, so the two
    // error matrices are computed on IDENTICAL points (paired design).
    var samples = stack.stratifiedSample({
      numPoints: N_PER_CLASS, classBand: 'consensus',
      region: site.aoi, scale: cfg.SCALE, seed: cfg.SEED,
      classValues: [0, 1], classPoints: [N_PER_CLASS, N_PER_CLASS],
      dropNulls: true, geometries: true
    }).map(function (f) {
      return f.set({site: site.name, date: m});
    });
    allSamples = allSamples.merge(samples);

    // Error matrices (printed; also recomputable from exported samples)
    var cmHls = samples.errorMatrix('consensus', 'hls_water');
    var cmS1 = samples.errorMatrix('consensus', 's1_water');
    print(site.name + ' ' + m + ' | DSWx-HLS OA/kappa:',
          cmHls.accuracy(), cmHls.kappa());
    print(site.name + ' ' + m + ' | DSWx-S1  OA/kappa:',
          cmS1.accuracy(), cmS1.kappa());

    metricRows.push(ee.Feature(null, {
      site: site.name, date: m, product: 'DSWx-HLS',
      oa: cmHls.accuracy(), kappa: cmHls.kappa(),
      f1_water: ee.Array(cmHls.fscore()).get([1]),
      pa_water: ee.Array(cmHls.producersAccuracy()).get([1, 0]),
      ua_water: ee.Array(cmHls.consumersAccuracy()).get([0, 1])
    }));
    metricRows.push(ee.Feature(null, {
      site: site.name, date: m, product: 'DSWx-S1',
      oa: cmS1.accuracy(), kappa: cmS1.kappa(),
      f1_water: ee.Array(cmS1.fscore()).get([1]),
      pa_water: ee.Array(cmS1.producersAccuracy()).get([1, 0]),
      ua_water: ee.Array(cmS1.consumersAccuracy()).get([0, 1])
    }));
  });
});

/* ---------- exports ---------------------------------------------------- */
// (a) Paired point samples -> McNemar test + bootstrap CIs offline.
Export.table.toDrive({
  collection: allSamples,
  description: 'T04_paired_accuracy_samples',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'date', 'consensus', 'hls_water', 's1_water',
              '.geo']
});
// (b) Summary metrics table (Table 4).
Export.table.toDrive({
  collection: ee.FeatureCollection(metricRows),
  description: 'T04_accuracy_metrics_summary',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'date', 'product', 'oa', 'kappa',
              'f1_water', 'pa_water', 'ua_water']
});

/* NOTE for the manuscript:
 * - Report the excluded "uncertain" consensus fraction per site/month
 *   (votes 2-3 in script 03) as a limitation/sensitivity analysis.
 * - Repeat with cfg.INCLUDE_PARTIAL_WATER=false and
 *   cfg.INCLUDE_INUNDATED_VEG=false to quantify class-definition
 *   sensitivity (supplementary table).                                 */