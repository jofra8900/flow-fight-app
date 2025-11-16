
import type { Timestamp } from "firebase/firestore";

export interface Student {
    id: string;
    name: string;
    photoUrl: string;
    plan: string;
    sede: 'chimbote' | 'nuevo-chimbote' | string;
    classesRemaining: number;
    notes?: string;
    createdAt: Timestamp;
}

export interface AttendanceRecord {
    id: string;
    studentId: string;
    studentName: string;
    className: string;
    sede: string;
    timestamp: Timestamp;
}

export interface Announcement {
    id: string;
    title: string;
    text: string;
    imageUrl?: string;
    createdAt: Timestamp;
}

export interface Professor {
    id: string;
    name: string;
    sede: 'chimbote' | 'nuevo-chimbote';
    pin: string;
}

export interface Schedule {
    id: string;
    day: string; // "Lunes", "Martes", etc.
    time: string; // "18:00"
    className: string;
}

export interface ProfessorAttendance {
    id: string;
    professorId: string;
    professorName: string;
    sede: string;
    className: string;
    timestamp: Timestamp;
    status: 'EN HORA' | 'TARDE';
}

export interface SedeCoordinates {
    chimbote: {
        lat: number;
        lon: number;
    };
    'nuevo-chimbote': {
        lat: number;
        lon: number;
    };
}