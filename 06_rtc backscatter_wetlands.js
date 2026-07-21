/* ================= INLINED 00_config (no require needed) ============ */
var cfg = {};
/**** =====================================================================
 * 00_config.js
 * ---------------------------------------------------------------------
 * OPERA-TR: Cross-sensor evaluation of NASA OPERA Dynamic Surface Water
 * Extent products (DSWx-HLS, DSWx-S1) and RTC-S1 backscatter across four
 * contrasting hydro-geomorphic settings in Türkiye.
 *
 * This module centralises: study sites, analysis periods, dataset IDs,
 * class encodings, and shared helper functions (masking, compositing,
 * Otsu thresholding, area computation, dB conversion, month lists).
 *
 * USAGE (from any other script in the same repository):
 *   (standalone version: config is inlined below, no require needed)
 *
 * All other scripts in this project assume this require path; adjust
 * <YOUR_USERNAME> and the repo name to your own GEE account.
 * ===================================================================== */

/* ------------------------------------------------------------------ *
 * 1. STUDY SITES (4 contrasting hydro-geomorphic settings)
 *    S1: Burdur Lake      - terminal (endorheic) saline tectonic lake,
 *                           multi-decadal shrinkage; Ramsar site.
 *    S2: Tuz Lake         - ephemeral hypersaline playa; extreme
 *                           seasonality; hardest case for both optical
 *                           (bright salt crust) and SAR (smooth surface).
 *    S3: Kizilirmak Delta - Ramsar coastal delta wetland (Bafra);
 *                           seasonal inundation + flooded vegetation;
 *                           tests the DSWx-S1 inundated-vegetation class.
 *    S4: Ataturk Reservoir- largest reservoir in Türkiye; anthropogenic,
 *                           operational drawdown dynamics.
 * ------------------------------------------------------------------ */
cfg.SITES = {
  burdur: {
    name: 'Burdur Lake',
    nameTr: 'Burdur Gölü',
    type: 'terminal saline lake',
    aoi: ee.Geometry.Rectangle([29.93, 37.55, 30.36, 37.92]),
    center: [30.15, 37.73],
    zoom: 11
  },
  tuz: {
    name: 'Tuz Lake',
    nameTr: 'Tuz Gölü',
    type: 'ephemeral hypersaline playa',
    aoi: ee.Geometry.Rectangle([32.95, 38.35, 33.85, 39.20]),
    center: [33.38, 38.78],
    zoom: 9
  },
  kizilirmak: {
    name: 'Kizilirmak Delta',
    nameTr: 'Kızılırmak Deltası (Bafra)',
    type: 'coastal delta wetland',
    aoi: ee.Geometry.Rectangle([35.75, 41.48, 36.40, 41.78]),
    center: [36.06, 41.63],
    zoom: 11
  },
  ataturk: {
    name: 'Ataturk Reservoir',
    nameTr: 'Atatürk Baraj Gölü',
    type: 'managed reservoir (drawdown)',
    aoi: ee.Geometry.Rectangle([38.20, 37.45, 39.05, 38.30]),
    center: [38.60, 37.87],
    zoom: 9
  }
};

// Convenience: list of site keys for mapping/iteration in client code.
cfg.SITE_KEYS = ['burdur', 'tuz', 'kizilirmak', 'ataturk'];

/* ------------------------------------------------------------------ *
 * 2. ANALYSIS PERIODS
 *  - HLS_PERIOD    : full validated DSWx-HLS record (optical).
 *  - COMMON_PERIOD : overlap of DSWx-HLS and DSWx-S1 -> used for all
 *                    cross-sensor comparisons (fair comparison window).
 *  - RTC_PERIOD    : long-term RTC-S1 gamma0 record (context/time series).
 *  - GSW_BASELINE  : JRC Global Surface Water climatology reference.
 * ------------------------------------------------------------------ */
cfg.HLS_PERIOD    = {start: '2023-04-04', end: '2026-06-30'};
cfg.COMMON_PERIOD = {start: '2024-09-01', end: '2026-06-30'};
cfg.RTC_PERIOD    = {start: '2016-04-14', end: '2026-06-30'};
cfg.CLIMATE_BASELINE = {start: '1991-01-01', end: '2020-12-31'};

/* ------------------------------------------------------------------ *
 * 3. DATASET IDs (verified against the GEE Data Catalog, July 2026)
 * ------------------------------------------------------------------ */
