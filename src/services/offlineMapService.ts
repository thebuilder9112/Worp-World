import { Location } from '../types';

// Converts latitude and longitude to OpenStreetMap tile coordinates (X, Y) at a given Zoom level
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

// Bounding box coordinates from center and radius
export function getBoundingBox(lat: number, lng: number, radiusKm: number) {
  const R = 6371; // Earth's radius in km
  const latDelta = (radiusKm / R) * (180 / Math.PI);
  const lngDelta = ((radiusKm / R) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180);
  
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export interface DownloadProgress {
  total: number;
  completed: number;
  percentage: number;
  currentUrl?: string;
}

const CACHE_NAME = 'offline-map-tiles';

// Download tiles for a specific region and zoom levels (e.g., 10 to 14)
export async function downloadRegionTiles(
  name: string,
  lat: number,
  lng: number,
  radiusKm: number,
  onProgress: (progress: DownloadProgress) => void
): Promise<number> {
  const bbox = getBoundingBox(lat, lng, radiusKm);
  const zoomLevels = [11, 12, 13, 14]; // Useful zoom levels for offline tactical navigation
  const tileUrls: string[] = [];

  for (const z of zoomLevels) {
    const tileMin = latLngToTile(bbox.maxLat, bbox.minLng, z); // lat max is top/left, lng min is left
    const tileMax = latLngToTile(bbox.minLat, bbox.maxLng, z); // lat min is bottom/right, lng max is right

    // Ensure coordinates are ordered correctly
    const minX = Math.min(tileMin.x, tileMax.x);
    const maxX = Math.max(tileMin.x, tileMax.x);
    const minY = Math.min(tileMin.y, tileMax.y);
    const maxY = Math.max(tileMin.y, tileMax.y);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tileUrls.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
      }
    }
  }

  // To prevent crashing or massive downloads, limit total tiles
  const MAX_TILES = 150;
  const originalCount = tileUrls.length;
  if (tileUrls.length > MAX_TILES) {
    // Subsample or clip to keep within limit
    tileUrls.splice(MAX_TILES);
  }

  const cache = await caches.open(CACHE_NAME);
  let completed = 0;

  for (const url of tileUrls) {
    try {
      // Check if tile is already cached
      const matched = await cache.match(url);
      if (!matched) {
        // Fetch and put in cache
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
        }
      }
      completed++;
      onProgress({
        total: tileUrls.length,
        completed,
        percentage: Math.round((completed / tileUrls.length) * 100),
        currentUrl: url,
      });
    } catch (e) {
      console.warn('Failed to download tile:', url, e);
      completed++; // Continue progress
    }
  }

  return tileUrls.length;
}

// Check if a tile URL exists in our offline cache
export async function getCachedTile(url: string): Promise<Blob | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const matched = await cache.match(url);
    if (matched) {
      return await matched.blob();
    }
  } catch (error) {
    console.error('Error fetching cached tile:', error);
  }
  return null;
}

// Clear offline map cache
export async function clearOfflineTiles(): Promise<boolean> {
  return await caches.delete(CACHE_NAME);
}

// --- Offline Route Caching & Routing Utilities ---

export interface SavedRoute {
  id: string;
  startName: string;
  endName: string;
  startCoords: Location;
  endCoords: Location;
  path: Location[];
  distanceKm: number;
  durationMin: number;
}

const STORAGE_KEY_ROUTES = 'offline-saved-routes';

export function saveRouteOffline(route: SavedRoute) {
  try {
    const existing = getOfflineSavedRoutes();
    // Prevent duplicate IDs
    const filtered = existing.filter(r => r.id !== route.id);
    filtered.push(route);
    localStorage.setItem(STORAGE_KEY_ROUTES, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error saving route offline:', error);
  }
}

export function getOfflineSavedRoutes(): SavedRoute[] {
  try {
    const routesStr = localStorage.getItem(STORAGE_KEY_ROUTES);
    return routesStr ? JSON.parse(routesStr) : [];
  } catch (error) {
    console.error('Error loading saved routes:', error);
    return [];
  }
}

// Simple direct point-to-point router that projects a straight line or bypasses threat/hazard spheres
export function calculateFallbackOfflineRoute(
  start: Location,
  end: Location,
  hazards: { lat: number; lng: number; radiusMeters: number }[] = []
): Location[] {
  const points: Location[] = [];
  const steps = 15; // Number of intermediate points for smooth rendering and hazard check
  
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    let lat = start.lat + (end.lat - start.lat) * fraction;
    let lng = start.lng + (end.lng - start.lng) * fraction;
    
    // Check if this interpolated point hits a hazard.
    // If yes, apply a visual "bending" factor to route around the hazard zone!
    for (const hazard of hazards) {
      const dist = getHaversineDistance(lat, lng, hazard.lat, hazard.lng) * 1000; // in meters
      if (dist < hazard.radiusMeters) {
        // Bend point away from hazard center (pushing outwards by hazard radius + padding)
        const pushFactor = (hazard.radiusMeters + 150) / 111300; // rough deg to meters conversion
        const angle = Math.atan2(lat - hazard.lat, lng - hazard.lng) + Math.PI / 4; // Bending angle
        lat += Math.sin(angle) * pushFactor * (1 - dist / hazard.radiusMeters);
        lng += Math.cos(angle) * pushFactor * (1 - dist / hazard.radiusMeters);
      }
    }
    
    points.push({ lat, lng });
  }
  
  return points;
}

// Standard Haversine distance calculator in km
export function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
