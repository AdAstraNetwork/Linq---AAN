/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  where,
  updateDoc,
  increment,
  deleteDoc,
  serverTimestamp,
  getDocs,
  getDocsFromServer,
  addDoc,
  orderBy,
  limit,
  collectionGroup,
  arrayUnion,
  arrayRemove,
  startAfter
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { cn } from './lib/utils';
import {
  Sparkles,
  User as UserIcon,
  Store,
  LogOut,
  Plus,
  CheckCircle2,
  Gift,
  ChevronRight,
  Search,
  MapPin,
  Star,
  Wallet,
  LayoutDashboard,
  QrCode,
  Bell,
  Filter,
  Map as MapIcon,
  Settings,
  X,
  Archive,
  Clock,
  TrendingUp,
  Users,
  Calendar,
  MessageSquare,
  Heart,
  Send,
  Trophy,
  Compass,
  MessageCircle,
  Zap,
  Flame,
  UserPlus,
  UserCheck,
  ArrowLeft,
  MoreVertical,
  Trash2,
  BarChart2,
  Image,
  Flag,
  ChevronDown,
  Palette,
  Building2,
  Edit3
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';

// --- Types ---

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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
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
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the whole app, but we log it clearly
  return errInfo;
}

type UserRole = 'consumer' | 'vendor';
type Category = 'Food' | 'Beauty' | 'Barber' | 'Gym' | 'Parking' | 'Retail';

interface UserProfile {
  uid: string;
  name: string;
  handle?: string;
  email: string;
  photoURL: string;
  role: UserRole;
  roleConfirmed?: boolean;
  onboardingComplete?: boolean;
  gender?: string;
  birthday?: string;
  location?: { lat: number; lng: number; city?: string };
  total_cards_held: number;
  totalStamps: number;
  totalRedeemed: number;
}

interface StoreProfile {
  id: string;
  name: string;
  category: Category;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
  coverUrl: string;
  ownerUid: string;
  description: string;
  isVerified: boolean;
  stamps_required_for_reward: number;
  reward?: string;
  theme?: string;
  location?: string;
  visibilitySettings?: {
    members?: boolean;
    stamps?: boolean;
    activeCards?: boolean;
    returnRate?: boolean;
    followers?: boolean;
  };
}

interface Card {
  id: string;
  user_id: string;
  store_id: string;
  current_stamps: number;
  total_completed_cycles: number;
  last_tap_timestamp: any;
  isArchived?: boolean;
  isRedeemed?: boolean;
}

interface Notification {
  id: string;
  toUid: string;
  fromUid: string;
  fromName: string;
  fromPhoto: string;
  type: 'follow' | 'system' | 'like' | 'comment' | 'message';
  message: string;
  isRead: boolean;
  createdAt: any;
}

interface Transaction {
  id: string;
  user_id: string;
  store_id: string;
  completed_at: any;
  stamps_at_completion: number;
  reward_claimed: boolean;
}

interface Chat {
  id: string;
  uids: string[];
  lastMessage: string;
  lastActivity: any;
  unreadCount?: { [uid: string]: number };
}

interface ChatMessage {
  id: string;
  chatId: string;
  senderUid: string;
  senderName: string;
  text: string;
  createdAt: any;
}

interface Post {
  id: string;
  store_id: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  createdAt: any;
  likesCount: number;
}

interface Comment {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  createdAt: any;
}

interface GlobalPost {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  authorRole: 'consumer' | 'vendor';
  storeId?: string;
  storeName?: string;
  wallPost?: boolean;
  toUid?: string;
  toName?: string;
  toPhoto?: string;
  content: string;
  postType: 'post' | 'poll' | 'review';
  rating?: number;
  storeReviewId?: string;
  pollOptions?: { text: string }[];
  pollVotes?: { [key: string]: string[] };
  createdAt: any;
  likesCount: number;
  likedBy?: string[];
}

// --- Main App Component ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('for-you');
  const [viewingStore, setViewingStore] = useState<StoreProfile | null>(null);
  const [viewingUser, setViewingUser] = useState<UserProfile | null>(null);

  // If the target user is a vendor, go straight to their store instead of their user profile
  const handleViewUser = async (targetUser: UserProfile) => {
    if (targetUser.role === 'vendor') {
      try {
        const q = query(collection(db, 'stores'), where('ownerUid', '==', targetUser.uid));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setViewingStore({ id: snap.docs[0].id, ...snap.docs[0].data() } as StoreProfile);
          setViewingUser(null);
          return;
        }
      } catch { /* fall through to user profile */ }
    }
    setViewingUser(targetUser);
  };
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [userCards, setUserCards] = useState<Card[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Listen to user's cards globally to sync stats
  useEffect(() => {
    if (!user) {
      setUserCards([]);
      return;
    }
    const q = query(collection(db, 'cards'), where('user_id', '==', user.uid));
    return onSnapshot(q, (snap) => {
      setUserCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card)));
    }, (error) => console.error("Global cards listener:", error));
  }, [user]);

  // Listen to ALL notifications (shown in feed); badge count tracks unread separately
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const q = query(
      collection(db, 'notifications'),
      where('toUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    return onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as Notification)));
    }, (error) => console.error("Notifications listener:", error));
  }, [user]);

  // Listen to unread message count via chats
  useEffect(() => {
    if (!user) { setUnreadMessages(0); return; }
    const q = query(collection(db, 'chats'), where('uids', 'array-contains', user.uid));
    return onSnapshot(q, (snap) => {
      const total = snap.docs.reduce((sum, d) => {
        const uc = d.data().unreadCount || {};
        return sum + (uc[user.uid] || 0);
      }, 0);
      setUnreadMessages(total);
    }, () => {});
  }, [user]);

  // Daily stamp reminder — fires once per day per device
  useEffect(() => {
    if (!user || userCards.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `stamp_reminder_${user.uid}_${today}`;
    if (localStorage.getItem(key)) return;
    const activeCards = userCards.filter(c => !c.isArchived);
    if (activeCards.length === 0) return;
    const stampedToday = activeCards.some(c => {
      if (!c.last_tap_timestamp) return false;
      const ts = c.last_tap_timestamp.toDate?.() || new Date(c.last_tap_timestamp);
      return ts.toISOString().slice(0, 10) === today;
    });
    if (!stampedToday) {
      localStorage.setItem(key, '1');
      addDoc(collection(db, 'notifications'), {
        toUid: user.uid,
        fromUid: 'system',
        fromName: 'Linq',
        fromPhoto: '',
        type: 'system',
        message: `Don't forget to collect your stamps today! You have ${activeCards.length} active card${activeCards.length > 1 ? 's' : ''}.`,
        isRead: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  }, [user, userCards]);

  // Listen to profile changes
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setProfile(doc.data() as UserProfile);
      }
    }, (error) => console.error("Profile listener:", error));
  }, [user]);
  useEffect(() => {
    const seedDemoStores = async () => {
      try {
        const storeSnap = await getDocs(collection(db, 'stores'));
        if (storeSnap.empty) {
          console.log("Seeding demo stores...");
          const demoStores = [
            { name: 'The Coffee House', category: 'Food', address: '123 Brew St', phone: '555-0101', email: 'coffee@example.com', logoUrl: 'https://picsum.photos/seed/coffee/200/200', coverUrl: 'https://picsum.photos/seed/coffee-bg/800/400', ownerUid: 'demo-vendor', description: 'Best beans in town.', isVerified: true, stamps_required_for_reward: 10 },
            { name: 'Glow Beauty', category: 'Beauty', address: '456 Shine Ave', phone: '555-0202', email: 'glow@example.com', logoUrl: 'https://picsum.photos/seed/beauty/200/200', coverUrl: 'https://picsum.photos/seed/beauty-bg/800/400', ownerUid: 'demo-vendor', description: 'Premium skincare.', isVerified: true, stamps_required_for_reward: 8 },
            { name: 'Iron Gym', category: 'Gym', address: '789 Muscle Rd', phone: '555-0303', email: 'iron@example.com', logoUrl: 'https://picsum.photos/seed/gym/200/200', coverUrl: 'https://picsum.photos/seed/gym-bg/800/400', ownerUid: 'demo-vendor', description: 'Get strong.', isVerified: false, stamps_required_for_reward: 12 },
            { name: 'Urban Barber', category: 'Barber', address: '101 Fade St', phone: '555-0404', email: 'barber@example.com', logoUrl: 'https://picsum.photos/seed/barber/200/200', coverUrl: 'https://picsum.photos/seed/barber-bg/800/400', ownerUid: 'demo-vendor', description: 'Sharp cuts.', isVerified: true, stamps_required_for_reward: 6 },
          ];
          for (const store of demoStores) {
            await addDoc(collection(db, 'stores'), store);
          }
          console.log("Demo stores seeded.");
        }
      } catch (error) {
        console.error("Error seeding demo stores:", error);
      }
    };
    seedDemoStores();
  }, []);

  useEffect(() => {
    if (!user) return;
    const seedDemoPosts = async () => {
      try {
        const snap = await getDocsFromServer(query(collection(db, 'global_posts'), limit(1)));
        if (!snap.empty) return;

        const users = [
          { uid: 'demo_u1', name: 'Alex Rivers',    photo: 'https://i.pravatar.cc/150?u=alexrivers',   role: 'consumer' },
          { uid: 'demo_u2', name: 'Jordan Smith',   photo: 'https://i.pravatar.cc/150?u=jordansmith',  role: 'consumer' },
          { uid: 'demo_u3', name: 'Casey Chen',     photo: 'https://i.pravatar.cc/150?u=caseychen',    role: 'consumer' },
          { uid: 'demo_u4', name: 'Sam Taylor',     photo: 'https://i.pravatar.cc/150?u=samtaylor',    role: 'consumer' },
          { uid: 'demo_u5', name: 'Morgan Lee',     photo: 'https://i.pravatar.cc/150?u=morganlee',    role: 'consumer' },
        ];

        const vendors = [
          { uid: 'demo_v1', name: 'The Coffee House',  photo: 'https://picsum.photos/seed/coffee/200/200',  store: 'The Coffee House' },
          { uid: 'demo_v2', name: 'Glow Beauty',       photo: 'https://picsum.photos/seed/beauty/200/200',  store: 'Glow Beauty' },
          { uid: 'demo_v3', name: 'Iron Gym',          photo: 'https://picsum.photos/seed/gym/200/200',     store: 'Iron Gym' },
          { uid: 'demo_v4', name: 'Urban Barber',      photo: 'https://picsum.photos/seed/barber/200/200',  store: 'Urban Barber' },
        ];

        const posts = [
          // User posts
          {
            authorUid: users[0].uid, authorName: users[0].name, authorPhoto: users[0].photo, authorRole: 'consumer',
            content: "Just hit my 8th stamp at The Coffee House ☕ Free coffee is so close I can taste it!",
            postType: 'post', likesCount: 14,
            likedBy: [users[1].uid, users[2].uid, users[3].uid, users[4].uid],
            pollOptions: null, pollVotes: null,
          },
          {
            authorUid: users[1].uid, authorName: users[1].name, authorPhoto: users[1].photo, authorRole: 'consumer',
            content: "Glow Beauty just gave me the best facial I've ever had. The loyalty rewards make it even sweeter 💅",
            postType: 'post', likesCount: 22,
            likedBy: [users[0].uid, users[2].uid, users[4].uid],
            pollOptions: null, pollVotes: null,
          },
          {
            authorUid: users[2].uid, authorName: users[2].name, authorPhoto: users[2].photo, authorRole: 'consumer',
            content: "Iron Gym is changing my life. Two months in and already redeemed my first free session 💪 Anyone else training there?",
            postType: 'post', likesCount: 18,
            likedBy: [users[3].uid, users[4].uid, users[0].uid],
            pollOptions: null, pollVotes: null,
          },
          {
            authorUid: users[3].uid, authorName: users[3].name, authorPhoto: users[3].photo, authorRole: 'consumer',
            content: "PSA: Urban Barber now has Sunday hours 🙌 Got my fresh cut this morning and earned stamp #5. One more for a free service!",
            postType: 'post', likesCount: 9,
            likedBy: [users[1].uid, users[2].uid],
            pollOptions: null, pollVotes: null,
          },
          {
            authorUid: users[4].uid, authorName: users[4].name, authorPhoto: users[4].photo, authorRole: 'consumer',
            content: "Linq is genuinely the best loyalty app I've used. Actually motivates me to keep going back to my favourite spots 🔥",
            postType: 'post', likesCount: 31,
            likedBy: [users[0].uid, users[1].uid, users[2].uid, users[3].uid],
            pollOptions: null, pollVotes: null,
          },
          // Vendor posts
          {
            authorUid: vendors[0].uid, authorName: vendors[0].name, authorPhoto: vendors[0].photo, authorRole: 'vendor',
            storeName: vendors[0].store,
            content: "🎉 DOUBLE STAMPS this entire weekend! Friday through Sunday — every purchase earns 2x stamps. Come level up your card ☕",
            postType: 'post', likesCount: 47,
            likedBy: [users[0].uid, users[1].uid, users[2].uid, users[3].uid, users[4].uid],
            pollOptions: null, pollVotes: null,
          },
          {
            authorUid: vendors[1].uid, authorName: vendors[1].name, authorPhoto: vendors[1].photo, authorRole: 'vendor',
            storeName: vendors[1].store,
            content: "✨ Our summer skincare range has arrived! Book any facial this week and receive 3 BONUS stamps. Spaces filling fast 🌸",
            postType: 'post', likesCount: 35,
            likedBy: [users[1].uid, users[4].uid],
            pollOptions: null, pollVotes: null,
          },
          {
            authorUid: vendors[2].uid, authorName: vendors[2].name, authorPhoto: vendors[2].photo, authorRole: 'vendor',
            storeName: vendors[2].store,
            content: "New Olympic lifting platform just landed 💪 First 20 members to use it this week get a bonus stamp. First come, first served!",
            postType: 'post', likesCount: 28,
            likedBy: [users[2].uid, users[3].uid],
            pollOptions: null, pollVotes: null,
          },
          // User polls
          {
            authorUid: users[0].uid, authorName: users[0].name, authorPhoto: users[0].photo, authorRole: 'consumer',
            content: "Which local business deserves more love? 👇",
            postType: 'poll', likesCount: 8,
            likedBy: [users[1].uid, users[2].uid],
            pollOptions: [{ text: 'The Coffee House ☕' }, { text: 'Glow Beauty 💅' }, { text: 'Iron Gym 💪' }, { text: 'Urban Barber ✂️' }],
            pollVotes: { '0': [users[1].uid, users[2].uid], '1': [users[3].uid, users[4].uid], '2': [users[0].uid], '3': [] },
          },
          {
            authorUid: users[3].uid, authorName: users[3].name, authorPhoto: users[3].photo, authorRole: 'consumer',
            content: "What's your ideal loyalty reward? 🎁",
            postType: 'poll', likesCount: 12,
            likedBy: [users[0].uid, users[4].uid],
            pollOptions: [{ text: 'Free item / drink' }, { text: 'Percentage discount' }, { text: 'Bonus stamps' }, { text: 'Exclusive experience' }],
            pollVotes: { '0': [users[0].uid, users[2].uid], '1': [users[1].uid, users[3].uid], '2': [users[4].uid], '3': [] },
          },
          {
            authorUid: users[4].uid, authorName: users[4].name, authorPhoto: users[4].photo, authorRole: 'consumer',
            content: "How many loyalty cards are you actively collecting? 🃏",
            postType: 'poll', likesCount: 7,
            likedBy: [users[2].uid],
            pollOptions: [{ text: '1–2 cards' }, { text: '3–5 cards' }, { text: '6–10 cards' }, { text: '10+ (collector mode)' }],
            pollVotes: { '0': [users[3].uid], '1': [users[0].uid, users[1].uid, users[4].uid], '2': [users[2].uid], '3': [] },
          },
          // Vendor polls
          {
            authorUid: vendors[0].uid, authorName: vendors[0].name, authorPhoto: vendors[0].photo, authorRole: 'vendor',
            storeName: vendors[0].store,
            content: "Help us choose our next seasonal special! Vote below ☕👇",
            postType: 'poll', likesCount: 19,
            likedBy: [users[0].uid, users[1].uid, users[2].uid],
            pollOptions: [{ text: 'Pumpkin Spice Latte 🎃' }, { text: 'Iced Matcha Coconut 🍵' }, { text: 'Lavender Honey Flat White 🌸' }, { text: 'Chai Oat Bomb 🧡' }],
            pollVotes: { '0': [users[0].uid, users[3].uid], '1': [users[1].uid, users[4].uid], '2': [users[2].uid], '3': [] },
          },
          {
            authorUid: vendors[2].uid, authorName: vendors[2].name, authorPhoto: vendors[2].photo, authorRole: 'vendor',
            storeName: vendors[2].store,
            content: "We're extending opening hours! When would you use the gym most? 🏋️",
            postType: 'poll', likesCount: 23,
            likedBy: [users[2].uid, users[3].uid, users[4].uid],
            pollOptions: [{ text: 'Earlier mornings (5am)' }, { text: 'Late nights (until 11pm)' }, { text: 'Weekend afternoons' }, { text: 'All of the above!' }],
            pollVotes: { '0': [users[0].uid], '1': [users[1].uid, users[3].uid], '2': [users[2].uid], '3': [users[4].uid] },
          },
          {
            authorUid: vendors[3].uid, authorName: vendors[3].name, authorPhoto: vendors[3].photo, authorRole: 'vendor',
            storeName: vendors[3].store,
            content: "What new service should we add? Your vote decides! ✂️",
            postType: 'poll', likesCount: 15,
            likedBy: [users[0].uid, users[3].uid],
            pollOptions: [{ text: 'Hot towel shave' }, { text: 'Hair colouring' }, { text: 'Scalp treatment' }, { text: "Men's facials" }],
            pollVotes: { '0': [users[0].uid, users[1].uid], '1': [users[2].uid], '2': [users[3].uid, users[4].uid], '3': [] },
          },
        ];

        for (const post of posts) {
          await addDoc(collection(db, 'global_posts'), { ...post, createdAt: serverTimestamp() });
        }
      } catch (err) {
        console.error('Error seeding demo posts:', err);
      }
    };
    seedDemoPosts();
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (!userDoc.exists()) {
          setNeedsRoleSelection(true);
        } else {
          const data = userDoc.data();
          setNeedsOnboarding(data.roleConfirmed === true && !data.onboardingComplete);
        }
      } else {
        setNeedsRoleSelection(false);
        setNeedsOnboarding(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleDeleteAccount = async () => {
    if (!user) return;
    const uid = user.uid;

    const tryDelete = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.warn('Delete step skipped:', e); } };

    await tryDelete(async () => {
      const snap = await getDocs(query(collection(db, 'global_posts'), where('authorUid', '==', uid)));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    });
    await tryDelete(async () => {
      const [a, b] = await Promise.all([
        getDocs(query(collection(db, 'follows'), where('followerUid', '==', uid))),
        getDocs(query(collection(db, 'follows'), where('followingUid', '==', uid))),
      ]);
      await Promise.all([...a.docs, ...b.docs].map(d => deleteDoc(d.ref)));
    });
    await tryDelete(async () => {
      const snap = await getDocs(query(collection(db, 'store_follows'), where('followerUid', '==', uid)));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    });
    await tryDelete(async () => {
      const [a, b] = await Promise.all([
        getDocs(query(collection(db, 'user_reviews'), where('authorUid', '==', uid))),
        getDocs(query(collection(db, 'user_reviews'), where('toUid', '==', uid))),
      ]);
      await Promise.all([...a.docs, ...b.docs].map(d => deleteDoc(d.ref)));
    });
    await tryDelete(async () => {
      const snap = await getDocs(query(collection(db, 'stores'), where('ownerUid', '==', uid)));
      await Promise.all(snap.docs.map(async (storeDoc) => {
        const posts = await getDocs(collection(db, 'stores', storeDoc.id, 'posts'));
        await Promise.all(posts.docs.map(d => deleteDoc(d.ref)));
        await deleteDoc(storeDoc.ref);
      }));
    });
    await tryDelete(async () => {
      const snap = await getDocs(query(collection(db, 'notifications'), where('toUid', '==', uid)));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    });
    await tryDelete(() => deleteDoc(doc(db, 'users', uid)));

    // Delete the Firebase Auth account, re-authenticating if the session is stale
    try {
      await user.delete();
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
        await user.delete();
      } else {
        console.error('user.delete() failed:', err);
        throw err;
      }
    }
    await signOut(auth);
  };

  const handleRoleSelect = async (role: 'consumer' | 'vendor') => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const existing = await getDoc(userRef);
    if (existing.exists()) {
      await updateDoc(userRef, { role, roleConfirmed: true });
    } else {
      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || 'Guest',
        email: user.email || '',
        photoURL: user.photoURL || '',
        role,
        roleConfirmed: true,
        total_cards_held: 0,
        totalStamps: 0,
        totalRedeemed: 0
      });
    }
    setNeedsRoleSelection(false);
    setNeedsOnboarding(true);
  };

  const handleOnboardingComplete = async (data: { gender: string; birthday: string; location: { lat: number; lng: number; city?: string } | null }) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      ...(data.gender ? { gender: data.gender } : {}),
      ...(data.birthday ? { birthday: data.birthday } : {}),
      ...(data.location ? { location: data.location } : {}),
      onboardingComplete: true
    });
    setNeedsOnboarding(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Sparkles className="w-12 h-12 text-brand-gold" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  if (needsRoleSelection) {
    return <RoleSelectionScreen user={user} onSelect={handleRoleSelect} />;
  }

  if (needsOnboarding) {
    return <OnboardingScreen user={user} onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen pb-24 max-w-md mx-auto shadow-xl shadow-black/5 relative overflow-hidden bg-white">
      {/* Header */}
      <header className="glass-panel sticky top-0 z-50 px-5 py-3.5 flex items-center justify-between">
        <button
          onClick={() => setShowCreatePost(true)}
          className="w-9 h-9 gradient-red rounded-xl flex items-center justify-center shadow-md shadow-red-500/20 active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5 text-white" />
        </button>
        <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 gradient-red rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-display font-bold text-xl tracking-tight"><span className="text-brand-gold">Li</span>nq</h1>
        </button>
        <button
          onClick={() => setShowNotifications(true)}
          className="relative w-9 h-9 flex items-center justify-center text-brand-navy/60 hover:text-brand-navy transition-colors"
        >
          <Bell className="w-6 h-6" />
          {notifications.filter(n => !n.isRead).length > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-brand-gold rounded-full border-2 border-white" />
          )}
        </button>
      </header>

      {/* Main Content */}
      <main className="px-6 py-8">
        <AnimatePresence mode="wait">
          {viewingStore ? (
            <StoreProfileView
              key="store-profile"
              store={viewingStore}
              onBack={() => setViewingStore(null)}
              user={user}
              profile={profile}
              onViewUser={handleViewUser}
              onMessage={(chatId) => {
                setActiveChatId(chatId);
                setActiveTab('messages');
                setViewingStore(null);
              }}
            />
          ) : viewingUser ? (
            <PublicUserProfile 
              key="user-profile" 
              targetUser={viewingUser} 
              onBack={() => setViewingUser(null)} 
              currentUser={user}
              currentProfile={profile}
              onMessage={(chatId) => {
                setActiveChatId(chatId);
                setActiveTab('messages');
                setViewingUser(null);
              }}
              onViewStore={(s) => {
                setViewingUser(null);
                setViewingStore(s);
              }}
            />
          ) : profile?.role === 'consumer' ? (
            <ConsumerApp
              key="consumer"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              profile={profile}
              user={user}
              onViewStore={setViewingStore}
              onViewUser={handleViewUser}
              cards={userCards}
              notifications={notifications}
              activeChatId={activeChatId}
              setActiveChatId={setActiveChatId}
              onLogout={handleLogout}
              onDeleteAccount={handleDeleteAccount}
            />
          ) : (
            <VendorApp
              key="vendor"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              profile={profile}
              user={user}
              onViewUser={handleViewUser}
              notifications={notifications}
              activeChatId={activeChatId}
              setActiveChatId={setActiveChatId}
              onLogout={handleLogout}
              onDeleteAccount={handleDeleteAccount}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Settings Menu */}
      <AnimatePresence>
        {showSettings && (
          <SettingsMenu
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            profile={profile}
            userCards={userCards}
          />
        )}
      </AnimatePresence>

      {/* Notifications Panel */}
      <AnimatePresence>
        {showNotifications && (
          <NotificationsPanel
            notifications={notifications}
            onClose={() => setShowNotifications(false)}
          />
        )}
      </AnimatePresence>

      {/* Create Post Modal */}
      <AnimatePresence>
        {showCreatePost && user && (
          <CreatePostModal
            onClose={() => setShowCreatePost(false)}
            user={user}
            profile={profile}
          />
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto glass-panel border-t border-black/5 px-4 py-4 flex justify-between items-center z-50">
        <NavButton 
          active={activeTab === 'for-you'} 
          onClick={() => { setActiveTab('for-you'); setViewingStore(null); setViewingUser(null); }}
          icon={<Zap />}
          label="For You"
          badgeCount={notifications.filter(n => !n.isRead).length}
        />
        <NavButton
          active={activeTab === 'messages'}
          onClick={() => { setActiveTab('messages'); setViewingStore(null); setViewingUser(null); }}
          icon={<MessageCircle />}
          label="Messages"
          badgeCount={unreadMessages}
        />
        <NavButton 
          active={activeTab === 'home'} 
          onClick={() => { setActiveTab('home'); setViewingStore(null); setViewingUser(null); }}
          icon={profile?.role === 'consumer' ? <Wallet /> : <LayoutDashboard />}
          label={profile?.role === 'consumer' ? 'Stamps' : 'Dashboard'}
        />
        <NavButton 
          active={activeTab === 'discover'} 
          onClick={() => { setActiveTab('discover'); setViewingStore(null); setViewingUser(null); }}
          icon={profile?.role === 'consumer' ? <Compass /> : <Plus />}
          label={profile?.role === 'consumer' ? 'Discovery' : 'Issue'}
        />
        <NavButton 
          active={activeTab === 'profile'} 
          onClick={() => { setActiveTab('profile'); setViewingStore(null); setViewingUser(null); }}
          icon={<UserIcon />}
          label="Profile"
        />
      </nav>
    </div>
  );
}

// --- Shared Components ---

function LandingPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center" style={{background: 'linear-gradient(160deg, #7f1d1d 0%, #b91c1c 40%, #dc2626 70%, #ef4444 100%)'}}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12"
      >
        <div className="w-24 h-24 bg-white/20 backdrop-blur-sm rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-black/20 border border-white/30">
          <Sparkles className="w-12 h-12 text-white" />
        </div>
        <h1 className="font-display text-4xl font-bold text-white mb-4">Linq</h1>
        <p className="text-white/60 text-lg max-w-xs mx-auto">
          Collect stamps, unlock rewards, and support your favorite local businesses.
        </p>
      </motion.div>

      <div className="w-full max-w-xs space-y-4">
        <button 
          onClick={onLogin}
          className="w-full bg-white text-brand-navy font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" />
          Continue with Google
        </button>
        <button className="w-full bg-white/15 backdrop-blur-sm text-white font-bold py-4 rounded-2xl hover:bg-white/25 transition-all border border-white/20">
          Create Account
        </button>
      </div>
    </div>
  );
}

