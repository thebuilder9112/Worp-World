export interface Location {
  lat: number;
  lng: number;
}

export interface HistoryItem {
  id?: string;
  location: Location;
  timestamp: any;
}

export interface SharePoint {
  userId: string;
  userName: string;
  userPhoto: string;
  data: Location;
  timestamp: any;
  type: 'live' | 'static';
  status?: string;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface EmergencyAlert {
  id?: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  zone: {
    lat: number;
    lng: number;
    radius: number; // in meters
  };
  timestamp: any;
  senderId: string;
  senderName?: string;
  active: boolean;
}

export interface Contact {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  sharedWith: boolean;
  status: string;
  addedAt?: any;
}

export interface OfflineRegion {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  radius: number; // in km
  tileCount: number;
  downloadedAt: string;
}
