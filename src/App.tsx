import React, { Component, useState, useEffect, useRef } from 'react';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  collection, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  serverTimestamp,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { 
  Video as VideoIcon, 
  MessageSquare, 
  Users, 
  LogOut, 
  Plus, 
  Trash2, 
  Send, 
  CheckCircle, 
  ChevronRight,
  Play,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { nl } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { UserProfile, Video, Assignment, Message, Role } from './types';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Generate a short ID for therapists
function generateShortId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// --- Firestore Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const Button = ({ 
  children, 
  className, 
  variant = 'primary', 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) => {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100'
  };
  
  return (
    <button 
      className={cn(
        'px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className, ...props }: { children: React.ReactNode; className?: string; [key: string]: any }) => (
  <div className={cn('bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden', className)} {...props}>
    {children}
  </div>
);

// --- Error Boundary ---

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-6">
          <Card className="max-w-md w-full p-8 text-center border-red-200">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Oeps! Er ging iets mis.</h2>
            <pre className="text-xs bg-gray-100 p-4 rounded mb-6 overflow-auto text-left max-h-40">
              {JSON.stringify(this.state.error, null, 2)}
            </pre>
            <Button onClick={() => window.location.reload()}>Pagina herladen</Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, loading] = useAuthState(auth);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    if (user) {
      const loadProfile = async () => {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          // Ensure therapist has a shortId
          if (data.role === 'therapist' && !data.shortId) {
            const shortId = generateShortId();
            await setDoc(docRef, { shortId }, { merge: true });
            setProfile({ ...data, shortId });
          } else {
            setProfile(data);
          }
        } else {
          // New user - default to parent for now, can be changed
          const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            name: user.displayName || 'Nieuwe Gebruiker',
            role: 'parent'
          };
          try {
            await setDoc(docRef, newProfile);
            setProfile(newProfile);
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
          }
        }
        setIsAuthReady(true);
      };
      loadProfile();
    } else {
      setProfile(null);
      if (!loading) setIsAuthReady(true);
    }
  }, [user, loading]);

  if (loading || !isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center overflow-hidden border border-gray-100">
            <img 
              src="https://raw.githubusercontent.com/lucide-react/lucide/main/icons/fox.svg" 
              alt="De Taalvos" 
              className="w-full h-full object-contain p-1"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-xl font-bold text-gray-900 hidden sm:block">De Taalvos Wachtlijst App</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <Button 
            variant="secondary" 
            className="text-xs py-1 px-2"
            onClick={async () => {
              const newRole = profile.role === 'therapist' ? 'parent' : 'therapist';
              const updates: Partial<UserProfile> = { role: newRole };
              if (newRole === 'therapist' && !profile.shortId) {
                updates.shortId = generateShortId();
              }
              await setDoc(doc(db, 'users', profile.uid), updates, { merge: true });
              window.location.reload();
            }}
          >
            Wissel naar {profile.role === 'therapist' ? 'Ouder' : 'Logopedist'}
          </Button>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-gray-900">{profile.name}</p>
            <p className="text-xs text-gray-500 capitalize">{profile.role === 'therapist' ? 'Logopedist' : 'Ouder'}</p>
            {profile.role === 'therapist' && profile.shortId && (
              <p className="text-[10px] text-blue-500 font-mono select-all cursor-copy" title="Klik om te kopiëren">
                Koppelcode: {profile.shortId}
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={() => signOut(auth)} className="p-2">
            <LogOut size={20} />
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6">
        {profile.role === 'therapist' ? (
          <TherapistDashboard profile={profile} />
        ) : (
          <ParentDashboard profile={profile} />
        )}
      </main>
    </div>
  );
}

// --- Login Screen ---

function LoginScreen() {
  const handleLogin = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50 p-6">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center overflow-hidden mx-auto mb-6 shadow-lg border border-gray-100">
          <img 
            src="https://raw.githubusercontent.com/lucide-react/lucide/main/icons/fox.svg" 
            alt="De Taalvos" 
            className="w-full h-full object-contain p-2"
            referrerPolicy="no-referrer"
          />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">De Taalvos</h1>
        <p className="text-gray-600 mb-8">
          Log in om toegang te krijgen tot de Wachtlijst App.
        </p>
        <Button onClick={handleLogin} className="w-full flex items-center justify-center gap-3 py-4 text-lg">
          <img src="https://www.google.com/favicon.ico" className="w-6 h-6" alt="Google" />
          Log in met Google
        </Button>
      </Card>
    </div>
  );
}