function RoleSelectionScreen({ user, onSelect }: { user: FirebaseUser, onSelect: (role: 'consumer' | 'vendor') => void }) {
  const [selecting, setSelecting] = React.useState<'consumer' | 'vendor' | null>(null);
  const handle = async (role: 'consumer' | 'vendor') => {
    setSelecting(role);
    await onSelect(role);
  };
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center bg-brand-bg">
      <div className="mb-8">
        <div className="w-16 h-16 gradient-red rounded-[1.5rem] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-red-500/20">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="font-display font-bold text-3xl text-brand-navy mb-2">Welcome to <span className="text-brand-gold">Li</span>nq</h1>
        <p className="text-brand-navy/50 text-sm">How would you like to use Linq?</p>
      </div>

      <div className="w-full max-w-xs space-y-4">
        <button
          onClick={() => handle('consumer')}
          disabled={selecting !== null}
          className="w-full bg-white border-2 border-brand-navy/10 rounded-[2rem] p-6 text-left flex items-center gap-4 hover:border-brand-gold/40 hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-60"
        >
          <div className="w-12 h-12 bg-brand-gold/10 rounded-2xl flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6 text-brand-gold" />
          </div>
          <div>
            <p className="font-bold text-brand-navy text-base">I'm a Customer</p>
            <p className="text-xs text-brand-navy/40 mt-0.5">Collect stamps & earn rewards</p>
          </div>
          {selecting === 'consumer' && <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="ml-auto"><Sparkles className="w-5 h-5 text-brand-gold" /></motion.div>}
        </button>

        <button
          onClick={() => handle('vendor')}
          disabled={selecting !== null}
          className="w-full bg-brand-navy rounded-[2rem] p-6 text-left flex items-center gap-4 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-base">I'm a Business</p>
            <p className="text-xs text-white/50 mt-0.5">Run a loyalty programme</p>
          </div>
          {selecting === 'vendor' && <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="ml-auto"><Sparkles className="w-5 h-5 text-white" /></motion.div>}
        </button>
      </div>

      <p className="text-xs text-brand-navy/30 mt-8">You can update this later in your profile settings</p>
    </div>
  );
}

function OnboardingScreen({ user, onComplete }: { user: FirebaseUser, onComplete: (data: { gender: string; birthday: string; location: { lat: number; lng: number; city?: string } | null }) => Promise<void> }) {
  const STEPS = ['gender', 'birthday', 'location'] as const;
  const [step, setStep] = React.useState(0);
  const [gender, setGender] = React.useState('');
  const [birthday, setBirthday] = React.useState('');
  const [locationData, setLocationData] = React.useState<{ lat: number; lng: number; city?: string } | null>(null);
  const [locationStatus, setLocationStatus] = React.useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [saving, setSaving] = React.useState(false);

  const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

  const canAdvance = step === 0 ? !!gender : step === 1 ? !!birthday : locationStatus === 'granted' || locationStatus === 'denied';

  const requestLocation = () => {
    setLocationStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let city: string | undefined;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
          const json = await res.json();
          city = json.address?.city || json.address?.town || json.address?.village;
        } catch {}
        setLocationData({ lat, lng, city });
        setLocationStatus('granted');
      },
      () => setLocationStatus('denied'),
      { timeout: 10000 }
    );
  };

  const handleFinish = async () => {
    setSaving(true);
    await onComplete({ gender, birthday, location: locationData });
  };

  const stepContent = [
    // Step 0 — Gender
    <>
      <div className="w-14 h-14 bg-brand-gold/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <UserCheck className="w-7 h-7 text-brand-gold" />
      </div>
      <h2 className="font-display font-bold text-2xl text-brand-navy mb-1">What's your gender?</h2>
      <p className="text-sm text-brand-navy/40 mb-8">Help us personalise your experience</p>
      <div className="w-full space-y-3">
        {GENDERS.map(g => (
          <button
            key={g}
            onClick={() => setGender(g)}
            className={`w-full py-4 px-5 rounded-2xl font-bold text-sm flex items-center justify-between transition-all active:scale-[0.98] ${
              gender === g
                ? 'bg-brand-navy text-white shadow-lg shadow-brand-navy/20'
                : 'bg-white border-2 border-brand-navy/10 text-brand-navy hover:border-brand-gold/40'
            }`}
          >
            {g}
            {gender === g && <Sparkles size={16} className="text-brand-gold" />}
          </button>
        ))}
      </div>
    </>,

    // Step 1 — Birthday
    <>
      <div className="w-14 h-14 bg-brand-gold/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <Calendar className="w-7 h-7 text-brand-gold" />
      </div>
      <h2 className="font-display font-bold text-2xl text-brand-navy mb-1">When's your birthday?</h2>
      <p className="text-sm text-brand-navy/40 mb-8">Get exclusive birthday rewards from businesses</p>
      <div className="w-full">
        <input
          type="date"
          value={birthday}
          onChange={e => setBirthday(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
          className="w-full px-5 py-4 rounded-2xl bg-white border-2 border-brand-navy/10 text-brand-navy font-bold text-base focus:outline-none focus:border-brand-gold/60 text-center"
        />
      </div>
    </>,

    // Step 2 — Location
    <>
      <div className="w-14 h-14 bg-brand-gold/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <MapPin className="w-7 h-7 text-brand-gold" />
      </div>
      <h2 className="font-display font-bold text-2xl text-brand-navy mb-1">Find nearby deals</h2>
      <p className="text-sm text-brand-navy/40 mb-8">Allow location access to discover businesses around you</p>
      <div className="w-full">
        {locationStatus === 'idle' && (
          <button
            onClick={requestLocation}
            className="w-full py-4 px-5 rounded-2xl bg-brand-navy text-white font-bold flex items-center justify-center gap-3 active:scale-[0.98] transition-all shadow-lg shadow-brand-navy/20"
          >
            <MapPin size={18} />
            Allow Location Access
          </button>
        )}
        {locationStatus === 'requesting' && (
          <div className="flex items-center justify-center gap-3 py-4 text-brand-navy/50">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
              <Sparkles size={18} className="text-brand-gold" />
            </motion.div>
            <span className="font-medium text-sm">Requesting access…</span>
          </div>
        )}
        {locationStatus === 'granted' && (
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
              <MapPin size={18} className="text-green-600" />
            </div>
            <div className="text-left">
              <p className="font-bold text-green-700 text-sm">Location allowed</p>
              {locationData?.city && <p className="text-xs text-green-600/70 mt-0.5">{locationData.city}</p>}
            </div>
          </div>
        )}
        {locationStatus === 'denied' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 text-center">
              <p className="font-bold text-amber-700 text-sm">Location access denied</p>
              <p className="text-xs text-amber-600/70 mt-1">You can enable it later in your device settings</p>
            </div>
          </div>
        )}
      </div>
    </>
  ];

  return (
    <div className="min-h-screen flex flex-col bg-brand-bg px-8">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 pt-14 mb-10">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all ${i === step ? 'w-8 h-2 bg-brand-navy' : i < step ? 'w-2 h-2 bg-brand-navy/40' : 'w-2 h-2 bg-brand-navy/15'}`}
          />
        ))}
      </div>

      <div className="flex-1 flex flex-col items-center text-center max-w-xs mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
            className="w-full"
          >
            {stepContent[step]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="pb-12 max-w-xs mx-auto w-full space-y-3">
        <button
          onClick={() => {
            if (step < STEPS.length - 1) setStep(s => s + 1);
            else handleFinish();
          }}
          disabled={!canAdvance || saving}
          className="w-full py-4 rounded-2xl bg-brand-navy text-white font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {saving
            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Sparkles size={16} /></motion.div> Setting up…</>
            : step < STEPS.length - 1 ? 'Continue' : 'Get Started'}
        </button>
        {step < STEPS.length - 1 && (
          <button onClick={() => setStep(s => s + 1)} className="w-full py-3 text-xs text-brand-navy/30 hover:text-brand-navy/50 transition-colors">
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, badgeCount }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, badgeCount?: number }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all relative",
        active ? "text-brand-gold" : "text-brand-navy/40 hover:text-brand-navy/60"
      )}
    >
      <div className={cn(
        "p-2 rounded-xl transition-all",
        active && "bg-brand-gold/10"
      )}>
        {React.cloneElement(icon as React.ReactElement, { size: 24 })}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      {badgeCount !== undefined && badgeCount > 0 && (
        <span className="absolute top-0 right-2 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center border-2 border-white">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </button>
  );
}

// --- Consumer App ---