cfg.DATASETS = {
  DSWX_HLS   : 'OPERA/DSWX/L3_V1/HLS',        // 30 m, from 2023-04
  DSWX_S1    : 'OPERA/DSWX/L3_V1/S1',         // 30 m, from 2024-08/09
  RTC_S1     : 'OPERA/RTC/L2_V1/S1',          // 30 m gamma0, from 2016-04
  RTC_STATIC : 'OPERA/RTC/L2_V1/S1_STATIC',   // incidence angle etc.
  S2_SR      : 'COPERNICUS/S2_SR_HARMONIZED',
  S2_CLDPRB  : 'COPERNICUS/S2_CLOUD_PROBABILITY',
  S1_GRD     : 'COPERNICUS/S1_GRD',
  GSW        : 'JRC/GSW1_4/GlobalSurfaceWater',
  GSW_MONTHLY: 'JRC/GSW1_4/MonthlyHistory',
  DW         : 'GOOGLE/DYNAMICWORLD/V1',
  WORLDCOVER : 'ESA/WorldCover/v200',
  DEM_GLO30  : 'COPERNICUS/DEM/GLO30',
  CHIRPS     : 'UCSB-CHG/CHIRPS/DAILY',
  ERA5L_MON  : 'ECMWF/ERA5_LAND/MONTHLY_AGGR'
};

/* ------------------------------------------------------------------ *
 * 4. OPERA CLASS ENCODINGS (from product specifications)
 * ------------------------------------------------------------------ */
// DSWx-HLS WTR: 0 not-water | 1 open water | 2 partial surface water
//               252 snow/ice | 253 cloud/shadow | 254 ocean-masked
cfg.HLS_WTR = {
  NOT_WATER: 0, OPEN_WATER: 1, PARTIAL_WATER: 2,
  SNOW_ICE: 252, CLOUD: 253, OCEAN: 254
};
// DSWx-S1 WTR:  0 not-water | 1 open water | 3 inundated vegetation
//               250 HAND-masked | 251 layover/shadow | 254 ocean-masked
cfg.S1_WTR = {
  NOT_WATER: 0, OPEN_WATER: 1, INUNDATED_VEG: 3,
  HAND_MASK: 250, LAYOVER_SHADOW: 251, OCEAN: 254
};

/* ------------------------------------------------------------------ *
 * 5. GLOBAL PARAMETERS
 * ------------------------------------------------------------------ */
cfg.SCALE = 30;                 // native resolution of all OPERA products
cfg.WATER_FREQ_THRESHOLD = 0.5; // monthly composite: water if observed
                                    // as water in >= 50% of clear obs.
cfg.MIN_CLEAR_OBS = 1;          // minimum clear observations per month
cfg.INCLUDE_PARTIAL_WATER = true; // HLS: treat partial surface water
                                       // (class 2) as water (BWTR logic).
cfg.INCLUDE_INUNDATED_VEG = true; // S1: treat inundated vegetation
                                       // (class 3) as water (BWTR logic).
cfg.EXPORT_FOLDER = 'OPERA_TR_exports';
cfg.SEED = 42;

/* ====================================================================
 * HELPER FUNCTIONS
 * ==================================================================== */

/**
 * DSWx-HLS: returns an image with two bands:
 *   'water' (1/0) and 'valid' (1/0), applying the BWTR logic.
 * Ocean-masked, cloud and snow pixels are treated as NOT VALID
 * (excluded from both numerator and denominator of water frequency).
 */
cfg.hlsWaterValid = function (img) {
  var wtr = img.select('WTR_Water_classification');
  var valid = wtr.eq(0).or(wtr.eq(1)).or(wtr.eq(2));   // observed land/water
  var water = cfg.INCLUDE_PARTIAL_WATER ?
      wtr.eq(1).or(wtr.eq(2)) : wtr.eq(1);
  return img.addBands(water.rename('water').toByte())
            .addBands(valid.rename('valid').toByte());
};

/**
 * DSWx-S1: same interface as hlsWaterValid().
 * HAND-masked, layover/shadow and ocean-masked pixels -> NOT VALID.
 */
