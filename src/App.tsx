import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Search, 
  Map as MapIcon, 
  Globe, 
  Navigation, 
  Layers, 
  History, 
  Settings, 
  User, 
  LogOut, 
  Shield, 
  Clock, 
  ChevronRight, 
  X, 
  Copy, 
  Menu,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Zap,
  Target,
  Activity,
  Share2,
  MessageSquare,
  Send,
  Loader2,
  Info,
  MapPin,
  Route,
  Compass,
  Wind,
  Cloud,
  Thermometer,
  AlertTriangle,
  ArrowRight,
  Plus,
  Minus,
  RotateCw,
  Trash2,
  Check,
  ExternalLink,
  Star,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  APIProvider, 
  Map, 
  AdvancedMarker, 
  Pin, 
  InfoWindow,
  useMap,
  useMapsLibrary,
  ControlPosition,
  MapControl,
  useApiLoadingStatus,
  APILoadingStatus
} from '@vis.gl/react-google-maps';
import GlobeComponent from 'react-globe.gl';
import * as THREE from 'three';
import ReactMarkdown from 'react-markdown';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
  where
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { cn } from './lib/utils';
import { analyzeTerrain, getLiveIntel, describeRoute, chatWithAI, getPlaceInfo } from './services/geminiService';

// --- Constants & Types ---
import { 
  MapContainer, 
  TileLayer, 
  Marker, 
  Popup, 
  useMap as useLeafletMap,
  useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icon issue
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const GOOGLE_MAPS_API_KEY = 
  import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY || 
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 
  import.meta.env.VITE_GOOGLE_MAPS_KEY || 
  import.meta.env.VITE_MAPS_API_KEY || 
  '';

const USE_FREE_MAP_INITIAL = !GOOGLE_MAPS_API_KEY;
const MAP_ID = ''; 

interface Location {
  lat: number;
  lng: number;
}

interface HistoryItem {
  id?: string;
  location: Location;
  timestamp: any;
}

interface SharePoint {
  userId: string;
  userName: string;
  userPhoto: string;
  data: Location;
  timestamp: any;
  type: 'live' | 'static';
}

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

// --- GlobeView Component ---
// --- Components ---

const TacticalAutocomplete = ({ 
  onPlaceSelect, 
  placeholder = "SEARCH TACTICAL DATA...",
  className = "w-48 md:w-80",
  icon = <Search size={16} />,
  value = "",
  onChange,
  onSearchClick,
  onSearchSubmit
}: { 
  onPlaceSelect: (place: any) => void,
  placeholder?: string,
  className?: string,
  icon?: React.ReactNode,
  value?: string,
  onChange?: (val: string) => void,
  onSearchClick?: () => void,
  onSearchSubmit?: (query: string) => void
}) => {
  const [inputValue, setInputValue] = useState(value);
  const [options, setOptions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const placesLibrary = useMapsLibrary('places');
  const [autocompleteService, setAutocompleteService] = useState<google.maps.places.AutocompleteService | null>(null);
  const [placesService, setPlacesService] = useState<google.maps.places.PlacesService | null>(null);

  useEffect(() => {
    if (placesLibrary) {
      setAutocompleteService(new placesLibrary.AutocompleteService());
      // PlacesService needs a div or map instance, we can use a dummy div
      const dummy = document.createElement('div');
      setPlacesService(new placesLibrary.PlacesService(dummy));
    }
  }, [placesLibrary]);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const searchPlaces = async (query: string) => {
    if (!query || query.length < 2) {
      setOptions([]);
      return;
    }
    setIsLoading(true);

    // Try Google Places first if available
    if (autocompleteService && placesService) {
      autocompleteService.getPlacePredictions({ input: query }, (predictions, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
          setOptions(predictions.map(p => ({
            display_name: p.description,
            place_id: p.place_id,
            isGoogle: true
          })));
          setIsLoading(false);
        } else {
          // Fallback to Nominatim if Google fails or returns nothing
          searchNominatim(query);
        }
      });
      return;
    }

    // Default to Nominatim
    searchNominatim(query);
  };

  const searchNominatim = async (query: string) => {
    try {
      console.log(`Searching Nominatim for: ${query}`);
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      console.log(`Nominatim results:`, data);
      setOptions(data.map((item: any) => ({ ...item, isGoogle: false })));
    } catch (error) {
      console.error("Nominatim search failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputValue.length >= 2) searchPlaces(inputValue);
    }, 500);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const handleSelect = (item: any) => {
    if (item.isGoogle && placesService) {
      setIsLoading(true);
      placesService.getDetails({ placeId: item.place_id }, (place, status) => {
        setIsLoading(false);
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          onPlaceSelect(place);
          setInputValue(place.name || item.display_name);
          if (onChange) onChange(place.name || item.display_name);
          setOptions([]);
        }
      });
      return;
    }

    const place = {
      name: item.display_name,
      geometry: {
        location: {
          lat: () => parseFloat(item.lat),
          lng: () => parseFloat(item.lon)
        }
      },
      formatted_address: item.display_name,
      address_components: item.address
    };
    onPlaceSelect(place);
    setInputValue(item.display_name);
    if (onChange) onChange(item.display_name);
    setOptions([]);
  };

  return (
    <div className={cn("relative group flex items-center", className)}>
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-map-text-dim group-focus-within:text-map-accent transition-colors z-10">
        {isLoading ? <Loader2 size={14} className="animate-spin" /> : icon}
      </div>
      <input 
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          if (onChange) onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (options.length > 0) {
              handleSelect(options[0]);
            } else if (onSearchSubmit) {
              onSearchSubmit(inputValue);
              setOptions([]);
            } else {
              searchPlaces(inputValue);
            }
          }
        }}
        placeholder={placeholder}
        className="bg-black/20 backdrop-blur-sm border border-white/10 px-10 py-2 text-xs w-full focus:outline-none focus:border-map-accent/50 transition-all placeholder:text-map-text-dim/30 tracking-widest pr-12"
      />
      <button 
        onClick={() => {
          if (onSearchClick) onSearchClick();
          if (onSearchSubmit && inputValue.length > 0) {
            onSearchSubmit(inputValue);
            setOptions([]);
          } else {
            searchPlaces(inputValue);
          }
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-map-accent hover:bg-map-accent/10 transition-all border border-transparent hover:border-map-accent/30"
        title="Execute Search"
      >
        <Search size={14} />
      </button>
      <AnimatePresence>
        {options.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-1 bg-black/90 backdrop-blur-xl border border-map-border z-50 max-h-60 overflow-y-auto shadow-2xl"
          >
            {options.map((opt, idx) => (
              <button
                key={idx}
                onClick={() => handleSelect(opt)}
                className="w-full text-left px-4 py-3 text-[10px] hover:bg-map-accent/20 transition-colors border-b border-map-border/30 last:border-0 group/item"
              >
                <div className="font-bold text-map-accent uppercase tracking-tighter group-hover/item:translate-x-1 transition-transform truncate">{opt.display_name.split(',')[0]}</div>
                <div className="text-map-text-dim truncate text-[9px]">{opt.display_name.split(',').slice(1).join(',')}</div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const GlobeView = ({ 
  coords, 
  targetCoords,
  currentLocation,
  zoom, 
  history, 
  sharePoints, 
  route, 
  isGlobeNight,
  setIsGlobeNight,
  isGlobeRotating,
  setIsGlobeRotating,
  setIsGlobeMode,
  isMapDark,
  setIsMapDark,
  onGlobeClick 
}: { 
  coords: [number, number], 
  targetCoords: [number, number] | null,
  currentLocation: [number, number] | null,
  zoom: number, 
  history: HistoryItem[], 
  sharePoints: SharePoint[], 
  route: any,
  isGlobeNight: boolean,
  setIsGlobeNight: (val: boolean) => void,
  isGlobeRotating: boolean,
  setIsGlobeRotating: (val: boolean) => void,
  setIsGlobeMode: (val: boolean) => void,
  isMapDark: boolean,
  setIsMapDark: (val: boolean) => void,
  onGlobeClick: (lat: number, lng: number) => void
}) => {
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const globeRef = useRef<any>(null);

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (globeRef.current) {
      const controls = globeRef.current.controls();
      if (controls) {
        controls.autoRotate = isGlobeRotating;
        controls.autoRotateSpeed = 0.5;
      }
    }
  }, [isGlobeRotating]);

  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.pointOfView({
        lat: coords[0],
        lng: coords[1],
        altitude: zoom > 15 ? 0.1 : zoom > 10 ? 0.5 : 2.5
      }, 1000);
    }
  }, [coords, zoom]);

  // Memoize data for performance
  const pointsData = useMemo(() => {
    const data = [];

    if (targetCoords) {
      data.push({
        lat: targetCoords[0],
        lng: targetCoords[1],
        size: 0.3,
        color: '#22c55e', // Bright Green
        name: 'TARGET_LOCKED'
      });
    }

    if (currentLocation) {
      data.push({
        lat: currentLocation[0],
        lng: currentLocation[1],
        size: 0.2,
        color: '#2563eb', // Blue
        name: 'CURRENT_LOCATION'
      });
    }

    return data;
  }, [targetCoords, currentLocation]);

  const ringsData = useMemo(() => {
    if (!targetCoords) return [];
    return [{
      lat: targetCoords[0],
      lng: targetCoords[1],
      color: '#22c55e',
      maxRadius: 5,
      propagationSpeed: 2,
      repeatPeriod: 1000
    }];
  }, [targetCoords]);

  const labelsData = useMemo(() => {
    if (!targetCoords) return [];
    return [{
      lat: targetCoords[0],
      lng: targetCoords[1],
      text: 'TARGET_LOCKED',
      color: '#22c55e',
      size: 1.5
    }];
  }, [targetCoords]);

  const pathsData = useMemo(() => {
    if (!route || !route.points || route.points.length < 2) return [];
    
    const validPoints = route.points.filter((p: any) => 
      p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
      !isNaN(p.lat) && !isNaN(p.lng)
    );

    if (validPoints.length < 2) return [];

    return [{
      path: validPoints.map((p: any) => [p.lat, p.lng]),
      color: '#00ff00'
    }];
  }, [route]);

  return (
    <div className="w-full h-full bg-black relative">
      <GlobeComponent
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        globeImageUrl={isGlobeNight 
          ? "//unpkg.com/three-globe/example/img/earth-night.jpg"
          : "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        }
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        showAtmosphere={true}
        atmosphereAltitude={0.25}
        atmosphereColor={isGlobeNight ? "#4a32b8" : "#3a228a"}
        pointsData={pointsData}
        pointColor="color"
        pointAltitude={0.01}
        pointRadius="size"
        pointLabel="name"
        pointLat="lat"
        pointLng="lng"
        ringsData={ringsData}
        ringColor="color"
        ringMaxRadius="maxRadius"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"
        labelsData={labelsData}
        labelLat="lat"
        labelLng="lng"
        labelText="text"
        labelColor="color"
        labelSize="size"
        labelDotRadius={0.5}
        labelAltitude={0.02}
        pathsData={pathsData}
        pathPoints="path"
        pathColor="color"
        pathStroke={2}
        pathDashLength={0.1}
        pathDashGap={0.02}
        pathDashAnimateTime={2000}
        onGlobeClick={({ lat, lng }) => onGlobeClick(lat, lng)}
        onGlobeReady={() => {
          if (globeRef.current) {
            const scene = globeRef.current.scene();
            if (scene) {
              // Add a bit more ambient light for night mode visibility
              const ambientLight = new THREE.AmbientLight(0xffffff, isGlobeNight ? 1.8 : 1.2);
              scene.add(ambientLight);
              
              // Add a directional light to give some highlights
              const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
              dirLight.position.set(1, 1, 1);
              scene.add(dirLight);
            }
          }
        }}
      />
      
      {/* Globe Specific Menu */}
      <div className="absolute top-20 right-6 z-40 flex flex-col gap-2">
        <button 
          onClick={() => setIsGlobeNight(!isGlobeNight)}
          className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border border-map-border flex items-center justify-center text-map-accent hover:border-map-accent transition-all shadow-lg"
          title={isGlobeNight ? "Current: Night Mode" : "Current: Day Mode"}
        >
          {isGlobeNight ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <button 
          onClick={() => setIsGlobeRotating(!isGlobeRotating)}
          className={cn(
            "w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border flex items-center justify-center transition-all shadow-lg",
            isGlobeRotating ? "text-map-accent border-map-accent" : "text-map-text-dim border-map-border hover:border-map-accent/50"
          )}
          title={isGlobeRotating ? "Stop Rotation" : "Start Rotation"}
        >
          <RotateCw size={18} className={isGlobeRotating ? "animate-spin-slow" : ""} />
        </button>
        <button 
          onClick={() => setIsGlobeMode(false)}
          className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border border-map-border flex items-center justify-center text-map-accent hover:border-map-accent transition-all shadow-lg"
          title="Switch to Flat Map"
        >
          <MapIcon size={18} />
        </button>
      </div>
    </div>
  );
};

const LeafletMapView = ({ 
  coords, 
  targetCoords,
  currentLocation,
  zoom, 
  onMapClick, 
  onCameraChange, 
  sharePoints, 
  isDark, 
  onThemeToggle 
}: { 
  coords: [number, number], 
  targetCoords: [number, number] | null,
  currentLocation: [number, number] | null,
  zoom: number, 
  onMapClick: (lat: number, lng: number) => void, 
  onCameraChange: (lat: number, lng: number, zoom: number) => void,
  sharePoints: SharePoint[],
  isDark: boolean,
  onThemeToggle?: () => void
}) => {
  const MapEvents = () => {
    useMapEvents({
      click: (e) => onMapClick(e.latlng.lat, e.latlng.lng),
      moveend: (e) => {
        const map = e.target;
        const center = map.getCenter();
        const newZoom = map.getZoom();
        
        // Only update if there's a significant change to avoid loops
        if (
          Math.abs(center.lat - coords[0]) > 0.0001 || 
          Math.abs(center.lng - coords[1]) > 0.0001 || 
          newZoom !== zoom
        ) {
          onCameraChange(center.lat, center.lng, newZoom);
        }
      }
    });
    return null;
  };

  const ChangeView = ({ center, zoom }: { center: [number, number], zoom: number }) => {
    const map = useLeafletMap();
    useEffect(() => {
      // Use flyTo for a smoother transition or setView for instant
      map.setView(center, zoom, { animate: true });
    }, [center, zoom, map]);
    return null;
  };

  const tileUrl = isDark 
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const targetIcon = L.divIcon({
    className: 'custom-target-icon',
    html: `<div class="relative flex items-center justify-center">
            <div class="absolute w-10 h-10 bg-map-accent/20 rounded-full animate-ping"></div>
            <div class="w-5 h-5 bg-map-accent/30 rounded-full border border-map-accent/50"></div>
            <div class="absolute w-2 h-2 bg-map-accent rounded-full shadow-[0_0_8px_rgba(0,255,157,0.8)]"></div>
            <div class="absolute -top-5 text-[7px] font-bold text-map-accent uppercase tracking-tighter whitespace-nowrap bg-black/90 px-1 border border-map-accent/30">TARGET_LOCKED</div>
            <div class="absolute w-6 h-[1px] bg-map-accent/50"></div>
            <div class="absolute h-6 w-[1px] bg-map-accent/50"></div>
          </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  return (
    <div className="w-full h-full relative">
      <MapContainer 
        center={coords} 
        zoom={zoom} 
        className="w-full h-full z-0"
        zoomControl={false}
      >
        <TileLayer
          url={tileUrl}
          attribution={attribution}
        />
        <MapEvents />
        <ChangeView center={coords} zoom={zoom} />
        
        {targetCoords && (
          <Marker position={targetCoords} icon={targetIcon}>
            <Popup>
              <div className="bg-black text-map-accent p-2 font-mono text-[10px] border border-map-accent/30">
                <div className="font-bold border-b border-map-accent/20 mb-1 pb-1 uppercase">Target Coordinates</div>
                <div>LAT: {targetCoords[0].toFixed(4)}</div>
                <div>LNG: {targetCoords[1].toFixed(4)}</div>
              </div>
            </Popup>
          </Marker>
        )}

        {currentLocation && (
          <Marker position={currentLocation}>
            <Popup>
              <div className="font-mono text-[10px]">
                <div className="font-bold text-blue-600 uppercase">Your Current Location</div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Map Controls Overlay */}
      <div className="absolute top-20 right-6 flex flex-col gap-3 z-50 pointer-events-auto">
        <button 
          onClick={() => onThemeToggle && onThemeToggle()}
          className={cn(
            "w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border flex items-center justify-center transition-all shadow-lg",
            isDark ? "text-map-accent border-map-accent" : "text-gray-800 bg-white/80 border-gray-200 hover:border-gray-400"
          )}
          title={isDark ? "Switch to Light Map" : "Switch to Dark Map"}
        >
          {isDark ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </div>
  );
};

// --- Main App Component ---
export default function App() {
  // --- State ---
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [forceFreeMap, setForceFreeMap] = useState(true);
  const [coords, setCoords] = useState<[number, number]>([0, 0]);
  const [targetCoords, setTargetCoords] = useState<[number, number] | null>(null);
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(2);
  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('hybrid');
  const [isGlobeMode, setIsGlobeMode] = useState(true);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [isGlobeNight, setIsGlobeNight] = useState(true);
  const [isGlobeRotating, setIsGlobeRotating] = useState(true);
  const [isMapDark, setIsMapDark] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sharePoints, setSharePoints] = useState<SharePoint[]>([]);
  const [statusMessage, setStatusMessage] = useState("SYSTEM READY");
  
  const placesLibrary = useMapsLibrary('places');
  const [placesService, setPlacesService] = useState<google.maps.places.PlacesService | null>(null);

  useEffect(() => {
    if (placesLibrary) {
      const dummy = document.createElement('div');
      setPlacesService(new placesLibrary.PlacesService(dummy));
    }
  }, [placesLibrary]);
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [intelReport, setIntelReport] = useState<string | null>(null);
  const [isIntelLoading, setIsIntelLoading] = useState(false);
  const [route, setRoute] = useState<any>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showRateUs, setShowRateUs] = useState(false);
  const [showAboutUs, setShowAboutUs] = useState(false);
  const [showRoutePlanner, setShowRoutePlanner] = useState(false);
  const [routeStart, setRouteStart] = useState("");
  const [routeEnd, setRouteEnd] = useState("");
  const [notifications, setNotifications] = useState<{id: string, message: string, type: 'info' | 'success' | 'warning'}[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const USE_FREE_MAP = !GOOGLE_MAPS_API_KEY || forceFreeMap;
  const EFFECTIVE_MAP_ID = MAP_ID || 'DEMO_MAP_ID';

  const addNotification = (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    const id = Math.random().toString(36).substring(7);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const deleteHistoryItem = async (id: string) => {
    if (!user || !id) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/history`, id));
      setStatusMessage("Intelligence record purged.");
    } catch (error) {
      console.error("Error deleting history:", error);
      setStatusMessage("Failed to delete record.");
    }
  };

  // --- Auth & Firestore ---
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setCurrentLocation([position.coords.latitude, position.coords.longitude]);
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const identifier = u.displayName || u.email?.split('@')[0] || "OPERATOR";
        setStatusMessage(`AUTHENTICATED: ${identifier.toUpperCase()}`);
        addNotification(`Welcome back, ${identifier}`, 'info');
      } else {
        setStatusMessage("AWAITING AUTHENTICATION");
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    // History listener
    const historyQuery = query(
      collection(db, `users/${user.uid}/history`),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    const unsubHistory = onSnapshot(historyQuery, (snap) => {
      const items: HistoryItem[] = [];
      snap.forEach(doc => items.push({ ...doc.data(), id: doc.id } as HistoryItem));
      setHistory(items);
    });

    // Share points listener
    const shareQuery = query(
      collection(db, 'shares'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsubShare = onSnapshot(shareQuery, (snap) => {
      const items: SharePoint[] = [];
      snap.forEach(doc => items.push(doc.data() as SharePoint));
      setSharePoints(items);
    });

    return () => {
      unsubHistory();
      unsubShare();
    };
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.remove('light');
      document.body.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.body.classList.add('light');
    }
  }, [isDarkTheme]);

  // --- Handlers ---
  const handleLocationUpdate = useCallback(async (lat: number, lng: number) => {
    setTargetCoords([lat, lng]);
    
    if (user) {
      try {
        await addDoc(collection(db, `users/${user.uid}/history`), {
          location: { lat, lng },
          timestamp: serverTimestamp()
        });
      } catch (error) {
        console.error("Error saving history:", error);
      }
    }
  }, [user]);

  const handleMapClick = useCallback((e: any) => {
    if (e?.detail?.latLng) {
      handleLocationUpdate(e.detail.latLng.lat, e.detail.latLng.lng);
    }
  }, [handleLocationUpdate]);

  const handleGlobeClick = useCallback((lat: number, lng: number) => {
    setZoom(15);
    handleLocationUpdate(lat, lng);
  }, [handleLocationUpdate]);

  const handleSearch = async (e?: React.FormEvent, overrideMessage?: string) => {
    if (e) e.preventDefault();
    const message = overrideMessage || chatInput.trim();
    if (!message) return;
    
    setChatInput("");
    setChatMessages(prev => [...prev, { role: 'user', text: message, timestamp: Date.now() }]);
    setIsChatLoading(true);
    setShowChat(true);

    try {
      const context = {
        currentCoords: coords,
        mapType,
        isGlobeMode,
        isDarkTheme,
        isGlobeNight,
        selectedPlace,
        transportMode: 'driving'
      };

      const aiResponse = await chatWithAI(message, context);
      
      if (aiResponse.locationRequest) {
        setStatusMessage(`Locating: ${aiResponse.locationRequest}`);
        
        // Use coordinates provided by AI if available (more accurate for specific buildings)
        if (aiResponse.lat !== undefined && aiResponse.lng !== undefined) {
          const lat = aiResponse.lat;
          const lng = aiResponse.lng;
          setTargetCoords([lat, lng]);
          setCoords([lat, lng]);
          setZoom(18); // Zoom in closer for specific buildings
          addNotification(`Target Located: ${aiResponse.locationRequest}`, 'success');
        } else {
          try {
            // Fallback to Nominatim if AI didn't provide coordinates
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiResponse.locationRequest)}&limit=1&addressdetails=1`);
            const data = await res.json();
            if (data && data.length > 0) {
              const lat = parseFloat(data[0].lat);
              const lng = parseFloat(data[0].lon);
              setTargetCoords([lat, lng]);
              setCoords([lat, lng]);
              setZoom(15);
              addNotification(`Target Located: ${aiResponse.locationRequest}`, 'success');
            } else {
              addNotification(`Could not locate: ${aiResponse.locationRequest}`, 'warning');
            }
          } catch (err) {
            console.error("Geocoding failed:", err);
          }
        }
      }

      if (aiResponse.routeRequest) {
        setStatusMessage(`Calculating route: ${aiResponse.routeRequest.start} to ${aiResponse.routeRequest.end}`);
        try {
          // Get coordinates for start and end
          const getCoords = async (query: string, lat?: number, lng?: number) => {
            if (lat !== undefined && lng !== undefined) return { lat, lng };
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await res.json();
            return data && data.length > 0 ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
          };

          const startCoords = await getCoords(aiResponse.routeRequest.start, aiResponse.routeRequest.startLat, aiResponse.routeRequest.startLng);
          const endCoords = await getCoords(aiResponse.routeRequest.end, aiResponse.routeRequest.endLat, aiResponse.routeRequest.endLng);

          if (startCoords && endCoords) {
            // Use OSRM for routing
            const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=geojson`);
            const osrmData = await osrmRes.json();
            
            if (osrmData.routes && osrmData.routes.length > 0) {
              const points = osrmData.routes[0].geometry.coordinates.map((c: any) => ({ lat: c[1], lng: c[0] }));
              setRoute({ points });
              setTargetCoords([startCoords.lat, startCoords.lng]);
              setCoords([startCoords.lat, startCoords.lng]);
              setZoom(12);
              addNotification("Tactical Route Calculated", "success");
            }
          } else {
            addNotification("Could not calculate route: Invalid locations", "warning");
          }
        } catch (err) {
          console.error("Routing failed:", err);
        }
      }

      if (aiResponse.searchRequest) {
        setStatusMessage(`Searching for: ${aiResponse.searchRequest.query}`);
        try {
          // If AI provided coordinates for the search center, use them
          if (aiResponse.searchRequest.lat !== undefined && aiResponse.searchRequest.lng !== undefined) {
            const lat = aiResponse.searchRequest.lat;
            const lng = aiResponse.searchRequest.lng;
            setTargetCoords([lat, lng]);
            setCoords([lat, lng]);
            setZoom(16);
            addNotification(`Scanning area: ${aiResponse.searchRequest.query}`, "success");
            
            // Still search for points in that area
            const query = `${aiResponse.searchRequest.query}`;
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&lat=${lat}&lon=${lng}&limit=10&addressdetails=1`);
            const data = await res.json();
            if (data && data.length > 0) {
              const newSharePoints = data.map((item: any) => ({
                id: item.place_id,
                userName: 'System Intel',
                userPhoto: 'https://api.dicebear.com/7.x/bottts/svg?seed=tactical',
                data: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
                timestamp: Date.now(),
                type: 'static'
              }));
              setSharePoints(prev => [...prev, ...newSharePoints]);
            }
          } else {
            const query = `${aiResponse.searchRequest.query}${aiResponse.searchRequest.location ? ` in ${aiResponse.searchRequest.location}` : ''}`;
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&addressdetails=1`);
            const data = await res.json();
            
            if (data && data.length > 0) {
              const newSharePoints = data.map((item: any) => ({
                id: item.place_id,
                userName: 'System Intel',
                userPhoto: 'https://api.dicebear.com/7.x/bottts/svg?seed=tactical',
                data: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
                timestamp: Date.now(),
                type: 'static'
              }));
              setSharePoints(prev => [...prev, ...newSharePoints]);
              
              // Focus on the first result
              const firstLat = parseFloat(data[0].lat);
              const firstLng = parseFloat(data[0].lon);
              setTargetCoords([firstLat, firstLng]);
              setCoords([firstLat, firstLng]);
              setZoom(16); // Zoom in for specific search results
              addNotification(`Found ${data.length} tactical points`, "success");
            } else {
              addNotification(`No tactical points found for: ${aiResponse.searchRequest.query}`, "warning");
            }
          }
        } catch (err) {
          console.error("Search failed:", err);
        }
      }

      setChatMessages(prev => [...prev, { role: 'ai', text: aiResponse.text || "I'm sorry, I couldn't process that request.", timestamp: Date.now() }]);
    } catch (error) {
      console.error("Chat failed:", error);
      setChatMessages(prev => [...prev, { role: 'ai', text: "Tactical communication link failed. Please try again.", timestamp: Date.now() }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleUniversalSearch = async (query: string) => {
    if (!query.trim()) return;
    
    // Check if it's a command or route
    const isCommand = /route|from|to|locate|find|show|where|how to/i.test(query);
    
    if (isCommand) {
      handleSearch(undefined, query);
      return;
    }
    
    // Otherwise do a direct search
    setStatusMessage(`SEARCHING: ${query.toUpperCase()}`);
    
    const performNominatimSearch = async (q: string) => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`);
        const data = await res.json();
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          setTargetCoords([lat, lng]);
          setCoords([lat, lng]);
          setZoom(16);
          const name = data[0].display_name.split(',')[0];
          addNotification(`TARGET LOCKED: ${name.toUpperCase()}`, 'success');
          setStatusMessage(`TARGET LOCKED: ${name.toUpperCase()}`);
        } else {
          // If geocode fails, try AI as a fallback
          handleSearch(undefined, q);
        }
      } catch (err) {
        console.error("Direct search failed:", err);
        handleSearch(undefined, q);
      }
    };

    // Try Google Places first if available for better accuracy on specific buildings
    if (placesService) {
      const request = {
        query: query,
        fields: ['name', 'geometry', 'formatted_address'],
      };
      
      placesService.findPlaceFromQuery(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
          const place = results[0];
          if (place.geometry?.location) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            setTargetCoords([lat, lng]);
            setCoords([lat, lng]);
            setZoom(18);
            const name = place.name || query;
            addNotification(`TARGET LOCKED: ${name.toUpperCase()}`, 'success');
            setStatusMessage(`TARGET LOCKED: ${name.toUpperCase()}`);
            return;
          }
        }
        // Fallback to Nominatim
        performNominatimSearch(query);
      });
    } else {
      performNominatimSearch(query);
    }
  };

  const fetchIntel = async () => {
    setIsIntelLoading(true);
    try {
      const report = await analyzeTerrain(coords[0], coords[1]);
      setIntelReport(report);
    } catch (error) {
      console.error("Intel fetch failed:", error);
    } finally {
      setIsIntelLoading(false);
    }
  };

  // --- Render ---
  const renderContent = () => (
    <div className={cn(
      "flex h-screen w-screen bg-map-bg text-map-text font-mono overflow-hidden transition-colors duration-300",
      !isDarkTheme && "light"
    )}>
      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        {/* Floating Action Buttons */}
        <div className="absolute top-6 left-6 z-50 flex flex-col gap-3">
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className={cn(
              "w-12 h-12 flex items-center justify-center border rounded-full transition-all shadow-2xl backdrop-blur-md",
              showMenu ? "bg-map-accent border-map-accent text-black" : "bg-black/60 border-map-accent/30 text-map-accent hover:border-map-accent"
            )}
            title="Tactical Menu"
          >
            <Menu size={20} />
          </button>
          
          <button 
            onClick={() => setShowChat(!showChat)}
            className={cn(
              "w-12 h-12 flex items-center justify-center border rounded-full transition-all shadow-2xl backdrop-blur-md",
              showChat ? "bg-map-accent border-map-accent text-black" : "bg-black/60 border-map-accent/30 text-map-accent hover:border-map-accent"
            )}
            title="Ask AI"
          >
            <MessageSquare size={20} />
          </button>

          <button 
            onClick={() => {
              setIsGlobeMode(!isGlobeMode);
              setMapVersion(v => v + 1);
            }}
            className={cn(
              "w-12 h-12 flex items-center justify-center border rounded-full transition-all shadow-2xl backdrop-blur-md",
              isGlobeMode ? "bg-map-accent border-map-accent text-black" : "bg-black/60 border-map-accent/30 text-map-accent hover:border-map-accent"
            )}
            title="Toggle Globe/Map"
          >
            {isGlobeMode ? <MapIcon size={20} /> : <Globe size={20} />}
          </button>

          <button 
            onClick={() => setShowRoutePlanner(true)}
            className="w-12 h-12 flex items-center justify-center border rounded-full transition-all shadow-2xl backdrop-blur-md bg-black/60 border-map-accent/30 text-map-accent hover:border-map-accent"
            title="Plan Route"
          >
            <Navigation size={20} />
          </button>
        </div>


      {/* Left Side Menu (Toggled by Logo) */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMenu(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[55]"
            />
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-72 md:w-80 bg-map-card border-r border-map-border z-[60] shadow-2xl flex flex-col"
            >
              <div className="p-4 border-b border-map-border flex items-center gap-4">
                <button 
                  onClick={() => setShowMenu(false)}
                  className="w-10 h-10 flex items-center justify-center border rounded-full bg-map-accent border-map-accent transition-all"
                >
                  <Target className="text-black" size={24} />
                </button>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-map-accent">Tactical Menu</h2>
                  <p className="text-[8px] text-map-text-dim uppercase tracking-tighter">System Configuration</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button 
                    onClick={() => setIsDarkTheme(!isDarkTheme)}
                    className="w-8 h-8 flex items-center justify-center text-map-text-dim hover:text-map-accent transition-colors"
                    title={isDarkTheme ? "Current: Dark Mode" : "Current: Light Mode"}
                  >
                    {isDarkTheme ? <Moon size={18} /> : <Sun size={18} />}
                  </button>
                  <button 
                    onClick={() => setIsGlobeRotating(!isGlobeRotating)}
                    className={cn("w-8 h-8 flex items-center justify-center transition-colors", isGlobeRotating ? "text-map-accent" : "text-map-text-dim hover:text-map-accent")}
                    title={isGlobeRotating ? "Stop Rotation" : "Start Rotation"}
                  >
                    <RotateCw size={18} className={isGlobeRotating ? "animate-spin-slow" : ""} />
                  </button>
                  <button onClick={() => setShowMenu(false)} className="text-map-text-dim hover:text-map-accent transition-colors">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                <div className="text-[10px] text-map-text-dim uppercase tracking-widest mb-4 px-2">Navigation</div>
                <button 
                  onClick={() => { setIsGlobeMode(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-map-accent/5 border border-transparent hover:border-map-accent/20 transition-all group"
                >
                  <div className="w-8 h-8 rounded-full border border-map-accent/20 flex items-center justify-center group-hover:border-map-accent/40 transition-colors">
                    <Globe size={16} className="text-map-accent" />
                  </div>
                  <span className="text-[11px] uppercase tracking-widest group-hover:text-map-accent">Globe View</span>
                </button>
                <button 
                  onClick={() => { setIsGlobeMode(false); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-map-accent/5 border border-transparent hover:border-map-accent/20 transition-all group"
                >
                  <div className="w-8 h-8 rounded-full border border-map-accent/20 flex items-center justify-center group-hover:border-map-accent/40 transition-colors">
                    <MapIcon size={16} className="text-map-accent" />
                  </div>
                  <span className="text-[11px] uppercase tracking-widest group-hover:text-map-accent">Tactical Map</span>
                </button>

                <div className="h-px bg-map-border my-4 mx-2" />
                <div className="text-[10px] text-map-text-dim uppercase tracking-widest mb-4 px-2">Map Configuration</div>
                <div className="grid grid-cols-2 gap-2 px-2">
                  {[
                    { id: 'roadmap', label: 'Roadmap', icon: <MapIcon size={14} /> },
                    { id: 'satellite', label: 'Satellite', icon: <Layers size={14} /> },
                    { id: 'hybrid', label: 'Hybrid', icon: <Layers size={14} /> },
                    { id: 'terrain', label: 'Terrain', icon: <Navigation size={14} /> }
                  ].map((type) => (
                    <button
                      key={type.id}
                      onClick={() => {
                        setMapType(type.id as any);
                        setIsGlobeMode(false);
                        addNotification(`Map Type: ${type.label}`, 'info');
                      }}
                      className={cn(
                        "flex items-center gap-2 p-2 border text-[10px] uppercase tracking-widest transition-all",
                        mapType === type.id && !isGlobeMode ? "bg-map-accent/10 border-map-accent text-map-accent" : "bg-black/20 border-map-border text-map-text-dim hover:border-map-accent/50"
                      )}
                    >
                      {type.icon}
                      {type.label}
                    </button>
                  ))}
                </div>

                <div className="h-px bg-map-border my-4 mx-2" />
                <div className="text-[10px] text-map-text-dim uppercase tracking-widest mb-4 px-2">Intelligence</div>
                
                {/* Integrated Chat in Sidebar */}
                <div className="px-2 space-y-4">
                  <div className="max-h-64 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                    {chatMessages.length === 0 ? (
                      <div className="text-center py-4 opacity-30">
                        <p className="text-[8px] uppercase tracking-widest">Awaiting mission parameters...</p>
                      </div>
                    ) : (
                      chatMessages.map((msg, i) => (
                        <div key={i} className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}>
                          <div className={cn(
                            "max-w-[90%] p-2 text-[9px] leading-tight",
                            msg.role === 'user' 
                              ? "bg-map-accent/10 border border-map-accent/30 text-map-accent" 
                              : "bg-black/40 border border-map-border text-map-text/80"
                          )}>
                            {msg.text.length > 100 ? msg.text.substring(0, 100) + '...' : msg.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSearch} className="relative">
                    <input 
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="ASK SAGITTARIUS..."
                      className="w-full bg-black/40 border border-map-border px-3 py-2 text-[10px] focus:outline-none focus:border-map-accent transition-all pr-10 tracking-widest"
                    />
                    <button type="submit" className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-map-accent hover:bg-map-accent/10 transition-all">
                      <Send size={12} />
                    </button>
                  </form>
                  <button 
                    onClick={() => { setShowChat(true); setShowMenu(false); }}
                    className="w-full flex items-center justify-center gap-2 p-2 border border-map-accent/30 text-[9px] uppercase tracking-widest text-map-accent hover:bg-map-accent/10 transition-all"
                  >
                    <Maximize2 size={10} />
                    Open Full Tactical Link
                  </button>
                </div>

                <div className="h-px bg-map-border my-4 mx-2" />
                <div className="text-[10px] text-map-text-dim uppercase tracking-widest mb-4 px-2">Settings</div>
                <div className="px-2 space-y-2 mb-4">
                  <button 
                    onClick={() => {
                      setForceFreeMap(!forceFreeMap);
                      addNotification(forceFreeMap ? "Google Maps Enabled" : "Free Mode (Leaflet) Enabled", 'success');
                    }}
                    className={cn(
                      "w-full flex items-center justify-between p-3 border transition-all group",
                      forceFreeMap ? "bg-map-accent/10 border-map-accent text-map-accent" : "bg-black/20 border-map-border text-map-text-dim hover:border-map-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <ShieldAlert size={16} />
                      <span className="text-[10px] uppercase tracking-widest">Force Free Mode</span>
                    </div>
                    <div className={cn("w-8 h-4 rounded-full relative transition-colors", forceFreeMap ? "bg-map-accent" : "bg-map-border")}>
                      <div className={cn("absolute top-1 w-2 h-2 bg-black rounded-full transition-all", forceFreeMap ? "right-1" : "left-1")} />
                    </div>
                  </button>
                  <div className="text-[8px] text-map-text-dim leading-relaxed uppercase tracking-tighter px-1">
                    Enable this if you see Google Maps errors or want to use OpenStreetMap.
                  </div>
                </div>
                <button 
                  onClick={() => { setShowHistory(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-map-accent/5 border border-transparent hover:border-map-accent/20 transition-all group"
                >
                  <div className="w-8 h-8 rounded-full border border-map-accent/20 flex items-center justify-center group-hover:border-map-accent/40 transition-colors">
                    <History size={16} className="text-map-accent" />
                  </div>
                  <span className="text-[11px] uppercase tracking-widest group-hover:text-map-accent">History</span>
                </button>
                <button 
                  onClick={() => { setShowProfile(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-map-accent/5 border border-transparent hover:border-map-accent/20 transition-all group"
                >
                  <div className="w-8 h-8 rounded-full border border-map-accent/20 flex items-center justify-center group-hover:border-map-accent/40 transition-colors">
                    <User size={16} className="text-map-accent" />
                  </div>
                  <span className="text-[11px] uppercase tracking-widest group-hover:text-map-accent">Operator Profile</span>
                </button>
                <button 
                  onClick={() => { setShowRateUs(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-map-accent/5 border border-transparent hover:border-map-accent/20 transition-all group"
                >
                  <div className="w-8 h-8 rounded-full border border-map-accent/20 flex items-center justify-center group-hover:border-map-accent/40 transition-colors">
                    <Star size={16} className="text-map-accent" />
                  </div>
                  <span className="text-[11px] uppercase tracking-widest group-hover:text-map-accent">Rate Us</span>
                </button>
                <button 
                  onClick={() => { setShowAboutUs(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-map-accent/5 border border-transparent hover:border-map-accent/20 transition-all group"
                >
                  <div className="w-8 h-8 rounded-full border border-map-accent/20 flex items-center justify-center group-hover:border-map-accent/40 transition-colors">
                    <Info size={16} className="text-map-accent" />
                  </div>
                  <span className="text-[11px] uppercase tracking-widest group-hover:text-map-accent">About Us</span>
                </button>
              </div>

              <div className="p-6 border-t border-map-border bg-black/20">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full border border-map-accent/30 p-0.5">
                    <div className="w-full h-full rounded-full bg-map-accent/20 flex items-center justify-center">
                      <Shield size={14} className="text-map-accent" />
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-map-accent uppercase tracking-widest">Sagittarius v2.4</div>
                    <div className="text-[8px] text-map-text-dim uppercase tracking-tighter">Secure Tactical Link</div>
                  </div>
                </div>
                <div className="text-[8px] text-map-accent leading-relaxed uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-map-accent animate-pulse" />
                  AI Core Active & Synchronized
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      {/* Map / Globe Container */}
      <div className="absolute inset-0 z-0">
          {isGlobeMode ? (
            <GlobeView 
              coords={coords} 
              targetCoords={targetCoords}
              currentLocation={currentLocation}
              zoom={zoom} 
              history={history} 
              sharePoints={sharePoints} 
              route={route}
              isGlobeNight={isGlobeNight}
              setIsGlobeNight={setIsGlobeNight}
              isGlobeRotating={isGlobeRotating}
              setIsGlobeRotating={setIsGlobeRotating}
              setIsGlobeMode={setIsGlobeMode}
              isMapDark={isMapDark}
              setIsMapDark={setIsMapDark}
              onGlobeClick={handleGlobeClick}
            />
          ) : USE_FREE_MAP ? (
            <LeafletMapView 
              coords={coords}
              targetCoords={targetCoords}
              currentLocation={currentLocation}
              zoom={zoom}
              onMapClick={handleLocationUpdate}
              onCameraChange={(lat, lng, z) => {
                setCoords([lat, lng]);
                setZoom(z);
              }}
              sharePoints={sharePoints}
              isDark={isMapDark}
              onThemeToggle={() => setIsMapDark(!isMapDark)}
            />
          ) : (
            <Map
              key={mapVersion}
              mapId={EFFECTIVE_MAP_ID}
              center={{ lat: coords[0], lng: coords[1] }}
              zoom={zoom}
              onCameraChanged={(ev) => {
                setCoords([ev.detail.center.lat, ev.detail.center.lng]);
                setZoom(ev.detail.zoom);
              }}
              mapTypeId={isMapDark ? 'hybrid' : mapType}
              onClick={handleMapClick}
              disableDefaultUI={true}
              streetViewControl={zoom > 15}
              mapTypeControl={false}
              fullscreenControl={false}
              className="w-full h-full"
            >
              {targetCoords && (
                <AdvancedMarker position={{ lat: targetCoords[0], lng: targetCoords[1] }}>
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-10 h-10 bg-map-accent/20 rounded-full animate-ping"></div>
                    <div className="w-5 h-5 bg-map-accent/30 rounded-full border border-map-accent/50"></div>
                    <div className="absolute w-2 h-2 bg-map-accent rounded-full shadow-[0_0_8px_rgba(0,255,157,0.8)]"></div>
                  </div>
                </AdvancedMarker>
              )}
            </Map>
          )}
        </div>

        {/* Overlay UI */}
        <div className="absolute top-6 right-6 z-40 w-full max-w-xs md:max-w-sm px-4">
          <TacticalAutocomplete 
            className="w-full shadow-2xl"
            onSearchSubmit={handleUniversalSearch}
            onPlaceSelect={(place) => {
              if (place.geometry?.location) {
                const lat = place.geometry.location.lat();
                const lng = place.geometry.location.lng();
                setTargetCoords([lat, lng]);
                setCoords([lat, lng]);
                setZoom(15);
                setSelectedPlace(place);
                setStatusMessage(`Target Locked: ${place.name}`);
                addNotification(`Target Locked: ${place.name}`, 'success');
                
                if (user) {
                  addDoc(collection(db, `users/${user.uid}/history`), {
                    location: { lat, lng },
                    name: place.name,
                    timestamp: serverTimestamp()
                  });
                }
              }
            }} 
          />
        </div>

        {/* Notifications */}
        <div className="fixed top-20 right-6 z-[60] flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {notifications.map((n) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 50 }}
                className={cn(
                  "px-4 py-3 border backdrop-blur-md shadow-xl flex items-center gap-3 min-w-[200px] pointer-events-auto",
                  n.type === 'success' ? "bg-green-500/20 border-green-500/50 text-green-400" :
                  n.type === 'warning' ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400" :
                  "bg-blue-500/20 border-blue-500/50 text-blue-400"
                )}
              >
                {n.type === 'success' ? <Check size={16} /> : 
                 n.type === 'warning' ? <AlertTriangle size={16} /> : 
                 <Info size={16} />}
                <span className="text-[10px] uppercase tracking-widest font-bold">{n.message}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="absolute bottom-6 right-6 z-40 flex flex-col items-end gap-4">
          <button 
            onClick={fetchIntel}
            disabled={isIntelLoading}
            className="bg-map-accent text-black px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50 rounded-full shadow-lg shadow-map-accent/20"
          >
            {isIntelLoading ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
            Analyze Terrain
          </button>
        </div>

        {/* Chat Panel */}
        <AnimatePresence>
          {showChat && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="absolute top-0 right-0 bottom-0 w-full md:w-96 bg-map-card border-l border-map-border z-50 flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-map-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-map-accent/10 flex items-center justify-center border border-map-accent/30">
                    <MessageSquare className="text-map-accent" size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-widest text-map-accent">Ask Sagittarius</h2>
                    <p className="text-[8px] text-map-text-dim uppercase tracking-tighter">Tactical Intelligence Link</p>
                  </div>
                </div>
                <button onClick={() => setShowChat(false)} className="text-map-text-dim hover:text-map-accent transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {chatMessages.length === 0 && (
                  <div className="text-center py-10 opacity-50">
                    <Compass className="mx-auto mb-4 text-map-accent" size={32} />
                    <p className="text-[10px] uppercase tracking-widest">Awaiting mission parameters...</p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}>
                    <div className={cn(
                      "max-w-[85%] p-4 text-[11px] leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-map-accent/10 border border-map-accent/30 text-map-accent" 
                        : "bg-map-bg border border-map-border text-map-text markdown-content"
                    )}>
                      {msg.role === 'ai' ? <ReactMarkdown>{msg.text}</ReactMarkdown> : msg.text}
                    </div>
                    <span className="text-[8px] text-map-text-dim mt-1 uppercase tracking-tighter">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex items-center gap-2 text-map-accent">
                    <Loader2 className="animate-spin" size={14} />
                    <span className="text-[10px] uppercase tracking-widest">Processing Data...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-6 border-t border-map-border">
                <form onSubmit={handleSearch} className="relative">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="ENTER COMMAND..."
                    className="w-full bg-map-bg border border-map-border px-4 py-3 text-xs focus:outline-none focus:border-map-accent transition-all pr-12 tracking-widest"
                  />
                  <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-map-accent hover:bg-map-accent/10 transition-all">
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Profile Modal */}
        <AnimatePresence>
          {showProfile && user && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-md bg-map-card border border-map-accent/30 p-8 shadow-2xl relative"
              >
                <button 
                  onClick={() => setShowProfile(false)}
                  className="absolute top-4 right-4 text-map-text-dim hover:text-map-accent transition-colors"
                >
                  <X size={20} />
                </button>

                <div className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 rounded-full border-2 border-map-accent p-1 mb-6 overflow-hidden">
                    <img src={user.photoURL || ''} alt="Profile" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                  </div>
                  <h2 className="text-lg font-bold text-map-accent uppercase tracking-[0.2em] mb-1">{user.displayName}</h2>
                  <div className="flex items-center gap-2 mb-8">
                    <div className="w-2 h-2 bg-map-accent rounded-full" />
                    <span className="text-[10px] text-map-text-dim uppercase tracking-widest">Tactical Operator</span>
                  </div>

                  <div className="w-full grid grid-cols-2 gap-4 mb-8">
                    <div className="p-4 bg-map-bg border border-map-border">
                      <div className="text-[8px] text-map-text-dim uppercase tracking-tighter mb-1">Missions</div>
                      <div className="text-xl font-bold text-map-accent">{history.length}</div>
                    </div>
                    <div className="p-4 bg-map-bg border border-map-border">
                      <div className="text-[8px] text-map-text-dim uppercase tracking-tighter mb-1">Status</div>
                      <div className="text-xl font-bold text-map-accent">ACTIVE</div>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      logout();
                      setShowProfile(false);
                    }}
                    className="w-full py-3 border border-red-500/50 text-red-500 text-xs font-bold uppercase tracking-widest hover:bg-red-500 hover:text-black transition-all flex items-center justify-center gap-2"
                  >
                    <LogOut size={16} />
                    Terminate Session
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History Modal */}
        <AnimatePresence>
          {showHistory && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-2xl bg-map-card border border-map-accent/30 p-6 shadow-2xl relative max-h-[80vh] flex flex-col"
              >
                <button 
                  onClick={() => setShowHistory(false)}
                  className="absolute top-4 right-4 text-map-text-dim hover:text-map-accent transition-colors"
                >
                  <X size={20} />
                </button>

                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-map-accent/10 flex items-center justify-center border border-map-accent/30">
                    <Clock className="text-map-accent" size={20} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-map-accent uppercase tracking-widest">History</h2>
                    <p className="text-[10px] text-map-text-dim uppercase tracking-tighter">Your saved locations and activity</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
                  {history.length === 0 ? (
                    <div className="text-center py-20 border border-dashed border-map-border">
                      <span className="text-[10px] text-map-text-dim uppercase tracking-widest">No history found</span>
                    </div>
                  ) : (
                    history.map((item, idx) => (
                      <div 
                        key={item.id || idx}
                        className="p-4 bg-map-bg border border-map-border hover:border-map-accent/30 transition-all flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="text-[10px] font-mono text-map-accent/50 group-hover:text-map-accent transition-colors">
                            {idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                          </div>
                          <div>
                            <div className="text-xs font-mono text-map-text tracking-widest">
                              {item.location?.lat.toFixed(4)}, {item.location?.lng.toFixed(4)}
                            </div>
                            <div className="text-[8px] text-map-text-dim uppercase tracking-tighter">
                              {item.timestamp?.toDate().toLocaleString() || 'TIMESTAMP UNKNOWN'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setCoords([item.location.lat, item.location.lng]);
                              setMapVersion(v => v + 1);
                              setShowHistory(false);
                              setStatusMessage("Restoring saved location...");
                            }}
                            className="p-2 bg-map-accent/10 text-map-accent border border-map-accent/30 hover:bg-map-accent hover:text-black transition-all"
                            title="Go to location"
                          >
                            <ChevronRight size={14} />
                          </button>
                          <button 
                            onClick={() => item.id && deleteHistoryItem(item.id)}
                            className="p-2 bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-black transition-all"
                            title="Delete record"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Route Planner Modal */}
        <AnimatePresence>
          {showRoutePlanner && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-md bg-map-card border border-map-accent/30 p-6 shadow-2xl relative"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-map-accent/10 flex items-center justify-center border border-map-accent/30">
                      <Navigation className="text-map-accent" size={18} />
                    </div>
                    <h2 className="text-xs font-bold text-map-accent uppercase tracking-[0.2em]">Tactical Route Planner</h2>
                  </div>
                  <button onClick={() => setShowRoutePlanner(false)} className="text-map-text-dim hover:text-map-accent"><X size={20} /></button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[8px] text-map-text-dim uppercase tracking-widest mb-1 block">Start Point</label>
                    <TacticalAutocomplete 
                      placeholder="ENTER START LOCATION..."
                      className="w-full"
                      icon={<MapPin size={14} />}
                      value={routeStart}
                      onChange={setRouteStart}
                      onPlaceSelect={(place) => setRouteStart(place.name || "")}
                      onSearchSubmit={handleUniversalSearch}
                    />
                  </div>
                  <div className="flex justify-center">
                    <div className="w-px h-4 bg-map-accent/30" />
                  </div>
                  <div>
                    <label className="text-[8px] text-map-text-dim uppercase tracking-widest mb-1 block">Destination</label>
                    <TacticalAutocomplete 
                      placeholder="ENTER DESTINATION..."
                      className="w-full"
                      icon={<Target size={14} />}
                      value={routeEnd}
                      onChange={setRouteEnd}
                      onPlaceSelect={(place) => setRouteEnd(place.name || "")}
                      onSearchSubmit={handleUniversalSearch}
                    />
                  </div>

                  <button 
                    onClick={() => {
                      if (routeStart && routeEnd) {
                        handleSearch(undefined, `Plan a route from ${routeStart} to ${routeEnd}`);
                        setShowRoutePlanner(false);
                      }
                    }}
                    className="w-full py-3 bg-map-accent text-black text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white transition-colors mt-4"
                  >
                    Engage Navigation
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rate Us Modal */}
        <AnimatePresence>
          {showRateUs && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-md bg-map-card border border-map-accent/30 p-8 shadow-2xl relative text-center"
              >
                <button 
                  onClick={() => setShowRateUs(false)}
                  className="absolute top-4 right-4 text-map-text-dim hover:text-map-accent transition-colors"
                >
                  <X size={20} />
                </button>

                <div className="w-16 h-16 bg-map-accent/10 flex items-center justify-center border border-map-accent/30 mx-auto mb-6">
                  <Star className="text-map-accent" size={32} />
                </div>
                
                <h2 className="text-lg font-bold text-map-accent uppercase tracking-[0.2em] mb-2">Rate Sagittarius</h2>
                <p className="text-[10px] text-map-text-dim uppercase tracking-widest mb-8">Help us improve the tactical interface</p>

                <div className="flex justify-center gap-3 mb-8">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button 
                      key={star}
                      className="text-map-text-dim hover:text-map-accent transition-all transform hover:scale-110"
                      onClick={() => {
                        setStatusMessage(`Rating received: ${star} stars. Thank you, Operator.`);
                        setShowRateUs(false);
                      }}
                    >
                      <Star size={32} />
                    </button>
                  ))}
                </div>

                <p className="text-[9px] text-map-text-dim leading-relaxed uppercase tracking-tighter">
                  Your feedback is vital for the evolution of the Sagittarius World intelligence network.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* About Us Modal */}
        <AnimatePresence>
          {showAboutUs && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-lg bg-map-card border border-map-accent/30 p-8 shadow-2xl relative"
              >
                <button 
                  onClick={() => setShowAboutUs(false)}
                  className="absolute top-4 right-4 text-map-text-dim hover:text-map-accent transition-colors"
                >
                  <X size={20} />
                </button>

                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 bg-map-accent/10 flex items-center justify-center border border-map-accent/30">
                    <Target className="text-map-accent" size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-map-accent uppercase tracking-[0.2em]">Sagittarius World</h2>
                    <p className="text-[10px] text-map-text-dim uppercase tracking-widest">Next-Gen Tactical Intelligence</p>
                  </div>
                </div>

                <div className="space-y-4 text-[11px] leading-relaxed text-map-text/80 uppercase tracking-tight">
                  <p>
                    Sagittarius World is a state-of-the-art tactical visualization and intelligence platform designed for global awareness and mission planning.
                  </p>
                  <p>
                    Powered by the Sagittarius AI (Gemini 3 Flash), our system provides real-time terrain analysis, route planning, and collaborative intelligence sharing.
                  </p>
                  <div className="p-4 bg-black/40 border border-map-border space-y-2">
                    <div className="flex justify-between">
                      <span className="text-map-accent">Version</span>
                      <span className="text-map-text-dim">4.2.0-TACTICAL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-map-accent">Core Engine</span>
                      <span className="text-map-text-dim">Gemini 3 Flash</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-map-accent">Network</span>
                      <span className="text-map-text-dim">Global Distributed</span>
                    </div>
                  </div>
                  <p className="text-[9px] text-map-text-dim pt-4 border-t border-map-border">
                    © 2026 SAGITTARIUS INTELLIGENCE SYSTEMS. ALL RIGHTS RESERVED.
                  </p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );

  if (GOOGLE_MAPS_API_KEY) {
    return (
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['places']}>
        {renderContent()}
      </APIProvider>
    );
  }

  return renderContent();
}
