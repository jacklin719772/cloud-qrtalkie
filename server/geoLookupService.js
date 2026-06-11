import { open } from "maxmind";
import fs from "node:fs";
import path from "node:path";

let reader = null;

function getDbPath() {
  return process.env.GEOIP_DATABASE_PATH || path.join(process.cwd(), "GeoLite2-City.mmdb");
}

export async function initGeoLookup() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.warn(`GeoIP database not found at ${dbPath}, geo lookup disabled`);
    return false;
  }
  try {
    reader = await open(dbPath);
    const meta = reader.metadata;
    console.log(`GeoIP database loaded (${meta.databaseType}, build ${meta.buildEpoch})`);
    return true;
  } catch (error) {
    console.error(`Failed to load GeoIP database: ${error.message}`);
    reader = null;
    return false;
  }
}

export function lookupGeo(ip) {
  if (!reader) return null;
  try {
    const result = reader.get(ip);
    if (!result) return null;
    const country = result.country?.names?.en || null;
    const city = result.city?.names?.en || null;
    const subdivision = result.subdivisions?.[0]?.names?.en || null;
    return {
      country: country || null,
      countryCode: result.country?.iso_code || null,
      city: city || null,
      subdivision: subdivision || null,
      latitude: result.location?.latitude ?? null,
      longitude: result.location?.longitude ?? null,
      timezone: result.location?.time_zone || null,
    };
  } catch {
    return null;
  }
}

const IPV4_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-f:]+$/i;

export function extractIpFromContactUri(contactUri) {
  const match = String(contactUri || "").match(/^sip:[^@]+@([^:;]+)/);
  if (!match) return null;
  const host = match[1];
  if (IPV4_REGEX.test(host) || IPV6_REGEX.test(host)) return host;
  return null;
}
