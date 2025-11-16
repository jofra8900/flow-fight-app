
import { initializeApp } from "firebase/app";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut, 
    setPersistence, 
    browserLocalPersistence,
    type User,
    type Unsubscribe
} from "firebase/auth";
import { 
    getFirestore, 
    collection, 
    onSnapshot, 
    query, 
    addDoc,
    doc,
    deleteDoc,
    updateDoc,
    getDoc,
    where,
    getDocs,
    orderBy,
    setDoc,
    Timestamp
} from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAANDkSre69Bk50Lh2JUUJEag8JTl5MqGg",
    authDomain: "flowfightapp.firebaseapp.com",
    projectId: "flowfightapp",
    storageBucket: "flowfightapp.firebasestorage.app",
    messagingSenderId: "692889717954",
    appId: "1:692889717954:web:72b3c374b41efeefb53f5b",
    measurementId: "G-B3TCTYQ6JN"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use a consistent app ID for data paths
const appId = 'default-app-id';

// Collection References
const getCollectionRef = (collectionName: string) => collection(db, `artifacts/${appId}/public/data/${collectionName}`);

export const studentsCollection = getCollectionRef('students');
export const attendanceCollection = getCollectionRef('attendance');
export const announcementsCollection = getCollectionRef('announcements');
export const professorsCollection = getCollectionRef('professors');
export const professorAttendanceCollection = getCollectionRef('professorAttendance');


// Auth Functions
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
// FIX: The onAuthChange function was not returning the unsubscribe function from onAuthStateChanged.
// It now returns a promise that resolves with the unsubscribe function after persistence is set.
export const onAuthChange = (callback: (user: User | null) => void): Promise<Unsubscribe> => {
    return setPersistence(auth, browserLocalPersistence).then(() => {
        return onAuthStateChanged(auth, callback);
    }).catch(error => {
        console.error('Failed to set persistence', error);
        // Return a no-op unsubscribe function to prevent crashing the app.
        return () => {};
    });
};


// Generic Firestore Listener
export const createFirestoreSubscription = <T,>(collectionRef, callback: (data: T[]) => void, orderField = 'createdAt', orderDirection = 'desc') => {
    const q = query(collectionRef, orderBy(orderField, orderDirection));
    return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
        callback(data);
    }, (error) => {
        console.error(`Error fetching ${collectionRef.path}:`, error);
    });
};

// Student Functions
export const addStudent = (studentData) => addDoc(studentsCollection, {...studentData, createdAt: Timestamp.now()});
export const updateStudent = (id, data) => updateDoc(doc(studentsCollection, id), data);
export const deleteStudent = (id) => deleteDoc(doc(studentsCollection, id));
export const resetStudentClasses = (studentId: string, newClassCount: number) => {
    return updateDoc(doc(studentsCollection, studentId), { classesRemaining: newClassCount });
};


// Attendance Functions
export const addAttendance = (attendanceData) => addDoc(attendanceCollection, {...attendanceData, timestamp: Timestamp.now()});

// Announcement Functions
export const addAnnouncement = (announcementData) => addDoc(announcementsCollection, {...announcementData, createdAt: Timestamp.now()});
export const deleteAnnouncement = (id) => deleteDoc(doc(announcementsCollection, id));


// Professor and related functions
export const getProfessorByPin = async (pin: string) => {
    const q = query(professorsCollection, where("pin", "==", pin));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    }
    return null;
};

export const getProfessorSchedule = (professorId, callback) => {
    const scheduleCollection = collection(db, `artifacts/${appId}/public/data/professors/${professorId}/schedule`);
    return onSnapshot(scheduleCollection, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(data);
    });
};
export const addProfessorSchedule = (professorId: string, schedule: any) => {
    const scheduleCollection = collection(db, `artifacts/${appId}/public/data/professors/${professorId}/schedule`);
    return addDoc(scheduleCollection, schedule);
}
export const deleteProfessorSchedule = (professorId: string, scheduleId: string) => {
    const scheduleDocRef = doc(db, `artifacts/${appId}/public/data/professors/${professorId}/schedule`, scheduleId);
    return deleteDoc(scheduleDocRef);
}


export const addProfessor = (professorData) => addDoc(professorsCollection, {...professorData, createdAt: Timestamp.now()});
export const deleteProfessor = (id) => deleteDoc(doc(professorsCollection, id));

export const addProfessorAttendance = (attendanceData) => addDoc(professorAttendanceCollection, {...attendanceData, timestamp: Timestamp.now()});


// Generic get all for exports
export const getAllDocs = async (collectionRef) => {
    const snapshot = await getDocs(query(collectionRef, orderBy("timestamp", "desc")));
    return snapshot.docs.map(doc => doc.data());
}
