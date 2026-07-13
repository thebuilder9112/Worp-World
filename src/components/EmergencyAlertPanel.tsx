import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  MapPin, 
  Plus, 
  Radio, 
  Rss, 
  Send, 
  ShieldAlert, 
  Loader2,
  Trash2,
  Volume2,
  BrainCircuit,
  VolumeX,
  BellRing
} from 'lucide-react';
import { db } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  getDocs
} from 'firebase/firestore';
import { EmergencyAlert } from '../types';
import { generateSectorThreatAlert } from '../services/geminiService';
import { getHaversineDistance } from '../services/offlineMapService';
import { cn } from '../lib/utils';

interface EmergencyAlertPanelProps {
  user: any;
  currentLocation: [number, number] | null;
  targetCoords: [number, number] | null;
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  addNotification: (msg: string, type?: 'info' | 'success' | 'warning') => void;
  onFocusLocation: (lat: number, lng: number) => void;
  alerts: EmergencyAlert[];
}

interface SubscriptionZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export default function EmergencyAlertPanel({
  user,
  currentLocation,
  targetCoords,
  statusMessage,
  setStatusMessage,
  addNotification,
  onFocusLocation,
  alerts
}: EmergencyAlertPanelProps) {
  const [subZones, setSubZones] = useState<SubscriptionZone[]>([]);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneRadius, setNewZoneRadius] = useState<number>(10); // 10km default

  // Custom alert creator form states (Broadcast Simulation)
  const [customTitle, setCustomTitle] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [customSeverity, setCustomSeverity] = useState<'critical' | 'warning' | 'info'>('warning');
  const [customRadius, setCustomRadius] = useState<number>(5000); // 5km radius
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isScanningAI, setIsScanningAI] = useState(false);
  
  // Audio chime state
  const [isMuted, setIsMuted] = useState(false);

  // Load subscriptions from localstorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('alert-subscription-zones');
      if (stored) {
        setSubZones(JSON.parse(stored));
      } else if (currentLocation) {
        // Initial auto-subscription to current area
        const initial = [{
          id: `sub_${Date.now()}`,
          name: "Immediate Location Zone",
          lat: currentLocation[0],
          lng: currentLocation[1],
          radiusKm: 15
        }];
        setSubZones(initial);
        localStorage.setItem('alert-subscription-zones', JSON.stringify(initial));
      }
    } catch (e) {
      console.error(e);
    }
  }, [currentLocation]);

  // Audio frequency generator for tactical alerts (using Web Audio API)
  const playTacticalSiren = (severity: 'critical' | 'warning' | 'info') => {
    if (isMuted) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      if (severity === 'critical') {
        // Pulsing high-pitch warning siren
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.3);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.6);
        osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.9);
        
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
      } else if (severity === 'warning') {
        // Double electronic chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
        osc.start();
        
        // second chirp
        const osc2 = ctx.createOscillator();
        const gainNode2 = ctx.createGain();
        osc2.connect(gainNode2);
        gainNode2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
        gainNode2.gain.setValueAtTime(0.15, ctx.currentTime + 0.15);
        gainNode2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc2.start(ctx.currentTime + 0.15);
        osc2.stop(ctx.currentTime + 0.5);
        
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        // Soft confirmation chirp
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch (e) {
      console.warn("Audio Context blocked or failed:", e);
    }
  };

  // Listen for newly added critical/warning alerts within subscribed zones
  useEffect(() => {
    if (alerts.length === 0) return;
    
    const latestAlert = alerts[0];
    if (!latestAlert || !latestAlert.id) return;
    
    // Check if we already notified for this alert ID in this session
    const shownKey = `shown_alert_${latestAlert.id}`;
    if (sessionStorage.getItem(shownKey)) return;
    
    // Check if the alert overlaps with any of our subscribed zones OR current location
    let isRelevanceMatch = false;
    let matchingZoneName = "";

    // 1. Check current location
    if (currentLocation) {
      const dist = getHaversineDistance(
        currentLocation[0],
        currentLocation[1],
        latestAlert.zone.lat,
        latestAlert.zone.lng
      ) * 1000; // in meters
      
      if (dist <= latestAlert.zone.radius) {
        isRelevanceMatch = true;
        matchingZoneName = "My Direct Location";
      }
    }

    // 2. Check subscription zones
    if (!isRelevanceMatch) {
      for (const zone of subZones) {
        const dist = getHaversineDistance(
          zone.lat,
          zone.lng,
          latestAlert.zone.lat,
          latestAlert.zone.lng
        ); // in km
        
        const combinedRadiusKm = (zone.radiusKm) + (latestAlert.zone.radius / 1000);
        if (dist <= combinedRadiusKm) {
          isRelevanceMatch = true;
          matchingZoneName = zone.name;
          break;
        }
      }
    }

    if (isRelevanceMatch) {
      sessionStorage.setItem(shownKey, 'true');
      // Trigger siren sound!
      playTacticalSiren(latestAlert.severity);
      // Trigger notification banner
      addNotification(
        `[CRISIS ALERT] ${latestAlert.title} matched inside zone "${matchingZoneName}"!`,
        latestAlert.severity === 'critical' ? 'warning' : 'info'
      );
    }
  }, [alerts, subZones, currentLocation]);

  // Handle manual alert broadcast creation
  const handleManualBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      addNotification("Please authenticate to broadcast emergency alerts.", "warning");
      return;
    }
    if (!targetCoords) {
      addNotification("Define the alert coordinates by clicking on the map.", "warning");
      return;
    }
    if (!customTitle.trim() || !customMessage.trim()) return;

    setIsBroadcasting(true);
    setStatusMessage("BROADCASTING TACTICAL EMERGENCY ALERT...");

    try {
      const alertId = `alert_${Date.now()}`;
      const alertRef = doc(db, 'alerts', alertId);

      const alertPayload: EmergencyAlert = {
        title: customTitle.trim().toUpperCase(),
        message: customMessage.trim(),
        severity: customSeverity,
        zone: {
          lat: targetCoords[0],
          lng: targetCoords[1],
          radius: customRadius
        },
        timestamp: new Date().toISOString(),
        senderId: user.uid,
        senderName: user.displayName || user.email?.split('@')[0] || "CRISIS UNIT",
        active: true
      };

      await setDoc(alertRef, alertPayload);
      addNotification(`Crisis broadcast transmitted successfully! Alert ID: ${alertId}`, 'success');
      setCustomTitle('');
      setCustomMessage('');
      setStatusMessage("ALERT TRANSMITTED");
    } catch (err) {
      console.error(err);
      addNotification("Crisis alert broadcast failed.", "warning");
      setStatusMessage("TRANSMISSION ERROR");
    } finally {
      setIsBroadcasting(false);
    }
  };

  // AI threat intel scanner (uses Gemini API function generateSectorThreatAlert)
  const handleAIScanThreats = async () => {
    if (!user) {
      addNotification("Please authenticate to authorize the AI Threat Scanner.", "warning");
      return;
    }
    if (!targetCoords) {
      addNotification("First click the map to designate a scan sector.", "warning");
      return;
    }

    setIsScanningAI(true);
    setStatusMessage("SCANNING LOCAL SIGNALS VIA SAGITTARIUS AI...");

    try {
      const aiResponse = await generateSectorThreatAlert(targetCoords[0], targetCoords[1]);
      
      // Save AI generated warning directly to Firestore alerts collection to trigger real-time warning!
      const alertId = `ai_alert_${Date.now()}`;
      const alertRef = doc(db, 'alerts', alertId);

      const alertPayload: EmergencyAlert = {
        title: `[AI INTEL] ${aiResponse.title.toUpperCase()}`,
        message: aiResponse.message,
        severity: aiResponse.severity || 'warning',
        zone: {
          lat: targetCoords[0],
          lng: targetCoords[1],
          radius: 8000 // 8km default scanning envelope
        },
        timestamp: new Date().toISOString(),
        senderId: user.uid,
        senderName: "SAGITTARIUS THREAT ENGINE",
        active: true
      };

      await setDoc(alertRef, alertPayload);
      addNotification(`AI Intelligence alert compiled and broadcasted!`, 'success');
      setStatusMessage("AI SCAN BRIEFING COMPLETE");
    } catch (err) {
      console.error(err);
      addNotification("AI Threats scan failed.", "warning");
    } finally {
      setIsScanningAI(false);
    }
  };

  // Add subscription zone
  const handleAddSubZone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCoords) {
      addNotification("Click on the map to define the subscription zone center.", "warning");
      return;
    }
    const name = newZoneName.trim() || `Subscription Zone ${targetCoords[0].toFixed(2)}`;
    
    const newZone: SubscriptionZone = {
      id: `sub_${Date.now()}`,
      name,
      lat: targetCoords[0],
      lng: targetCoords[1],
      radiusKm: newZoneRadius
    };

    const updated = [...subZones, newZone];
    setSubZones(updated);
    localStorage.setItem('alert-subscription-zones', JSON.stringify(updated));
    addNotification(`Subscribed to crisis updates for: ${name}`, 'success');
    setNewZoneName('');
  };

  // Delete subscription zone
  const handleDeleteSubZone = (id: string, name: string) => {
    const updated = subZones.filter(z => z.id !== id);
    setSubZones(updated);
    localStorage.setItem('alert-subscription-zones', JSON.stringify(updated));
    addNotification(`Unsubscribed from: ${name}`, 'info');
  };

  return (
    <div className="flex flex-col gap-5 text-gray-100">
      
      {/* Sound Controls Header Card */}
      <div className="flex justify-between items-center bg-zinc-950/80 p-3.5 border border-zinc-800 rounded-xl">
        <div className="flex items-center gap-2">
          <BellRing className="w-4 h-4 text-red-400" />
          <span className="font-sans font-medium text-xs tracking-wider uppercase text-gray-200">Alert Center Controls</span>
        </div>
        <button
          onClick={() => setIsMuted(!isMuted)}
          className={cn(
            "p-1.5 rounded-lg border flex items-center gap-1.5 font-mono text-[10px] uppercase transition-all cursor-pointer",
            isMuted 
              ? "bg-red-500/10 text-red-400 border-red-500/30" 
              : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-800"
          )}
        >
          {isMuted ? (
            <>
              <VolumeX className="w-3.5 h-3.5" />
              Siren Muted
            </>
          ) : (
            <>
              <Volume2 className="w-3.5 h-3.5" />
              Siren On
            </>
          )}
        </button>
      </div>

      {/* Broadcast Alert Simulator - Only for Authenticated Users */}
      {user && (
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-3.5">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-500 animate-pulse" />
              <span className="font-sans font-medium text-sm text-gray-100">Crisis Broadcast Center</span>
            </div>
            <button
              onClick={handleAIScanThreats}
              disabled={isScanningAI || !targetCoords}
              className="flex items-center gap-1.5 py-1 px-2.5 bg-zinc-950 hover:bg-zinc-900 text-[10px] text-map-accent font-mono border border-map-accent/30 rounded-lg cursor-pointer disabled:opacity-50 transition-all"
            >
              {isScanningAI ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <BrainCircuit className="w-3 h-3" />
              )}
              AI Intel Scanner
            </button>
          </div>

          <form onSubmit={handleManualBroadcast} className="flex flex-col gap-3">
            {/* Target coord notification */}
            <div className="text-[10px] font-mono bg-zinc-950 border border-zinc-800 p-2 rounded flex justify-between items-center">
              <span className="text-zinc-500">TARGET ZONE:</span>
              <span className="text-red-400">
                {targetCoords 
                  ? `${targetCoords[0].toFixed(4)}°N, ${targetCoords[1].toFixed(4)}°E` 
                  : "CLICK MAP TO TARGET"}
              </span>
            </div>

            {/* Headline */}
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Alert Headline (e.g., SHELTER OPEN)"
              className="bg-zinc-950 border border-zinc-800 text-xs px-3.5 py-2 rounded-lg text-gray-200 placeholder-zinc-500 focus:outline-none focus:border-red-500/50"
              required
            />

            {/* Severity Level */}
            <div className="grid grid-cols-3 gap-2">
              {(['critical', 'warning', 'info'] as const).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setCustomSeverity(sev)}
                  className={cn(
                    "py-1.5 text-[10px] font-mono uppercase border rounded-lg transition-all cursor-pointer text-center",
                    customSeverity === sev
                      ? sev === 'critical' ? "bg-red-500/20 text-red-400 border-red-500/60" :
                        sev === 'warning' ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/60" :
                        "bg-blue-500/20 text-blue-400 border-blue-500/60"
                      : "bg-zinc-950/40 text-zinc-500 border-zinc-900"
                  )}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Message Body */}
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Warning instructions, safe paths, evacuation coordinates, etc."
              rows={2}
              className="bg-zinc-950 border border-zinc-800 text-xs px-3.5 py-2 rounded-lg text-gray-200 placeholder-zinc-500 focus:outline-none focus:border-red-500/50 resize-none"
              required
            />

            {/* Impact Envelope */}
            <div className="flex justify-between items-center bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg text-xs font-mono">
              <span className="text-zinc-500 uppercase text-[9px]">Impact Radius:</span>
              <select 
                value={customRadius} 
                onChange={(e) => setCustomRadius(parseInt(e.target.value))}
                className="bg-transparent text-gray-200 outline-none cursor-pointer border-none text-[11px]"
              >
                <option value={1000} className="bg-zinc-950 text-gray-200">1 km</option>
                <option value={3000} className="bg-zinc-950 text-gray-200">3 km</option>
                <option value={5000} className="bg-zinc-950 text-gray-200">5 km</option>
                <option value={10000} className="bg-zinc-950 text-gray-200">10 km</option>
                <option value={20000} className="bg-zinc-950 text-gray-200">20 km</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isBroadcasting || !targetCoords}
              className="bg-red-500/20 border border-red-500/50 hover:bg-red-500/30 text-red-400 font-mono font-bold uppercase tracking-wider text-xs py-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isBroadcasting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              TRANSMIT BROADCAST
            </button>
          </form>
        </div>
      )}

      {/* Subscription zone list */}
      <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Rss className="w-4 h-4 text-map-accent" />
          <span className="font-sans font-medium text-sm text-gray-100">Alert Guard Zones</span>
        </div>

        <form onSubmit={handleAddSubZone} className="flex gap-2">
          <input
            type="text"
            value={newZoneName}
            onChange={(e) => setNewZoneName(e.target.value)}
            placeholder="Subscribe new zone (e.g. Home)..."
            className="flex-1 bg-zinc-950 border border-zinc-800 text-xs px-3.5 py-2 rounded-lg text-gray-200 placeholder-zinc-500 focus:outline-none focus:border-map-accent/50"
          />
          <button
            type="submit"
            disabled={!targetCoords}
            className="bg-zinc-800 hover:bg-zinc-700 text-map-accent border border-zinc-700 font-mono text-[10px] font-bold px-3 py-2 rounded-lg disabled:opacity-40 cursor-pointer"
          >
            ADD
          </button>
        </form>

        <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
          {subZones.length === 0 ? (
            <div className="text-center py-4 text-xs text-zinc-500 border border-dashed border-zinc-800 rounded">
              No alert guard zones. Map click to center.
            </div>
          ) : (
            subZones.map((z) => (
              <div key={z.id} className="flex justify-between items-center bg-zinc-950/40 p-2.5 border border-zinc-800/80 rounded-lg">
                <div>
                  <div className="text-xs font-medium text-zinc-200">{z.name}</div>
                  <div className="text-[9px] font-mono text-zinc-500 uppercase mt-0.5">
                    RADIUS: {z.radiusKm}KM • COORDS: {z.lat.toFixed(2)}, {z.lng.toFixed(2)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => onFocusLocation(z.lat, z.lng)}
                    className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-[9px] text-map-accent border border-zinc-800 font-mono rounded"
                  >
                    FOCUS
                  </button>
                  <button
                    onClick={() => handleDeleteSubZone(z.id, z.name)}
                    className="p-1.5 bg-zinc-900 hover:bg-red-950/40 text-zinc-500 hover:text-red-400 border border-zinc-800/80 hover:border-red-900/40 rounded"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Danger Broadcast Feed */}
      <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-500" />
          <span className="font-sans font-medium text-sm text-gray-100 font-semibold">Active Crisis Broadcasts</span>
        </div>

        <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1">
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              No active alerts reported. The operations theatre is quiet.
            </div>
          ) : (
            alerts.map((a) => (
              <div 
                key={a.id}
                className={cn(
                  "p-3 rounded-xl border flex flex-col gap-2 transition-all cursor-pointer hover:bg-zinc-950/30",
                  a.severity === 'critical' ? "bg-red-950/10 border-red-900/40 text-red-100" :
                  a.severity === 'warning' ? "bg-yellow-950/10 border-yellow-900/40 text-yellow-100" :
                  "bg-blue-950/10 border-blue-900/40 text-blue-100"
                )}
                onClick={() => onFocusLocation(a.zone.lat, a.zone.lng)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      a.severity === 'critical' ? "bg-red-500 animate-pulse" :
                      a.severity === 'warning' ? "bg-yellow-400" : "bg-blue-400"
                    )} />
                    <span className="font-sans font-bold text-xs tracking-wide uppercase">
                      {a.title}
                    </span>
                  </div>
                  <span className="font-mono text-[8px] text-zinc-500 uppercase">
                    {new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <p className="text-xs font-sans text-zinc-300 leading-relaxed">
                  {a.message}
                </p>

                <div className="flex justify-between items-center text-[9px] font-mono text-zinc-500 pt-1.5 border-t border-zinc-800/50 mt-1 uppercase">
                  <span>SENDER: {a.senderName || "CRISIS BRIEFING"}</span>
                  <span>ENVELOPE: {(a.zone.radius / 1000).toFixed(1)}km</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
