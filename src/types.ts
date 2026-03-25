export type Role = 'therapist' | 'parent';

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  name: string;
  therapistId?: string;
  shortId?: string; // For therapists to share with parents
}

export interface Video {
  id: string;
  title: string;
  url: string;
  description?: string;
  therapistId: string;
}

export interface Assignment {
  id: string;
  clientId: string;
  videoId: string;
  therapistId: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: any; // Firestore Timestamp
}