cfg.s1WaterValid = function (img) {
  var wtr = img.select('WTR_Water_classification');
  var valid = wtr.eq(0).or(wtr.eq(1)).or(wtr.eq(3));
  var water = cfg.INCLUDE_INUNDATED_VEG ?
      wtr.eq(1).or(wtr.eq(3)) : wtr.eq(1);
  return img.addBands(water.rename('water').toByte())
            .addBands(valid.rename('valid').toByte());
};

/**
 * Builds a list of month-start ee.Date objects between start and end.
 */
cfg.monthList = function (start, end) {
  var s = ee.Date(start);
  var e = ee.Date(end);
  var n = e.difference(s, 'month').floor();
  return ee.List.sequence(0, n.subtract(1))
      .map(function (m) { return s.advance(m, 'month'); });
};

/**
 * Monthly water composite from a mapped (water/valid) collection.
 * Returns an ee.Image per month with bands:
 *  'water_freq'  - fraction of clear obs classified as water [0..1]
 *  'water'       - binary water (freq >= WATER_FREQ_THRESHOLD)
 *  'n_valid'     - number of clear observations
 * Pixels with n_valid < MIN_CLEAR_OBS are masked.
 */
cfg.monthlyWaterComposite = function (col, monthStart) {
  monthStart = ee.Date(monthStart);
  var monthEnd = monthStart.advance(1, 'month');
  var sub = col.filterDate(monthStart, monthEnd);
  var nValid  = sub.select('valid').sum().rename('n_valid');
  var nWater  = sub.select('water').sum().rename('n_water');
  var freq = nWater.divide(nValid).rename('water_freq');
  var water = freq.gte(cfg.WATER_FREQ_THRESHOLD).rename('water');
  var mask = nValid.gte(cfg.MIN_CLEAR_OBS);
  return freq.addBands(water).addBands(nValid)
      .updateMask(mask)
      .set({
        'system:time_start': monthStart.millis(),
        'year': monthStart.get('year'),
        'month': monthStart.get('month'),
        'date_label': monthStart.format('YYYY-MM')
      });
};

/**
 * Surface water area (km2) of a binary mask over a region.
 * Returns an ee.Number.
 */
cfg.waterAreaKm2 = function (waterBinary, region) {
  var area = waterBinary.selfMask()
      .multiply(ee.Image.pixelArea())
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: region,
        scale: cfg.SCALE,
        maxPixels: 1e13,
        tileScale: 4
      });
  return ee.Number(area.values().get(0)).divide(1e6);
};

/**
 * Linear power -> dB (for RTC-S1 gamma0 and S1 GRD already in dB skip).
 */
cfg.toDb = function (img) {
  return ee.Image(10).multiply(img.log10())
      .copyProperties(img, img.propertyNames());
};

/**
 * Otsu threshold from an image-band histogram over a region.
 * Canonical between-class-variance maximisation on ee.Array.
 */
