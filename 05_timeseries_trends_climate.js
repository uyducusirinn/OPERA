/**** =====================================================================
 * 05_timeseries_trends_climate.js
 * ---------------------------------------------------------------------
 * PAPER SECTION: "Results 4.3 - Temporal dynamics" and
 * "Results 4.4 - Climatic drivers" (Figs. 6-8, Table 6)
 *
 * 1) Monthly surface-water AREA time series per site for:
 *      DSWx-HLS (2023-04 ->), DSWx-S1 (2024-09 ->),
 *      JRC MonthlyHistory (1984-2021, long-term context).
 * 2) Per-pixel trend maps of monthly water frequency (Sen's slope) and
 *    Kendall's tau over the DSWx-HLS record.
 * 3) Climate drivers: CHIRPS monthly precipitation + standardized
 *    precipitation anomaly (SPI-like z-score of 3-month sums vs the
 *    1991-2020 baseline; final gamma-fit SPI to be computed offline on
 *    the exported series), ERA5-Land 2 m temperature and evaporation.
 * All series exported as tidy CSVs for offline statistics (Mann-Kendall
 * significance, cross-correlation lags, changepoint detection).
 * ===================================================================== */
var cfg = require('users/melihaltay2017/earth101:00_config');

/* ============ 1. WATER AREA TIME SERIES ============================== */
function areaSeries(productId, mapper, period, label) {
  var months = cfg.monthList(period.start, period.end);
  var rows = ee.FeatureCollection([]);
  cfg.SITE_KEYS.forEach(function (key) {
    var site = cfg.SITES[key];
    var col = ee.ImageCollection(productId)
        .filterBounds(site.aoi)
        .filterDate(period.start, period.end)
        .map(mapper);
    var feats = ee.FeatureCollection(months.map(function (m) {
      m = ee.Date(m);
      var comp = cfg.monthlyWaterComposite(col, m);
      var areaKm2 = cfg.waterAreaKm2(comp.select('water'), site.aoi);
      // Valid-pixel fraction: guards against composites biased by gaps.
      var validFrac = comp.select('n_valid').gte(cfg.MIN_CLEAR_OBS)
          .unmask(0).reduceRegion({
            reducer: ee.Reducer.mean(), geometry: site.aoi,
            scale: 300, maxPixels: 1e13, tileScale: 4
          }).values().get(0);
      return ee.Feature(null, {
        site: site.name, product: label, date: m.format('YYYY-MM'),
        area_km2: areaKm2, valid_fraction: validFrac
      });
    }));
    rows = rows.merge(feats);
  });
  return rows;
}

var hlsSeries = areaSeries(cfg.DATASETS.DSWX_HLS, cfg.hlsWaterValid,
    cfg.HLS_PERIOD, 'DSWx-HLS');
var s1Series = areaSeries(cfg.DATASETS.DSWX_S1, cfg.s1WaterValid,
    cfg.COMMON_PERIOD, 'DSWx-S1');

Export.table.toDrive({
  collection: hlsSeries.merge(s1Series),
  description: 'T06_water_area_timeseries_opera',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'product', 'date', 'area_km2', 'valid_fraction']
});

/* Long-term JRC context series (1984-2021) — Fig. 6 background. */
var jrcRows = ee.FeatureCollection([]);
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  var jrc = ee.ImageCollection(cfg.DATASETS.GSW_MONTHLY)
      .filterBounds(site.aoi);
  var feats = jrc.map(function (img) {
    var water = ee.Image(img).select('water').eq(2);
    return ee.Feature(null, {
      site: site.name, product: 'JRC-monthly',
      year: img.get('year'), month: img.get('month'),
      area_km2: cfg.waterAreaKm2(water, site.aoi)
    });
  });
  jrcRows = jrcRows.merge(feats);
});
Export.table.toDrive({
  collection: jrcRows, description: 'T06_water_area_timeseries_jrc',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'product', 'year', 'month', 'area_km2']
});

/* Quicklook chart (client-side) for one site. */
var demoKey = 'burdur';
print(ui.Chart.feature.byFeature({
  features: hlsSeries.filter(ee.Filter.eq('site',
      cfg.SITES[demoKey].name)),
  xProperty: 'date', yProperties: ['area_km2']
}).setOptions({title: cfg.SITES[demoKey].name +
    ' — DSWx-HLS monthly water area (km2)', lineWidth: 2,
    pointSize: 3}));

