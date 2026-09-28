// Build the full Bavaria station master (all ~620 wells) with exact coordinates
// from the LfU INSPIRE download service, instead of the town-level seed coords.
//
//   node scripts/build-stations-by.js
//
// LfU publishes station locations via the "Landesmessnetze Grundwasser und
// Quellen" download service (WMS/WFS/ATOM):
//   https://www.lfu.bayern.de/gdi/dls/landesmessnetze.xml   (ATOM feed)
//   https://www.lfu.bayern.de/gdi/wms/wasser/landesmessnetze?  (WMS)
//
// The download service exposes the well locations (id, name, coordinates in
// ETRS89/UTM32 -> reproject to WGS84). Map each well's id/name to its gkd.bayern.de
// page path. Then write data/by.stations.json in the same shape as the seed.
//
// Left as a template because the ATOM payload is a shapefile (needs a shp reader)
// and the id<->page-path mapping is LfU-specific; wire it to your preferred
// GIS tooling. The seed file already lets the pipeline run in the meantime.

console.log('Template — see header. Produces data/by.stations.json with exact coords.');
