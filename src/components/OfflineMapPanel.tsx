import React, { useState, useEffect } from 'react';
import { 
  Download, 
  MapPin, 
  Loader2, 
  Trash2, 
  Check, 
  Radio, 
  Database, 
  Wifi, 
  WifiOff, 
  ArrowRight,
  Info
} from 'lucide-react';
import { db } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot 
} from 'firebase/firestore';
import { 
  downloadRegionTiles, 
  clearOfflineTiles, 
  getOfflineSavedRoutes,
  SavedRoute 
} from '../services/offlineMapService';
import { OfflineRegion } from '../types';
import { cn } from '../lib/utils';

interface OfflineMapPanelProps {
  user: any;
  targetCoords: [number, number] | null;
  isOfflineMode: boolean;
  setIsOfflineMode: (offline: boolean) => void;
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  addNotification: (msg: string, type?: 'info' | 'success' | 'warning') => void;
  onFocusLocation: (lat: number, lng: number) => void;
}

export default function OfflineMapPanel({
  user,
  targetCoords,
  isOfflineMode,
  setIsOfflineMode,
  statusMessage,
  setStatusMessage,
  addNotification,
  onFocusLocation
}: OfflineMapPanelProps) {
  const [radius, setRadius] = useState<number>(5); // Default 5km radius
  const [regionName, setRegionName] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ total: 0, completed: 0, percentage: 0 });
  const [savedRegions, setSavedRegions] = useState<OfflineRegion[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<any[]>([]);

  // Fetch pre-downloaded regions from Firestore or local storage
  useEffect(() => {
    if (user) {
      const q = collection(db, `users/${user.uid}/offline_regions`);
      const unsubscribe = onSnapshot(q, (snap) => {
        const list: OfflineRegion[] = [];
        snap.forEach(doc => {
          list.push({ ...doc.data(), id: doc.id } as OfflineRegion);
        });
        setSavedRegions(list);
      });
      return unsubscribe;
    } else {
      // Local storage fallback for anonymous sessions
      try {
        const local = localStorage.getItem('offline-regions-meta');
        if (local) setSavedRegions(JSON.parse(local));
      } catch (e) {
        console.error(e);
      }
    }
  }, [user]);

  // Load saved routes
  useEffect(() => {
    setSavedRoutes(getOfflineSavedRoutes());
  }, [isOfflineMode]);

  // Handle Download Map
  const handleDownload = async () => {
    if (!targetCoords) {
      addNotification("Please click on the map to define the region center first.", "warning");
      return;
    }
    const name = regionName.trim() || `Tactical Sector ${targetCoords[0].toFixed(2)}, ${targetCoords[1].toFixed(2)}`;
    
    setIsDownloading(true);
    setDownloadProgress({ total: 0, completed: 0, percentage: 0 });
    setStatusMessage("INITIALIZING REGIONAL MAP DOWNLOAD...");

    try {
      const totalTiles = await downloadRegionTiles(
        name,
        targetCoords[0],
        targetCoords[1],
        radius,
        (progress) => {
          setDownloadProgress({
            total: progress.total,
            completed: progress.completed,
            percentage: progress.percentage
          });
          setStatusMessage(`CACHING TILES: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
        }
      );

      // Save metadata
      const newRegion: OfflineRegion = {
        name,
        lat: targetCoords[0],
        lng: targetCoords[1],
        radius,
        tileCount: totalTiles,
        downloadedAt: new Date().toISOString()
      };

      if (user) {
        const regionDocId = `region_${Date.now()}`;
        await setDoc(doc(db, `users/${user.uid}/offline_regions`, regionDocId), newRegion);
      } else {
        const updated = [...savedRegions, { ...newRegion, id: `local_${Date.now()}` }];
        setSavedRegions(updated);
        localStorage.setItem('offline-regions-meta', JSON.stringify(updated));
      }

      addNotification(`Map pre-cached successfully: ${totalTiles} tiles of ${name} saved.`, 'success');
      setRegionName('');
      setStatusMessage("OFFLINE REGIONAL MAP CACHED");
    } catch (error) {
      console.error("Error downloading region:", error);
      addNotification("Map download failed. Network error or limit exceeded.", "warning");
      setStatusMessage("DOWNLOAD FAILURE");
    } finally {
      setIsDownloading(false);
    }
  };

  // Delete an offline region
  const handleDeleteRegion = async (regionId: string, name: string) => {
    try {
      if (user) {
        await deleteDoc(doc(db, `users/${user.uid}/offline_regions`, regionId));
      } else {
        const updated = savedRegions.filter(r => r.id !== regionId);
        setSavedRegions(updated);
        localStorage.setItem('offline-regions-meta', JSON.stringify(updated));
      }
      addNotification(`Deleted offline cache metadata for ${name}`, 'info');
    } catch (e) {
      console.error(e);
    }
  };

  // Purge the tile cache entirely
  const handlePurgeCache = async () => {
    if (confirm("Are you sure you want to delete all pre-downloaded map tiles? This cannot be undone.")) {
      const success = await clearOfflineTiles();
      if (success) {
        // Clear metadata
        if (user) {
          for (const region of savedRegions) {
            if (region.id) await deleteDoc(doc(db, `users/${user.uid}/offline_regions`, region.id));
          }
        } else {
          setSavedRegions([]);
          localStorage.removeItem('offline-regions-meta');
        }
        addNotification("All offline tiles and regions purged successfully.", "success");
      } else {
        addNotification("Purging tiles failed.", "warning");
      }
    }
  };

  return (
    <div className="flex flex-col gap-5 text-gray-100">
      
      {/* Offline state indicator & Toggle */}
      <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            {isOfflineMode ? (
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-400">
                <WifiOff className="w-4 h-4 animate-pulse" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                <Wifi className="w-4 h-4" />
              </div>
            )}
            <div>
              <div className="font-sans font-medium text-sm text-gray-100">Operation Mode</div>
              <div className="font-mono text-[10px] text-zinc-400">
                {isOfflineMode ? "DISCONNECTED / SECURE MODE" : "ONLINE / INTEGRATED"}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              const nextState = !isOfflineMode;
              setIsOfflineMode(nextState);
              addNotification(
                nextState 
                  ? "Operation secure. Switched to offline tile rendering." 
                  : "Switched to online mode.", 
                nextState ? 'warning' : 'success'
              );
            }}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider border transition-all cursor-pointer",
              isOfflineMode 
                ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/50" 
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"
            )}
          >
            {isOfflineMode ? "Go Online" : "Go Offline"}
          </button>
        </div>

        {isOfflineMode && (
          <div className="bg-red-500/5 border border-red-950/40 p-2.5 rounded-lg flex items-start gap-2.5">
            <Info className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] font-sans text-zinc-400 leading-normal">
              Map and route rendering are currently utilizing offline-cached tiles. Safe route planning will bypass hazard zones locally.
            </p>
          </div>
        )}
      </div>

      {/* Pre-download tool */}
      {!isOfflineMode && (
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-map-accent" />
            <span className="font-sans font-medium text-sm text-gray-100">Download Sector Map</span>
          </div>

          <div className="flex flex-col gap-3">
            {/* Center target indicator */}
            <div className="flex justify-between items-center text-xs font-mono bg-zinc-950/80 p-2.5 border border-zinc-800/80 rounded-lg">
              <span className="text-zinc-500 uppercase tracking-wider">Sector Center:</span>
              <span className="text-map-accent">
                {targetCoords 
                  ? `${targetCoords[0].toFixed(4)}°N, ${targetCoords[1].toFixed(4)}°E` 
                  : "CLICK MAP TO TARGET"}
              </span>
            </div>

            {/* Region Name */}
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">Sector Label</label>
              <input
                type="text"
                value={regionName}
                onChange={(e) => setRegionName(e.target.value)}
                placeholder="e.g. Kyiv Safe Zone..."
                className="bg-zinc-950/80 border border-zinc-800 text-xs px-3.5 py-2 rounded-lg text-gray-200 placeholder-zinc-500 focus:outline-none focus:border-map-accent/50"
              />
            </div>

            {/* Radius select */}
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">Radius Scope</label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 5, 10, 25].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRadius(r)}
                    className={cn(
                      "py-1.5 text-xs font-mono border rounded-lg transition-all cursor-pointer",
                      radius === r
                        ? "bg-zinc-800 text-map-accent border-map-accent"
                        : "bg-zinc-950/50 text-zinc-500 border-zinc-800/80 hover:border-zinc-700"
                    )}
                  >
                    {r} km
                  </button>
                ))}
              </div>
            </div>

            {/* Download Progress Bar */}
            {isDownloading && (
              <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg flex flex-col gap-2">
                <div className="flex justify-between font-mono text-[10px] text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin text-map-accent" />
                    CACHING TILES...
                  </span>
                  <span>{downloadProgress.percentage}%</span>
                </div>
                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-map-accent h-1.5 rounded-full transition-all duration-300" 
                    style={{ width: `${downloadProgress.percentage}%` }}
                  />
                </div>
                <div className="font-mono text-[9px] text-zinc-500 text-right">
                  {downloadProgress.completed} of {downloadProgress.total} Tiles
                </div>
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={isDownloading || !targetCoords}
              className="w-full bg-map-accent text-black font-mono font-bold uppercase tracking-wider text-xs py-2.5 rounded-lg hover:bg-opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  PREPARING REGION ({downloadProgress.percentage}%)
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Download Sector Tiles
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Saved sectors list */}
      <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-map-accent" />
            <span className="font-sans font-medium text-sm text-gray-100">Offline Cache Library</span>
          </div>
          {savedRegions.length > 0 && (
            <button
              onClick={handlePurgeCache}
              className="text-[10px] font-mono text-red-400 hover:text-red-300 transition-all cursor-pointer flex items-center gap-1 uppercase"
              title="Purge completely"
            >
              <Trash2 className="w-3 h-3" />
              Purge All
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
          {savedRegions.length === 0 ? (
            <div className="text-center py-6 text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              No offline sectors stored in your database.
            </div>
          ) : (
            savedRegions.map((r) => (
              <div 
                key={r.id}
                className="bg-zinc-950/40 hover:bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg flex justify-between items-center transition-all group"
              >
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-200 truncate pr-2">{r.name}</div>
                  <div className="flex gap-2 text-[9px] font-mono text-zinc-500 uppercase">
                    <span>Radius: {r.radius}km</span>
                    <span>•</span>
                    <span>Tiles: {r.tileCount}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => onFocusLocation(r.lat, r.lng)}
                    className="p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-800/80 text-map-accent cursor-pointer text-[10px] font-mono"
                  >
                    FOCUS
                  </button>
                  <button
                    onClick={() => handleDeleteRegion(r.id!, r.name)}
                    className="p-1.5 bg-zinc-900 hover:bg-red-950/40 text-zinc-500 hover:text-red-400 border border-zinc-800/80 hover:border-red-900/40 rounded cursor-pointer"
                    title="Remove index"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