/* ============ 2. PER-PIXEL TREND MAPS ================================ */
// Monthly water-frequency collection with a fractional-year time band.
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];
  var months = cfg.monthList(cfg.HLS_PERIOD.start, cfg.HLS_PERIOD.end);
  var col = ee.ImageCollection(cfg.DATASETS.DSWX_HLS)
      .filterBounds(site.aoi)
      .filterDate(cfg.HLS_PERIOD.start, cfg.HLS_PERIOD.end)
      .map(cfg.hlsWaterValid);
  var monthly = ee.ImageCollection.fromImages(months.map(function (m) {
    m = ee.Date(m);
    var t = m.difference(ee.Date('2023-01-01'), 'year');
    return cfg.monthlyWaterComposite(col, m)
        .select('water_freq')
        .addBands(ee.Image.constant(t).float().rename('t'))
        .set('system:time_start', m.millis());
  }));

  // Sen's slope (robust, non-parametric) of water frequency per year.
  var sens = monthly.select(['t', 'water_freq'])
      .reduce(ee.Reducer.sensSlope());          // bands: slope, offset
  // Kendall's tau (direction/strength); significance testing offline.
  var tau = monthly.select(['t', 'water_freq'])
      .reduce(ee.Reducer.kendallsCorrelation()); // band: *_tau

  var trend = sens.select('slope').rename('sens_slope_per_yr')
      .addBands(tau.select(0).rename('kendall_tau'))
      .clip(site.aoi);

  Map.addLayer(trend.select('sens_slope_per_yr'),
      {min: -0.3, max: 0.3,
       palette: ['d73027', 'ffffbf', '1a9850']},
      site.name + ' | water_freq trend (yr-1)', false);

  Export.image.toDrive({
    image: trend.toFloat(),
    description: 'IMG05_waterfreq_trend_' + key,
    folder: cfg.EXPORT_FOLDER, region: site.aoi,
    scale: cfg.SCALE, maxPixels: 1e13
  });
});

/* ============ 3. CLIMATE DRIVERS ===================================== */
// CHIRPS: monthly precip totals; SPI-like z of 3-month rolling sums.
function chirpsMonthly(aoi, start, end) {
  var months = cfg.monthList(start, end);
  return ee.ImageCollection.fromImages(months.map(function (m) {
    m = ee.Date(m);
    return ee.ImageCollection(cfg.DATASETS.CHIRPS)
        .filterDate(m, m.advance(1, 'month'))
        .select('precipitation').sum()
        .set({'system:time_start': m.millis(),
              'month': m.get('month')});
  }));
}

var climRows = ee.FeatureCollection([]);
cfg.SITE_KEYS.forEach(function (key) {
  var site = cfg.SITES[key];

  // Baseline stats per calendar month (1991-2020) of 3-month sums.
  var base = chirpsMonthly(site.aoi,
      cfg.CLIMATE_BASELINE.start, cfg.CLIMATE_BASELINE.end);
  var study = chirpsMonthly(site.aoi, '2022-01-01',
      cfg.HLS_PERIOD.end);

  function roll3(col) {                    // 3-month rolling sums
    var list = col.toList(col.size());
    var n = list.size();
    return ee.ImageCollection(ee.List.sequence(2, n.subtract(1))
        .map(function (i) {
          i = ee.Number(i);
          var img = ee.Image(list.get(i));
          var sum3 = ee.Image(list.get(i)).add(
              ee.Image(list.get(i.subtract(1)))).add(
              ee.Image(list.get(i.subtract(2))));
          return sum3.copyProperties(img,
              ['system:time_start', 'month']);
        }));
  }
  var base3 = roll3(base);
  var study3 = roll3(study);

  var feats = ee.FeatureCollection(
    ee.List.sequence(1, 12).map(function (mm) {
      mm = ee.Number(mm);
      var bm = base3.filter(ee.Filter.eq('month', mm));
      var mu = bm.mean();
      var sd = bm.reduce(ee.Reducer.stdDev());
      return study3.filter(ee.Filter.eq('month', mm))
          .map(function (img) {
            var z = ee.Image(img).subtract(mu).divide(sd);
            var d = ee.Date(img.get('system:time_start'));
            var reduce = function (im) {
              return im.reduceRegion({
                reducer: ee.Reducer.mean(), geometry: site.aoi,
                scale: 5000, maxPixels: 1e13
              }).values().get(0);
            };
            return ee.Feature(null, {
              site: site.name, date: d.format('YYYY-MM'),
              precip3mo_mm: reduce(ee.Image(img)),
              spi3_z: reduce(z)
            });
          });
    })
  ).flatten();
  climRows = climRows.merge(feats);

  // ERA5-Land: 2 m temperature and total evaporation anomalies.
  var era5 = ee.ImageCollection(cfg.DATASETS.ERA5L_MON)
      .filterDate('2022-01-01', cfg.HLS_PERIOD.end)
      .select(['temperature_2m', 'total_evaporation_sum',
               'total_precipitation_sum']);
  var eraFeats = era5.map(function (img) {
    var d = ee.Date(img.get('system:time_start'));
    var vals = img.reduceRegion({
      reducer: ee.Reducer.mean(), geometry: site.aoi,
      scale: 11132, maxPixels: 1e13
    });
    return ee.Feature(null, {
      site: site.name, date: d.format('YYYY-MM'),
      t2m_K: vals.get('temperature_2m'),
      evap_m: vals.get('total_evaporation_sum'),
      precip_m: vals.get('total_precipitation_sum')
    });
  });
  climRows = climRows.merge(eraFeats);
});

Export.table.toDrive({
  collection: climRows, description: 'T07_climate_drivers',
  folder: cfg.EXPORT_FOLDER, fileFormat: 'CSV',
  selectors: ['site', 'date', 'precip3mo_mm', 'spi3_z',
              't2m_K', 'evap_m', 'precip_m']
});

Map.setCenter(33.0, 39.0, 6);