function ConsumerApp({ activeTab, setActiveTab, profile, user, onViewStore, onViewUser, cards: initialCards, notifications, activeChatId, setActiveChatId, onLogout, onDeleteAccount }: { activeTab: string, setActiveTab: (tab: string) => void, profile: UserProfile | null, user: FirebaseUser, onViewStore: (s: StoreProfile) => void, onViewUser: (u: UserProfile) => void, cards: Card[], notifications: Notification[], activeChatId: string | null, setActiveChatId: (id: string | null) => void, onLogout: () => void, onDeleteAccount: () => Promise<void>, key?: React.Key }) {
  const [stores, setStores] = useState<StoreProfile[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'stores'), (snapshot) => {
      setStores(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoreProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stores');
    });
    return unsubscribe;
  }, []);

  const handleJoinStore = async (store: StoreProfile) => {
    if (!user) return;
    const cardId = `${user.uid}_${store.id}`;
    const cardRef = doc(db, 'cards', cardId);
    const cardSnap = await getDoc(cardRef);
    if (!cardSnap.exists() || cardSnap.data()?.isArchived) {
      await setDoc(cardRef, {
        user_id: user.uid,
        store_id: store.id,
        current_stamps: 0,
        total_completed_cycles: 0,
        last_tap_timestamp: serverTimestamp(),
        isArchived: false,
        isRedeemed: false,
        userName: user.displayName || user.email?.split('@')[0] || 'Loyal Customer',
        userPhoto: user.photoURL || ''
      });
      
      // Update user total_cards_held
      await updateDoc(doc(db, 'users', user.uid), {
        total_cards_held: increment(1)
      });

      setActiveTab('home');
    }
  };

  const activeCards = initialCards.filter(c => !c.isArchived);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      {activeTab === 'for-you' && (
        <ForYouScreen onViewUser={onViewUser} onViewStore={onViewStore} currentUser={user} currentProfile={profile} userCards={initialCards} />
      )}

      {activeTab === 'messages' && (
        <MessagesScreen 
          currentUser={user} 
          currentProfile={profile} 
          activeChatId={activeChatId} 
          setActiveChatId={setActiveChatId}
          onViewUser={onViewUser}
        />
      )}

      {activeTab === 'home' && (
        <div className="space-y-8">
          <header>
            <h2 className="font-display text-3xl font-bold mb-1">My Passes</h2>
            <p className="text-brand-navy/60">You have {activeCards.length} active loyalty cards.</p>
          </header>

          <div className="space-y-4">
            {activeCards.length > 0 ? (
              activeCards.map(card => {
                const store = stores.find(s => s.id === card.store_id);
                return <LoyaltyCard key={card.id} card={card} store={store} onViewStore={onViewStore} />;
              })
            ) : (
              <div className="glass-card p-10 rounded-[2.5rem] border-2 border-dashed border-brand-rose/40 text-center">
                <div className="w-16 h-16 bg-brand-bg rounded-full flex items-center justify-center mx-auto mb-4">
                  <Wallet className="w-8 h-8 text-brand-navy/20" />
                </div>
                <p className="text-brand-navy/60 mb-6">Your wallet is empty.</p>
                <button 
                  onClick={() => setActiveTab('discover')}
                  className="bg-brand-navy text-white px-8 py-3 rounded-xl font-bold text-sm"
                >
                  Find Stores
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'discover' && (
        <DiscoveryScreen 
          stores={stores} 
          cards={initialCards} 
          onJoin={handleJoinStore} 
          onViewStore={onViewStore} 
          onViewUser={onViewUser} 
        />
      )}

      {activeTab === 'profile' && (
        <ProfileScreen
          profile={profile}
          userCards={initialCards}
          onLogout={onLogout}
          onDeleteAccount={onDeleteAccount}
          onViewUser={onViewUser}
          user={user}
        />
      )}
    </motion.div>
  );
}

// --- Vendor App ---

function VendorApp({ activeTab, setActiveTab, profile, user, onViewUser, notifications, activeChatId, setActiveChatId, onLogout, onDeleteAccount }: { activeTab: string, setActiveTab: (tab: string) => void, profile: UserProfile | null, user: FirebaseUser, onViewUser: (u: UserProfile) => void, notifications: Notification[], activeChatId: string | null, setActiveChatId: (id: string | null) => void, onLogout: () => void, onDeleteAccount: () => Promise<void>, key?: React.Key }) {
  const [store, setStore] = useState<StoreProfile | null>(null);
  const [userCards, setUserCards] = useState<Card[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'cards'), where('user_id', '==', user.uid));
    return onSnapshot(q, (snap) => {
      setUserCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card)));
    });
  }, [user]);
  const [isScanning, setIsScanning] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('');
  const [stampQuantity, setStampQuantity] = useState(1);
  const [isIssuing, setIsIssuing] = useState(false);
  const [lastIssueTime, setLastIssueTime] = useState(0);
  const [issueStatus, setIssueStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

  useEffect(() => {
    if (!store) return;
    const q = query(
      collection(db, 'transactions'), 
      where('store_id', '==', store.id), 
      orderBy('completed_at', 'desc'), 
      limit(10)
    );
    return onSnapshot(q, (snap) => {
      setRecentTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [store]);

  useEffect(() => {
    const q = query(collection(db, 'stores'), where('ownerUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setStore({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as StoreProfile);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stores');
    });
    return unsubscribe;
  }, [user]);

  const handleIssueStamp = async () => {
    if (!customerEmail || !store) return;
    
    const now = Date.now();
    if (now - lastIssueTime < 1000) {
      setIssueStatus({ type: 'error', message: 'Please wait a second between issues' });
      return;
    }
    setLastIssueTime(now);

    setIsIssuing(true);
    setIssueStatus(null);

    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', customerEmail));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setIssueStatus({ type: 'error', message: 'User not found' });
      } else {
        const customer = querySnapshot.docs[0].data() as UserProfile;
        const cardId = `${customer.uid}_${store.id}`;
        const cardRef = doc(db, 'cards', cardId);
        
        const cardDoc = await getDoc(cardRef);
        const qty = Number(stampQuantity);
        const limit = store.stamps_required_for_reward;

        if (cardDoc.exists()) {
          const data = cardDoc.data() as Card;
          let newStamps = data.current_stamps + qty;
          let newCycles = data.total_completed_cycles;

          if (newStamps >= limit) {
            newCycles += 1;
            // Cap at limit to force redemption before starting new cycle
            if (newStamps > limit) newStamps = limit; 
            
            // Record transaction
            await addDoc(collection(db, 'transactions'), {
              user_id: customer.uid,
              store_id: store.id,
              completed_at: serverTimestamp(),
              stamps_at_completion: limit,
              reward_claimed: false
            });
          }

          await updateDoc(cardRef, {
            current_stamps: newStamps,
            total_completed_cycles: newCycles,
            last_tap_timestamp: serverTimestamp()
          });
        } else {
          let newStamps = qty;
          let newCycles = 0;

          if (newStamps >= limit) {
            newCycles = 1;
            // Cap at limit to force redemption before starting new cycle
            if (newStamps > limit) newStamps = limit; 
            
            await addDoc(collection(db, 'transactions'), {
              user_id: customer.uid,
              store_id: store.id,
              completed_at: serverTimestamp(),
              stamps_at_completion: limit,
              reward_claimed: false
            });
          }

          await setDoc(cardRef, {
            user_id: customer.uid,
            store_id: store.id,
            current_stamps: newStamps,
            total_completed_cycles: newCycles,
            last_tap_timestamp: serverTimestamp(),
            isArchived: false
          });

          await updateDoc(doc(db, 'users', customer.uid), {
            total_cards_held: increment(1)
          });
        }
        
        await updateDoc(doc(db, 'users', customer.uid), {
          totalStamps: increment(qty)
        });

        setIssueStatus({ type: 'success', message: `${qty} stamp(s) issued to ${customer.name}!` });
        setCustomerEmail('');
        setStampQuantity(1);
      }
    } catch (error) {
      console.error(error);
      setIssueStatus({ type: 'error', message: 'Failed to issue stamp' });
    } finally {
      setIsIssuing(false);
    }
  };

  if (!store && activeTab !== 'profile') {
    return (
      <div className="glass-card p-10 rounded-[2.5rem] border-2 border-dashed border-brand-rose/40 text-center space-y-6">
        <div className="w-20 h-20 bg-brand-bg rounded-full flex items-center justify-center mx-auto">
          <Store className="w-10 h-10 text-brand-navy/20" />
        </div>
        <div>
          <h3 className="text-xl font-bold mb-2">Setup Your Store</h3>
          <p className="text-brand-navy/60 text-sm">You haven't registered a store yet. Create one to start issuing stamps.</p>
        </div>
        <button 
          onClick={async () => {
            const newStore = {
              name: `${profile?.name}'s Shop`,
              category: 'Retail',
              address: '123 Main St',
              phone: '555-0000',
              email: profile?.email || '',
              logoUrl: `https://picsum.photos/seed/${user.uid}/200/200`,
              coverUrl: `https://picsum.photos/seed/${user.uid}-bg/800/400`,
              ownerUid: user.uid,
              description: 'A wonderful local shop.',
              isVerified: false,
              stamps_required_for_reward: 10
            };
            await addDoc(collection(db, 'stores'), newStore);
          }}
          className="w-full bg-brand-navy text-white py-4 rounded-2xl font-bold"
        >
          Create Demo Store
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      {activeTab === 'for-you' && (
        <ForYouScreen onViewUser={onViewUser} currentUser={user} currentProfile={profile} />
      )}

      {activeTab === 'messages' && (
        <MessagesScreen
          currentUser={user}
          currentProfile={profile}
          activeChatId={activeChatId}
          setActiveChatId={setActiveChatId}
          onViewUser={onViewUser}
          vendorStore={store}
        />
      )}

      {activeTab === 'home' && (
        <div className="space-y-8">
          <header>
            <h2 className="font-display text-3xl font-bold mb-1">Dashboard</h2>
            <p className="text-brand-navy/60">{store?.name || 'Your Store'}</p>
          </header>

          <div className="grid grid-cols-2 gap-4">
            <StatSquare icon={<Users className="text-blue-500" />} label="Members" value="124" />
            <StatSquare icon={<TrendingUp className="text-green-500" />} label="Stamps" value="842" />
          </div>

          <div className="bg-brand-navy p-8 rounded-[2.5rem] text-white text-center">
            <h3 className="font-display text-xl font-bold mb-4">Issue a Stamp</h3>
            <p className="text-white/60 text-sm mb-8">Scan a customer's QR code or enter their email to issue a loyalty stamp.</p>
            
            <div className="space-y-4">
              <button 
                onClick={() => setIsScanning(true)}
                className="w-full bg-brand-gold text-brand-navy font-bold py-4 rounded-2xl flex items-center justify-center gap-3"
              >
                <QrCode className="w-6 h-6" />
                Open Scanner
              </button>
              
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <UserIcon className="w-5 h-5 text-white/20" />
                  </div>
                  <input 
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Customer email..."
                    className="w-full bg-white/10 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                  />
                </div>
                <div className="w-24">
                  <input 
                    type="number"
                    min="1"
                    max="10"
                    value={stampQuantity}
                    onChange={(e) => setStampQuantity(parseInt(e.target.value) || 1)}
                    className="w-full px-4 py-4 rounded-2xl bg-white/10 border border-white/10 text-white text-center focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                  />
                  <p className="text-[10px] text-white/40 mt-1 font-bold uppercase">Qty</p>
                </div>
              </div>

              <button 
                onClick={handleIssueStamp}
                disabled={isIssuing || !customerEmail}
                className="w-full bg-white text-brand-navy font-bold py-4 rounded-2xl disabled:opacity-50 transition-all"
              >
                {isIssuing ? 'Issuing...' : 'Issue Manually'}
              </button>

              {issueStatus && (
                <p className={cn(
                  "text-sm font-bold",
                  issueStatus.type === 'success' ? "text-brand-gold" : "text-red-400"
                )}>
                  {issueStatus.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-display text-xl font-bold">Recent Activity</h3>
            {recentTransactions.map(tx => (
              <div key={tx.id} className="glass-card p-4 rounded-2xl flex items-center gap-4">
                <div className="w-10 h-10 bg-brand-bg rounded-full flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-brand-navy/40" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-sm">Card Completed</p>
                  <p className="text-xs text-brand-navy/40">
                    {tx.completed_at ? format(tx.completed_at.toDate(), 'h:mm a') : 'Just now'}
                  </p>
                </div>
                <div className="w-2 h-2 bg-brand-gold rounded-full" />
              </div>
            ))}
            {recentTransactions.length === 0 && (
              <div className="py-8 text-center text-brand-navy/20">
                <Clock size={40} className="mx-auto mb-2 opacity-10" />
                <p className="text-sm font-bold">No recent activity</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'discover' && <CardBuilder store={store} />}
      {activeTab === 'profile' && (
        <ProfileScreen
          profile={profile}
          userCards={userCards}
          onLogout={onLogout}
          onDeleteAccount={onDeleteAccount}
          onViewUser={onViewUser}
          user={user}
        />
      )}

      {/* Scanner Modal Simulation */}
      <AnimatePresence>
        {isScanning && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-8"
          >
            <div className="w-64 h-64 border-2 border-brand-gold rounded-3xl relative overflow-hidden mb-12">
              <div className="absolute inset-0 bg-brand-gold/10 animate-pulse" />
              <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gold animate-scan" />
            </div>
            <h3 className="text-white text-xl font-bold mb-4">Scanning...</h3>
            <p className="text-white/60 text-center mb-12">Align the customer's QR code within the frame to issue a stamp.</p>
            
            <div className="flex flex-col gap-4 w-full">
              <button 
                onClick={() => {
                  setCustomerEmail(user.email || ''); // Simulate scanning own QR
                  setIsScanning(false);
                  setTimeout(() => handleIssueStamp(), 100);
                }}
                className="bg-brand-gold text-brand-navy px-12 py-4 rounded-2xl font-bold hover:scale-105 transition-transform"
              >
                Simulate Successful Scan
              </button>
              <button 
                onClick={() => setIsScanning(false)}
                className="bg-white/10 text-white px-12 py-4 rounded-2xl font-bold"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- UI Components ---

function LoyaltyCard({ card, store, onViewStore }: { card: Card, store?: StoreProfile, onViewStore?: (s: StoreProfile) => void, key?: React.Key }) {
  const [showQR, setShowQR] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showCompletionPopup, setShowCompletionPopup] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testQty, setTestQty] = useState(1);
  const [isTestIssuing, setIsTestIssuing] = useState(false);
  const [lastTestTime, setLastTestTime] = useState(0);
  const limit = store?.stamps_required_for_reward || 10;
  const isCompleted = card.current_stamps >= limit;

  // Show completion popup when card is completed
  useEffect(() => {
    if (isCompleted && !card.isArchived && !card.isRedeemed) {
      setShowCompletionPopup(true);
    }
  }, [isCompleted, card.isArchived, card.isRedeemed]);

  const handleTestStamp = async () => {
    if (!auth.currentUser || !store) return;
    
    const now = Date.now();
    if (now - lastTestTime < 1000) return;
    setLastTestTime(now);

    setIsTestIssuing(true);
    try {
      const qty = Number(testQty);
      const cardRef = doc(db, 'cards', card.id);
      
      let newStamps = card.current_stamps + qty;
      let newCycles = card.total_completed_cycles;

      if (newStamps >= limit) {
        newCycles += 1;
        // We don't modulo here if we want the user to "stop" at 10 for the popup
        // But the requirement says "when user reaches 10... show it to shop... then stamp again"
        // So let's cap it at limit for the completion state
        if (newStamps > limit) newStamps = limit; 
        
        await addDoc(collection(db, 'transactions'), {
          user_id: auth.currentUser.uid,
          store_id: store.id,
          completed_at: serverTimestamp(),
          stamps_at_completion: limit,
          reward_claimed: false
        });
      }

      await updateDoc(cardRef, {
        current_stamps: newStamps,
        total_completed_cycles: newCycles,
        last_tap_timestamp: serverTimestamp()
      });

      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        totalStamps: increment(qty)
      });

      if (newStamps >= limit) {
        setShowQR(false);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsTestIssuing(false);
    }
  };

  const handleArchive = async () => {
    if (!auth.currentUser || !store) return;
    setIsArchiving(true);
    try {
      // Create an archived record for the history/archive list
      await addDoc(collection(db, 'cards'), {
        user_id: card.user_id,
        store_id: card.store_id,
        current_stamps: limit,
        total_completed_cycles: card.total_completed_cycles,
        last_tap_timestamp: serverTimestamp(),
        isArchived: true,
        isRedeemed: true,
        archivedAt: serverTimestamp(),
      });
      // Reset the active card for the next loyalty cycle
      await updateDoc(doc(db, 'cards', card.id), {
        current_stamps: 0,
        isRedeemed: false,
        isArchived: false,
        last_tap_timestamp: serverTimestamp(),
      });
      // Increment rewards counter on profile
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        totalRedeemed: increment(1),
      });
      setShowCompletionPopup(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) return;
    
    setIsDeleting(true);
    try {
      await updateDoc(doc(db, 'cards', card.id), {
        isArchived: true
      });
      // Also decrement user's total_cards_held
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        total_cards_held: increment(-1)
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeleting(false);
      setShowOptions(false);
    }
  };

  const handleReset = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) return;
    try {
      await updateDoc(doc(db, 'cards', card.id), {
        isRedeemed: false,
        current_stamps: 0,
        last_tap_timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error(error);
    }
  };

  if (card.isArchived) return null;

  return (
    <>
      <motion.div 
        whileTap={{ scale: 0.98 }}
        onClick={() => !isCompleted && setShowQR(true)}
        className={cn(
          "glass-card p-6 rounded-[2.5rem] border relative overflow-hidden transition-all",
          isCompleted ? "border-brand-gold/40 bg-red-50/60" : "border-transparent cursor-pointer"
        )}
      >
        <div className="absolute top-4 right-4 flex items-center gap-2">
          {isCompleted && !card.isRedeemed && (
            <div className="bg-brand-gold text-brand-navy text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest animate-pulse">
              Completed
            </div>
          )}
          {card.isRedeemed && (
            <div className="bg-green-500 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
              Redeemed
            </div>
          )}
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setShowOptions(!showOptions);
            }}
            className="p-2 hover:bg-brand-navy/5 rounded-full transition-colors text-brand-navy/40"
          >
            <MoreVertical size={18} />
          </button>
        </div>

        <AnimatePresence>
          {showOptions && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-14 right-4 z-20 glass-panel rounded-2xl shadow-xl p-2 min-w-[140px]"
            >
              <button 
                onClick={handleDelete}
                disabled={isDeleting}
                className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors text-xs font-bold"
              >
                <Trash2 size={16} />
                {isDeleting ? 'Removing...' : 'Remove Card'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4 mb-6">
          <div 
            className="w-14 h-14 rounded-2xl overflow-hidden border border-brand-navy/5 bg-white cursor-pointer hover:scale-105 transition-transform"
            onClick={(e) => {
              if (store && onViewStore) {
                e.stopPropagation();
                onViewStore(store);
              }
            }}
          >
            <img src={store?.logoUrl || `https://picsum.photos/seed/${card.store_id}/200/200`} alt="" className="w-full h-full object-cover" />
          </div>
          <div 
            className="cursor-pointer group flex-1"
            onClick={(e) => {
              if (store && onViewStore) {
                e.stopPropagation();
                onViewStore(store);
              }
            }}
          >
            <h4 className="font-bold text-lg group-hover:text-brand-gold transition-colors">{store?.name || 'Store'}</h4>
            <p className="text-xs text-brand-navy/40 font-bold uppercase tracking-widest">{store?.category || 'Retail'}</p>
          </div>
        </div>

        {card.isRedeemed ? (
          <div className="space-y-4">
            <div className="bg-green-50 p-4 rounded-2xl border border-green-100 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-xs font-bold uppercase tracking-widest text-green-600/60">Reward Claimed</p>
              <p className="font-bold text-green-700">Enjoy your reward!</p>
            </div>
            <button 
              onClick={handleReset}
              className="w-full py-3 rounded-2xl bg-brand-navy text-white text-xs font-bold uppercase tracking-widest hover:bg-brand-navy/90 transition-all"
            >
              Start New Card
            </button>
          </div>
        ) : isCompleted ? (
          <div className="space-y-4">
            <div className="glass-card p-4 rounded-2xl border border-brand-gold/20 text-center">
              <Gift className="w-8 h-8 text-brand-gold mx-auto mb-2" />
              <p className="text-xs font-bold uppercase tracking-widest text-brand-navy/40">Your Reward</p>
              <p className="font-bold text-brand-navy">Free Gift / Discount</p>
            </div>
            <button 
              onClick={() => setShowCompletionPopup(true)}
              className="w-full py-3 rounded-2xl bg-brand-navy text-white text-xs font-bold uppercase tracking-widest hover:bg-brand-navy/90 transition-all"
            >
              Claim Reward
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3 mb-6">
              {Array.from({ length: limit }).map((_, i) => (
                <div key={i} className={cn(
                  "aspect-square rounded-full border-2 flex items-center justify-center transition-all",
                  i < card.current_stamps ? "bg-brand-gold border-brand-gold text-brand-navy" : "border-dashed border-brand-navy/10 text-brand-navy/10"
                )}>
                  {i < card.current_stamps ? <CheckCircle2 size={16} /> : <span className="text-[10px] font-bold">{i + 1}</span>}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest">
              <span className="text-brand-navy/40">{card.current_stamps} / {limit} Stamps</span>
              {card.current_stamps >= limit - 1 && <span className="text-brand-gold">Almost there!</span>}
            </div>
          </>
        )}
      </motion.div>

      <AnimatePresence>
        {showCompletionPopup && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-brand-navy/95 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="glass-panel w-full max-w-sm p-10 rounded-[3.5rem] text-center relative z-10 shadow-2xl"
            >
              <div className="w-24 h-24 bg-brand-gold/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trophy className="w-12 h-12 text-brand-gold" />
              </div>
              <h3 className="font-display text-3xl font-bold mb-2">Congratulations!</h3>
              <p className="text-brand-navy/60 mb-8">You've reached {limit} stamps at {store?.name}! Show this screen to the shop staff to claim your reward.</p>
              
              <div className="bg-red-50/80 p-6 rounded-3xl mb-8 border-2 border-dashed border-brand-gold/40">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest mb-2">Staff Action Required</p>
                <p className="text-sm font-bold text-brand-navy">Scan NFC Tag or Stamp again to confirm redemption</p>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={handleArchive}
                  disabled={isArchiving}
                  className="w-full bg-brand-navy text-white py-5 rounded-2xl font-bold flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {isArchiving ? 'Processing...' : 'Confirm & Redeem'}
                </button>
                <button 
                  onClick={() => setShowCompletionPopup(false)}
                  className="w-full py-4 text-brand-navy/40 font-bold text-sm"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showQR && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowQR(false)}
              className="absolute inset-0 bg-brand-navy/90 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel w-full max-w-xs p-8 rounded-[3rem] text-center relative z-10"
            >
              <h3 className="font-display text-2xl font-bold mb-2">{store?.name}</h3>
              <p className="text-brand-navy/60 text-sm mb-8">Show this code to the vendor to receive your stamp.</p>
              <div className="bg-white/80 p-6 rounded-3xl mb-8 flex justify-center border border-brand-rose/20">
                <QRCodeSVG value={`stamp:${auth.currentUser?.uid}:${card.store_id}`} size={200} />
              </div>

              {/* Test Controls */}
              <div className="mb-8 p-4 glass-card rounded-2xl">
                <p className="text-[10px] font-bold text-brand-navy/40 uppercase tracking-widest mb-3">Test: Simulate Stamp</p>
                <div className="flex gap-2">
                  <input 
                    type="number"
                    min="1"
                    max="10"
                    value={testQty}
                    onChange={(e) => setTestQty(parseInt(e.target.value) || 1)}
                    className="w-16 px-3 py-2 rounded-xl bg-white border border-brand-navy/10 text-center font-bold text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                  />
                  <button 
                    onClick={handleTestStamp}
                    disabled={isTestIssuing}
                    className="flex-1 bg-brand-gold text-brand-navy py-2 rounded-xl font-bold text-sm hover:scale-105 transition-transform disabled:opacity-50"
                  >
                    {isTestIssuing ? 'Issuing...' : 'Add Stamps'}
                  </button>
                </div>
              </div>

              <button 
                onClick={() => setShowQR(false)}
                className="w-full bg-brand-navy text-white py-4 rounded-2xl font-bold"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function StoreCard({ store, card, onJoin, onClick }: { store: StoreProfile, card?: Card, onJoin: () => void, onClick?: () => void, key?: React.Key }) {
  const stampsRequired = store.stamps_required_for_reward || 10;
  
  return (
    <div 
      onClick={onClick}
      className="glass-card p-4 rounded-3xl flex items-center gap-4 hover:shadow-lg transition-all cursor-pointer group"
    >
      <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0">
        <img src={store.logoUrl || `https://picsum.photos/seed/${store.id}/200/200`} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-1">
          <h4 className="font-bold truncate">{store.name}</h4>
          {store.isVerified && <CheckCircle2 size={14} className="text-blue-500 fill-blue-500/10" />}
        </div>
        <p className="text-xs text-brand-navy/40 mb-2">{store.category} • 1.2km away</p>
        
        {card ? (
          <div className="space-y-2">
            <div className="flex gap-1">
              {Array.from({ length: stampsRequired }).map((_, i) => (
                <div key={i} className={cn(
                  "h-1 rounded-full flex-1",
                  i < card.current_stamps ? "bg-brand-gold" : "bg-brand-navy/10"
                )} />
              ))}
            </div>
            <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
              {card.current_stamps} / {stampsRequired} Stamps
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="px-2 py-1 bg-brand-gold/10 rounded-lg">
              <span className="text-[10px] font-bold text-brand-gold uppercase">Double Stamps</span>
            </div>
          </div>
        )}
      </div>
      {!card && (
        <button 
          onClick={(e) => { e.stopPropagation(); onJoin(); }}
          className="w-10 h-10 bg-brand-bg rounded-full flex items-center justify-center text-brand-navy hover:bg-brand-navy hover:text-white transition-all shrink-0"
        >
          <Plus size={20} />
        </button>
      )}
    </div>
  );
}

function DiscoveryScreen({ stores, cards, onJoin, onViewStore, onViewUser }: { stores: StoreProfile[], cards: Card[], onJoin: (s: StoreProfile) => void, onViewStore: (s: StoreProfile) => void, onViewUser: (u: UserProfile) => void }) {
  const [search, setSearch] = useState('');
  const [searchType, setSearchType] = useState<'stores' | 'users'>('stores');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => {
    if (searchType === 'users') {
      setLoadingUsers(true);
      const q = query(collection(db, 'users'), limit(50));
      getDocs(q).then(snap => {
        setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
        setLoadingUsers(false);
      });
    }
  }, [searchType]);

  const filteredStores = stores.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || 
                          s.category.toLowerCase().includes(search.toLowerCase());
    const matchesCat = activeCategory === 'All' || s.category === activeCategory;
    const notJoined = !cards.some(c => c.store_id === s.id && !c.isArchived);
    return matchesSearch && matchesCat && notJoined;
  });

  const filteredUsers = users.filter(u => 
    (u.name || '').toLowerCase().includes(search.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-3xl font-bold mb-4">Discovery</h2>
        <div className="space-y-4">
          <div className="flex gap-2 p-1 glass-card rounded-2xl">
            <button 
              onClick={() => setSearchType('stores')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                searchType === 'stores' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40 hover:bg-brand-bg"
              )}
            >
              <Store size={18} />
              Businesses
            </button>
            <button 
              onClick={() => setSearchType('users')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                searchType === 'users' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40 hover:bg-brand-bg"
              )}
            >
              <Users size={18} />
              Users
            </button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-navy/40" />
            <input 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchType === 'stores' ? "Search businesses..." : "Search users..."}
              className="w-full pl-12 pr-4 py-4 rounded-2xl glass-card border-brand-rose/20 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 font-medium"
            />
          </div>
        </div>
      </header>

      {searchType === 'stores' && (
        <>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {['All', 'Food', 'Beauty', 'Barber', 'Gym', 'Retail'].map(cat => (
              <button 
                key={cat} 
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-6 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all",
                  activeCategory === cat ? "bg-brand-navy text-white shadow-md" : "glass-card text-brand-navy/50 hover:text-brand-navy"
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {filteredStores.map(store => (
              <StoreCard 
                key={store.id} 
                store={store} 
                onJoin={() => onJoin(store)} 
                onClick={() => onViewStore(store)} 
              />
            ))}
            {filteredStores.length === 0 && (
              <div className="py-12 text-center text-brand-navy/20">
                <Compass size={48} className="mx-auto mb-4 opacity-10" />
                <p className="font-bold">No results found</p>
                <p className="text-xs">Try a different search term or category</p>
              </div>
            )}
          </div>
        </>
      )}

      {searchType === 'users' && (
        <div className="space-y-3">
          {loadingUsers ? (
            <div className="flex justify-center py-12">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="w-8 h-8 text-brand-gold" />
              </motion.div>
            </div>
          ) : (
            <>
              {filteredUsers.map(u => (
                <div 
                  key={u.uid} 
                  className="glass-card p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:shadow-md transition-all"
                  onClick={() => onViewUser(u)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden border border-brand-navy/5">
                      <img src={u.photoURL} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">@{u.email?.split('@')[0] || u.name}</p>
                      <p className="text-xs text-brand-navy/40">{u.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-brand-navy">{u.totalStamps || 0}</p>
                    <p className="text-[10px] text-brand-navy/40 font-bold uppercase tracking-widest">Stamps</p>
                  </div>
                </div>
              ))}
              {filteredUsers.length === 0 && (
                <div className="py-20 text-center text-brand-navy/20">
                  <Users size={64} className="mx-auto mb-4 opacity-10" />
                  <p className="font-bold">No users found</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WallPostItem({ post, currentUser, wallOwnerUid }: { post: any, currentUser: FirebaseUser, wallOwnerUid?: string, key?: React.Key }) {
  const [likes, setLikes] = useState<string[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [newReply, setNewReply] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canDelete = currentUser.uid === post.fromUid || currentUser.uid === (wallOwnerUid ?? post.toUid);

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'user_reviews', post.id));
      // Also remove the cross-posted global_posts entry
      if (post.userReviewId) {
        await deleteDoc(doc(db, 'global_posts', post.userReviewId)).catch(() => {});
      } else {
        // Fallback for older posts without the link: query by authorUid + toUid
        const snap = await getDocs(query(
          collection(db, 'global_posts'),
          where('userReviewId', '==', post.id)
        )).catch(() => null);
        if (snap) await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      }
    } catch (err) {
      console.error('Wall post delete failed:', err);
      setDeleting(false);
    }
  };

  useEffect(() => {
    const unsubLikes = onSnapshot(collection(db, 'user_reviews', post.id, 'likes'), (snap) => {
      setLikes(snap.docs.map(d => d.id));
    }, (error) => console.error(error));

    const unsubReplies = onSnapshot(query(collection(db, 'user_reviews', post.id, 'replies'), orderBy('createdAt', 'asc')), (snap) => {
      setReplies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => console.error(error));

    return () => {
      unsubLikes();
      unsubReplies();
    };
  }, [post.id]);

  const isLiked = likes.includes(currentUser.uid);

  const handleLike = async () => {
    const likeRef = doc(db, 'user_reviews', post.id, 'likes', currentUser.uid);
    const postRef = doc(db, 'user_reviews', post.id);
    try {
      if (isLiked) {
        await deleteDoc(likeRef);
        await updateDoc(postRef, { likesCount: increment(-1) });
      } else {
        await setDoc(likeRef, { createdAt: serverTimestamp() });
        await updateDoc(postRef, { likesCount: increment(1) });
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handlePostReply = async () => {
    if (!newReply.trim()) return;
    setIsReplying(true);
    try {
      await addDoc(collection(db, 'user_reviews', post.id, 'replies'), {
        fromUid: currentUser.uid,
        fromName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Anonymous',
        fromPhoto: currentUser.photoURL || '',
        content: newReply,
        createdAt: serverTimestamp()
      });
      setNewReply('');
      setShowReplyInput(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsReplying(false);
    }
  };

  return (
    <div className="glass-card p-6 rounded-[2.5rem] space-y-4 animation-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden border border-brand-navy/5">
            <img src={post.fromPhoto} alt="" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="font-bold text-sm text-brand-navy">{post.fromName}</p>
            <p className="text-[10px] text-brand-navy/40 font-bold uppercase tracking-widest">
              {post.createdAt ? format(post.createdAt.toDate(), 'MMM d, h:mm a') : 'Just now'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
              <Star key={i} size={10} className={cn(i <= (post.rating || 5) ? "text-brand-gold fill-brand-gold" : "text-brand-navy/5")} />
            ))}
          </div>
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 rounded-xl text-brand-navy/20 hover:text-red-400 hover:bg-red-50 transition-all disabled:opacity-40"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-brand-navy/80 leading-relaxed italic">"{post.content}"</p>

      <div className="flex items-center gap-6 pt-2 border-t border-brand-navy/5">
        <button 
          onClick={handleLike}
          className={cn("flex items-center gap-2 transition-colors", isLiked ? "text-red-500" : "text-brand-navy/40 hover:text-red-500")}
        >
          <Heart size={18} className={isLiked ? "fill-current" : ""} />
          <span className="text-xs font-bold">{likes.length}</span>
        </button>
        <button 
          onClick={() => setShowReplyInput(!showReplyInput)}
          className="flex items-center gap-2 text-brand-navy/40 hover:text-brand-navy transition-colors"
        >
          <MessageSquare size={18} />
          <span className="text-xs font-bold">{replies.length || 'Reply'}</span>
        </button>
      </div>

      {replies.length > 0 && (
        <div className="mt-4 space-y-3 pl-4 border-l-2 border-brand-navy/5">
          {replies.map(reply => (
            <div key={reply.id} className="flex gap-3">
              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                <img src={reply.fromPhoto} alt="" className="w-full h-full object-cover" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-[10px] text-brand-navy">{reply.fromName}</p>
                  <p className="text-[8px] text-brand-navy/40">{reply.createdAt ? format(reply.createdAt.toDate(), 'h:mm a') : ''}</p>
                </div>
                <p className="text-xs text-brand-navy/70">{reply.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showReplyInput && (
        <div className="flex items-center gap-2 pt-2">
          <input 
            value={newReply}
            onChange={(e) => setNewReply(e.target.value)}
            placeholder="Write a reply..."
            className="flex-1 bg-brand-bg border-none rounded-xl px-4 py-2 text-xs focus:ring-1 focus:ring-brand-gold/20"
            onKeyDown={(e) => e.key === 'Enter' && handlePostReply()}
          />
          <button 
            onClick={handlePostReply}
            disabled={isReplying || !newReply.trim()}
            className="text-brand-navy hover:text-brand-gold disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatSquare({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="glass-card aspect-square rounded-[2rem] flex flex-col items-center justify-center p-4 hover:shadow-md transition-all">
      <div className="w-10 h-10 bg-brand-bg rounded-2xl flex items-center justify-center mb-2">
        {React.cloneElement(icon as React.ReactElement, { size: 20 })}
      </div>
      <p className="font-display text-lg font-bold text-brand-navy leading-none mb-1">{value}</p>
      <p className="text-[9px] text-brand-navy/40 font-bold uppercase tracking-wider text-center">{label}</p>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-brand-navy/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="glass-panel w-full max-w-md rounded-t-[3rem] sm:rounded-[3rem] p-8 relative z-10 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-8">
          <h3 className="font-display text-2xl font-bold">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-full bg-brand-bg text-brand-navy/40">
            <X size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function CardBuilder({ store }: { store: StoreProfile | null }) {
  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-display text-3xl font-bold mb-1">Card Builder</h2>
        <p className="text-brand-navy/60">Design your loyalty experience.</p>
      </header>

      <div className="glass-card p-8 rounded-[2.5rem] space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-brand-navy/40">Card Name</label>
          <input defaultValue={store?.name} className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 font-bold" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-brand-navy/40">Stamp Limit</label>
            <select defaultValue={store?.stamps_required_for_reward || 10} className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 font-bold">
              {[4, 6, 8, 10, 12, 15, 20].map(n => <option key={n} value={n}>{n} Stamps</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-brand-navy/40">Theme Color</label>
            <div className="flex gap-2 p-2 bg-brand-bg rounded-2xl">
              {['#1B2B4B', '#F5A623', '#10B981', '#EF4444'].map(c => (
                <button key={c} className="w-8 h-8 rounded-lg" style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-brand-navy/40">Reward Description</label>
          <input defaultValue="Free Item" className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 font-bold" />
        </div>
        <button className="w-full bg-brand-navy text-white py-4 rounded-2xl font-bold mt-4">
          Save Template
        </button>
      </div>
    </div>
  );
}

function ProfileScreen({ profile, userCards, onLogout, onDeleteAccount, onViewUser, user }: { profile: UserProfile | null, userCards: Card[], onLogout: () => void, onDeleteAccount: () => Promise<void>, onViewUser: (u: UserProfile) => void, user: FirebaseUser }) {
  const [activeSubTab, setActiveSubTab] = useState<'posts' | 'interactions'>('posts');
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const profileLastDocRef = useRef<any>(null);
  const [profileHasMore, setProfileHasMore] = useState(true);
  const [profileLoadingMore, setProfileLoadingMore] = useState(false);
  const profileSentinelRef = useRef<HTMLDivElement>(null);
  const PROFILE_PAGE_SIZE = 10;
  const [vendorStore, setVendorStore] = useState<StoreProfile | null>(null);
  const [storeCards, setStoreCards] = useState<Card[]>([]);

  useEffect(() => {
    if (profile?.role !== 'vendor') return;
    const q = query(collection(db, 'stores'), where('ownerUid', '==', profile.uid));
    return onSnapshot(q, snap => {
      if (!snap.empty) setVendorStore({ id: snap.docs[0].id, ...snap.docs[0].data() } as StoreProfile);
    });
  }, [profile?.uid, profile?.role]);

  useEffect(() => {
    if (!vendorStore) return;
    const q = query(collection(db, 'cards'), where('store_id', '==', vendorStore.id));
    return onSnapshot(q, snap => setStoreCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card))));
  }, [vendorStore?.id]);

  const [storeWallPosts, setStoreWallPosts] = useState<any[]>([]);
  useEffect(() => {
    if (!vendorStore) return;
    const q = query(collection(db, 'stores', vendorStore.id, 'posts'), orderBy('createdAt', 'desc'), limit(30));
    return onSnapshot(q, snap => setStoreWallPosts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [vendorStore?.id]);
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<'following' | 'followers'>('following');
  const [wallPosts, setWallPosts] = useState<any[]>([]);
  const [myGlobalPosts, setMyGlobalPosts] = useState<GlobalPost[]>([]);
  const [likedPosts, setLikedPosts] = useState<GlobalPost[]>([]);
  const [allPostsForVotes, setAllPostsForVotes] = useState<GlobalPost[]>([]);
  const [newPost, setNewPost] = useState('');
  const [rating, setRating] = useState(5);
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    if (!profile?.uid) return;

    const fetchUsersByIds = async (uids: string[]): Promise<UserProfile[]> => {
      if (uids.length === 0) return [];
      const snaps = await Promise.all(uids.map(uid => getDoc(doc(db, 'users', uid))));
      return snaps.filter(s => s.exists()).map(s => ({ uid: s.id, ...s.data() } as UserProfile));
    };

    const unsubFollowing = onSnapshot(
      query(collection(db, 'follows'), where('followerUid', '==', profile.uid)),
      async (snap) => {
        const uids = snap.docs.map(d => d.data().followingUid as string);
        setFollowing(await fetchUsersByIds(uids));
      }
    );

    const unsubFollowers = onSnapshot(
      query(collection(db, 'follows'), where('followingUid', '==', profile.uid)),
      async (snap) => {
        const uids = snap.docs.map(d => d.data().followerUid as string);
        setFollowers(await fetchUsersByIds(uids));
      }
    );

    const pq = query(collection(db, 'user_reviews'), where('toUid', '==', profile.uid), orderBy('createdAt', 'desc'));
    const unsubWall = onSnapshot(pq, (snap) => {
      setWallPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    getDocs(query(collection(db, 'global_posts'), where('authorUid', '==', profile.uid), orderBy('createdAt', 'desc'), limit(PROFILE_PAGE_SIZE))).then(snap => {
      setMyGlobalPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost)));
      profileLastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
      setProfileHasMore(snap.docs.length === PROFILE_PAGE_SIZE);
    }).catch(() => {});
    const unsubGlobalPosts = () => {};

    const lq = query(collection(db, 'global_posts'), where('likedBy', 'array-contains', profile.uid), orderBy('createdAt', 'desc'));
    const unsubLiked = onSnapshot(lq, (snap) => {
      setLikedPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost)));
    });

    const aq = query(collection(db, 'global_posts'), where('postType', '==', 'poll'), orderBy('createdAt', 'desc'), limit(100));
    const unsubAllPolls = onSnapshot(aq, (snap) => {
      setAllPostsForVotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost)));
    });

    return () => {
      unsubFollowing();
      unsubFollowers();
      unsubWall();
      unsubGlobalPosts();
      unsubLiked();
      unsubAllPolls();
    };
  }, [profile?.uid]);

  const profileLoadingMoreRef = useRef(false);

  const loadMoreProfilePosts = async () => {
    if (!profile || profileLoadingMoreRef.current || !profileHasMore || !profileLastDocRef.current) return;
    profileLoadingMoreRef.current = true;
    setProfileLoadingMore(true);
    try {
      const snap = await getDocs(query(collection(db, 'global_posts'), where('authorUid', '==', profile.uid), orderBy('createdAt', 'desc'), startAfter(profileLastDocRef.current), limit(PROFILE_PAGE_SIZE)));
      setMyGlobalPosts(prev => [...prev, ...snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost))]);
      profileLastDocRef.current = snap.docs[snap.docs.length - 1] ?? profileLastDocRef.current;
      setProfileHasMore(snap.docs.length === PROFILE_PAGE_SIZE);
    } catch { /* ignore */ }
    profileLoadingMoreRef.current = false;
    setProfileLoadingMore(false);
  };

  useEffect(() => {
    const el = profileSentinelRef.current;
    if (!el || !profileHasMore) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) loadMoreProfilePosts(); }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [myGlobalPosts.length, profileHasMore, profile?.uid]);

  const handlePostOnWall = async () => {
    if (!newPost.trim() || !profile) return;
    setIsPosting(true);
    try {
      await addDoc(collection(db, 'user_reviews'), {
        fromUid: user.uid,
        fromName: profile.name || user.displayName || 'Me',
        fromPhoto: profile.photoURL || user.photoURL || '',
        toUid: profile.uid,
        content: newPost,
        rating,
        likesCount: 0,
        createdAt: serverTimestamp()
      });
      setNewPost('');
      setRating(5);
    } catch (error) {
      console.error(error);
    } finally {
      setIsPosting(false);
    }
  };

  if (!profile) return null;

  const lifetimeStamps = userCards.reduce((acc, c) => acc + (c.current_stamps || 0) + ((c.total_completed_cycles || 0) * 10), 0) || profile.totalStamps || 0;
  const archivedCardsCount = profile.totalRedeemed || 0;
  const activeCardsCount = userCards.filter(c => !c.isArchived).length;

  // Vendor stats
  const totalMembers = storeCards.length > 0 ? new Set(storeCards.map(c => c.user_id)).size : 0;
  const stampsRequired = vendorStore?.stamps_required_for_reward || 10;
  const totalStampsGiven = storeCards.reduce((sum, c) => sum + (c.current_stamps || 0) + ((c.total_completed_cycles || 0) * stampsRequired), 0);
  const activeStoreCards = storeCards.filter(c => !c.isArchived).length;
  const returningUsers = storeCards.filter(c => (c.total_completed_cycles || 0) > 0).length;
  const returnRate = totalMembers > 0 ? Math.round((returningUsers / totalMembers) * 100) : 0;
  const vis = vendorStore?.visibilitySettings;

  const settingsModal = (
    <AnimatePresence>
      {showProfileSettings && (
        <ProfileSettingsModal profile={profile} user={user} onClose={() => setShowProfileSettings(false)} onLogout={onLogout} onDeleteAccount={onDeleteAccount} />
      )}
    </AnimatePresence>
  );

  // ── Vendor profile layout ──
  if (profile.role === 'vendor') {
    const theme = vendorStore?.theme || '#1e3a5f';
    return (
      <div className="space-y-6 pb-20 text-brand-navy">
        {settingsModal}

        {/* Business hero banner */}
        <div className="relative rounded-[2.5rem] overflow-hidden" style={{ background: `linear-gradient(135deg, ${theme}ee, ${theme}88)` }}>
          <div className="px-6 pt-8 pb-6">
            <button onClick={() => setShowProfileSettings(true)}
              className="absolute top-4 right-4 p-2 rounded-2xl bg-white/20 backdrop-blur-sm active:scale-95 transition-all">
              <Settings size={18} className="text-white" />
            </button>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-[1.5rem] overflow-hidden border-4 border-white/30 shadow-xl shrink-0 bg-white/10">
                {vendorStore?.logoUrl
                  ? <img src={vendorStore.logoUrl} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Building2 size={32} className="text-white/60" /></div>}
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold text-white leading-tight">{vendorStore?.name || profile.name}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {vendorStore?.category && (
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-white/20 text-white px-2 py-1 rounded-lg">{vendorStore.category}</span>
                  )}
                  {vendorStore?.location && (
                    <span className="flex items-center gap-1 text-[10px] text-white/70 font-medium">
                      <MapPin size={10} />{vendorStore.location}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/60 mt-1">@{profile.handle || user.email?.split('@')[0]}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Business stats */}
        <div className="grid grid-cols-2 gap-3">
          {(vis?.members !== false) && (
            <div className="glass-card p-5 rounded-[2rem]">
              <div className="flex items-center gap-2 mb-1">
                <Users size={16} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Members</span>
              </div>
              <p className="text-3xl font-bold">{totalMembers}</p>
              <p className="text-[10px] text-brand-navy/40 mt-0.5">total cardholders</p>
            </div>
          )}
          {(vis?.stamps !== false) && (
            <div className="glass-card p-5 rounded-[2rem]">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={16} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Stamps</span>
              </div>
              <p className="text-3xl font-bold">{totalStampsGiven}</p>
              <p className="text-[10px] text-brand-navy/40 mt-0.5">given lifetime</p>
            </div>
          )}
          {(vis?.activeCards !== false) && (
            <div className="glass-card p-5 rounded-[2rem]">
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={16} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Active</span>
              </div>
              <p className="text-3xl font-bold">{activeStoreCards}</p>
              <p className="text-[10px] text-brand-navy/40 mt-0.5">active cards</p>
            </div>
          )}
          {(vis?.returnRate !== false) && (
            <div className="glass-card p-5 rounded-[2rem]">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={16} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Return Rate</span>
              </div>
              <p className="text-3xl font-bold">{returnRate}<span className="text-lg">%</span></p>
              <p className="text-[10px] text-brand-navy/40 mt-0.5">avg user return</p>
            </div>
          )}
        </div>

        {/* Followers / Following */}
        {(vis?.followers !== false) && (
          <div className="grid grid-cols-2 gap-3">
            <div onClick={() => { setFollowModalTab('following'); setShowFollowModal(true); }} className="cursor-pointer">
              <StatSquare icon={<Users className="text-brand-gold" />} label="Following" value={following.length.toString()} />
            </div>
            <div onClick={() => { setFollowModalTab('followers'); setShowFollowModal(true); }} className="cursor-pointer">
              <StatSquare icon={<UserPlus className="text-brand-gold" />} label="Followers" value={followers.length.toString()} />
            </div>
          </div>
        )}

        {/* Posts */}
        <div className="flex p-1 glass-card rounded-2xl">
          <button onClick={() => setActiveSubTab('posts')}
            className={cn("flex-1 py-3 rounded-xl text-xs font-bold transition-all", activeSubTab === 'posts' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40")}>
            Posts
          </button>
          <button onClick={() => setActiveSubTab('interactions')}
            className={cn("flex-1 py-3 rounded-xl text-xs font-bold transition-all", activeSubTab === 'interactions' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40")}>
            Interactions
          </button>
        </div>

        {activeSubTab === 'posts' && (() => {
          const merged = [
            ...myGlobalPosts.map(p => ({ _type: 'global' as const, _ts: p.createdAt?.toMillis?.() ?? 0, data: p })),
            ...storeWallPosts.map(p => ({ _type: 'wall' as const, _ts: p.createdAt?.toMillis?.() ?? 0, data: p })),
          ].sort((a, b) => b._ts - a._ts);
          return (
            <div className="space-y-4">
              {merged.map(item =>
                item._type === 'global' ? (
                  <FeedPostCard key={item.data.id} post={item.data} currentUser={user} onViewUser={onViewUser}
                    onLike={async (p) => { const ref = doc(db, 'global_posts', p.id); const liked = (p.likedBy || []).includes(user.uid); await updateDoc(ref, { likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid), likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1 }); }}
                    onVote={async (p, idx) => { const ref = doc(db, 'global_posts', p.id); const votes = p.pollVotes || {}; const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid)); const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) }; if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid); await updateDoc(ref, updates); }}
                  />
                ) : (
                  <div key={item.data.id} className="glass-card p-5 rounded-[2rem] space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full overflow-hidden border border-brand-navy/5 shrink-0">
                        <img src={item.data.authorPhoto || `https://i.pravatar.cc/40?u=${item.data.authorUid}`} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug">
                          <span className="font-bold cursor-pointer hover:text-brand-gold transition-colors"
                            onClick={async () => { const snap = await getDoc(doc(db, 'users', item.data.authorUid)).catch(() => null); if (snap?.exists()) onViewUser({ uid: snap.id, ...snap.data() } as UserProfile); }}>
                            {item.data.authorName}
                          </span>
                          <span className="text-brand-navy/30 mx-1">›</span>
                          <span className="font-bold text-brand-gold">{vendorStore?.name || profile.name}</span>
                        </p>
                        <p className="text-[10px] text-brand-navy/40 font-medium">{item.data.createdAt ? format(item.data.createdAt.toDate(), 'MMM d · h:mm a') : 'Just now'}</p>
                      </div>
                    </div>
                    <p className="text-sm text-brand-navy/80 leading-relaxed">{item.data.content}</p>
                  </div>
                )
              )}
              {merged.length === 0 && <div className="py-16 text-center text-brand-navy/20"><MessageSquare size={48} className="mx-auto mb-3 opacity-10" /><p className="font-bold text-sm">No posts yet</p></div>}
            </div>
          );
        })()}

        {activeSubTab === 'interactions' && (() => {
          const votedPolls = allPostsForVotes.filter(p => Object.values(p.pollVotes || {}).some(arr => (arr as string[]).includes(profile.uid)));
          return (
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold px-1 flex items-center gap-2"><Heart size={12} fill="currentColor" /> Liked ({likedPosts.length})</p>
              {likedPosts.map(post => (
                <FeedPostCard key={post.id} post={post} currentUser={user} onViewUser={onViewUser}
                  onLike={async (p) => { const ref = doc(db, 'global_posts', p.id); const liked = (p.likedBy || []).includes(user.uid); await updateDoc(ref, { likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid), likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1 }); }}
                  onVote={async (p, idx) => { const ref = doc(db, 'global_posts', p.id); const votes = p.pollVotes || {}; const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid)); const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) }; if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid); await updateDoc(ref, updates); }}
                />
              ))}
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold px-1 flex items-center gap-2 mt-4"><BarChart2 size={12} /> Votes Cast ({votedPolls.length})</p>
              {votedPolls.map(post => (
                <FeedPostCard key={post.id} post={post} currentUser={user} onViewUser={onViewUser}
                  onLike={async (p) => { const ref = doc(db, 'global_posts', p.id); const liked = (p.likedBy || []).includes(user.uid); await updateDoc(ref, { likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid), likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1 }); }}
                  onVote={async (p, idx) => { const ref = doc(db, 'global_posts', p.id); const votes = p.pollVotes || {}; const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid)); const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) }; if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid); await updateDoc(ref, updates); }}
                />
              ))}
            </div>
          );
        })()}

        <AnimatePresence>
          {showFollowModal && (
            <Modal title={followModalTab === 'following' ? `Following (${following.length})` : `Followers (${followers.length})`} onClose={() => setShowFollowModal(false)}>
              <div className="space-y-4">
                <div className="flex p-1 bg-brand-bg rounded-2xl">
                  <button onClick={() => setFollowModalTab('following')} className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all", followModalTab === 'following' ? "bg-brand-navy text-white shadow" : "text-brand-navy/40")}>Following ({following.length})</button>
                  <button onClick={() => setFollowModalTab('followers')} className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all", followModalTab === 'followers' ? "bg-brand-navy text-white shadow" : "text-brand-navy/40")}>Followers ({followers.length})</button>
                </div>
                <div className="space-y-2">
                  {(followModalTab === 'following' ? following : followers).map(u => (
                    <div key={u.uid} className="flex items-center gap-3 p-3 rounded-2xl bg-brand-bg cursor-pointer" onClick={() => { onViewUser(u); setShowFollowModal(false); }}>
                      <div className="w-10 h-10 rounded-2xl overflow-hidden border border-brand-navy/5 shrink-0"><img src={u.photoURL || `https://i.pravatar.cc/40?u=${u.uid}`} alt="" className="w-full h-full object-cover" /></div>
                      <div><p className="font-bold text-sm">{u.name}</p><p className="text-[10px] text-brand-navy/40 font-bold uppercase">@{u.email?.split('@')[0]}</p></div>
                    </div>
                  ))}
                  {(followModalTab === 'following' ? following : followers).length === 0 && <p className="text-xs text-brand-navy/40 text-center py-8">{followModalTab === 'following' ? 'Not following anyone yet' : 'No followers yet'}</p>}
                </div>
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Consumer profile layout ──
  return (
    <div className="space-y-6 pb-20 text-brand-navy">
      <header className="text-center relative">
        <button onClick={() => setShowProfileSettings(true)}
          className="absolute right-0 top-0 p-2 rounded-2xl bg-white border border-brand-navy/10 shadow-sm active:scale-95 transition-all">
          <Settings size={18} className="text-brand-navy/60" />
        </button>
        <div className="w-32 h-32 rounded-[2.5rem] overflow-hidden border-4 border-white mx-auto mb-4 shadow-xl">
          <img src={profile.photoURL} alt="" className="w-full h-full object-cover" />
        </div>
        <h2 className="font-display text-3xl font-bold">{profile.name}</h2>
        <p className="text-brand-gold font-bold text-xs uppercase tracking-[0.2em]">@{profile.handle || user.email?.split('@')[0]}</p>
      </header>

      {settingsModal}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatSquare icon={<CheckCircle2 className="text-brand-gold" />} label="Stamps" value={lifetimeStamps.toString()} />
        <StatSquare icon={<Trophy className="text-brand-gold" />} label="Rewards" value={archivedCardsCount.toString()} />
        <div onClick={() => { setFollowModalTab('following'); setShowFollowModal(true); }} className="cursor-pointer">
          <StatSquare icon={<Users className="text-brand-gold" />} label="Following" value={following.length.toString()} />
        </div>
        <div onClick={() => { setFollowModalTab('followers'); setShowFollowModal(true); }} className="cursor-pointer">
          <StatSquare icon={<UserPlus className="text-brand-gold" />} label="Followers" value={followers.length.toString()} />
        </div>
      </div>

      <div className="flex p-1 glass-card rounded-2xl">
        <button
          onClick={() => setActiveSubTab('posts')}
          className={cn("flex-1 py-3 rounded-xl text-xs font-bold transition-all", activeSubTab === 'posts' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40")}
        >
          Posts
        </button>
        <button
          onClick={() => setActiveSubTab('interactions')}
          className={cn("flex-1 py-3 rounded-xl text-xs font-bold transition-all", activeSubTab === 'interactions' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40")}
        >
          Interactions
        </button>
      </div>

      {activeSubTab === 'posts' && (
        <div className="space-y-6">
          {/* Write to wall — always at top */}
          <div className="glass-card p-5 rounded-[2rem] space-y-4">
            <h3 className="font-bold text-sm px-1">Post to Wall</h3>
            <textarea
              value={newPost}
              onChange={(e) => setNewPost(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 text-sm h-20 resize-none"
            />
            <button
              onClick={handlePostOnWall}
              disabled={isPosting || !newPost.trim()}
              className="w-full bg-brand-navy text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            >
              <Plus size={16} /> Post
            </button>
          </div>

          <div className="space-y-3">
            {wallPosts.map(post => (
              <WallPostItem key={post.id} post={post} currentUser={user} wallOwnerUid={profile?.uid} />
            ))}
          </div>

          {/* Global feed posts */}
          {myGlobalPosts.length > 0 && (
            <div className="space-y-4">
              {myGlobalPosts.map(post => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  currentUser={user}
                  onViewUser={onViewUser}
                  onLike={async (p) => {
                    const ref = doc(db, 'global_posts', p.id);
                    const liked = (p.likedBy || []).includes(user.uid);
                    await updateDoc(ref, {
                      likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
                      likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1
                    });
                  }}
                  onVote={async (p, idx) => {
                    const ref = doc(db, 'global_posts', p.id);
                    const votes = p.pollVotes || {};
                    const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid));
                    const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) };
                    if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid);
                    await updateDoc(ref, updates);
                  }}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel for profile posts */}
          <div ref={profileSentinelRef} className="h-4" />
          {profileLoadingMore && (
            <div className="flex justify-center py-4">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="w-5 h-5 text-brand-gold/50" />
              </motion.div>
            </div>
          )}

          {myGlobalPosts.length === 0 && wallPosts.length === 0 && (
            <div className="py-20 text-center text-brand-navy/20">
              <MessageSquare size={64} className="mx-auto mb-4 opacity-5" />
              <p className="font-bold">Nothing posted yet</p>
              <p className="text-xs">Use the + button or post to your wall above</p>
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'interactions' && (() => {
        const votedPolls = allPostsForVotes.filter(p =>
          Object.values(p.pollVotes || {}).some(arr => (arr as string[]).includes(profile.uid))
        );
        return (
          <div className="space-y-6">
            {/* Liked posts */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold px-1 flex items-center gap-2">
                <Heart size={12} fill="currentColor" /> Liked ({likedPosts.length})
              </p>
              {likedPosts.length === 0 ? (
                <div className="glass-card rounded-2xl p-6 text-center text-brand-navy/30 text-sm">Nothing liked yet</div>
              ) : likedPosts.map(post => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  currentUser={user}
                  onViewUser={onViewUser}
                  onLike={async (p) => {
                    const ref = doc(db, 'global_posts', p.id);
                    const liked = (p.likedBy || []).includes(user.uid);
                    await updateDoc(ref, {
                      likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
                      likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1
                    });
                  }}
                  onVote={async (p, idx) => {
                    const ref = doc(db, 'global_posts', p.id);
                    const votes = p.pollVotes || {};
                    const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid));
                    const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) };
                    if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid);
                    await updateDoc(ref, updates);
                  }}
                />
              ))}
            </div>

            {/* Voted polls */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold px-1 flex items-center gap-2">
                <BarChart2 size={12} /> Votes Cast ({votedPolls.length})
              </p>
              {votedPolls.length === 0 ? (
                <div className="glass-card rounded-2xl p-6 text-center text-brand-navy/30 text-sm">No polls voted in yet</div>
              ) : votedPolls.map(post => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  currentUser={user}
                  onViewUser={onViewUser}
                  onLike={async (p) => {
                    const ref = doc(db, 'global_posts', p.id);
                    const liked = (p.likedBy || []).includes(user.uid);
                    await updateDoc(ref, {
                      likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
                      likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1
                    });
                  }}
                  onVote={async (p, idx) => {
                    const ref = doc(db, 'global_posts', p.id);
                    const votes = p.pollVotes || {};
                    const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid));
                    const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) };
                    if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid);
                    await updateDoc(ref, updates);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })()}

      <AnimatePresence>
        {showFollowModal && (
          <Modal title={followModalTab === 'following' ? `Following (${following.length})` : `Followers (${followers.length})`} onClose={() => setShowFollowModal(false)}>
            <div className="space-y-4">
              <div className="flex p-1 bg-brand-bg rounded-2xl">
                <button
                  onClick={() => setFollowModalTab('following')}
                  className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all", followModalTab === 'following' ? "bg-brand-navy text-white shadow" : "text-brand-navy/40")}
                >
                  Following ({following.length})
                </button>
                <button
                  onClick={() => setFollowModalTab('followers')}
                  className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all", followModalTab === 'followers' ? "bg-brand-navy text-white shadow" : "text-brand-navy/40")}
                >
                  Followers ({followers.length})
                </button>
              </div>

              <div className="space-y-2">
                {(followModalTab === 'following' ? following : followers).map(u => (
                  <div key={u.uid} className="flex items-center justify-between p-3 rounded-2xl bg-brand-bg hover:bg-brand-gold/5 transition-colors group">
                    <div
                      className="flex items-center gap-3 flex-1 cursor-pointer"
                      onClick={() => { onViewUser(u); setShowFollowModal(false); }}
                    >
                      <div className="w-10 h-10 rounded-2xl overflow-hidden border border-brand-navy/5 shrink-0">
                        <img src={u.photoURL || `https://i.pravatar.cc/40?u=${u.uid}`} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <p className="font-bold text-sm group-hover:text-brand-gold transition-colors">{u.name}</p>
                        <p className="text-[10px] text-brand-navy/40 font-bold uppercase tracking-widest">@{u.email?.split('@')[0]}</p>
                      </div>
                    </div>
                    {followModalTab === 'following' && (
                      <button
                        onClick={async () => {
                          const followId = `${profile.uid}_${u.uid}`;
                          await deleteDoc(doc(db, 'follows', followId));
                        }}
                        className="px-3 py-1.5 rounded-xl border border-brand-navy/10 text-xs font-bold text-brand-navy/50 hover:border-brand-gold/50 hover:text-brand-gold transition-all ml-2 shrink-0"
                      >
                        Unfollow
                      </button>
                    )}
                  </div>
                ))}
                {(followModalTab === 'following' ? following : followers).length === 0 && (
                  <p className="text-xs text-brand-navy/40 text-center py-8">
                    {followModalTab === 'following' ? 'Not following anyone yet' : 'No followers yet'}
                  </p>
                )}
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

const THEME_COLOURS = [
  { label: 'Navy',   value: '#1e3a5f' },
  { label: 'Gold',   value: '#f59e0b' },
  { label: 'Rose',   value: '#f43f5e' },
  { label: 'Green',  value: '#10b981' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Teal',   value: '#14b8a6' },
];

const CATEGORIES: Category[] = ['Food', 'Beauty', 'Barber', 'Gym', 'Parking', 'Retail'];

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn('w-12 h-7 rounded-full transition-all relative shrink-0', on ? 'bg-green-500' : 'bg-brand-navy/20')}
    >
      <span className={cn('absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  );
}

function ProfileSettingsModal({ profile, user, onClose, onLogout, onDeleteAccount }: { profile: UserProfile, user: FirebaseUser, onClose: () => void, onLogout: () => void, onDeleteAccount: () => Promise<void> }) {
  const [name, setName] = useState(profile.name || '');
  const [handle, setHandle] = useState(profile.handle || user.email?.split('@')[0] || '');
  const [store, setStore] = useState<StoreProfile | null>(null);
  const [storeName, setStoreName] = useState('');
  const [storeReward, setStoreReward] = useState('');
  const [storeCategory, setStoreCategory] = useState<Category>('Food');
  const [storeTheme, setStoreTheme] = useState('#1e3a5f');
  const [storeLogo, setStoreLogo] = useState('');
  const [storeLocation, setStoreLocation] = useState('');
  const [visibility, setVisibility] = useState({ members: true, stamps: true, activeCards: true, returnRate: true, followers: true });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile.role !== 'vendor') return;
    const q = query(collection(db, 'stores'), where('ownerUid', '==', profile.uid));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const s = { id: snap.docs[0].id, ...snap.docs[0].data() } as StoreProfile;
        setStore(s);
        setStoreName(s.name || '');
        setStoreReward(s.reward || '');
        setStoreCategory(s.category || 'Food');
        setStoreTheme(s.theme || '#1e3a5f');
        setStoreLogo(s.logoUrl || '');
        setStoreLocation(s.location || s.address || '');
        setVisibility({ members: true, stamps: true, activeCards: true, returnRate: true, followers: true, ...(s.visibilitySettings || {}) });
      }
    });
    return unsub;
  }, [profile.uid, profile.role]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const profileUpdates: any = { name, handle };
      await updateDoc(doc(db, 'users', profile.uid), profileUpdates);

      if (profile.role === 'vendor' && store) {
        await updateDoc(doc(db, 'stores', store.id), {
          name: storeName, reward: storeReward, category: storeCategory, theme: storeTheme,
          logoUrl: storeLogo, location: storeLocation, visibilitySettings: visibility,
        });
      }

      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1000);
    } catch (err) {
      console.error('Save profile error:', err);
    } finally {
      setSaving(false);
    }
  };

  const visibilityItems: { key: keyof typeof visibility; label: string }[] = [
    { key: 'members', label: 'Members' },
    { key: 'stamps', label: 'Stamps Given' },
    { key: 'activeCards', label: 'Active Cards' },
    { key: 'returnRate', label: 'Return Rate' },
    { key: 'followers', label: 'Followers & Following' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-0 bg-brand-bg z-[200] flex flex-col max-w-md mx-auto"
    >
      <header className="glass-panel px-6 py-4 flex items-center gap-4">
        <button onClick={onClose} className="p-2 -ml-2 text-brand-navy/60"><ArrowLeft size={24} /></button>
        <h2 className="font-display text-xl font-bold flex-1">Edit Profile</h2>
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-brand-navy text-white rounded-2xl font-bold text-sm disabled:opacity-50 active:scale-95 transition-all">
          {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 pb-12">

        {/* Avatar */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-[2rem] overflow-hidden border-4 border-white shadow-xl">
              <img src={profile.photoURL} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-brand-gold rounded-xl flex items-center justify-center shadow">
              <Edit3 size={14} className="text-brand-navy" />
            </div>
          </div>
        </div>

        {/* Name */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Display Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
            className="w-full px-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30" />
        </div>

        {/* Handle */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Handle</label>
          <div className="relative">
            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brand-navy/40 font-bold text-sm">@</span>
            <input value={handle} onChange={e => setHandle(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="yourhandle"
              className="w-full pl-9 pr-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30" />
          </div>
        </div>

        {/* Business Fields */}
        {profile.role === 'vendor' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

            <SectionLabel icon={<Building2 size={14} className="text-brand-gold" />} label="Business Details" />

            <div className="space-y-2">
              <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Business Name</label>
              <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="Your business name"
                className="w-full px-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30" />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Stamp Card Reward</label>
              <input value={storeReward} onChange={e => setStoreReward(e.target.value)} placeholder="e.g. Free coffee, Free class"
                className="w-full px-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30" />
              <p className="text-[10px] text-brand-navy/30 px-1">Shown on the Hot tab so customers know what they earn</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Category</label>
              <div className="relative">
                <select value={storeCategory} onChange={e => setStoreCategory(e.target.value as Category)}
                  className="w-full px-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30 appearance-none pr-10">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/40 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Location</label>
              <div className="relative">
                <MapPin size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-navy/30" />
                <input value={storeLocation} onChange={e => setStoreLocation(e.target.value)} placeholder="123 High Street, London"
                  className="w-full pl-10 pr-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Logo URL</label>
              <div className="flex gap-3">
                <input value={storeLogo} onChange={e => setStoreLogo(e.target.value)} placeholder="https://..."
                  className="flex-1 px-5 py-4 rounded-2xl bg-white border border-brand-navy/10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold/30" />
                {storeLogo && (
                  <div className="w-14 h-14 rounded-2xl overflow-hidden border border-brand-navy/10 shrink-0">
                    <img src={storeLogo} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                  </div>
                )}
              </div>
            </div>

            {/* Colour Theme */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">Brand Colour</label>
                <Palette size={13} className="text-brand-navy/30" />
              </div>
              <div className="grid grid-cols-4 gap-3">
                {THEME_COLOURS.map(c => (
                  <button key={c.value} onClick={() => setStoreTheme(c.value)}
                    className={cn("h-12 rounded-2xl transition-all active:scale-95 relative", storeTheme === c.value ? "ring-4 ring-offset-2 ring-brand-navy/30 scale-105" : "")}
                    style={{ backgroundColor: c.value }}>
                    {storeTheme === c.value && <CheckCircle2 size={16} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-brand-navy/40 font-bold">Custom</label>
                <input type="color" value={storeTheme} onChange={e => setStoreTheme(e.target.value)}
                  className="w-10 h-10 rounded-xl border border-brand-navy/10 cursor-pointer p-1 bg-white" />
                <span className="text-sm font-mono text-brand-navy/60">{storeTheme}</span>
              </div>
            </div>

            {/* Public Visibility */}
            <div className="space-y-3">
              <SectionLabel icon={<Settings size={14} className="text-brand-gold" />} label="Public Visibility" />
              <p className="text-xs text-brand-navy/40">Choose which stats are visible on your public profile.</p>
              <div className="space-y-3">
                {visibilityItems.map(item => (
                  <div key={item.key} className="flex items-center justify-between bg-white px-5 py-4 rounded-2xl border border-brand-navy/10">
                    <span className="text-sm font-medium">{item.label}</span>
                    <ToggleSwitch on={visibility[item.key]} onChange={v => setVisibility(prev => ({ ...prev, [item.key]: v }))} />
                  </div>
                ))}
              </div>
            </div>

          </motion.div>
        )}

        {/* Account Actions */}
        <div className="pt-4 border-t border-brand-navy/10 space-y-3">
          <button
            onClick={async () => {
              const newRole = profile.role === 'consumer' ? 'vendor' : 'consumer';
              await updateDoc(doc(db, 'users', profile.uid), { role: newRole });
              window.location.reload();
            }}
            className={`w-full py-4 px-5 rounded-2xl font-bold text-sm flex items-center gap-3 transition-all active:scale-[0.98] ${
              profile.role === 'consumer'
                ? 'bg-brand-navy text-white'
                : 'bg-brand-gold text-brand-navy'
            }`}
          >
            <LayoutDashboard size={18} />
            Switch to {profile.role === 'consumer' ? 'Vendor' : 'Consumer'} Account
          </button>

          <button
            onClick={onLogout}
            className="w-full py-4 px-5 rounded-2xl text-red-500 font-bold text-sm flex items-center gap-3 hover:bg-red-50 transition-colors"
          >
            <LogOut size={18} />
            Sign Out
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-4 px-5 rounded-2xl text-red-400/70 text-sm flex items-center gap-3 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={18} />
            Delete Account
          </button>
        </div>

      </div>

      {/* Delete confirmation overlay */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-end justify-center bg-black/40 backdrop-blur-sm pb-8 px-6"
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full bg-white rounded-[2.5rem] p-8 space-y-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center space-y-2">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={24} className="text-red-500" />
                </div>
                <h3 className="font-display font-bold text-xl text-brand-navy">Delete Account?</h3>
                <p className="text-sm text-brand-navy/50">This permanently removes your profile, posts, and follow connections. Your stamp history and loyalty cards will remain.</p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await onDeleteAccount();
                    } catch (err: any) {
                      console.error('Delete account error:', err);
                      alert('Could not delete account: ' + (err?.message ?? 'Unknown error'));
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="w-full bg-red-500 text-white font-bold py-4 rounded-2xl hover:bg-red-600 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {deleting
                    ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Sparkles size={18} /></motion.div>
                    : <Trash2 size={18} />}
                  {deleting ? 'Deleting…' : 'Yes, Delete My Account'}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="w-full py-4 rounded-2xl text-brand-navy/60 font-bold text-sm hover:bg-brand-navy/5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-2">
      {icon}
      <p className="text-xs font-bold text-brand-navy/50 uppercase tracking-widest">{label}</p>
    </div>
  );
}

function SettingsMenu({
  isOpen,
  onClose,
  profile,
  userCards
}: {
  isOpen: boolean,
  onClose: () => void,
  profile: UserProfile | null,
  userCards: Card[]
}) {
  const [showArchive, setShowArchive] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [archivedCards, setArchivedCards] = useState<Card[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  useEffect(() => {
    if (!profile) return;
    const aq = query(collection(db, 'cards'), where('user_id', '==', profile.uid), where('isArchived', '==', true));
    const unsubArchive = onSnapshot(aq, (snap) => {
      setArchivedCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card)));
    }, (error) => console.error("SettingsMenu archive listener:", error));

    const hq = query(collection(db, 'transactions'), where('user_id', '==', profile.uid), orderBy('completed_at', 'desc'));
    const unsubHistory = onSnapshot(hq, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => console.error("SettingsMenu history listener:", error));

    return () => {
      unsubArchive();
      unsubHistory();
    };
  }, [profile?.uid]);

  const seedData = async () => {
    if (!profile) return;
    setIsSeeding(true);
    try {
      const sampleStores = [
        {
          name: "The Daily Grind",
          category: "Food",
          address: "42 Espresso Lane",
          description: "Artisanal coffee and fresh pastries in the heart of the city.",
          stamps_required_for_reward: 8,
          isVerified: true,
          logoUrl: "https://picsum.photos/seed/coffee/200/200",
          coverUrl: "https://picsum.photos/seed/coffee-bg/800/400"
        },
        {
          name: "Glow Beauty Bar",
          category: "Beauty",
          address: "77 Radiance Blvd",
          description: "Premium skincare and beauty treatments for your natural glow.",
          stamps_required_for_reward: 10,
          isVerified: true,
          logoUrl: "https://picsum.photos/seed/beauty/200/200",
          coverUrl: "https://picsum.photos/seed/beauty-bg/800/400"
        },
        {
          name: "Iron Haven Gym",
          category: "Gym",
          address: "10 Strength St",
          description: "Your local community gym with top-tier equipment and trainers.",
          stamps_required_for_reward: 12,
          isVerified: false,
          logoUrl: "https://picsum.photos/seed/gym/200/200",
          coverUrl: "https://picsum.photos/seed/gym-bg/800/400"
        },
        {
          name: "The Barber Shop",
          category: "Barber",
          address: "15 Grooming Way",
          description: "Traditional cuts and modern styles for the modern gentleman.",
          stamps_required_for_reward: 6,
          isVerified: true,
          logoUrl: "https://picsum.photos/seed/barber/200/200",
          coverUrl: "https://picsum.photos/seed/barber-bg/800/400"
        },
        {
          name: "Green Leaf Salads",
          category: "Food",
          address: "88 Healthy Ave",
          description: "Fresh, organic salads and cold-pressed juices.",
          stamps_required_for_reward: 10,
          isVerified: true,
          logoUrl: "https://picsum.photos/seed/salad/200/200",
          coverUrl: "https://picsum.photos/seed/salad-bg/800/400"
        }
      ];

      // 1. Create/Update All Stores and track their IDs
      const seededStoreIds: string[] = [];
      for (const s of sampleStores) {
        const q = query(collection(db, 'stores'), where('name', '==', s.name));
        const snap = await getDocs(q);
        let storeId = '';
        if (snap.empty) {
          const storeRef = await addDoc(collection(db, 'stores'), {
            ...s,
            ownerUid: "system_seed",
            email: "contact@" + s.name.toLowerCase().replace(/\s/g, '') + ".com",
            createdAt: serverTimestamp()
          });
          storeId = storeRef.id;
        } else {
          storeId = snap.docs[0].id;
          await updateDoc(doc(db, 'stores', storeId), { ...s });
        }
        seededStoreIds.push(storeId);
      }

      // 2. Define Dummy Users
      const dummyUsers = [
        { uid: "dummy_1", name: "Alex Rivers", email: "alex@example.com", photoURL: "https://i.pravatar.cc/150?u=alex", role: "consumer" },
        { uid: "dummy_2", name: "Jordan Smith", email: "jordan@example.com", photoURL: "https://i.pravatar.cc/150?u=jordan", role: "consumer" },
        { uid: "dummy_3", name: "Casey Chen", email: "casey@example.com", photoURL: "https://i.pravatar.cc/150?u=casey", role: "consumer" },
        { uid: "dummy_4", name: "Sam Taylor", email: "sam@example.com", photoURL: "https://i.pravatar.cc/150?u=sam", role: "consumer" },
        { uid: "dummy_5", name: "Morgan Lee", email: "morgan@example.com", photoURL: "https://i.pravatar.cc/150?u=morgan", role: "consumer" },
        { uid: "dummy_6", name: "Bowie Star", email: "bowie@example.com", photoURL: "https://i.pravatar.cc/150?u=bowie", role: "consumer" },
        { uid: "dummy_7", name: "Charlie Drift", email: "charlie@example.com", photoURL: "https://i.pravatar.cc/150?u=charlie", role: "consumer" },
        { uid: "dummy_8", name: "Dakota Sky", email: "dakota@example.com", photoURL: "https://i.pravatar.cc/150?u=dakota", role: "consumer" },
        { uid: "dummy_9", name: "Emerson Blaise", email: "emerson@example.com", photoURL: "https://i.pravatar.cc/150?u=emerson", role: "consumer" },
        { uid: "dummy_10", name: "Finley Gray", email: "finley@example.com", photoURL: "https://i.pravatar.cc/150?u=finley", role: "consumer" },
        { uid: "dummy_11", name: "River Song", email: "river@example.com", photoURL: "https://i.pravatar.cc/150?u=river", role: "consumer" },
        { uid: "dummy_12", name: "Ocean Waves", email: "ocean@example.com", photoURL: "https://i.pravatar.cc/150?u=ocean", role: "consumer" }
      ];

      // 3. Process Dummy Users
      for (const du of dummyUsers) {
        let totalStamps = 0;
        let activeCardsCount = 0;
        let totalRedeemed = Math.floor(Math.random() * 5);

        // Assign random cards to each dummy user
        const numCards = Math.floor(Math.random() * 4) + 2; // 2-5 cards
        const userStores = [...seededStoreIds].sort(() => 0.5 - Math.random()).slice(0, numCards);

        for (const storeId of userStores) {
          const stamps = Math.floor(Math.random() * 10);
          totalStamps += stamps;
          activeCardsCount++;

          const cardId = `${du.uid}_${storeId}`;
          await setDoc(doc(db, 'cards', cardId), {
            user_id: du.uid,
            store_id: storeId,
            current_stamps: stamps,
            total_completed_cycles: Math.floor(Math.random() * 2),
            last_tap_timestamp: serverTimestamp(),
            isArchived: false,
            isRedeemed: false,
            userName: du.name,
            userPhoto: du.photoURL
          });
        }

        // Update dummy user statistics to match assigned cards
        await setDoc(doc(db, 'users', du.uid), {
          ...du,
          totalStamps,
          total_cards_held: activeCardsCount,
          totalRedeemed,
          createdAt: serverTimestamp()
        });

        // Add random wall posts for each dummy user
        const sampleShoutouts = [
          "Amazing stamps system, so easy to use!",
          "Highly recommend The Daily Grind for coffee lovers.",
          "Finally earned my first reward at Glow Beauty Bar!",
          "Anyone else training at Iron Haven сегодня?",
          "Does anyone know if The Barber Shop is open late?",
          "This app makes loyalty so much fun!"
        ];

        if (Math.random() > 0.3) {
          const author = dummyUsers[Math.floor(Math.random() * dummyUsers.length)];
          await addDoc(collection(db, 'user_reviews'), {
            fromUid: author.uid,
            fromName: author.name,
            fromPhoto: author.photoURL,
            toUid: du.uid,
            content: sampleShoutouts[Math.floor(Math.random() * sampleShoutouts.length)],
            rating: 5,
            likesCount: Math.floor(Math.random() * 10),
            createdAt: serverTimestamp()
          });
        }
      }

      // 4. Process Current User (Self)
      let myTotalStamps = 0;
      let myActiveCardsCount = 0;
      
      // Give current user 3 random cards
      const myStores = [...seededStoreIds].sort(() => 0.5 - Math.random()).slice(0, 3);
      for (const storeId of myStores) {
        const stamps = Math.floor(Math.random() * 5) + 3;
        myTotalStamps += stamps;
        myActiveCardsCount++;

        const cardId = `${profile.uid}_${storeId}`;
        await setDoc(doc(db, 'cards', cardId), {
          user_id: profile.uid,
          store_id: storeId,
          current_stamps: stamps,
          total_completed_cycles: 0,
          last_tap_timestamp: serverTimestamp(),
          isArchived: false,
          isRedeemed: false,
          userName: profile.name || 'Me',
          userPhoto: profile.photoURL || ''
        });
      }

      // Sync statistics for current user
      await updateDoc(doc(db, 'users', profile.uid), {
        totalStamps: myTotalStamps,
        total_cards_held: myActiveCardsCount
      });

      // 5. Seed global_posts (posts + polls from users and vendors)
      const existingPostsSnap = await getDocs(query(collection(db, 'global_posts'), limit(1)));
      if (existingPostsSnap.empty) {
        const d1 = dummyUsers[0], d2 = dummyUsers[1], d3 = dummyUsers[2];
        const d4 = dummyUsers[3], d5 = dummyUsers[4], d6 = dummyUsers[5];
        const d7 = dummyUsers[6], d8 = dummyUsers[7], d9 = dummyUsers[8];
        const storeNames = sampleStores.map(s => s.name);
        const storePics = [
          "https://picsum.photos/seed/coffee/200/200",
          "https://picsum.photos/seed/beauty/200/200",
          "https://picsum.photos/seed/gym/200/200",
          "https://picsum.photos/seed/barber/200/200",
          "https://picsum.photos/seed/salad/200/200",
        ];

        const postsToSeed = [
          // --- User regular posts ---
          {
            authorUid: d1.uid, authorName: d1.name, authorPhoto: d1.photoURL, authorRole: "consumer",
            content: "Just hit my 8th stamp at The Daily Grind ☕ Free coffee is so close I can taste it!",
            postType: "post", likesCount: 14, likedBy: [d2.uid, d3.uid, d4.uid, d5.uid, d6.uid, d7.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: d2.uid, authorName: d2.name, authorPhoto: d2.photoURL, authorRole: "consumer",
            content: "Glow Beauty Bar just gave me the best facial I've ever had. The staff are incredible and the loyalty rewards make it even better 💅",
            postType: "post", likesCount: 22, likedBy: [d1.uid, d3.uid, d5.uid, d8.uid, d9.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: d3.uid, authorName: d3.name, authorPhoto: d3.photoURL, authorRole: "consumer",
            content: "Iron Haven Gym is genuinely changing my life. Two months in and I've already redeemed my first free session reward. Anyone else training there? 💪",
            postType: "post", likesCount: 18, likedBy: [d4.uid, d5.uid, d6.uid, d1.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: d4.uid, authorName: d4.name, authorPhoto: d4.photoURL, authorRole: "consumer",
            content: "PSA: The Barber Shop now has Sunday hours 🙌 Got my fresh cut this morning and earned my 5th stamp. One more and I get a free service!",
            postType: "post", likesCount: 9, likedBy: [d2.uid, d7.uid, d8.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: d5.uid, authorName: d5.name, authorPhoto: d5.photoURL, authorRole: "consumer",
            content: "Green Leaf Salads for lunch every day this week. No regrets and 4 stamps richer 🥗 Who else is on their health journey?",
            postType: "post", likesCount: 11, likedBy: [d1.uid, d3.uid, d6.uid, d9.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: d6.uid, authorName: d6.name, authorPhoto: d6.photoURL, authorRole: "consumer",
            content: "Linq is genuinely the best loyalty app I've used. Actually motivates me to go back to the same spots 🔥",
            postType: "post", likesCount: 31, likedBy: [d1.uid, d2.uid, d3.uid, d4.uid, d5.uid, d7.uid, d8.uid, d9.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          // --- Vendor posts ---
          {
            authorUid: "vendor_daily_grind", authorName: "The Daily Grind", authorPhoto: storePics[0], authorRole: "vendor",
            storeName: storeNames[0],
            content: "🎉 DOUBLE STAMPS this entire weekend! Friday through Sunday — every purchase earns you 2x stamps. Come on in and level up your card faster. See you soon! ☕",
            postType: "post", likesCount: 47, likedBy: [d1.uid, d2.uid, d3.uid, d4.uid, d5.uid, d6.uid, d7.uid, d8.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: "vendor_glow_beauty", authorName: "Glow Beauty Bar", authorPhoto: storePics[1], authorRole: "vendor",
            storeName: storeNames[1],
            content: "✨ NEW: Our summer skincare range has arrived. Book any facial this week and receive 3 BONUS stamps. Spaces are filling up fast — book via the link in bio!",
            postType: "post", likesCount: 35, likedBy: [d2.uid, d5.uid, d8.uid, d9.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          {
            authorUid: "vendor_iron_haven", authorName: "Iron Haven Gym", authorPhoto: storePics[2], authorRole: "vendor",
            storeName: storeNames[2],
            content: "New Olympic lifting platform just dropped 💪 First 20 members to use it this week get an extra stamp added to their card. First come, first served!",
            postType: "post", likesCount: 28, likedBy: [d3.uid, d6.uid, d7.uid, profile.uid],
            pollOptions: null, pollVotes: null
          },
          // --- User polls ---
          {
            authorUid: d7.uid, authorName: d7.name, authorPhoto: d7.photoURL, authorRole: "consumer",
            content: "Which local business deserves more love? 👇",
            postType: "poll",
            pollOptions: [{ text: "The Daily Grind ☕" }, { text: "Glow Beauty Bar 💅" }, { text: "Iron Haven Gym 💪" }, { text: "The Barber Shop ✂️" }],
            pollVotes: { "0": [d1.uid, d2.uid, d5.uid], "1": [d3.uid, d8.uid, d9.uid, profile.uid], "2": [d4.uid, d6.uid], "3": [d7.uid] },
            likesCount: 8, likedBy: [d1.uid, d2.uid, d3.uid, d4.uid]
          },
          {
            authorUid: d8.uid, authorName: d8.name, authorPhoto: d8.photoURL, authorRole: "consumer",
            content: "What's your ideal loyalty reward? 🎁",
            postType: "poll",
            pollOptions: [{ text: "Free item / drink" }, { text: "Percentage discount" }, { text: "Bonus stamps" }, { text: "Exclusive experience" }],
            pollVotes: { "0": [d1.uid, d3.uid, d6.uid, profile.uid], "1": [d2.uid, d4.uid, d7.uid], "2": [d5.uid, d9.uid], "3": [d8.uid] },
            likesCount: 12, likedBy: [d2.uid, d5.uid, d6.uid, d7.uid, d8.uid]
          },
          {
            authorUid: d9.uid, authorName: d9.name, authorPhoto: d9.photoURL, authorRole: "consumer",
            content: "How many loyalty cards are you actively collecting right now? 🃏",
            postType: "poll",
            pollOptions: [{ text: "1–2 cards" }, { text: "3–5 cards" }, { text: "6–10 cards" }, { text: "10+ cards (collector mode)" }],
            pollVotes: { "0": [d4.uid, d5.uid], "1": [d1.uid, d2.uid, d6.uid, d8.uid, profile.uid], "2": [d3.uid, d7.uid], "3": [d9.uid] },
            likesCount: 7, likedBy: [d1.uid, d3.uid, d9.uid]
          },
          // --- Vendor polls ---
          {
            authorUid: "vendor_daily_grind", authorName: "The Daily Grind", authorPhoto: storePics[0], authorRole: "vendor",
            storeName: storeNames[0],
            content: "Help us choose our next seasonal special! ☕ Vote below 👇",
            postType: "poll",
            pollOptions: [{ text: "Pumpkin Spice Latte 🎃" }, { text: "Iced Matcha Coconut 🍵" }, { text: "Lavender Honey Flat White 🌸" }, { text: "Chai Oat Bomb 🧡" }],
            pollVotes: { "0": [d1.uid, d4.uid, d7.uid], "1": [d2.uid, d5.uid, d8.uid, profile.uid], "2": [d3.uid, d9.uid], "3": [d6.uid] },
            likesCount: 19, likedBy: [d1.uid, d2.uid, d3.uid, d4.uid, d5.uid, profile.uid]
          },
          {
            authorUid: "vendor_iron_haven", authorName: "Iron Haven Gym", authorPhoto: storePics[2], authorRole: "vendor",
            storeName: storeNames[2],
            content: "We're extending our opening hours! When would you use the gym most? 🏋️",
            postType: "poll",
            pollOptions: [{ text: "Earlier mornings (5am open)" }, { text: "Late nights (until 11pm)" }, { text: "Weekend afternoons" }, { text: "All of the above!" }],
            pollVotes: { "0": [d3.uid, d7.uid], "1": [d1.uid, d4.uid, d6.uid], "2": [d5.uid, d8.uid], "3": [d2.uid, d9.uid, profile.uid] },
            likesCount: 23, likedBy: [d3.uid, d4.uid, d5.uid, d6.uid, d7.uid, profile.uid]
          },
          {
            authorUid: "vendor_barber", authorName: "The Barber Shop", authorPhoto: storePics[3], authorRole: "vendor",
            storeName: storeNames[3],
            content: "What new service should we add to our menu? Your vote decides! ✂️",
            postType: "poll",
            pollOptions: [{ text: "Hot towel shave" }, { text: "Hair colouring" }, { text: "Scalp treatment" }, { text: "Men's facials" }],
            pollVotes: { "0": [d1.uid, d2.uid, d4.uid, d6.uid], "1": [d3.uid, d8.uid], "2": [d5.uid, d9.uid], "3": [d7.uid, profile.uid] },
            likesCount: 15, likedBy: [d2.uid, d4.uid, d8.uid]
          },
        ];

        for (const post of postsToSeed) {
          await addDoc(collection(db, 'global_posts'), {
            ...post,
            createdAt: serverTimestamp()
          });
        }
      }

      alert("Sample data successfully seeded! Users, Businesses, and consistent statistics are ready.");
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert("Seeding failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-brand-navy/60 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="glass-panel w-full max-w-md rounded-t-[3rem] p-8 space-y-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-2xl font-bold">Menu</h2>
          <button onClick={onClose} className="p-2 bg-brand-navy/5 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <MenuButton icon={<Archive />} label="Archived Cards" sub="View completed programs" onClick={() => setShowArchive(true)} />
          <MenuButton icon={<Clock />} label="Stamp History" sub="Timeline of collections" onClick={() => setShowHistory(true)} />
          <MenuButton icon={<Settings />} label="Settings" sub="Account preferences" />
          <MenuButton icon={<Sparkles />} label="Seed Sample Data" sub="Generate test users & stamps" onClick={seedData} disabled={isSeeding} />
          
        </div>

        <AnimatePresence>
          {showArchive && (
            <Modal title="Archived Cards" onClose={() => setShowArchive(false)}>
              <div className="space-y-4">
                {archivedCards.map(card => (
                  <div key={card.id} className="glass-card p-4 rounded-2xl">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-sm">Completed Program</p>
                      <span className="text-[10px] font-bold text-brand-gold uppercase">Archived</span>
                    </div>
                    <p className="text-xs text-brand-navy/60">Completed cycles: {card.total_completed_cycles}</p>
                  </div>
                ))}
                {archivedCards.length === 0 && (
                  <div className="py-12 text-center text-brand-navy/20">
                    <Archive size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="font-bold">No archived cards yet</p>
                  </div>
                )}
              </div>
            </Modal>
          )}

          {showHistory && (
            <Modal title="Stamp History" onClose={() => setShowHistory(false)}>
              <div className="space-y-4">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 bg-brand-gold rounded-full flex items-center justify-center text-brand-navy">
                        <CheckCircle2 size={16} />
                      </div>
                      <div className="w-0.5 flex-1 bg-brand-navy/5 my-1" />
                    </div>
                    <div className="flex-1 pb-6">
                      <p className="font-bold text-sm">Card Completed</p>
                      <p className="text-xs text-brand-navy/40 mb-2">
                        {tx.completed_at ? format(tx.completed_at.toDate(), 'MMM d, yyyy • h:mm a') : 'Recently'}
                      </p>
                      <div className="bg-brand-bg p-3 rounded-xl text-[10px] font-bold text-brand-navy/60 uppercase tracking-widest">
                        {tx.stamps_at_completion} Stamps Collected
                      </div>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && (
                  <div className="py-12 text-center text-brand-navy/20">
                    <Clock size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="font-bold">No history yet</p>
                  </div>
                )}
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function MenuButton({ icon, label, sub, onClick, disabled }: { icon: React.ReactNode, label: string, sub: string, onClick?: () => void, disabled?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-white p-5 rounded-3xl border border-brand-navy/5 flex items-center justify-between group hover:border-brand-gold/50 transition-all disabled:opacity-50"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-brand-navy/5 rounded-2xl flex items-center justify-center text-brand-navy/40 group-hover:scale-110 transition-transform">
          {React.cloneElement(icon as React.ReactElement, { size: 24 })}
        </div>
        <div className="text-left">
          <p className="font-bold">{label}</p>
          <p className="text-xs text-brand-navy/40">{sub}</p>
        </div>
      </div>
      <ChevronRight className="text-brand-navy/20" />
    </button>
  );
}

function ProfileLink({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full p-6 flex items-center justify-between hover:bg-brand-bg transition-all border-b border-brand-navy/5 last:border-0"
    >
      <div className="flex items-center gap-4">
        <div className="text-brand-navy/40">{icon}</div>
        <span className="font-bold">{label}</span>
      </div>
      <ChevronRight size={18} className="text-brand-navy/20" />
    </button>
  );
}

// --- Social & Community Components ---

function FeedPostCard({ post, currentUser, currentProfile, onViewUser, onViewStore, onLike, onVote, onDelete }: {
  key?: React.Key;
  post: GlobalPost;
  currentUser?: FirebaseUser;
  currentProfile?: UserProfile | null;
  onViewUser: (u: UserProfile) => void;
  onViewStore?: (s: StoreProfile) => void;
  onLike: (post: GlobalPost) => void | Promise<void>;
  onVote: (post: GlobalPost, optionIndex: number) => void | Promise<void>;
  onDelete?: (post: GlobalPost) => void | Promise<void>;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [showAllComments, setShowAllComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<{ name: string; photoURL: string } | null>(null);

  useEffect(() => {
    if (post.authorRole === 'vendor' && post.storeId) {
      return onSnapshot(doc(db, 'stores', post.storeId), (snap) => {
        if (snap.exists()) setAuthorProfile({ name: snap.data().name, photoURL: snap.data().logoUrl || '' });
      }, () => {});
    }
    return onSnapshot(doc(db, 'users', post.authorUid), (snap) => {
      if (snap.exists()) setAuthorProfile({ name: snap.data().name, photoURL: snap.data().photoURL });
    }, () => {});
  }, [post.authorUid, post.storeId, post.authorRole]);

  const isLiked = currentUser ? (post.likedBy || []).includes(currentUser.uid) : false;
  const isOwn = currentUser?.uid === post.authorUid;
  const totalVotes = post.postType === 'poll'
    ? Object.values(post.pollVotes || {}).reduce((s, arr) => s + (arr?.length || 0), 0)
    : 0;
  const userVoteKey = currentUser
    ? Object.keys(post.pollVotes || {}).find(k => (post.pollVotes![k] || []).includes(currentUser.uid))
    : undefined;
  const likesCount = post.likesCount || 0;

  useEffect(() => {
    const q = query(
      collection(db, 'global_posts', post.id, 'comments'),
      orderBy('likesCount', 'desc'),
      orderBy('createdAt', 'asc'),
      limit(50)
    );
    return onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
  }, [post.id]);

  const handleAvatarClick = async () => {
    try {
      if (post.authorRole === 'vendor' && post.storeId && onViewStore) {
        const snap = await getDoc(doc(db, 'stores', post.storeId));
        if (snap.exists()) { onViewStore({ id: snap.id, ...snap.data() } as StoreProfile); return; }
      }
      const snap = await getDoc(doc(db, 'users', post.authorUid));
      if (snap.exists()) onViewUser({ uid: snap.id, ...snap.data() } as UserProfile);
    } catch {/* seed users may not exist */}
  };

  const handleSubmitComment = async () => {
    if (!currentUser || !newComment.trim()) return;
    setIsCommenting(true);
    const text = newComment.trim();
    try {
      // Fetch fresh sender profile so name/photo are always accurate
      const senderSnap = await getDoc(doc(db, 'users', currentUser.uid)).catch(() => null);
      const senderData = senderSnap?.exists() ? senderSnap.data() : null;
      const fromName = senderData?.name || currentProfile?.name || currentUser.displayName || 'User';
      const fromPhoto = senderData?.photoURL || currentProfile?.photoURL || currentUser.photoURL || '';

      await addDoc(collection(db, 'global_posts', post.id, 'comments'), {
        fromUid: currentUser.uid,
        fromName,
        fromPhoto,
        content: text,
        likesCount: 0,
        likedBy: [],
        createdAt: serverTimestamp(),
      });
      if (post.authorUid !== currentUser.uid) {
        addDoc(collection(db, 'notifications'), {
          toUid: post.authorUid,
          fromUid: currentUser.uid,
          fromName,
          fromPhoto,
          type: 'comment',
          message: `commented: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
          isRead: false,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
      setNewComment('');
    } finally {
      setIsCommenting(false);
    }
  };

  const handleLikeComment = async (comment: any) => {
    if (!currentUser) return;
    const ref = doc(db, 'global_posts', post.id, 'comments', comment.id);
    const liked = (comment.likedBy || []).includes(currentUser.uid);
    await updateDoc(ref, {
      likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
      likesCount: liked ? Math.max(0, comment.likesCount - 1) : comment.likesCount + 1,
    });
  };

  const visibleComments = showAllComments ? comments : comments.slice(0, 2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-[2rem] overflow-hidden border border-black/5 shadow-sm"
    >
      {/* Post header */}
      <div className="px-5 pt-5 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden border border-black/5 cursor-pointer shrink-0" onClick={handleAvatarClick}>
            <img src={authorProfile?.photoURL || (post.authorRole !== 'vendor' ? post.authorPhoto : '') || `https://i.pravatar.cc/40?u=${post.authorUid}`} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {post.wallPost && post.storeName ? (
                <p className="text-sm leading-snug">
                  <span
                    className="font-bold cursor-pointer hover:text-brand-gold transition-colors"
                    onClick={handleAvatarClick}
                  >
                    {authorProfile?.name || post.authorName}
                  </span>
                  <span className="text-brand-navy/30 mx-1">›</span>
                  <span
                    className="font-bold text-brand-gold cursor-pointer hover:opacity-70 transition-opacity"
                    onClick={async () => {
                      if (!post.storeId || !onViewStore) return;
                      const snap = await getDoc(doc(db, 'stores', post.storeId));
                      if (snap.exists()) onViewStore({ id: snap.id, ...snap.data() } as StoreProfile);
                    }}
                  >
                    {post.storeName}
                  </span>
                </p>
              ) : post.wallPost && post.toUid ? (
                <p className="text-sm leading-snug">
                  <span
                    className="font-bold cursor-pointer hover:text-brand-gold transition-colors"
                    onClick={handleAvatarClick}
                  >
                    {authorProfile?.name || post.authorName}
                  </span>
                  <span className="text-brand-navy/30 mx-1">›</span>
                  <span
                    className="font-bold cursor-pointer hover:text-brand-gold transition-colors"
                    onClick={async () => {
                      const snap = await getDoc(doc(db, 'users', post.toUid!));
                      if (snap.exists()) onViewUser({ uid: snap.id, ...snap.data() } as UserProfile);
                    }}
                  >
                    {post.toName}
                  </span>
                </p>
              ) : post.authorRole === 'vendor' && post.storeName && !post.wallPost ? (
                <span
                  className="font-bold text-sm cursor-pointer hover:text-brand-gold transition-colors"
                  onClick={async () => {
                    if (!post.storeId || !onViewStore) return;
                    const snap = await getDoc(doc(db, 'stores', post.storeId));
                    if (snap.exists()) onViewStore({ id: snap.id, ...snap.data() } as StoreProfile);
                  }}
                >
                  {post.storeName}
                </span>
              ) : (
                <span
                  className="font-bold text-sm cursor-pointer hover:text-brand-gold transition-colors"
                  onClick={handleAvatarClick}
                >
                  {authorProfile?.name || post.authorName}
                </span>
              )}
            </div>
            <p className="text-[10px] text-brand-navy/40 font-medium">
              {post.createdAt ? format(post.createdAt.toDate(), 'MMM d · h:mm a') : 'Just now'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {post.postType === 'poll' && (
              <div className="w-7 h-7 bg-brand-gold/10 rounded-lg flex items-center justify-center">
                <BarChart2 size={14} className="text-brand-gold" />
              </div>
            )}
            <div className="relative">
              <button
                onClick={() => setShowMenu(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-brand-navy/30 hover:text-brand-navy/70 hover:bg-brand-bg transition-all"
              >
                <MoreVertical size={16} />
              </button>
              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                    className="absolute right-0 top-8 z-50 bg-white rounded-2xl shadow-xl border border-black/8 overflow-hidden min-w-[150px]"
                    onMouseLeave={() => setShowMenu(false)}
                  >
                    {isOwn && (
                      <button
                        onClick={() => { setShowMenu(false); onDelete?.(post); }}
                        className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-bold text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={15} /> Delete
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        setShowMenu(false);
                        if (!currentUser) return;
                        await addDoc(collection(db, 'reports'), {
                          postId: post.id,
                          reportedBy: currentUser.uid,
                          reason: 'User report',
                          createdAt: serverTimestamp(),
                        });
                        setReportSent(true);
                        setTimeout(() => setReportSent(false), 3000);
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-bold text-brand-navy/60 hover:bg-brand-bg transition-colors"
                    >
                      <Flag size={15} /> {reportSent ? 'Reported!' : 'Report'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {post.postType === 'review' && (
          <div className="flex items-center gap-0.5">
            {[1,2,3,4,5].map(s => (
              <Star key={s} size={13} className={s <= (post.rating || 5) ? "text-brand-gold fill-brand-gold" : "text-brand-navy/20"} />
            ))}
            <span className="ml-1.5 text-xs text-brand-navy/40 font-medium">review for <span className="font-bold text-brand-gold">{post.storeName}</span></span>
          </div>
        )}
        {post.content && (
          <p className="text-sm text-brand-navy leading-relaxed">{post.content}</p>
        )}

        {post.postType === 'poll' && post.pollOptions && (
          <div className="space-y-2 pt-1">
            {post.pollOptions.map((opt, i) => {
              const voteCount = (post.pollVotes?.[String(i)] || []).length;
              const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
              const voted = userVoteKey === String(i);
              return (
                <button
                  key={i}
                  onClick={() => onVote(post, i)}
                  className={cn(
                    "w-full text-left rounded-xl overflow-hidden border-2 transition-all active:scale-[0.98]",
                    voted ? "border-brand-gold" : "border-black/6 hover:border-brand-gold/40"
                  )}
                >
                  <div className="relative px-4 py-2.5 min-h-[42px] flex items-center">
                    <div
                      className={cn(
                        "absolute left-0 top-0 bottom-0 rounded-[10px] transition-all duration-500",
                        voted ? "bg-brand-gold/20" : "bg-brand-navy/5"
                      )}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                    <div className="relative flex items-center justify-between w-full gap-2">
                      <div className="flex items-center gap-2">
                        {voted && <CheckCircle2 size={14} className="text-brand-gold shrink-0" />}
                        <span className={cn("text-sm font-medium", voted && "font-bold")}>{opt.text}</span>
                      </div>
                      <span className={cn("text-xs font-bold shrink-0", voted ? "text-brand-gold" : "text-brand-navy/40")}>{pct}%</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Interactions bar */}
      <div className="px-5 pb-3 border-t border-black/5 pt-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => onLike(post)}
            className={cn(
              "flex items-center gap-1.5 transition-all active:scale-95 text-sm font-bold",
              isLiked ? "text-brand-gold" : "text-brand-navy/30 hover:text-brand-gold"
            )}
          >
            <Heart size={17} className={cn("transition-all", isLiked ? "fill-brand-gold scale-110" : "")} />
            <span>{likesCount}</span>
          </button>

          <button
            onClick={() => setShowAllComments(v => !v)}
            className="flex items-center gap-1.5 text-sm font-bold text-brand-navy/30 hover:text-brand-navy/60 transition-colors"
          >
            <MessageCircle size={17} />
            <span>{comments.length}</span>
          </button>

          {post.postType === 'poll' && (
            <div className="flex items-center gap-1.5 text-brand-navy/30 text-sm font-bold">
              <BarChart2 size={17} />
              <span>{totalVotes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Comments thread — toggled by the chat icon */}
      {(comments.length > 0 || showAllComments) && (
        <div className="px-5 pb-3 border-t border-black/5 pt-3 space-y-3">
          {visibleComments.map(comment => {
            const commentLiked = currentUser ? (comment.likedBy || []).includes(currentUser.uid) : false;
            return (
              <div key={comment.id} className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full overflow-hidden border border-black/5 shrink-0 mt-0.5">
                  <img src={comment.fromPhoto || `https://i.pravatar.cc/28?u=${comment.fromUid}`} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="bg-brand-bg rounded-2xl px-3 py-2">
                    <p className="text-xs font-bold text-brand-navy mb-0.5">{comment.fromName}</p>
                    <p className="text-xs text-brand-navy/70 leading-relaxed">{comment.content}</p>
                  </div>
                  <div className="flex items-center gap-3 mt-1 px-1">
                    <button
                      onClick={() => handleLikeComment(comment)}
                      className={cn("flex items-center gap-1 text-[10px] font-bold transition-colors", commentLiked ? "text-brand-gold" : "text-brand-navy/30 hover:text-brand-gold")}
                    >
                      <Heart size={10} className={commentLiked ? "fill-current" : ""} />
                      {comment.likesCount > 0 && <span>{comment.likesCount}</span>}
                    </button>
                    <span className="text-[10px] text-brand-navy/20">
                      {comment.createdAt ? format(comment.createdAt.toDate(), 'MMM d') : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {comments.length > 2 && (
            <button
              onClick={() => setShowAllComments(v => !v)}
              className="flex items-center gap-1 text-xs font-bold text-brand-navy/40 hover:text-brand-gold transition-colors"
            >
              <ChevronDown size={14} className={cn("transition-transform", showAllComments && "rotate-180")} />
              {showAllComments ? 'Show less' : `View all ${comments.length} comments`}
            </button>
          )}
        </div>
      )}

      {/* Comment input — always visible for logged-in users */}
      {currentUser && (
        <div className="px-5 pb-4 border-t border-black/5 pt-3 flex gap-2">
          <div className="w-7 h-7 rounded-full overflow-hidden border border-black/5 shrink-0">
            <img src={currentProfile?.photoURL || currentUser.photoURL || `https://i.pravatar.cc/28?u=${currentUser.uid}`} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 flex gap-2">
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); } }}
              placeholder="Add a comment…"
              className="flex-1 bg-brand-bg rounded-2xl px-3 py-2 text-xs border-none focus:outline-none focus:ring-2 focus:ring-brand-gold/20"
            />
            <button
              onClick={handleSubmitComment}
              disabled={!newComment.trim() || isCommenting}
              className="w-8 h-8 rounded-xl bg-brand-gold text-white flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function CreatePostModal({ onClose, user, profile }: { onClose: () => void, user: FirebaseUser, profile: UserProfile | null }) {
  const [content, setContent] = useState('');
  const [isPoll, setIsPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [isPosting, setIsPosting] = useState(false);
  const [vendorStore, setVendorStore] = useState<StoreProfile | null>(null);

  useEffect(() => {
    if (profile?.role === 'vendor') {
      const q = query(collection(db, 'stores'), where('ownerUid', '==', user.uid), limit(1));
      getDocs(q).then(snap => {
        if (!snap.empty) setVendorStore({ id: snap.docs[0].id, ...snap.docs[0].data() } as StoreProfile);
      });
    }
  }, [profile?.role, user.uid]);

  const handleAddOption = () => setPollOptions(prev => [...prev, '']);
  const handleOptionChange = (i: number, val: string) => {
    setPollOptions(prev => prev.map((o, idx) => idx === i ? val : o));
  };
  const handleRemoveOption = (i: number) => {
    if (pollOptions.length <= 2) return;
    setPollOptions(prev => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    if (!content.trim() && !isPoll) return;
    if (isPoll && pollOptions.filter(o => o.trim()).length < 2) return;
    setIsPosting(true);
    try {
      const initialVotes: { [key: string]: string[] } = {};
      const options = pollOptions.filter(o => o.trim()).map(text => ({ text }));
      options.forEach((_, i) => { initialVotes[String(i)] = []; });

      await addDoc(collection(db, 'global_posts'), {
        authorUid: user.uid,
        authorName: profile?.name || user.displayName || 'User',
        authorPhoto: profile?.photoURL || user.photoURL || '',
        authorRole: profile?.role || 'consumer',
        storeId: vendorStore?.id || null,
        storeName: vendorStore?.name || null,
        content: content.trim(),
        postType: isPoll ? 'poll' : 'post',
        pollOptions: isPoll ? options : null,
        pollVotes: isPoll ? initialVotes : null,
        createdAt: serverTimestamp(),
        likesCount: 0,
        likedBy: []
      });
      onClose();
    } catch (err) {
      console.error("Create post error:", err);
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-md bg-white rounded-t-[2.5rem] p-6 pb-10 space-y-5 shadow-2xl"
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-brand-navy/10 rounded-full mx-auto" />

        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-lg">New Post</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPoll(p => !p)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                isPoll ? "bg-brand-gold text-white shadow-md" : "bg-brand-navy/5 text-brand-navy/50 hover:bg-brand-navy/10"
              )}
            >
              <BarChart2 size={14} />
              Poll
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl bg-brand-navy/5 text-brand-navy/40">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-brand-navy/10">
            <img src={profile?.photoURL || user.photoURL || ''} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-bold text-sm">{profile?.name || user.displayName}</p>
              {profile?.role === 'vendor' && vendorStore && (
                <span className="text-[10px] text-brand-navy/40">• {vendorStore.name}</span>
              )}
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={isPoll ? "Ask a question..." : "What's on your mind?"}
              rows={3}
              className="w-full text-sm resize-none bg-transparent border-none outline-none text-brand-navy placeholder:text-brand-navy/30 leading-relaxed"
              autoFocus
            />
          </div>
        </div>

        {isPoll && (
          <div className="space-y-2 ml-13 pl-[52px]">
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-brand-bg rounded-xl px-4 py-2.5 border border-brand-navy/8">
                  <span className="w-5 h-5 rounded-full border-2 border-brand-navy/20 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-brand-navy/40">{i + 1}</span>
                  </span>
                  <input
                    value={opt}
                    onChange={e => handleOptionChange(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-brand-navy/30"
                  />
                </div>
                {pollOptions.length > 2 && (
                  <button onClick={() => handleRemoveOption(i)} className="text-brand-navy/20 hover:text-red-400 transition-colors">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 5 && (
              <button
                onClick={handleAddOption}
                className="flex items-center gap-2 text-brand-gold text-xs font-bold hover:opacity-80 transition-opacity"
              >
                <Plus size={14} />
                Add option
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-brand-navy/5">
          <button
            onClick={handleSubmit}
            disabled={isPosting || (!content.trim() && !isPoll) || (isPoll && pollOptions.filter(o => o.trim()).length < 2)}
            className="px-6 py-2.5 gradient-red text-white rounded-xl font-bold text-sm disabled:opacity-40 transition-all active:scale-95 shadow-md shadow-red-500/20"
          >
            {isPosting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function NotificationsPanel({ notifications, onClose }: { notifications: Notification[], onClose: () => void }) {
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markAsRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { isRead: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-brand-bg shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5">
          <div>
            <h2 className="font-display text-xl font-bold">Notifications</h2>
            {unreadCount > 0 && (
              <p className="text-xs text-brand-gold font-bold">{unreadCount} unread</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-2xl bg-brand-navy/5 flex items-center justify-center hover:bg-brand-navy/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {notifications.map(notif => (
            <div
              key={notif.id}
              onClick={() => { if (!notif.isRead) markAsRead(notif.id); }}
              className={cn(
                "bg-white rounded-[1.5rem] p-4 flex items-center gap-3 transition-all",
                !notif.isRead ? "ring-2 ring-brand-gold/30 cursor-pointer shadow-sm" : "opacity-75"
              )}
            >
              <div className="w-11 h-11 rounded-xl overflow-hidden border border-brand-navy/5 relative bg-brand-gold/10 flex items-center justify-center shrink-0">
                {notif.fromPhoto ? (
                  <img src={notif.fromPhoto} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Sparkles size={18} className="text-brand-gold" />
                )}
                <div className={cn("absolute -bottom-1 -right-1 p-1 rounded-md border-2 border-white", notif.type === 'like' ? "bg-red-400" : notif.type === 'comment' ? "bg-blue-400" : notif.type === 'message' ? "bg-brand-navy" : "bg-brand-gold")}>
                  {notif.type === 'follow' ? <UserPlus size={9} className="text-white" /> : notif.type === 'like' ? <Heart size={9} className="text-white fill-white" /> : notif.type === 'comment' || notif.type === 'message' ? <MessageCircle size={9} className="text-white" /> : <Bell size={9} className="text-white" />}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm line-clamp-2 leading-snug">
                  {notif.type === 'system'
                    ? notif.message
                    : <><span className="font-bold">{notif.fromName}</span> {notif.type === 'follow' ? 'started following you!' : notif.message}</>
                  }
                </p>
                <p className="text-[10px] text-brand-navy/40 font-bold uppercase tracking-widest mt-0.5">
                  {notif.createdAt ? format(notif.createdAt.toDate(), 'MMM d, h:mm a') : 'Just now'}
                </p>
              </div>
              <button
                onClick={async e => { e.stopPropagation(); await deleteDoc(doc(db, 'notifications', notif.id)); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-brand-navy/20 hover:text-red-400 hover:bg-red-50 transition-all shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {notifications.length === 0 && (
            <div className="py-24 text-center text-brand-navy/20">
              <Bell size={48} className="mx-auto mb-4 opacity-10" />
              <p className="font-bold">All caught up!</p>
              <p className="text-sm mt-1">No notifications yet</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ForYouScreen({ onViewUser, onViewStore, currentUser, currentProfile, userCards = [] }: { onViewUser: (u: UserProfile) => void, onViewStore?: (s: StoreProfile) => void, currentUser?: FirebaseUser, currentProfile?: UserProfile | null, userCards?: Card[] }) {
  const [globalPosts, setGlobalPosts] = useState<GlobalPost[]>([]);
  const [vendorPosts, setVendorPosts] = useState<any[]>([]);
  const [followingUids, setFollowingUids] = useState<Set<string>>(new Set());
  const [followingStoreIds, setFollowingStoreIds] = useState<Set<string>>(new Set());
  const [hotStores, setHotStores] = useState<StoreProfile[]>([]);
  const [joiningStoreId, setJoiningStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'hot'>('all');
  const lastDocRef = useRef<any>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 10;

  const loadInitial = () => {
    setLoading(true);
    return onSnapshot(
      query(collection(db, 'global_posts'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)),
      (snap) => {
        setGlobalPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost)));
        lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
        setHasMore(snap.docs.length === PAGE_SIZE);
        setLoading(false);
      },
      (err) => { console.error("global_posts:", err); setLoading(false); }
    );
  };

  const loadMoreRef = useRef(false);

  const loadMore = async () => {
    if (loadMoreRef.current || !hasMore || !lastDocRef.current) return;
    loadMoreRef.current = true;
    setLoadingMore(true);
    try {
      const snap = await getDocs(query(collection(db, 'global_posts'), orderBy('createdAt', 'desc'), startAfter(lastDocRef.current), limit(PAGE_SIZE)));
      setGlobalPosts(prev => [...prev, ...snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost))]);
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current;
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) { console.error("load more:", err); }
    loadMoreRef.current = false;
    setLoadingMore(false);
  };

  useEffect(() => { return loadInitial(); }, []);

  // Re-observe whenever posts change so sentinel is re-checked after each page loads
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) loadMore(); }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [globalPosts.length, hasMore]);

  useEffect(() => {
    const unsubVendor = onSnapshot(
      query(collectionGroup(db, 'posts'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => setVendorPosts(snap.docs.map(d => ({ id: d.id, _type: 'vendor', ...d.data() }))),
      (err) => console.error("vendor posts:", err)
    );
    return () => unsubVendor();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'follows'), where('followerUid', '==', currentUser.uid));
    return onSnapshot(q, (snap) => {
      setFollowingUids(new Set(snap.docs.map(d => d.data().followingUid as string)));
    });
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'store_follows'), where('followerUid', '==', currentUser.uid));
    return onSnapshot(q, (snap) => {
      setFollowingStoreIds(new Set(snap.docs.map(d => d.data().storeId as string)));
    }, () => {});
  }, [currentUser?.uid]);

  useEffect(() => {
    return onSnapshot(collection(db, 'stores'), (snap) => {
      setHotStores(snap.docs.map(d => ({ id: d.id, ...d.data() } as StoreProfile)));
    }, () => {});
  }, []);

  const handleJoinStore = async (store: StoreProfile) => {
    if (!currentUser) return;
    setJoiningStoreId(store.id);
    try {
      const cardId = `${currentUser.uid}_${store.id}`;
      const cardRef = doc(db, 'cards', cardId);
      const cardSnap = await getDoc(cardRef);
      if (!cardSnap.exists() || cardSnap.data()?.isArchived) {
        await setDoc(cardRef, {
          user_id: currentUser.uid,
          store_id: store.id,
          current_stamps: 0,
          total_completed_cycles: 0,
          last_tap_timestamp: serverTimestamp(),
          isArchived: false,
          isRedeemed: false,
          userName: currentProfile?.name || currentUser.displayName || 'Loyal Customer',
          userPhoto: currentProfile?.photoURL || currentUser.photoURL || ''
        });
        await updateDoc(doc(db, 'users', currentUser.uid), { total_cards_held: increment(1) });
      }
      if (onViewStore) onViewStore(store);
    } catch (err) { console.error(err); }
    setJoiningStoreId(null);
  };

  const handleLike = async (post: GlobalPost) => {
    if (!currentUser) return;
    const ref = doc(db, 'global_posts', post.id);
    const alreadyLiked = (post.likedBy || []).includes(currentUser.uid);
    await updateDoc(ref, {
      likedBy: alreadyLiked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
      likesCount: alreadyLiked ? Math.max(0, post.likesCount - 1) : post.likesCount + 1
    });
    if (!alreadyLiked && post.authorUid !== currentUser.uid) {
      // Fetch fresh profile to avoid stale/null currentProfile
      const senderSnap = await getDoc(doc(db, 'users', currentUser.uid)).catch(() => null);
      const senderData = senderSnap?.exists() ? senderSnap.data() : null;
      const senderName = senderData?.name || currentProfile?.name || currentUser.displayName || 'Someone';
      const senderPhoto = senderData?.photoURL || currentProfile?.photoURL || currentUser.photoURL || '';
      addDoc(collection(db, 'notifications'), {
        toUid: post.authorUid,
        fromUid: currentUser.uid,
        fromName: senderName,
        fromPhoto: senderPhoto,
        type: 'like',
        message: 'liked your post',
        isRead: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  const handleVote = async (post: GlobalPost, optionIndex: number) => {
    if (!currentUser) return;
    const ref = doc(db, 'global_posts', post.id);
    const votes = post.pollVotes || {};
    const currentVoteKey = Object.keys(votes).find(k => (votes[k] || []).includes(currentUser.uid));
    const updates: any = {};
    if (currentVoteKey !== undefined) {
      updates[`pollVotes.${currentVoteKey}`] = arrayRemove(currentUser.uid);
    }
    if (currentVoteKey !== String(optionIndex)) {
      updates[`pollVotes.${optionIndex}`] = arrayUnion(currentUser.uid);
    }
    if (Object.keys(updates).length > 0) await updateDoc(ref, updates);
  };

  const sortedFeed = [...globalPosts, ...vendorPosts].sort((a, b) => {
    const tA = a.createdAt?.toMillis?.() || 0;
    const tB = b.createdAt?.toMillis?.() || 0;
    return tB - tA;
  });

  const displayFeed = sortedFeed;

  return (
    <div className="space-y-5 pb-20">
      <div className="flex p-1 glass-card rounded-2xl">
        {(['all', ...(onViewStore ? ['hot'] : [])] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5",
              activeSubTab === tab ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40"
            )}
          >
            {tab === 'all' ? <Zap size={13} /> : <Flame size={13} />}
            {tab === 'all' ? 'All' : 'Hot'}
          </button>
        ))}
      </div>

      {activeSubTab === 'hot' ? (
        <div className="grid grid-cols-2 gap-3">
          {hotStores.map(store => {
            const joined = userCards.some(c => c.store_id === store.id && !c.isArchived);
            const isJoining = joiningStoreId === store.id;
            const bg = store.theme || '#1e3a5f';
            return (
              <motion.div
                key={store.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative rounded-[1.75rem] overflow-hidden aspect-square flex flex-col cursor-pointer active:scale-[0.97] transition-transform"
                style={{ background: `linear-gradient(145deg, ${bg}ee, ${bg}99)` }}
                onClick={() => onViewStore && onViewStore(store)}
              >
                {/* Cover blurred background */}
                {store.coverUrl && (
                  <div className="absolute inset-0">
                    <img src={store.coverUrl} alt="" className="w-full h-full object-cover opacity-20" />
                  </div>
                )}
                <div className="relative z-10 flex flex-col h-full p-4">
                  {/* Logo + verified */}
                  <div className="flex items-start justify-between mb-auto">
                    <div className="w-11 h-11 rounded-2xl overflow-hidden border-2 border-white/30 shadow-lg bg-white/10">
                      {store.logoUrl
                        ? <img src={store.logoUrl} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><Building2 size={18} className="text-white/70" /></div>}
                    </div>
                    {store.isVerified && (
                      <div className="w-6 h-6 bg-brand-gold rounded-full flex items-center justify-center shadow">
                        <Sparkles size={11} className="text-brand-navy" />
                      </div>
                    )}
                  </div>

                  {/* Reward headline + store name */}
                  <div className="mt-2">
                    {store.reward
                      ? <p className="font-extrabold text-white text-base leading-tight line-clamp-2">{store.reward}</p>
                      : <p className="font-extrabold text-white text-base leading-tight line-clamp-2">{store.stamps_required_for_reward} stamps to reward</p>
                    }
                    <p className="text-white/50 text-[10px] font-medium mt-1 line-clamp-1">{store.name}</p>
                  </div>

                  {/* Join button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!joined) handleJoinStore(store); else onViewStore && onViewStore(store); }}
                    disabled={isJoining}
                    className={cn(
                      "mt-3 w-full py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5",
                      joined
                        ? "bg-white/20 text-white/80"
                        : "bg-white text-brand-navy shadow-lg"
                    )}
                  >
                    {isJoining
                      ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Sparkles size={12} /></motion.div>
                      : joined ? <><UserCheck size={12} /> Joined</> : <><Plus size={12} /> Join</>}
                  </button>
                </div>
              </motion.div>
            );
          })}
          {hotStores.length === 0 && (
            <div className="col-span-2 py-20 text-center text-brand-navy/20">
              <Building2 size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-bold text-sm">No businesses yet</p>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
            <Sparkles className="w-8 h-8 text-brand-gold" />
          </motion.div>
        </div>
      ) : (
        <div className="space-y-4">
          {displayFeed.map((item) => {
            const isGlobal = !item._type;
            if (isGlobal) {
              return (
                <FeedPostCard
                  key={`gp-${item.id}`}
                  post={item as GlobalPost}
                  currentUser={currentUser}
                  currentProfile={currentProfile}
                  onViewUser={onViewUser}
                  onViewStore={onViewStore}
                  onLike={handleLike}
                  onVote={handleVote}
                  onDelete={async (p) => { await deleteDoc(doc(db, 'global_posts', p.id)); }}
                />
              );
            } else {
              return (
                <motion.div key={`vp-${item.id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 rounded-[2rem] space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden border border-brand-navy/5 shrink-0">
                      <img src={item.authorPhoto || `https://picsum.photos/seed/${item.authorUid}/40`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm truncate">{item.authorName}</p>
                        <span className="px-2 py-0.5 bg-brand-gold/10 rounded-full text-[9px] font-bold text-brand-gold uppercase shrink-0">Store</span>
                      </div>
                      <p className="text-[10px] text-brand-navy/40">{item.createdAt ? format(item.createdAt.toDate(), 'MMM d, h:mm a') : 'Just now'}</p>
                    </div>
                  </div>
                  <p className="text-sm text-brand-navy/90 leading-relaxed">{item.content}</p>
                </motion.div>
              );
            }
          })}
          {displayFeed.length === 0 && (
            <div className="py-20 text-center text-brand-navy/20">
              <Compass size={64} className="mx-auto mb-4 opacity-10" />
              <p className="font-bold">{activeSubTab === 'following' ? 'No posts from people you follow' : 'Nothing posted yet'}</p>
              <p className="text-sm">{activeSubTab === 'following' ? 'Follow people to see their posts here' : 'Be the first to post!'}</p>
            </div>
          )}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="w-5 h-5 text-brand-gold/50" />
              </motion.div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessagesScreen({ currentUser, currentProfile, activeChatId, setActiveChatId, onViewUser, vendorStore }: { currentUser: FirebaseUser, currentProfile: UserProfile | null, activeChatId: string | null, setActiveChatId: (id: string | null) => void, onViewUser: (u: UserProfile) => void, vendorStore?: StoreProfile | null }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [msgHasMore, setMsgHasMore] = useState(false);
  const [msgLoadingMore, setMsgLoadingMore] = useState(false);
  const msgLastDocRef = useRef<any>(null);
  const msgLoadingMoreRef = useRef(false);
  const [newMessage, setNewMessage] = useState('');
  const [chatPartner, setChatPartner] = useState<UserProfile | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [storeCustomers, setStoreCustomers] = useState<UserProfile[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'chats'),
      where('uids', 'array-contains', currentUser.uid),
      orderBy('lastActivity', 'desc')
    );
    return onSnapshot(q, (snap) => {
      setChats(snap.docs.map(d => ({ id: d.id, ...d.data() } as Chat)));
    });
  }, [currentUser.uid]);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      setOlderMessages([]);
      setMsgHasMore(false);
      msgLastDocRef.current = null;
      setChatPartner(null);
      return;
    }
    setOlderMessages([]);
    setMsgHasMore(false);
    msgLastDocRef.current = null;

    // Fetch partner — poll briefly if doc not yet created (race with background creation)
    const loadPartner = async (retries = 5) => {
      try {
        const chatSnap = await getDoc(doc(db, 'chats', activeChatId));
        if (!chatSnap.exists()) {
          if (retries > 0) { setTimeout(() => loadPartner(retries - 1), 600); }
          return;
        }
        const partnerUid = (chatSnap.data().uids as string[]).find(id => id !== currentUser.uid);
        if (!partnerUid) return;
        const userSnap = await getDoc(doc(db, 'users', partnerUid));
        if (userSnap.exists()) setChatPartner({ uid: userSnap.id, ...userSnap.data() } as UserProfile);
        const unreadCount = chatSnap.data().unreadCount || {};
        if (unreadCount[currentUser.uid]) {
          updateDoc(doc(db, 'chats', activeChatId), { [`unreadCount.${currentUser.uid}`]: 0 }).catch(() => {});
        }
      } catch { /* ignore permission errors on retry */ }
    };
    loadPartner();

    const q = query(
      collection(db, 'chats', activeChatId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(15)
    );
    return onSnapshot(q, (snap) => {
      const latest = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)).reverse();
      setMessages(latest);
      // The last doc in desc order is the oldest in this window — cursor for loading older
      if (snap.docs.length === 15) {
        msgLastDocRef.current = snap.docs[snap.docs.length - 1];
        setMsgHasMore(true);
      }
    });
  }, [activeChatId, currentUser.uid]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) el.scrollTop = el.scrollHeight;
      });
    });
    return () => { cancelled = true; };
  }, [messages, activeChatId]);

  const loadOlderMessages = async () => {
    if (!activeChatId || msgLoadingMoreRef.current || !msgHasMore || !msgLastDocRef.current) return;
    msgLoadingMoreRef.current = true;
    setMsgLoadingMore(true);
    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    try {
      const snap = await getDocs(query(
        collection(db, 'chats', activeChatId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(msgLastDocRef.current),
        limit(15)
      ));
      const older = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)).reverse();
      setOlderMessages(prev => [...older, ...prev]);
      msgLastDocRef.current = snap.docs.length === 15 ? snap.docs[snap.docs.length - 1] : null;
      setMsgHasMore(snap.docs.length === 15);
      // Restore scroll so content doesn't jump
      if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevScrollHeight; });
    } catch { /* ignore */ }
    msgLoadingMoreRef.current = false;
    setMsgLoadingMore(false);
  };

  const handleMsgScroll = () => {
    const el = scrollContainerRef.current;
    if (el && el.scrollTop < 60) loadOlderMessages();
  };

  useEffect(() => {
    if (!vendorStore) return;
    const q = query(
      collection(db, 'cards'),
      where('store_id', '==', vendorStore.id),
      where('isArchived', '==', false)
    );
    const unsub = onSnapshot(q, async (snap) => {
      const userIds = [...new Set(snap.docs.map(d => d.data().user_id as string))];
      const profiles = await Promise.all(
        userIds.map(uid => getDoc(doc(db, 'users', uid)).then(s => s.exists() ? { uid: s.id, ...s.data() } as UserProfile : null))
      );
      setStoreCustomers(profiles.filter(Boolean) as UserProfile[]);
    });
    return unsub;
  }, [vendorStore]);

  const handleStartCustomerChat = async (customer: UserProfile) => {
    const chatId = [currentUser.uid, customer.uid].sort().join('_');
    // Navigate immediately
    setShowCustomerPicker(false);
    setActiveChatId(chatId);
    // Create chat doc in background if needed
    try {
      const chatRef = doc(db, 'chats', chatId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          uids: [currentUser.uid, customer.uid],
          lastActivity: serverTimestamp(),
          lastMessage: '',
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error('Chat create error:', err);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !activeChatId) return;
    const text = newMessage;
    setNewMessage('');

    try {
      const messageData = {
        chatId: activeChatId,
        senderUid: currentUser.uid,
        senderName: currentProfile?.name || currentUser.displayName || 'Me',
        text,
        createdAt: serverTimestamp()
      };
      
      await addDoc(collection(db, 'chats', activeChatId, 'messages'), messageData);
      
      const partnerUid = chatPartner?.uid;
      await updateDoc(doc(db, 'chats', activeChatId), {
        lastMessage: text,
        lastActivity: serverTimestamp(),
        ...(partnerUid ? { [`unreadCount.${partnerUid}`]: increment(1) } : {})
      });

      // Send notification to partner
      if (partnerUid) {
        await addDoc(collection(db, 'notifications'), {
          toUid: partnerUid,
          fromUid: currentUser.uid,
          fromName: currentProfile?.name || currentUser.displayName || 'Friend',
          fromPhoto: currentProfile?.photoURL || currentUser.photoURL || '',
          type: 'message',
          message: `New message: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
          isRead: false,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error("Send message error:", err);
    }
  };

  if (activeChatId && chatPartner) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="fixed inset-0 bg-brand-bg z-[100] flex flex-col max-w-md mx-auto"
      >
        <header className="glass-panel px-6 py-4 flex items-center gap-4">
          <button onClick={() => setActiveChatId(null)} className="p-2 -ml-2 text-brand-navy/60">
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white shadow-sm cursor-pointer" onClick={() => onViewUser(chatPartner)}>
              <img src={chatPartner.photoURL} alt="" className="w-full h-full object-cover" />
            </div>
            <div>
              <h3 className="font-bold text-sm leading-tight">{chatPartner.name}</h3>
              <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest">Online</p>
            </div>
          </div>
          <button className="p-2 text-brand-navy/60">
            <MoreVertical size={20} />
          </button>
        </header>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto py-4 space-y-2" onClick={() => setSelectedMsgId(null)} onScroll={handleMsgScroll}>
          {msgLoadingMore && (
            <div className="flex justify-center py-2">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="w-4 h-4 text-brand-gold/50" />
              </motion.div>
            </div>
          )}
          {[...olderMessages, ...messages].map((msg, idx, all) => {
            const isMe = msg.senderUid === currentUser.uid;
            const showName = idx === 0 || all[idx-1].senderUid !== msg.senderUid;
            const isSelected = selectedMsgId === msg.id;
            return (
              <div key={msg.id} className="w-full px-2">
                {showName && !isMe && <span className="text-[10px] font-bold text-brand-navy/40 mb-1 ml-1 block">{msg.senderName}</span>}
                <div
                  className={cn("flex items-end gap-2 w-full", isMe ? "flex-row-reverse" : "flex-row")}
                  onClick={e => { e.stopPropagation(); if (isMe) setSelectedMsgId(isSelected ? null : msg.id); }}
                >
                  <div className={cn(
                    "flex-1 px-4 py-3 rounded-2xl text-sm shadow-sm",
                    isMe ? "bg-brand-navy text-white" : "glass-card text-brand-navy"
                  )}>
                    {msg.text}
                  </div>
                  <AnimatePresence>
                    {isSelected && isMe && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                        onClick={async e => {
                          e.stopPropagation();
                          await deleteDoc(doc(db, 'chats', activeChatId!, 'messages', msg.id));
                          setSelectedMsgId(null);
                        }}
                        className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0 mb-0.5"
                      >
                        <Trash2 size={13} className="text-red-500" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-6 bg-white border-t border-brand-navy/5">
          <div className="flex gap-2">
            <input 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-6 py-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 text-sm"
            />
            <button 
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              className="p-4 bg-brand-gold text-brand-navy rounded-2xl shadow-lg shadow-brand-gold/20 active:scale-95 transition-all disabled:opacity-50"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (showCustomerPicker && vendorStore) {
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <button onClick={() => setShowCustomerPicker(false)} className="p-2 -ml-2 text-brand-navy/60">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold">Message a Customer</h2>
            <p className="text-brand-navy/60 text-sm">{storeCustomers.length} active cardholders</p>
          </div>
        </header>
        <div className="space-y-3">
          {storeCustomers.length === 0 && (
            <div className="glass-card p-10 rounded-[2.5rem] text-center">
              <p className="text-brand-navy/60 font-bold">No customers yet</p>
              <p className="text-xs text-brand-navy/40 mt-1">Customers will appear here once they join your loyalty program.</p>
            </div>
          )}
          {storeCustomers.map(customer => (
            <button
              key={customer.uid}
              onClick={() => handleStartCustomerChat(customer)}
              className="w-full bg-white p-4 rounded-2xl flex items-center gap-4 border border-brand-navy/5 hover:border-brand-gold/20 transition-all text-left"
            >
              <div className="w-14 h-14 rounded-2xl overflow-hidden border border-brand-navy/5">
                <img src={customer.photoURL} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm truncate">{customer.name}</h4>
                <p className="text-xs text-brand-navy/40">{customer.email}</p>
              </div>
              <MessageCircle size={18} className="text-brand-navy/20 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-3xl font-bold mb-1">Messages</h2>
          <p className="text-brand-navy/60 text-sm">Direct conversations with others.</p>
        </div>
        {vendorStore && (
          <button
            onClick={() => setShowCustomerPicker(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-navy text-white rounded-2xl text-xs font-bold shadow-lg active:scale-95 transition-all"
          >
            <MessageCircle size={14} />
            New
          </button>
        )}
      </header>

      <div className="space-y-3">
        {chats.map(chat => (
          <ChatListItem
            key={chat.id}
            chat={chat}
            currentUser={currentUser}
            onClick={() => setActiveChatId(chat.id)}
          />
        ))}

        {chats.length === 0 && (
          <div className="glass-card p-10 rounded-[2.5rem] border-2 border-dashed border-brand-rose/40 text-center">
            <div className="w-16 h-16 bg-brand-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-brand-navy/20" />
            </div>
            <p className="text-brand-navy/60 mb-2 font-bold">No conversations</p>
            <p className="text-xs text-brand-navy/40">
              {vendorStore ? 'Tap "New" to message a customer.' : "Start a message from someone's profile!"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatListItem({ chat, currentUser, onClick }: { chat: Chat, currentUser: FirebaseUser, onClick: () => void, key?: React.Key }) {
  const [partner, setPartner] = useState<UserProfile | null>(null);
  const partnerUid = chat.uids.find(id => id !== currentUser.uid);

  useEffect(() => {
    if (!partnerUid) return;
    getDoc(doc(db, 'users', partnerUid)).then(snap => {
      if (snap.exists()) setPartner({ uid: snap.id, ...snap.data() } as UserProfile);
    });
  }, [partnerUid]);

  if (!partner) return null;

  return (
    <button 
      onClick={onClick}
      className="w-full bg-white p-4 rounded-2xl flex items-center gap-4 border border-brand-navy/5 hover:border-brand-gold/20 transition-all text-left"
    >
      <div className="w-14 h-14 rounded-2xl overflow-hidden border border-brand-navy/5">
        <img src={partner.photoURL} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <h4 className="font-bold text-sm truncate">{partner.name}</h4>
          <span className="text-[10px] text-brand-navy/40 uppercase font-bold">
            {chat.lastActivity?.toDate ? format(chat.lastActivity.toDate(), 'HH:mm') : '...'}
          </span>
        </div>
        <p className="text-xs text-brand-navy/60 truncate">{chat.lastMessage || 'Start a conversation'}</p>
      </div>
    </button>
  );
}

function CommunityScreen({ onViewUser, currentUser }: { onViewUser: (u: UserProfile) => void, currentUser: FirebaseUser, key?: React.Key }) {
  const [activeSubTab, setActiveSubTab] = useState<'leaderboard' | 'discover'>('leaderboard');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [followingUids, setFollowingUids] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('totalStamps', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
      setLoading(false);
    }, (error) => {
      console.error("Community leaderboard error:", error);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'follows'), where('followerUid', '==', currentUser.uid));
    return onSnapshot(q, (snap) => {
      setFollowingUids(new Set(snap.docs.map(d => d.data().followingUid as string)));
    });
  }, [currentUser.uid]);

  const handleToggleFollow = async (targetUid: string) => {
    const followId = `${currentUser.uid}_${targetUid}`;
    if (followingUids.has(targetUid)) {
      await deleteDoc(doc(db, 'follows', followId));
    } else {
      await setDoc(doc(db, 'follows', followId), {
        followerUid: currentUser.uid,
        followingUid: targetUid,
        createdAt: serverTimestamp()
      });
    }
  };

  const filteredUsers = users.filter(u => u.uid !== currentUser.uid && (u.name || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-3xl font-bold mb-4">Community</h2>
        <div className="flex gap-2 bg-white p-1 rounded-2xl border border-brand-navy/5">
          {(['leaderboard', 'discover'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              className={cn(
                "flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all",
                activeSubTab === tab ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40 hover:bg-brand-bg"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-12">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
            <Sparkles className="w-8 h-8 text-brand-gold" />
          </motion.div>
        </div>
      ) : (
        <>
          {activeSubTab === 'leaderboard' && (
            <div className="space-y-4">
              <div className="bg-brand-navy p-6 rounded-[2.5rem] text-white flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-brand-gold shrink-0">
                    {users[0]?.photoURL
                      ? <img src={users[0].photoURL} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-brand-gold flex items-center justify-center"><Trophy className="w-6 h-6 text-brand-navy" /></div>}
                  </div>
                  <div>
                    <p className="text-xs text-white/60 font-bold uppercase tracking-widest">Top Collector</p>
                    <p className="text-lg font-bold">{users[0]?.name || '---'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-brand-gold">{users[0]?.totalStamps || 0}</p>
                  <p className="text-[10px] text-white/40 font-bold uppercase">Stamps</p>
                </div>
              </div>

              <div className="space-y-2">
                {users.map((u, i) => (
                  <div 
                    key={`leaderboard-${u.uid}`} 
                    onClick={() => onViewUser(u)}
                    className="glass-card p-4 rounded-2xl flex items-center gap-4 hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="w-8 font-display font-bold text-brand-navy/20">#{i + 1}</div>
                    <div className="w-10 h-10 rounded-full overflow-hidden border border-brand-navy/5">
                      <img src={u.photoURL} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm">{u.name}</p>
                      <p className="text-xs text-brand-navy/40">{u.totalStamps} stamps</p>
                    </div>
                    {i < 3 && <Sparkles className="w-4 h-4 text-brand-gold" />}
                  </div>
                ))}
                {users.length === 0 && (
                  <div className="py-12 text-center text-brand-navy/20">
                    <Trophy size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="text-sm font-bold">No collectors yet. Be the first!</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSubTab === 'discover' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search users..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white border border-brand-navy/5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/20"
                />
              </div>
              <div className="space-y-2">
                {filteredUsers.map(u => {
                  const isFollowing = followingUids.has(u.uid);
                  return (
                    <div key={u.uid} className="glass-card p-4 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full overflow-hidden border border-brand-navy/5 cursor-pointer" onClick={() => onViewUser(u)}>
                        <img src={u.photoURL} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 cursor-pointer" onClick={() => onViewUser(u)}>
                        <p className="font-bold text-sm">{u.name}</p>
                        <p className="text-xs text-brand-navy/40">{u.role}</p>
                      </div>
                      <button
                        onClick={() => handleToggleFollow(u.uid)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                          isFollowing
                            ? "bg-brand-navy/10 text-brand-navy/60 hover:bg-red-50 hover:text-red-400"
                            : "bg-brand-gold text-brand-navy hover:bg-brand-gold/80"
                        )}
                      >
                        {isFollowing ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StoreProfileView({ store, onBack, user, profile, onViewUser, onMessage }: { store: StoreProfile, onBack: () => void, user: FirebaseUser, profile: UserProfile | null, onViewUser: (u: UserProfile) => void, onMessage?: (chatId: string) => void, key?: React.Key }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [vendorGlobalPosts, setVendorGlobalPosts] = useState<GlobalPost[]>([]);
  const [storeReviews, setStoreReviews] = useState<any[]>([]);
  const [activeStoreTab, setActiveStoreTab] = useState<'posts' | 'reviews'>('posts');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [newPost, setNewPost] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [isFollowingStore, setIsFollowingStore] = useState(false);
  const [allStoreCards, setAllStoreCards] = useState<Card[]>([]);

  useEffect(() => {
    const cardId = `${user.uid}_${store.id}`;
    return onSnapshot(doc(db, 'cards', cardId), (snap) => {
      if (snap.exists() && !snap.data()?.isArchived) {
        setCard({ id: snap.id, ...snap.data() } as Card);
      } else {
        setCard(null);
      }
    }, (err) => console.error("Card detail listener:", err));
  }, [user.uid, store.id]);

  useEffect(() => {
    const q = query(collection(db, 'cards'), where('store_id', '==', store.id));
    return onSnapshot(q, snap => setAllStoreCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card))), () => {});
  }, [store.id]);

  useEffect(() => {
    const q = query(
      collection(db, 'cards'),
      where('store_id', '==', store.id),
      where('isArchived', '==', false),
      orderBy('current_stamps', 'desc'),
      limit(5)
    );
    return onSnapshot(q, async (snap) => {
      const cards = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const enriched = await Promise.all(cards.map(async (card) => {
        if (card.user_id) {
          const usnap = await getDoc(doc(db, 'users', card.user_id));
          if (usnap.exists()) {
            const u = usnap.data() as UserProfile;
            return { ...card, userName: u.name || card.userName, userPhoto: u.photoURL || card.userPhoto };
          }
        }
        return card;
      }));
      setLeaderboard(enriched);
    }, (err) => console.error("Store leaderboard listener:", err));
  }, [store.id]);

  useEffect(() => {
    const q = query(collection(db, 'stores', store.id, 'posts'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
    }, (error) => {
      console.error("Store feed error:", error);
    });
  }, [store.id]);

  useEffect(() => {
    if (!store.ownerUid) return;
    const q = query(collection(db, 'global_posts'), where('authorUid', '==', store.ownerUid), where('authorRole', '==', 'vendor'), orderBy('createdAt', 'desc'), limit(30));
    return onSnapshot(q, snap => setVendorGlobalPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost))), () => {});
  }, [store.ownerUid]);

  useEffect(() => {
    const q = query(collection(db, 'store_reviews'), where('storeId', '==', store.id), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => setStoreReviews(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
  }, [store.id]);

  useEffect(() => {
    const followId = `${user.uid}_${store.id}`;
    return onSnapshot(doc(db, 'store_follows', followId), (snap) => {
      setIsFollowingStore(snap.exists());
    }, () => {});
  }, [user.uid, store.id]);

  const handleFollowStore = async () => {
    const followId = `${user.uid}_${store.id}`;
    if (isFollowingStore) {
      await deleteDoc(doc(db, 'store_follows', followId));
    } else {
      await setDoc(doc(db, 'store_follows', followId), {
        followerUid: user.uid,
        storeId: store.id,
        createdAt: serverTimestamp(),
      });
    }
  };

  const handleMessageStore = async () => {
    if (!onMessage || !store.ownerUid || store.ownerUid === user.uid) return;
    const chatId = [user.uid, store.ownerUid].sort().join('_');
    // Navigate immediately — don't block on Firestore
    onMessage(chatId);
    // Create chat doc in background if it doesn't exist
    try {
      const chatRef = doc(db, 'chats', chatId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          uids: [user.uid, store.ownerUid],
          lastActivity: serverTimestamp(),
          lastMessage: '',
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error('Chat create error:', err);
    }
  };

  const handleJoinStore = async () => {
    const cardId = `${user.uid}_${store.id}`;
    const cardRef = doc(db, 'cards', cardId);
    await setDoc(cardRef, {
      user_id: user.uid,
      store_id: store.id,
      current_stamps: 0,
      total_completed_cycles: 0,
      last_tap_timestamp: serverTimestamp(),
      isArchived: false
    });
    
    await updateDoc(doc(db, 'users', user.uid), {
      total_cards_held: increment(1)
    });
  };

  const handleCreatePost = async () => {
    if (!newPost.trim() || !profile) return;
    setIsPosting(true);
    try {
      const content = newPost.trim();
      const authorName = profile.name || profile.email?.split('@')[0] || 'Anonymous';
      const authorPhoto = profile.photoURL || '';

      // Write to store subcollection for the business wall
      await addDoc(collection(db, 'stores', store.id, 'posts'), {
        store_id: store.id,
        authorUid: profile.uid,
        authorName,
        authorPhoto,
        content,
        storeName: store.name,
        wallPost: true,
        createdAt: serverTimestamp(),
        likesCount: 0
      });

      // Also publish to global_posts so followers see it in their feed
      await addDoc(collection(db, 'global_posts'), {
        authorUid: profile.uid,
        authorName,
        authorPhoto,
        authorRole: profile.role || 'consumer',
        storeId: store.id,
        storeName: store.name,
        wallPost: true,
        content,
        postType: 'post',
        createdAt: serverTimestamp(),
        likesCount: 0,
        likedBy: [],
      });

      setNewPost('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsPosting(false);
    }
  };

  const myReview = storeReviews.find(r => r.authorUid === user.uid);

  const handleSubmitReview = async () => {
    if (!reviewText.trim() || myReview) return;
    setIsSubmittingReview(true);
    try {
      const authorName = profile?.name || user.displayName || 'Anonymous';
      const authorPhoto = profile?.photoURL || user.photoURL || '';
      const content = reviewText.trim();

      const reviewRef = await addDoc(collection(db, 'store_reviews'), {
        storeId: store.id,
        authorUid: user.uid,
        authorName,
        authorPhoto,
        rating: reviewRating,
        content,
        createdAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'global_posts'), {
        authorUid: user.uid,
        authorName,
        authorPhoto,
        authorRole: 'consumer',
        storeId: store.id,
        storeName: store.name,
        postType: 'review',
        rating: reviewRating,
        content,
        storeReviewId: reviewRef.id,
        createdAt: serverTimestamp(),
        likesCount: 0,
        likedBy: [],
      });

      setReviewText('');
      setReviewRating(5);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Public stats (respect visibility settings)
  const vis = store.visibilitySettings;
  const stampsReq = store.stamps_required_for_reward || 10;
  const totalMembers = new Set(allStoreCards.map(c => c.user_id)).size;
  const totalStampsGiven = allStoreCards.reduce((sum, c) => sum + (c.current_stamps || 0) + ((c.total_completed_cycles || 0) * stampsReq), 0);
  const activeCards = allStoreCards.filter(c => !c.isArchived).length;
  const returningUsers = allStoreCards.filter(c => (c.total_completed_cycles || 0) > 0).length;
  const returnRate = totalMembers > 0 ? Math.round((returningUsers / totalMembers) * 100) : 0;
  const showStats = vis ? Object.values(vis).some(Boolean) : true;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="space-y-6"
    >
      <button onClick={onBack} className="flex items-center gap-2 text-brand-navy/60 font-bold text-sm hover:text-brand-navy transition-colors">
        <ArrowLeft size={18} />
        Back
      </button>

      <div className="relative h-48 rounded-[2.5rem] overflow-hidden">
        <img src={store.coverUrl} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-navy/80 to-transparent" />
        <div className="absolute bottom-6 left-6 flex items-end gap-4">
          <div className="w-20 h-20 rounded-2xl border-4 border-white overflow-hidden bg-white">
            <img src={store.logoUrl} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-white">{store.name}</h2>
              {store.isVerified && <CheckCircle2 size={18} className="text-blue-400" />}
            </div>
            <p className="text-white/60 text-sm">{store.category}{store.location || store.address ? ` • ${store.location || store.address}` : ''}</p>
          </div>
        </div>
        <div className="absolute top-4 right-4 flex gap-2">
          {onMessage && store.ownerUid && store.ownerUid !== user.uid && (
            <button
              onClick={handleMessageStore}
              className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-white/90 text-brand-navy font-bold text-xs shadow-lg active:scale-95 transition-all"
            >
              <MessageCircle size={14} />
              Message
            </button>
          )}
          <button
            onClick={handleFollowStore}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-2xl font-bold text-xs transition-all shadow-lg active:scale-95",
              isFollowingStore
                ? "bg-white/20 text-white border border-white/30 hover:bg-red-500/30"
                : "bg-brand-gold text-brand-navy hover:bg-brand-gold/80"
            )}
          >
            {isFollowingStore ? <UserCheck size={14} /> : <UserPlus size={14} />}
            {isFollowingStore ? 'Following' : 'Follow'}
          </button>
          {store.ownerUid !== user.uid && (
            <button
              onClick={card ? undefined : handleJoinStore}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-2xl font-bold text-xs transition-all shadow-lg active:scale-95",
                card
                  ? "bg-green-500/30 text-green-300 border border-green-400/40 cursor-default"
                  : "bg-white/90 text-brand-navy hover:bg-white"
              )}
            >
              {card ? <><UserCheck size={14} /> Member</> : <><Plus size={14} /> Join</>}
            </button>
          )}
        </div>
      </div>

      {store.ownerUid !== user.uid && (
        card ? (
          <>
            <div className="flex items-center gap-2 px-1">
              <UserCheck size={15} className="text-green-400" />
              <span className="text-green-400 font-bold text-sm">Joined</span>
            </div>
            <LoyaltyCard card={card} store={store} />
          </>
        ) : (
          <div className="flex items-center justify-between px-1">
            <p className="text-white/50 text-sm">Not a member yet</p>
            <button
              onClick={handleJoinStore}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-brand-gold text-brand-navy font-bold text-sm shadow active:scale-95 transition-all"
            >
              <Plus size={14} /> Join
            </button>
          </div>
        )
      )}

      {showStats && (
        <div className="grid grid-cols-2 gap-3">
          {(vis?.members !== false) && (
            <div className="glass-card p-4 rounded-[2rem]">
              <div className="flex items-center gap-1.5 mb-1">
                <Users size={13} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Members</span>
              </div>
              <p className="text-2xl font-bold">{totalMembers}</p>
            </div>
          )}
          {(vis?.stamps !== false) && (
            <div className="glass-card p-4 rounded-[2rem]">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 size={13} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Stamps</span>
              </div>
              <p className="text-2xl font-bold">{totalStampsGiven}</p>
            </div>
          )}
          {(vis?.activeCards !== false) && (
            <div className="glass-card p-4 rounded-[2rem]">
              <div className="flex items-center gap-1.5 mb-1">
                <Wallet size={13} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Active Cards</span>
              </div>
              <p className="text-2xl font-bold">{activeCards}</p>
            </div>
          )}
          {(vis?.returnRate !== false) && (
            <div className="glass-card p-4 rounded-[2rem]">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp size={13} className="text-brand-gold" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40">Return Rate</span>
              </div>
              <p className="text-2xl font-bold">{returnRate}<span className="text-base">%</span></p>
            </div>
          )}
        </div>
      )}

      <div className="glass-card p-6 rounded-[2.5rem]">
        <h3 className="font-bold mb-2">About</h3>
        <p className="text-sm text-brand-navy/60 leading-relaxed">{store.description}</p>
      </div>

      <div className="glass-card p-6 rounded-[2.5rem] space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Top Collectors</h3>
          <Trophy size={18} className="text-brand-gold" />
        </div>
        <div className="space-y-3">
          {leaderboard.map((entry, index) => (
            <div 
              key={`lb-${entry.id}`} 
              onClick={async () => {
                const uq = query(collection(db, 'users'), where('uid', '==', entry.user_id));
                const usnap = await getDocs(uq);
                if (!usnap.empty) {
                  onViewUser({ uid: usnap.docs[0].id, ...usnap.docs[0].data() } as UserProfile);
                }
              }}
              className="flex items-center justify-between p-3 rounded-2xl hover:bg-brand-bg transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 flex items-center justify-center font-bold text-xs text-brand-navy/40">
                  #{index + 1}
                </div>
                <div className="w-10 h-10 rounded-full overflow-hidden border border-brand-navy/5">
                  <img src={entry.userPhoto || `https://i.pravatar.cc/150?u=${entry.user_id}`} alt="" className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="font-bold text-sm group-hover:text-brand-gold transition-colors">{entry.userName || 'Loyal Customer'}</p>
                  <p className="text-[10px] text-brand-navy/40 font-bold uppercase tracking-widest">{entry.total_completed_cycles || 0} Rewards Earned</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-brand-navy">{entry.current_stamps} Stamps</p>
              </div>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <p className="text-center py-4 text-xs text-brand-navy/40 font-bold uppercase tracking-widest">No collectors yet</p>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex p-1 glass-card rounded-2xl">
        {(['posts', 'reviews'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveStoreTab(tab)}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5",
              activeStoreTab === tab ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40"
            )}
          >
            {tab === 'posts' ? <><MessageSquare size={13} /> Posts</> : <><Star size={13} /> Reviews {storeReviews.length > 0 && `(${storeReviews.length})`}</>}
          </button>
        ))}
      </div>

      {activeStoreTab === 'posts' && (() => {
        const merged = [
          ...vendorGlobalPosts.map(p => ({ _type: 'global' as const, _ts: p.createdAt?.toMillis?.() ?? 0, data: p as any })),
          ...posts.map(p => ({ _type: 'wall' as const, _ts: (p as any).createdAt?.toMillis?.() ?? 0, data: p as any })),
        ].sort((a, b) => b._ts - a._ts);
        return (
          <div className="space-y-4">
            {/* Post box for consumers */}
            {store.ownerUid !== user.uid && (
              <div className="glass-card p-4 rounded-3xl space-y-4">
                <textarea
                  value={newPost}
                  onChange={(e) => setNewPost(e.target.value)}
                  placeholder="Share your experience..."
                  className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 text-sm resize-none h-24"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleCreatePost}
                    disabled={isPosting || !newPost.trim()}
                    className="bg-brand-navy text-white px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50 transition-all"
                  >
                    <Send size={16} /> Post
                  </button>
                </div>
              </div>
            )}
            {merged.map(item =>
              item._type === 'global' ? (
                <FeedPostCard key={item.data.id} post={item.data} currentUser={user} onViewUser={onViewUser}
                  onLike={async (p) => { const ref = doc(db, 'global_posts', p.id); const liked = (p.likedBy || []).includes(user.uid); await updateDoc(ref, { likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid), likesCount: liked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1 }); }}
                  onVote={async (p, idx) => { const ref = doc(db, 'global_posts', p.id); const votes = p.pollVotes || {}; const oldKey = Object.keys(votes).find(k => (votes[k] || []).includes(user.uid)); const updates: any = { [`pollVotes.${idx}`]: arrayUnion(user.uid) }; if (oldKey !== undefined && oldKey !== String(idx)) updates[`pollVotes.${oldKey}`] = arrayRemove(user.uid); await updateDoc(ref, updates); }}
                />
              ) : (
                <div key={item.data.id} className="glass-card p-5 rounded-[2rem] space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full overflow-hidden border border-brand-navy/5 shrink-0 cursor-pointer"
                      onClick={async () => { const snap = await getDoc(doc(db, 'users', item.data.authorUid)).catch(() => null); if (snap?.exists()) onViewUser({ uid: snap.id, ...snap.data() } as UserProfile); }}>
                      <img src={item.data.authorPhoto || `https://i.pravatar.cc/40?u=${item.data.authorUid}`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-bold cursor-pointer hover:text-brand-gold transition-colors"
                          onClick={async () => { const snap = await getDoc(doc(db, 'users', item.data.authorUid)).catch(() => null); if (snap?.exists()) onViewUser({ uid: snap.id, ...snap.data() } as UserProfile); }}>
                          {item.data.authorName}
                        </span>
                        <span className="text-brand-navy/30 mx-1">›</span>
                        <span className="font-bold text-brand-gold">{store.name}</span>
                      </p>
                      <p className="text-[10px] text-brand-navy/40 font-medium">{item.data.createdAt ? format(item.data.createdAt.toDate(), 'MMM d · h:mm a') : 'Just now'}</p>
                    </div>
                  </div>
                  <p className="text-sm text-brand-navy/80 leading-relaxed">{item.data.content}</p>
                </div>
              )
            )}
            {merged.length === 0 && <div className="py-12 text-center text-brand-navy/20"><MessageSquare size={40} className="mx-auto mb-2 opacity-10" /><p className="font-bold text-sm">No posts yet</p></div>}
          </div>
        );
      })()}

      {activeStoreTab === 'reviews' && (
        <div className="space-y-4">
          {/* Leave a review — only if not already reviewed */}
          {store.ownerUid !== user.uid && (
            myReview ? (
              <div className="glass-card p-4 rounded-3xl text-center text-sm text-brand-navy/40 font-medium">
                You've already left a review
              </div>
            ) : (
              <div className="glass-card p-5 rounded-3xl space-y-4">
                <p className="font-bold text-sm">Leave a Review</p>
                {/* Star picker */}
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(s => (
                    <button key={s} onClick={() => setReviewRating(s)}>
                      <Star size={24} className={s <= reviewRating ? "text-brand-gold fill-brand-gold" : "text-brand-navy/20"} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={reviewText}
                  onChange={e => setReviewText(e.target.value)}
                  placeholder="Write your review..."
                  className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 text-sm resize-none h-24"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleSubmitReview}
                    disabled={isSubmittingReview || !reviewText.trim()}
                    className="bg-brand-navy text-white px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50 transition-all"
                  >
                    <Send size={14} /> Submit
                  </button>
                </div>
              </div>
            )
          )}
          {/* Review list */}
          {storeReviews.map(review => (
            <div key={review.id} className="glass-card p-5 rounded-[2rem] space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full overflow-hidden border border-brand-navy/5 shrink-0">
                  <img src={review.authorPhoto || `https://i.pravatar.cc/40?u=${review.authorUid}`} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{review.authorName}</p>
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} size={11} className={s <= (review.rating || 5) ? "text-brand-gold fill-brand-gold" : "text-brand-navy/20"} />
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-brand-navy/40">{review.createdAt ? format(review.createdAt.toDate(), 'MMM d') : ''}</p>
              </div>
              <p className="text-sm text-brand-navy/70 leading-relaxed">{review.content}</p>
            </div>
          ))}
          {storeReviews.length === 0 && <div className="py-12 text-center text-brand-navy/20"><Star size={40} className="mx-auto mb-2 opacity-10" /><p className="font-bold text-sm">No reviews yet</p></div>}
        </div>
      )}
    </motion.div>
  );
}

function PublicUserProfile({ targetUser: initialTargetUser, onBack, currentUser, currentProfile, onViewStore, onMessage }: { targetUser: UserProfile, onBack: () => void, currentUser: FirebaseUser, currentProfile: UserProfile | null, onViewStore: (s: StoreProfile) => void, onMessage?: (uid: string) => void, key?: React.Key }) {
  const [targetUser, setTargetUser] = useState<UserProfile>(initialTargetUser);
  const [cards, setCards] = useState<Card[]>([]);
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [stores, setStores] = useState<StoreProfile[]>([]);
  const [vendorStore, setVendorStore] = useState<StoreProfile | null>(null);
  const [transactionHistory, setTransactionHistory] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [newReview, setNewReview] = useState('');
  const [rating, setRating] = useState(5);
  const [isPosting, setIsPosting] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [profileTab, setProfileTab] = useState<'wall' | 'posts'>('wall');
  const [userPosts, setUserPosts] = useState<GlobalPost[]>([]);

  useEffect(() => {
    // Listen to target user profile for real-time stamp updates
    const unsubProfile = onSnapshot(doc(db, 'users', initialTargetUser.uid), (doc) => {
      if (doc.exists()) {
        setTargetUser({ uid: doc.id, ...doc.data() } as UserProfile);
      }
    });

    // Fetch all stores to match with cards
    getDocs(collection(db, 'stores')).then(snap => {
      setStores(snap.docs.map(d => ({ id: d.id, ...d.data() } as StoreProfile)));
    });

    const q = query(collection(db, 'cards'), where('user_id', '==', initialTargetUser.uid), where('isArchived', '==', false));
    const unsubCards = onSnapshot(q, (snap) => {
      setCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card)));
    }, (error) => {
      console.error("Public profile cards error:", error);
    });

    // Fetch all cards (including archived) for lifetime stamp count
    const allQ = query(collection(db, 'cards'), where('user_id', '==', initialTargetUser.uid));
    const unsubAllCards = onSnapshot(allQ, (snap) => {
      setAllCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Card)));
    });

    const hq = query(collection(db, 'transactions'), where('user_id', '==', initialTargetUser.uid), orderBy('completed_at', 'desc'), limit(10));
    const unsubHistory = onSnapshot(hq, (snap) => {
      setTransactionHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const rq = query(collection(db, 'user_reviews'), where('toUid', '==', initialTargetUser.uid), orderBy('createdAt', 'desc'));
    const unsubReviews = onSnapshot(rq, (snap) => {
      setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Follow listener
    const followId = `${currentUser.uid}_${initialTargetUser.uid}`;
    const unsubFollow = onSnapshot(doc(db, 'follows', followId), (snap) => {
      setIsFollowing(snap.exists());
    });

    let unsubStore = () => {};
    if (initialTargetUser.role === 'vendor') {
      const bq = query(collection(db, 'stores'), where('ownerUid', '==', initialTargetUser.uid), limit(1));
      unsubStore = onSnapshot(bq, (snap) => {
        if (!snap.empty) {
          setVendorStore({ id: snap.docs[0].id, ...snap.docs[0].data() } as StoreProfile);
        }
      });
    }

    const postsQ = query(
      collection(db, 'global_posts'),
      where('authorUid', '==', initialTargetUser.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsubPosts = onSnapshot(postsQ, (snap) => {
      setUserPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalPost)));
    }, () => {});

    return () => {
      unsubProfile();
      unsubCards();
      unsubAllCards();
      unsubStore();
      unsubHistory();
      unsubReviews();
      unsubFollow();
      unsubPosts();
    };
  }, [initialTargetUser.uid, initialTargetUser.role, currentUser.uid]);

  const handleMessageClick = async () => {
    const chatId = [currentUser.uid, targetUser.uid].sort().join('_');
    // Navigate immediately — don't block on Firestore
    if (onMessage) onMessage(chatId);
    // Create chat doc in background if it doesn't exist
    try {
      const chatRef = doc(db, 'chats', chatId);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          uids: [currentUser.uid, targetUser.uid],
          lastActivity: serverTimestamp(),
          lastMessage: '',
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error('Chat create error:', err);
    }
  };

  const handleFollowClick = async () => {
    const followId = `${currentUser.uid}_${targetUser.uid}`;
    try {
      if (isFollowing) {
        await deleteDoc(doc(db, 'follows', followId));
      } else {
        await setDoc(doc(db, 'follows', followId), {
          followerUid: currentUser.uid,
          followingUid: targetUser.uid,
          createdAt: serverTimestamp()
        });
        await addDoc(collection(db, 'notifications'), {
          toUid: targetUser.uid,
          fromUid: currentUser.uid,
          fromName: currentProfile?.name || currentUser.displayName || 'Anonymous',
          fromPhoto: currentProfile?.photoURL || currentUser.photoURL || '',
          type: 'follow',
          message: `${currentProfile?.name || 'Someone'} started following you!`,
          isRead: false,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error("Follow error:", err);
    }
  };

  const handlePostReview = async () => {
    if (!newReview.trim()) return;
    setIsPosting(true);
    try {
      // Fetch fresh author profile for accurate name/photo
      const authorSnap = await getDoc(doc(db, 'users', currentUser.uid)).catch(() => null);
      const authorData = authorSnap?.exists() ? authorSnap.data() : null;
      const authorName = authorData?.name || currentUser.displayName || currentUser.email?.split('@')[0] || 'Anonymous';
      const authorPhoto = authorData?.photoURL || currentUser.photoURL || '';
      const authorRole = authorData?.role || 'consumer';

      const reviewRef = await addDoc(collection(db, 'user_reviews'), {
        fromUid: currentUser.uid,
        fromName: authorName,
        fromPhoto: authorPhoto,
        toUid: targetUser.uid,
        content: newReview,
        rating,
        likesCount: 0,
        createdAt: serverTimestamp()
      });

      // Cross-post to global feed so all users can see it; store reviewId to allow linked deletion
      await addDoc(collection(db, 'global_posts'), {
        authorUid: currentUser.uid,
        authorName,
        authorPhoto,
        authorRole,
        toUid: targetUser.uid,
        toName: targetUser.name,
        toPhoto: targetUser.photoURL || '',
        wallPost: true,
        userReviewId: reviewRef.id,
        content: newReview,
        postType: 'post',
        likesCount: 0,
        likedBy: [],
        createdAt: serverTimestamp()
      });

      setNewReview('');
      setRating(5);
    } catch (error) {
      console.error(error);
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6 pb-20 text-brand-navy"
    >
      <button onClick={onBack} className="flex items-center gap-2 text-brand-navy/60 font-bold text-sm hover:text-brand-navy transition-colors">
        <ArrowLeft size={18} />
        Back
      </button>

      <div className="glass-card p-8 rounded-[3rem] text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-24 bg-brand-gold/10" />
        <div className="relative z-10">
          <div className="w-24 h-24 rounded-[2.5rem] border-4 border-white overflow-hidden mx-auto mb-4 shadow-xl">
            <img src={targetUser.photoURL} alt="" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-2xl font-bold">{targetUser.name}</h2>
          <p className="text-brand-gold font-bold text-xs uppercase tracking-[0.2em] mb-4">@{targetUser.email?.split('@')[0]}</p>
          
          {currentUser && currentUser.uid !== targetUser.uid && (
            <div className="flex justify-center gap-2 mb-6">
              <button
                onClick={handleFollowClick}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all shadow-lg active:scale-95",
                  isFollowing
                    ? "bg-green-500 text-white hover:bg-red-400"
                    : "bg-brand-gold text-brand-navy hover:bg-brand-gold/80"
                )}
              >
                {isFollowing ? (
                  <>
                    <UserCheck size={18} />
                    Following
                  </>
                ) : (
                  <>
                    <UserPlus size={18} />
                    Follow
                  </>
                )}
              </button>
              <button 
                onClick={handleMessageClick}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-brand-navy text-white font-bold text-sm transition-all shadow-lg active:scale-95"
              >
                <MessageCircle size={18} />
                Message
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
            <div className="text-center">
              <p className="text-lg font-bold">
                {allCards.reduce((acc, c) => acc + (c.current_stamps || 0) + ((c.total_completed_cycles || 0) * 10), 0) || targetUser.totalStamps || 0}
              </p>
              <p className="text-[10px] text-brand-navy/40 font-bold uppercase">Stamps</p>
            </div>
            <div className="text-center border-x border-brand-navy/5">
              <p className="text-lg font-bold">{cards.length}</p>
              <p className="text-[10px] text-brand-navy/40 font-bold uppercase">Active</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{targetUser.totalRedeemed || 0}</p>
              <p className="text-[10px] text-brand-navy/40 font-bold uppercase">Rewards</p>
            </div>
          </div>
        </div>
      </div>

      {targetUser.role === 'vendor' && vendorStore && (
        <div className="bg-brand-navy p-6 rounded-[2.5rem] text-white space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl overflow-hidden border border-white/10">
                <img src={vendorStore.logoUrl} alt="" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Business Owner</p>
                <p className="font-bold">{vendorStore.name}</p>
              </div>
            </div>
            <button 
              onClick={() => onViewStore(vendorStore)}
              className="bg-brand-gold text-brand-navy px-4 py-2 rounded-xl text-xs font-bold shadow-lg"
            >
              View Shop
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="font-display text-xl font-bold px-2">Active Cards</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map(card => {
            const store = stores.find(s => s.id === card.store_id);
            if (!store) return null;
            return (
              <div 
                key={card.id} 
                onClick={() => onViewStore(store)}
                className="glass-card p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm shrink-0">
                    <img src={store.logoUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate group-hover:text-brand-gold transition-colors">{store.name}</p>
                    <p className="text-[10px] text-brand-navy/40 uppercase font-bold tracking-widest leading-none">{card.current_stamps} / {store.stamps_required_for_reward} Stamps</p>
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0 ml-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={cn("w-1.5 h-1.5 rounded-full", i < (card.current_stamps / store.stamps_required_for_reward) * 5 ? "bg-brand-gold" : "bg-brand-navy/10")} />
                  ))}
                </div>
              </div>
            );
          })}
          {cards.length === 0 && (
            <div className="col-span-1 sm:col-span-2 py-8 text-center text-brand-navy/20 bg-white/50 rounded-2xl border border-dashed border-brand-navy/5">
              <p className="text-xs font-bold uppercase tracking-widest italic">No active loyalty cards</p>
            </div>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex p-1 glass-card rounded-2xl">
        <button
          onClick={() => setProfileTab('wall')}
          className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5", profileTab === 'wall' ? "bg-brand-navy text-white shadow" : "text-brand-navy/40")}
        >
          <MessageSquare size={13} />
          Wall
        </button>
        <button
          onClick={() => setProfileTab('posts')}
          className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5", profileTab === 'posts' ? "bg-brand-navy text-white shadow" : "text-brand-navy/40")}
        >
          <Zap size={13} />
          Posts {userPosts.length > 0 && `(${userPosts.length})`}
        </button>
      </div>

      {profileTab === 'wall' ? (
        <div className="space-y-4">
          {targetUser.uid !== currentUser.uid && (
            <div className="glass-card p-6 rounded-[2.5rem] space-y-4">
              <div className="flex gap-2 mb-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} onClick={() => setRating(star)}>
                    <Star size={20} className={cn(star <= rating ? "text-brand-gold fill-brand-gold" : "text-brand-navy/10")} />
                  </button>
                ))}
              </div>
              <textarea
                value={newReview}
                onChange={(e) => setNewReview(e.target.value)}
                placeholder={`Write on ${targetUser.name}'s wall...`}
                className="w-full p-4 rounded-2xl bg-brand-bg border-none focus:ring-2 focus:ring-brand-gold/20 text-sm h-24 resize-none"
              />
              <button
                onClick={handlePostReview}
                disabled={isPosting || !newReview.trim()}
                className="w-full bg-brand-navy text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-brand-navy/10"
              >
                <Send size={18} />
                Post to Wall
              </button>
            </div>
          )}
          <div className="space-y-4">
            {reviews.map(review => (
              <WallPostItem key={review.id} post={review} currentUser={currentUser} wallOwnerUid={targetUser.uid} />
            ))}
            {reviews.length === 0 && (
              <p className="text-center py-12 text-xs text-brand-navy/20 font-bold uppercase tracking-widest italic">No wall posts yet</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {userPosts.map(post => (
            <FeedPostCard
              key={post.id}
              post={post}
              currentUser={currentUser}
              currentProfile={currentProfile}
              onViewUser={() => {}}
              onLike={async (p) => {
                const ref = doc(db, 'global_posts', p.id);
                const alreadyLiked = (p.likedBy || []).includes(currentUser.uid);
                await updateDoc(ref, {
                  likedBy: alreadyLiked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
                  likesCount: alreadyLiked ? Math.max(0, p.likesCount - 1) : p.likesCount + 1,
                });
              }}
              onVote={async (p, optionIndex) => {
                const ref = doc(db, 'global_posts', p.id);
                const votes = p.pollVotes || {};
                const currentVoteKey = Object.keys(votes).find(k => (votes[k] || []).includes(currentUser.uid));
                const updates: any = {};
                if (currentVoteKey !== undefined) updates[`pollVotes.${currentVoteKey}`] = arrayRemove(currentUser.uid);
                if (currentVoteKey !== String(optionIndex)) updates[`pollVotes.${optionIndex}`] = arrayUnion(currentUser.uid);
                if (Object.keys(updates).length > 0) await updateDoc(ref, updates);
              }}
            />
          ))}
          {userPosts.length === 0 && (
            <p className="text-center py-12 text-xs text-brand-navy/20 font-bold uppercase tracking-widest italic">No posts yet</p>
          )}
        </div>
      )}
    </motion.div>
  );
}
