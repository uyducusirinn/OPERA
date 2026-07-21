/**** =====================================================================
 * 09_figure_rasters.js  (STANDALONE — yapıştır, Run, sonra Tasks'tan
 * her görevi elle başlat!)
 * ---------------------------------------------------------------------
 * Üretilenler (Drive > OPERA_TR_exports):
 *  A) IMG05_waterfreq_trend_<site>.tif  -> Şekil 7 (4 alan)
 *     bantlar: sens_slope_per_yr, kendall_tau
 *  B) IMG10a_iv_frequency_kizilirmak.tif -> Şekil 10a
 *     bant: inundated_veg_freq
 *  C) IMG10a_wetland_mask_kizilirmak.tif -> Şekil 10a üzerine kontur
 *     bant: wetland (WorldCover sınıf 90, 1/0)
 * ===================================================================== */
var SITES = {
  burdur: ee.Geometry.Rectangle([29.93, 37.55, 30.36, 37.92]),
  tuz: ee.Geometry.Rectangle([32.95, 38.35, 33.85, 39.20]),
  kizilirmak: ee.Geometry.Rectangle([35.75, 41.48, 36.40, 41.78]),
  ataturk: ee.Geometry.Rectangle([38.20, 37.45, 39.05, 38.30])
};
var HLS_PERIOD = {start: '2023-04-04', end: '2026-06-30'};
var COMMON_PERIOD = {start: '2024-09-01', end: '2026-06-30'};
var FOLDER = 'OPERA_TR_exports';
var SCALE = 30;

function hlsWaterValid(img) {
  var wtr = img.select('WTR_Water_classification');
  var valid = wtr.eq(0).or(wtr.eq(1)).or(wtr.eq(2));
  var water = wtr.eq(1).or(wtr.eq(2));
  return img.addBands(water.rename('water').toByte())
            .addBands(valid.rename('valid').toByte());
}
function monthList(start, end) {
  var s = ee.Date(start); var e = ee.Date(end);
  var n = e.difference(s, 'month').floor();
  return ee.List.sequence(0, n.subtract(1))
      .map(function (m) { return s.advance(m, 'month'); });
}
function monthlyFreq(col, m) {
  m = ee.Date(m);
  var sub = col.filterDate(m, m.advance(1, 'month'));
  var nValid = sub.select('valid').sum();
  var freq = sub.select('water').sum().divide(nValid)
      .rename('water_freq').updateMask(nValid.gte(1));
  return freq.set('system:time_start', m.millis());
}

/* ========== A) Şekil 7: su frekansı Sen eğimi + Kendall tau ========= */
Object.keys(SITES).forEach(function (key) {
  var aoi = SITES[key];
  var months = monthList(HLS_PERIOD.start, HLS_PERIOD.end);
  var col = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
      .filterBounds(aoi).filterDate(HLS_PERIOD.start, HLS_PERIOD.end)
      .map(hlsWaterValid);
  var monthly = ee.ImageCollection.fromImages(months.map(function (m) {
    m = ee.Date(m);
    var t = m.difference(ee.Date('2023-01-01'), 'year');
    return monthlyFreq(col, m)
        .addBands(ee.Image.constant(t).float().rename('t'))
        .set('system:time_start', m.millis());
  }));
  var sens = monthly.select(['t', 'water_freq'])
      .reduce(ee.Reducer.sensSlope());
  var tau = monthly.select(['t', 'water_freq'])
      .reduce(ee.Reducer.kendallsCorrelation());
  var trend = sens.select('slope').rename('sens_slope_per_yr')
      .addBands(tau.select(0).rename('kendall_tau')).clip(aoi);
  Export.image.toDrive({
    image: trend.toFloat(),
    description: 'IMG05_waterfreq_trend_' + key,
    folder: FOLDER, region: aoi, scale: SCALE, maxPixels: 1e13
  });
});

/* ========== B) Şekil 10a: Kızılırmak IV frekansı ==================== */
var delta = SITES.kizilirmak;
var ivCol = ee.ImageCollection('OPERA/DSWX/L3_V1/S1')
    .filterBounds(delta)
    .filterDate(COMMON_PERIOD.start, COMMON_PERIOD.end)
    .map(function (img) {
      var wtr = img.select('WTR_Water_classification');
      var valid = wtr.eq(0).or(wtr.eq(1)).or(wtr.eq(3));
      return wtr.eq(3).rename('iv').toByte()
          .addBands(valid.rename('valid').toByte());
    });
var ivFreq = ivCol.select('iv').sum()
    .divide(ivCol.select('valid').sum())
    .rename('inundated_veg_freq').clip(delta);
Export.image.toDrive({
  image: ivFreq.toFloat(),
  description: 'IMG10a_iv_frequency_kizilirmak',
  folder: FOLDER, region: delta, scale: SCALE, maxPixels: 1e13
});

/* ========== C) Şekil 10a konturu: WorldCover sazlık maskesi ========= */
var wetland = ee.ImageCollection('ESA/WorldCover/v200').first()
    .select('Map').eq(90).rename('wetland').clip(delta);
Export.image.toDrive({
  image: wetland.toByte(),
  description: 'IMG10a_wetland_mask_kizilirmak',
  folder: FOLDER, region: delta, scale: SCALE, maxPixels: 1e13
});

print('6 export görevi oluşturuldu (4 trend + IV frekansı + sazlık maskesi). TASKS sekmesini açıp her birinde RUN’a basın!');
Map.centerObject(delta, 11);
Map.addLayer(ivFreq, {min: 0, max: 0.6,
    palette: ['ffffff', '99d8c9', '2ca25f', '00441b']}, 'IV frequency');