cfg.otsu = function (image, band, region, scale) {
  var histDict = image.select(band).reduceRegion({
    reducer: ee.Reducer.histogram(255, null),
    geometry: region,
    scale: scale || cfg.SCALE,
    maxPixels: 1e13,
    bestEffort: true,
    tileScale: 4
  });
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

/**
 * Copernicus GLO-30 DEM mosaic (band 'DEM').
 */
cfg.glo30 = function () {
  return ee.ImageCollection(cfg.DATASETS.DEM_GLO30)
      .select('DEM').mosaic().rename('elevation');
};

/**
 * Standard visual params.
 */
cfg.VIS = {
  water: {min: 0, max: 1, palette: ['ffffff', '0000ff']},
  freq:  {min: 0, max: 1, palette:
          ['ffffff', 'fffcb8', '0905ff']},
  agreement: {min: 0, max: 3, palette:
          ['e0e0e0', '1a9850', 'd73027', 'fdae61']},
  s2rgb: {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000},
  vvdb:  {min: -25, max: 0}
};

/* ================= end of inlined config ============================ */

/**** =====================================================================
 * 06_rtc_backscatter_wetlands.js
 * ---------------------------------------------------------------------
 * PAPER SECTION: "Results 4.5 - Backscatter mechanisms & wetlands"
 * (Figs. 9-10) — the physical-interpretation section that lifts the
 * paper beyond a product intercomparison.
 *
 * A) RTC-S1 gamma0 (2016->): long-term VV/VH dB time series over three
 *    functional zones per site derived from JRC occurrence:
 *      permanent water (occ>90), drawdown/ephemeral (10<occ<=90),
 *      stable land (occ<5). Explains DSWx-S1 behaviour (low-backscatter
 *    ambiguity over smooth playa/salt crust, wind roughening, etc.).
 * B) Dual-pol ratio (VH/VV in dB difference) seasonal climatology over
 *    wetland vegetation (WorldCover herbaceous wetland cls 90 + reeds)
 *    versus DSWx-S1 inundated-vegetation detections in the Kizilirmak
 *    Delta -> evaluates the flooded-vegetation class (novel: few
 *    published evaluations of this DSWx-S1 class exist).
 * C) DSWx-S1 layover/shadow and HAND mask footprints (systematic
 *    unobservable areas) quantified per site.
 * ===================================================================== */

/* ---------- functional zones from JRC occurrence --------------------- */
function zones(aoi) {
  var occ = ee.Image(cfg.DATASETS.GSW).select('occurrence')
      .unmask(0).clip(aoi);
  return {
    permanent: occ.gt(90),
    drawdown: occ.gt(10).and(occ.lte(90)),
    land: occ.lt(5)
  };
}

/* ========== A) RTC-S1 long-term gamma0 series ======================== */
// Quarterly means keep the export light while preserving seasonality.
function quarterList(start, end) {
  var s = ee.Date(start); var e = ee.Date(end);
  var n = e.difference(s, 'month').divide(3).floor();
  return ee.List.sequence(0, n.subtract(1))
      .map(function (q) { return s.advance(ee.Number(q).multiply(3),
          'month'); });
}

var rtcRows = ee.FeatureCollection([]);
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  var z = zones(site.aoi);
  var quarters = quarterList(cfg.RTC_PERIOD.start, cfg.RTC_PERIOD.end);

  var feats = ee.FeatureCollection(quarters.map(function (q) {
    q = ee.Date(q);
    var col = ee.ImageCollection(cfg.DATASETS.RTC_S1)
        .filterBounds(site.aoi)
        .filterDate(q, q.advance(3, 'month'))
        .filter(ee.Filter.listContains('POLARIZATIONS', 'VV'))
        .filter(ee.Filter.listContains('POLARIZATIONS', 'VH'))
        .map(function (img) {
          // Keep only valid samples unaffected by layover/shadow.
          var ok = img.select('mask').eq(0);
          return img.select(['VV', 'VH']).updateMask(ok);
        });
    var meanLin = col.mean();                 // average in LINEAR power,
    var db = cfg.toDb(meanLin);               // then convert to dB.
    var stats = ee.Dictionary(ee.List(['permanent', 'drawdown', 'land'])
        .iterate(function (zn, acc) {
          zn = ee.String(zn);
          var mask = ee.Image(ee.Dictionary({
            permanent: z.permanent, drawdown: z.drawdown, land: z.land
          }).get(zn));
          var v = ee.Image(db).updateMask(mask).reduceRegion({
            reducer: ee.Reducer.mean(), geometry: site.aoi,
            scale: cfg.SCALE, maxPixels: 1e13, tileScale: 4
          });
          return ee.Dictionary(acc)
              .set(zn.cat('_vv_db'), v.get('VV'))
              .set(zn.cat('_vh_db'), v.get('VH'));
        }, ee.Dictionary({})));
    return ee.Feature(null, stats.combine({
      site: site.name, date: q.format('YYYY-MM')
    }));
  }));
  rtcRows = rtcRows.merge(feats);
});

Export.table.toDrive({
  collection: rtcRows, description: 'T08_rtc_gamma0_zonal_series',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'date',
      'permanent_vv_db', 'permanent_vh_db',
      'drawdown_vv_db', 'drawdown_vh_db',
      'land_vv_db', 'land_vh_db']
});

/* ========== B) Flooded vegetation in the Kizilirmak Delta ============ */
var delta = cfg.SITES.kizilirmak;
var months = cfg.monthList(cfg.COMMON_PERIOD.start, cfg.COMMON_PERIOD.end);

// WorldCover herbaceous wetland (90) + permanent water context.
var wc = ee.ImageCollection(cfg.DATASETS.WORLDCOVER).first()
    .select('Map').clip(delta.aoi);
var wetlandMask = wc.eq(90);
Map.addLayer(wetlandMask.selfMask(), {palette: ['2ca25f']},
    'WorldCover herbaceous wetland', false);