// --- Therapist Dashboard ---

function TherapistDashboard({ profile }: { profile: UserProfile }) {
  const [activeTab, setActiveTab] = useState<'clients' | 'videos'>('clients');
  const [selectedClient, setSelectedClient] = useState<UserProfile | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
      {/* Sidebar / Navigation */}
      <div className="lg:col-span-3 space-y-4">
        <div className="flex flex-col gap-1">
          <button 
            onClick={() => { setActiveTab('clients'); setSelectedClient(null); }}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all',
              activeTab === 'clients' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:bg-white hover:shadow-sm'
            )}
          >
            <Users size={20} />
            Cliënten
          </button>
          <button 
            onClick={() => { setActiveTab('videos'); setSelectedClient(null); }}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all',
              activeTab === 'videos' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:bg-white hover:shadow-sm'
            )}
          >
            <VideoIcon size={20} />
            Video Bibliotheek
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="lg:col-span-9">
        <AnimatePresence mode="wait">
          {activeTab === 'clients' && !selectedClient && (
            <motion.div 
              key="clients-list"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ClientsList therapistId={profile.uid} onSelectClient={setSelectedClient} />
            </motion.div>
          )}

          {activeTab === 'clients' && selectedClient && (
            <motion.div 
              key="client-detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <ClientDetail 
                therapist={profile} 
                client={selectedClient} 
                onBack={() => setSelectedClient(null)} 
              />
            </motion.div>
          )}

          {activeTab === 'videos' && (
            <motion.div 
              key="videos-library"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <VideoLibrary therapistId={profile.uid} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ClientsList({ therapistId, onSelectClient }: { therapistId: string; onSelectClient: (client: UserProfile) => void }) {
  const [clients, setClients] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('therapistId', '==', therapistId), where('role', '==', 'parent'));
    return onSnapshot(q, (snapshot) => {
      setClients(snapshot.docs.map(doc => doc.data() as UserProfile));
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'users'));
  }, [therapistId]);

  if (loading) return <div className="text-center py-12 text-gray-500">Cliënten laden...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold text-gray-900">Mijn Cliënten</h2>
        <p className="text-sm text-gray-500">{clients.length} cliënten gekoppeld</p>
      </div>
      
      {clients.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">Nog geen cliënten gekoppeld.</p>
          <p className="text-sm text-gray-400 mt-2">Cliënten moeten jouw UID ({therapistId}) invoeren om te koppelen.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map(client => (
            <Card key={client.uid} className="hover:border-blue-300 transition-colors cursor-pointer" >
              <div className="p-5 flex items-center justify-between" onClick={() => onSelectClient(client)}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                    <UserIcon size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{client.name}</h3>
                    <p className="text-sm text-gray-500">{client.email}</p>
                  </div>
                </div>
                <ChevronRight className="text-gray-400" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientDetail({ therapist, client, onBack }: { therapist: UserProfile; client: UserProfile; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'videos' | 'chat'>('videos');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack} className="p-2">
          <ChevronRight className="rotate-180" size={24} />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{client.name}</h2>
          <p className="text-sm text-gray-500">Cliënt dossier</p>
        </div>
      </div>

      <div className="flex border-b border-gray-200">
        <button 
          onClick={() => setActiveTab('videos')}
          className={cn(
            'px-6 py-3 font-medium transition-all border-b-2',
            activeTab === 'videos' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Gedeelde Video's
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          className={cn(
            'px-6 py-3 font-medium transition-all border-b-2',
            activeTab === 'chat' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Berichten
        </button>
      </div>

      <div className="mt-6">
        {activeTab === 'videos' ? (
          <ClientVideoManager therapistId={therapist.uid} clientId={client.uid} />
        ) : (
          <Chat therapistId={therapist.uid} clientId={client.uid} currentUserRole="therapist" />
        )}
      </div>
    </div>
  );
}

function ClientVideoManager({ therapistId, clientId }: { therapistId: string; clientId: string }) {
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [assignedVideoIds, setAssignedVideoIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all therapist videos
    const vq = query(collection(db, 'videos'), where('therapistId', '==', therapistId));
    const unsubscribeVideos = onSnapshot(vq, (snapshot) => {
      setAllVideos(snapshot.docs.map(doc => doc.data() as Video));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'videos'));

    // Fetch assignments for this client
    const aq = query(collection(db, 'assignments'), where('clientId', '==', clientId));
    const unsubscribeAssignments = onSnapshot(aq, (snapshot) => {
      setAssignedVideoIds(snapshot.docs.map(doc => (doc.data() as Assignment).videoId));
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'assignments'));

    return () => {
      unsubscribeVideos();
      unsubscribeAssignments();
    };
  }, [therapistId, clientId]);

  const toggleAssignment = async (videoId: string) => {
    const isAssigned = assignedVideoIds.includes(videoId);
    try {
      if (isAssigned) {
        // Remove assignment
        const q = query(collection(db, 'assignments'), where('clientId', '==', clientId), where('videoId', '==', videoId));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);
      } else {
        // Add assignment
        await addDoc(collection(db, 'assignments'), {
          clientId,
          videoId,
          therapistId
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'assignments');
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Laden...</div>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Video's toewijzen</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allVideos.map(video => (
          <Card key={video.id} className={cn('p-4 flex items-center justify-between border-2 transition-all', assignedVideoIds.includes(video.id) ? 'border-blue-500 bg-blue-50' : 'border-transparent')}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                <Play size={20} />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{video.title}</p>
                <p className="text-xs text-gray-500 truncate max-w-[150px]">{video.url}</p>
              </div>
            </div>
            <Button 
              variant={assignedVideoIds.includes(video.id) ? 'primary' : 'secondary'}
              onClick={() => toggleAssignment(video.id)}
              className="px-3 py-1 text-sm"
            >
              {assignedVideoIds.includes(video.id) ? 'Gekoppeld' : 'Koppelen'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VideoLibrary({ therapistId }: { therapistId: string }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVideo, setNewVideo] = useState({ title: '', url: '', description: '' });

  useEffect(() => {
    const q = query(collection(db, 'videos'), where('therapistId', '==', therapistId));
    return onSnapshot(q, (snapshot) => {
      setVideos(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Video)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'videos'));
  }, [therapistId]);

  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVideo.title || !newVideo.url) return;
    
    try {
      await addDoc(collection(db, 'videos'), {
        ...newVideo,
        therapistId,
        id: Math.random().toString(36).substr(2, 9) // Simple ID
      });
      setNewVideo({ title: '', url: '', description: '' });
      setShowAddModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'videos');
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    // Also delete assignments
    const aq = query(collection(db, 'assignments'), where('videoId', '==', videoId));
    // In a real app, we'd delete assignments too. For now just the video.
    const q = query(collection(db, 'videos'), where('id', '==', videoId));
    // This is a bit simplified for the demo
    const snapshot = await onSnapshot(q, (s) => {
      s.docs.forEach(d => deleteDoc(d.ref));
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Video Bibliotheek</h2>
        <Button onClick={() => setShowAddModal(true)} className="flex items-center gap-2">
          <Plus size={20} />
          Video Toevoegen
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {videos.map(video => (
          <Card key={video.id} className="group">
            <div className="aspect-video bg-gray-100 flex items-center justify-center relative">
              <Play size={48} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="danger" className="p-2" onClick={() => handleDeleteVideo(video.id)}>
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-bold text-gray-900 mb-1">{video.title}</h3>
              <p className="text-sm text-gray-500 line-clamp-2">{video.description || 'Geen beschrijving'}</p>
            </div>
          </Card>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl"
          >
            <h3 className="text-2xl font-bold mb-6">Nieuwe Video</h3>
            <form onSubmit={handleAddVideo} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titel</label>
                <input 
                  type="text" 
                  required
                  value={newVideo.title}
                  onChange={e => setNewVideo({ ...newVideo, title: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="Bijv. Oefening de 'R'"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Video URL (YouTube/Vimeo)</label>
                <input 
                  type="url" 
                  required
                  value={newVideo.url}
                  onChange={e => setNewVideo({ ...newVideo, url: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="https://youtube.com/..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                <textarea 
                  value={newVideo.description}
                  onChange={e => setNewVideo({ ...newVideo, description: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none h-24"
                  placeholder="Wat moet de cliënt doen?"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="flex-1">Annuleren</Button>
                <Button type="submit" className="flex-1">Opslaan</Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// --- Parent Dashboard ---

function ParentDashboard({ profile }: { profile: UserProfile }) {
  const [activeTab, setActiveTab] = useState<'videos' | 'chat'>('videos');
  const [therapist, setTherapist] = useState<UserProfile | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(!profile.therapistId);
  const [therapistIdInput, setTherapistIdInput] = useState('');

  useEffect(() => {
    if (profile.therapistId) {
      const loadTherapist = async () => {
        const docSnap = await getDoc(doc(db, 'users', profile.therapistId!));
        if (docSnap.exists()) setTherapist(docSnap.data() as UserProfile);
      };
      loadTherapist();
    }
  }, [profile.therapistId]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!therapistIdInput) return;
    
    // Verify therapist exists by shortId or full uid
    try {
      let therapistUid = therapistIdInput;
      
      // Check if input is a shortId
      if (therapistIdInput.length === 4) {
        const q = query(collection(db, 'users'), where('shortId', '==', therapistIdInput.toUpperCase()), where('role', '==', 'therapist'));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          therapistUid = snapshot.docs[0].id;
        }
      }

      const docSnap = await getDoc(doc(db, 'users', therapistUid));
      if (docSnap.exists() && docSnap.data().role === 'therapist') {
        await setDoc(doc(db, 'users', profile.uid), { therapistId: therapistUid }, { merge: true });
        setShowConnectModal(false);
        window.location.reload(); // Simple way to refresh profile
      } else {
        alert('Ongeldige Koppelcode of Logopedist ID');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  return (
    <div className="space-y-6">
      {!profile.therapistId ? (
        <Card className="p-12 text-center max-w-2xl mx-auto">
          <UserIcon className="mx-auto text-blue-200 mb-6" size={64} />
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Koppel je Logopedist</h2>
          <p className="text-gray-600 mb-8">
            Om video's te zien en vragen te stellen, moet je gekoppeld zijn aan een logopedist.
            Vraag je logopedist om hun unieke koppelcode.
          </p>
          <form onSubmit={handleConnect} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input 
              type="text" 
              value={therapistIdInput}
              onChange={e => setTherapistIdInput(e.target.value.toUpperCase())}
              placeholder="Koppelcode (4 tekens)"
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none uppercase"
              maxLength={28}
            />
            <Button type="submit">Koppelen</Button>
          </form>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Hoi {profile.name.split(' ')[0]}!</h2>
              <p className="text-sm text-gray-500">Jouw logopedist: <span className="font-semibold text-blue-600">{therapist?.name}</span></p>
            </div>
            <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
              <button 
                onClick={() => setActiveTab('videos')}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'videos' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                Video's
              </button>
              <button 
                onClick={() => setActiveTab('chat')}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeTab === 'chat' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                Vragen
              </button>
            </div>
          </div>

          <div className="mt-8">
            {activeTab === 'videos' ? (
              <ParentVideoList clientId={profile.uid} />
            ) : (
              <Chat therapistId={profile.therapistId!} clientId={profile.uid} currentUserRole="parent" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ParentVideoList({ clientId }: { clientId: string }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const aq = query(collection(db, 'assignments'), where('clientId', '==', clientId));
    return onSnapshot(aq, async (snapshot) => {
      const videoIds = snapshot.docs.map(doc => (doc.data() as Assignment).videoId);
      
      if (videoIds.length === 0) {
        setVideos([]);
        setLoading(false);
        return;
      }

      // Fetch actual video data
      const videoPromises = videoIds.map(id => {
        const q = query(collection(db, 'videos'), where('id', '==', id));
        return new Promise<Video | null>((resolve) => {
          onSnapshot(q, (s) => {
            if (!s.empty) resolve(s.docs[0].data() as Video);
            else resolve(null);
          }, (err) => handleFirestoreError(err, OperationType.GET, 'videos'));
        });
      });

      const results = await Promise.all(videoPromises);
      setVideos(results.filter(v => v !== null) as Video[]);
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'assignments'));
  }, [clientId]);

  if (loading) return <div className="text-center py-12 text-gray-500">Video's laden...</div>;

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-900">Jouw Oefeningen</h3>
      {videos.length === 0 ? (
        <Card className="p-12 text-center bg-white/50 border-dashed">
          <Play className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">Er zijn nog geen video's voor je klaargezet.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos.map(video => (
            <Card key={video.id} className="group hover:shadow-lg transition-all">
              <div className="aspect-video bg-gray-900 flex items-center justify-center relative overflow-hidden">
                <img 
                  src={`https://picsum.photos/seed/${video.id}/640/360`} 
                  className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform" 
                  alt={video.title}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white group-hover:bg-blue-600 transition-colors">
                    <Play size={32} fill="currentColor" />
                  </div>
                </div>
              </div>
              <div className="p-5">
                <h4 className="font-bold text-lg text-gray-900 mb-2">{video.title}</h4>
                <p className="text-sm text-gray-600 mb-4 line-clamp-2">{video.description}</p>
                <a 
                  href={video.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-600 font-semibold hover:underline"
                >
                  Bekijk Video <ChevronRight size={16} />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Chat Component ---

function Chat({ therapistId, clientId, currentUserRole }: { therapistId: string; clientId: string; currentUserRole: Role }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
      where('senderId', 'in', [therapistId, clientId]),
      where('receiverId', 'in', [therapistId, clientId]),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Message)));
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'messages'));
  }, [therapistId, clientId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const senderId = currentUserRole === 'therapist' ? therapistId : clientId;
    const receiverId = currentUserRole === 'therapist' ? clientId : therapistId;

    try {
      await addDoc(collection(db, 'messages'), {
        senderId,
        receiverId,
        text: newMessage,
        timestamp: serverTimestamp()
      });
      setNewMessage('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'messages');
    }
  };

  return (
    <Card className="flex flex-col h-[600px] bg-gray-50">
      <div className="p-4 bg-white border-b border-gray-200 flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
          <MessageSquare size={20} />
        </div>
        <div>
          <h4 className="font-bold text-gray-900">Chat</h4>
          <p className="text-xs text-gray-500">Stel je vragen hier</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => {
          const isMe = (currentUserRole === 'therapist' && msg.senderId === therapistId) || 
                       (currentUserRole === 'parent' && msg.senderId === clientId);
          
          return (
            <div key={msg.id || idx} className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
              <div className={cn(
                'max-w-[80%] p-3 rounded-2xl text-sm shadow-sm',
                isMe ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-gray-900 rounded-tl-none'
              )}>
                {msg.text}
              </div>
              <span className="text-[10px] text-gray-400 mt-1 px-1">
                {msg.timestamp?.toDate ? format(msg.timestamp.toDate(), 'HH:mm', { locale: nl }) : '...'}
              </span>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-gray-200 flex gap-2">
        <input 
          type="text" 
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          placeholder="Typ een bericht..."
          className="flex-1 px-4 py-2 rounded-xl bg-gray-100 border-transparent focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
        />
        <Button type="submit" className="p-2 rounded-xl">
          <Send size={20} />
        </Button>
      </form>
    </Card>
  );
}
