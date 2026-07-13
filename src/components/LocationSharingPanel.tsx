import React, { useState, useEffect } from 'react';
import { 
  User, 
  Search, 
  Check, 
  Plus, 
  Trash2, 
  Share2, 
  Shield, 
  Users, 
  MapPin, 
  Loader2, 
  Activity, 
  AlertTriangle 
} from 'lucide-react';
import { db, auth } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { Contact, SharePoint } from '../types';
import { cn } from '../lib/utils';

interface LocationSharingPanelProps {
  user: any;
  currentLocation: [number, number] | null;
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  addNotification: (msg: string, type?: 'info' | 'success' | 'warning') => void;
  isSharingActive: boolean;
  setIsSharingActive: (active: boolean) => void;
  sharingScope: 'public' | 'contacts';
  setSharingScope: (scope: 'public' | 'contacts') => void;
  onFocusLocation: (lat: number, lng: number) => void;
}

export default function LocationSharingPanel({
  user,
  currentLocation,
  statusMessage,
  setStatusMessage,
  addNotification,
  isSharingActive,
  setIsSharingActive,
  sharingScope,
  setSharingScope,
  onFocusLocation
}: LocationSharingPanelProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [userStatus, setUserStatus] = useState('Safe');
  const [isLoading, setIsLoading] = useState(false);

  // Tactical statuses options
  const statusOptions = [
    { value: 'Safe', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { value: 'Evacuating', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    { value: 'Need Assistance', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    { value: 'In Danger', color: 'bg-red-500/20 text-red-400 border-red-500/30 pulsating' }
  ];

  // Fetch trusted contacts list
  useEffect(() => {
    if (!user) return;

    const q = collection(db, `users/${user.uid}/contacts`);
    const unsubscribe = onSnapshot(q, (snap) => {
      const list: Contact[] = [];
      snap.forEach(doc => {
        list.push(doc.data() as Contact);
      });
      setContacts(list);
    }, (error) => {
      console.error("Error fetching contacts:", error);
    });

    return unsubscribe;
  }, [user]);

  // Synchronize location update to Firestore if sharing is active
  useEffect(() => {
    if (!user || !currentLocation || !isSharingActive) return;

    // Update public profile with location
    const updateProfile = async () => {
      try {
        const profileRef = doc(db, 'public_profiles', user.uid);
        await setDoc(profileRef, {
          uid: user.uid,
          displayName: user.displayName || user.email?.split('@')[0] || 'Unknown Operator',
          photoURL: user.photoURL || '',
          lastLocation: {
            lat: currentLocation[0],
            lng: currentLocation[1],
            timestamp: new Date().toISOString()
          },
          status: userStatus
        }, { merge: true });

        // Update active shares record
        const shareRef = doc(db, 'shares', `live_${user.uid}`);
        await setDoc(shareRef, {
          userId: user.uid,
          userName: user.displayName || user.email?.split('@')[0] || 'Unknown Operator',
          userPhoto: user.photoURL || '',
          type: 'live',
          data: {
            lat: currentLocation[0],
            lng: currentLocation[1]
          },
          timestamp: new Date().toISOString(),
          active: true,
          scope: sharingScope,
          allowedContacts: sharingScope === 'contacts' ? contacts.map(c => c.uid) : []
        });

      } catch (error) {
        console.error("Error broadcasting location:", error);
      }
    };

    updateProfile();
    // Update every 10 seconds while sharing is active
    const interval = setInterval(updateProfile, 10000);
    return () => clearInterval(interval);

  }, [user, currentLocation, isSharingActive, userStatus, sharingScope, contacts]);

  // Handle disabling location sharing
  const handleToggleSharing = async () => {
    if (!user) {
      addNotification("Please sign in to enable location sharing", "warning");
      return;
    }

    const nextState = !isSharingActive;
    setIsSharingActive(nextState);

    try {
      if (!nextState) {
        // Deactivate share in firestore
        const shareRef = doc(db, 'shares', `live_${user.uid}`);
        await setDoc(shareRef, { active: false }, { merge: true });
        addNotification("Location sharing disabled.", "info");
      } else {
        addNotification("Location sharing activated!", "success");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Change user status
  const handleStatusChange = async (status: string) => {
    setUserStatus(status);
    if (!user) return;
    try {
      await setDoc(doc(db, 'public_profiles', user.uid), { status }, { merge: true });
      addNotification(`Tactical status updated: ${status}`, 'success');
    } catch (e) {
      console.error(e);
    }
  };

  // Search active operators
  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchEmail.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      // Query users collection for this email
      const q = query(collection(db, 'public_profiles'));
      const querySnapshot = await getDocs(q);
      const results: any[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.uid !== user?.uid && data.displayName?.toLowerCase().includes(searchEmail.toLowerCase())) {
          results.push(data);
        }
      });

      setSearchResults(results);
      if (results.length === 0) {
        addNotification("No tactical units found matching that name.", "info");
      }
    } catch (error) {
      console.error("Error searching profiles:", error);
      addNotification("Search failed. Try again.", "warning");
    } finally {
      setIsSearching(false);
    }
  };

  // Add a trusted contact
  const handleAddContact = async (profile: any) => {
    if (!user) return;
    try {
      const contactRef = doc(db, `users/${user.uid}/contacts`, profile.uid);
      const contactData: Contact = {
        uid: profile.uid,
        displayName: profile.displayName || 'Operator',
        email: profile.email || '',
        photoURL: profile.photoURL || '',
        sharedWith: true,
        status: profile.status || 'Safe',
        addedAt: new Date().toISOString()
      };
      
      await setDoc(contactRef, contactData);
      addNotification(`Added ${profile.displayName} to Trusted Contacts`, 'success');
      setSearchEmail('');
      setSearchResults([]);
    } catch (error) {
      console.error("Error adding contact:", error);
      addNotification("Failed to add contact.", "warning");
    }
  };

  // Remove a contact
  const handleRemoveContact = async (contactUid: string, name: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/contacts`, contactUid));
      addNotification(`Removed ${name} from contacts`, 'info');
    } catch (error) {
      console.error("Error removing contact:", error);
    }
  };

  return (
    <div className="flex flex-col gap-5 text-gray-100">
      {/* Real-time share toggle card */}
      <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <Share2 className={cn("w-5 h-5", isSharingActive ? "text-green-400" : "text-zinc-500")} />
            <div>
              <div className="font-sans font-medium text-sm text-gray-100">Location Broadcast</div>
              <div className="font-mono text-[10px] text-zinc-400">
                {isSharingActive ? "BROADCAST ACTIVE" : "BROADCAST INACTIVE"}
              </div>
            </div>
          </div>
          <button
            onClick={handleToggleSharing}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider border transition-all cursor-pointer",
              isSharingActive 
                ? "bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/50" 
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"
            )}
          >
            {isSharingActive ? "Disable" : "Enable"}
          </button>
        </div>

        {/* Current status changer (only visible when sharing is active or signed in) */}
        {user && (
          <div className="border-t border-zinc-800/60 pt-3.5 flex flex-col gap-2">
            <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              My Tactical Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              {statusOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn(
                    "px-2.5 py-2 text-[11px] font-mono border rounded-lg transition-all text-center cursor-pointer",
                    userStatus === opt.value
                      ? opt.color.replace('500/20', '500/40') + " border-opacity-100 font-semibold"
                      : "bg-zinc-950/40 text-zinc-400 border-zinc-800/80 hover:border-zinc-700"
                  )}
                >
                  {opt.value}
                </button>
              ))}
            </div>
          </div>
        )}

        {isSharingActive && (
          <div className="border-t border-zinc-800/60 pt-3 flex flex-col gap-2">
            <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Sharing Scope
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSharingScope('public')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-[10px] font-mono border uppercase tracking-wider text-center cursor-pointer transition-all",
                  sharingScope === 'public'
                    ? "bg-zinc-800 text-map-accent border-map-accent"
                    : "bg-zinc-950 text-zinc-500 border-zinc-900"
                )}
              >
                Public Coordination
              </button>
              <button
                onClick={() => setSharingScope('contacts')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-[10px] font-mono border uppercase tracking-wider text-center cursor-pointer transition-all",
                  sharingScope === 'contacts'
                    ? "bg-zinc-800 text-map-accent border-map-accent"
                    : "bg-zinc-950 text-zinc-500 border-zinc-900"
                )}
              >
                Contacts Only
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Contacts search and directory */}
      {user && (
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-xl flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-map-accent" />
            <span className="font-sans font-medium text-sm text-gray-100">Trusted Tactical Contacts</span>
          </div>

          {/* Search form */}
          <form onSubmit={handleSearchUser} className="relative flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                placeholder="Search active unit name..."
                className="w-full bg-zinc-950/80 border border-zinc-800 text-xs px-3.5 py-2 rounded-lg text-gray-200 placeholder-zinc-500 focus:outline-none focus:border-map-accent/50"
              />
              <Search className="absolute right-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="bg-map-accent text-black px-3.5 py-2 rounded-lg text-xs font-mono font-bold hover:bg-opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : "FIND"}
            </button>
          </form>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="bg-zinc-950/60 rounded-lg border border-zinc-800 p-2 max-h-40 overflow-y-auto flex flex-col gap-1">
              <div className="font-mono text-[9px] text-zinc-500 uppercase px-2 mb-1">Search Results:</div>
              {searchResults.map((p) => (
                <div key={p.uid} className="flex justify-between items-center p-2 rounded hover:bg-zinc-900">
                  <div className="flex items-center gap-2">
                    {p.photoURL ? (
                      <img src={p.photoURL} className="w-6 h-6 rounded-full border border-zinc-700" alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] text-map-accent">
                        {p.displayName?.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-zinc-200">{p.displayName}</div>
                      <div className="text-[9px] font-mono text-zinc-500">STATUS: {p.status || 'SAFE'}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAddContact(p)}
                    className="p-1 bg-zinc-800 hover:bg-zinc-700 rounded text-map-accent border border-zinc-700 transition-all cursor-pointer"
                    title="Add Contact"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Contacts List */}
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {contacts.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                No active contacts added yet. Use the locator tool above to search.
              </div>
            ) : (
              contacts.map((c) => (
                <div 
                  key={c.uid}
                  className="bg-zinc-950/40 hover:bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg flex justify-between items-center group transition-all"
                >
                  <div className="flex items-center gap-3">
                    {c.photoURL ? (
                      <img src={c.photoURL} className="w-8 h-8 rounded-full border border-zinc-800" alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-xs font-mono text-map-accent">
                        {c.displayName.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-gray-200 flex items-center gap-1.5">
                        {c.displayName}
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full inline-block",
                          c.status === 'In Danger' ? "bg-red-500 animate-pulse" :
                          c.status === 'Need Assistance' ? "bg-yellow-400" :
                          c.status === 'Evacuating' ? "bg-blue-400" : "bg-green-500"
                        )} />
                      </div>
                      <div className="text-[9px] font-mono text-zinc-500 mt-0.5 uppercase">
                        UNIT STATUS: {c.status || 'SAFE'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRemoveContact(c.uid, c.displayName)}
                      className="p-1.5 bg-zinc-900 hover:bg-red-950/40 text-zinc-500 hover:text-red-400 rounded-md border border-zinc-800/80 hover:border-red-900/40 cursor-pointer"
                      title="Remove contact"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
