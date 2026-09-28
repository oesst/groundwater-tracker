// Helpers for the two service types most German portals expose, so a new state
// adapter is a few lines once you know its endpoint + field names.
import { getJSON } from './http.js';

// OGC WFS 2.0 GetFeature as GeoJSON.
export async function wfsGeoJSON(base, typeName, { count = 5000, extra = {} } = {}) {
  const p = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: typeName, outputFormat: 'application/json', srsName: 'EPSG:4326',
    count: String(count), ...extra,
  });
  return getJSON(`${base}?${p.toString()}`);
}

// Esri ArcGIS FeatureServer/MapServer layer query as GeoJSON (WGS84).
export async function arcgisQuery(layerUrl, { where = '1=1', outFields = '*', extra = {} } = {}) {
  const p = new URLSearchParams({
    where, outFields, outSR: '4326', returnGeometry: 'true', f: 'geojson', ...extra,
  });
  return getJSON(`${layerUrl}/query?${p.toString()}`);
}

// GeoJSON FeatureCollection -> raw stations via a field-mapping function.
// map(props, coords) must return { id, name, state, lat, lon, nhn?, flur?, measured_at? }.
export function featuresToStations(fc, map) {
  return (fc.features || [])
    .filter((f) => f.geometry && f.geometry.type === 'Point')
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return map(f.properties || {}, { lat, lon });
    })
    .filter(Boolean);
}