// Monthly DSWx-S1 inundated-vegetation (class 3) frequency map.
var ivCol = ee.ImageCollection(cfg.DATASETS.DSWX_S1)
    .filterBounds(delta.aoi)
    .filterDate(cfg.COMMON_PERIOD.start, cfg.COMMON_PERIOD.end)
    .map(function (img) {
      var wtr = img.select('WTR_Water_classification');
      var valid = wtr.eq(0).or(wtr.eq(1)).or(wtr.eq(3));
      return wtr.eq(3).rename('iv').toByte()
          .addBands(valid.rename('valid').toByte())
          .copyProperties(img, ['system:time_start']);
    });
var ivFreq = ivCol.select('iv').sum()
    .divide(ivCol.select('valid').sum())
    .rename('inundated_veg_freq').clip(delta.aoi);
Map.addLayer(ivFreq, {min: 0, max: 0.6,
    palette: ['ffffff', '99d8c9', '2ca25f', '00441b']},
    'DSWx-S1 inundated vegetation frequency');

// Monthly stats: IV area, IV∩wetland overlap, dual-pol ratio over
// wetland from RTC-S1 (physical corroboration of the class).
var ivRows = ee.FeatureCollection(months.map(function (m) {
  m = ee.Date(m);
  var ivMonth = ivCol.filterDate(m, m.advance(1, 'month'));
  var iv = ivMonth.select('iv').max().unmask(0);
  var ivArea = cfg.waterAreaKm2(iv, delta.aoi);
  var ivInWetland = cfg.waterAreaKm2(iv.and(wetlandMask), delta.aoi);

  var rtc = ee.ImageCollection(cfg.DATASETS.RTC_S1)
      .filterBounds(delta.aoi).filterDate(m, m.advance(1, 'month'))
      .filter(ee.Filter.listContains('POLARIZATIONS', 'VH'))
      .map(function (img) {
        return img.select(['VV', 'VH'])
            .updateMask(img.select('mask').eq(0));
      }).mean();
  var db = cfg.toDb(rtc);
  var ratio = ee.Image(db).select('VH')
      .subtract(ee.Image(db).select('VV')).rename('vh_vv_db');
  var ratioWetland = ratio.updateMask(wetlandMask).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: delta.aoi,
    scale: cfg.SCALE, maxPixels: 1e13, tileScale: 4
  }).get('vh_vv_db');

  return ee.Feature(null, {
    site: delta.name, date: m.format('YYYY-MM'),
    iv_area_km2: ivArea, iv_in_wetland_km2: ivInWetland,
    wetland_vhvv_db: ratioWetland
  });
}));
Export.table.toDrive({
  collection: ivRows, description: 'T09_inundated_vegetation_delta',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'date', 'iv_area_km2', 'iv_in_wetland_km2',
              'wetland_vhvv_db']
});

/* ========== C) Systematic unobservable areas (DSWx-S1 masks) ========= */
var maskRows = [];
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  var sample = ee.ImageCollection(cfg.DATASETS.DSWX_S1)
      .filterBounds(site.aoi)
      .filterDate(cfg.COMMON_PERIOD.start, cfg.COMMON_PERIOD.end);
  // Frequency with which a pixel is HAND- or layover/shadow-masked.
  var wtr = sample.map(function (img) {
    var w = img.select('WTR_Water_classification');
    return w.eq(250).rename('hand').toByte()
        .addBands(w.eq(251).rename('los').toByte())
        .addBands(w.gte(0).rename('n').toByte());
  });
  var handFrac = wtr.select('hand').sum()
      .divide(wtr.select('n').sum());
  var losFrac = wtr.select('los').sum()
      .divide(wtr.select('n').sum());
  var stats = handFrac.rename('hand_frac')
      .addBands(losFrac.rename('los_frac')).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: site.aoi,
        scale: 90, maxPixels: 1e13, tileScale: 4
      });
  maskRows.push(ee.Feature(null, {
    site: site.name,
    hand_masked_fraction: stats.get('hand_frac'),
    layover_shadow_fraction: stats.get('los_frac')
  }));
});
Export.table.toDrive({
  collection: ee.FeatureCollection(maskRows),
  description: 'T10_dswxs1_mask_fractions',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'hand_masked_fraction', 'layover_shadow_fraction']
});

Map.centerObject(delta.aoi, delta.zoom);