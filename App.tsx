
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';
import type { User } from 'firebase/auth';
import type { Student, AttendanceRecord, Announcement, Professor, Schedule, ProfessorAttendance, SedeCoordinates, Payment, GlobalSchedule } from './types';
import { ADMIN_PIN, PLAN_DETAILS, CLASS_OPTIONS, DAYS_OF_WEEK, SEDE_COORDINATES } from './constants';
import * as fb from './services/firebaseService';

// --- HELPER FUNCTIONS & SMALL COMPONENTS ---

const Spinner: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => (
    <div className={`border-4 border-gray-600 border-t-lime-500 rounded-full animate-spin ${size === 'sm' ? 'w-5 h-5' : 'w-8 h-8'}`}></div>
);

const IonIcon: React.FC<{ name: string; className?: string; title?: string }> = ({ name, className, title }) => (
    // @ts-ignore
    <ion-icon name={name} class={className} title={title}></ion-icon>
);

const haversineDistance = (coords1: { lat: number; lon: number }, coords2: { lat: number; lon: number }): number => {
    const R = 6371e3; // metres
    const φ1 = coords1.lat * Math.PI / 180;
    const φ2 = coords2.lat * Math.PI / 180;
    const Δφ = (coords2.lat - coords1.lat) * Math.PI / 180;
    const Δλ = (coords2.lon - coords1.lon) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in metres
};

const convertToCSV = (data: any[], headers: string[], headerMapping: Record<string, string>) => {
    const csvHeaders = headers.map(h => headerMapping[h]).join(',');
    let csv = csvHeaders + '\r\n';
    data.forEach(row => {
        const values = headers.map(header => {
            let val = row[header] === null || row[header] === undefined ? '' : row[header];
             if (val.toDate && typeof val.toDate === 'function') { // Firebase Timestamp
                val = val.toDate().toLocaleString('es-PE');
            }
            if (typeof val === 'string') {
                val = val.replace(/"/g, '""');
                if (val.includes(',')) {
                    val = `"${val}"`;
                }
            }
            return val;
        });
        csv += values.join(',') + '\r\n';
    });
    return csv;
};


const downloadCSV = (csv: string, filename: string) => {
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const Modal: React.FC<{ children: React.ReactNode; onClose: () => void; title: string }> = ({ children, onClose, title }) => (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-40 fade-in">
        <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg relative">
            <h2 className="text-2xl font-semibold mb-6">{title}</h2>
            <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-smooth">
                <IonIcon name="close-outline" className="text-3xl" />
            </button>
            <div className="max-h-[70vh] overflow-y-auto pr-2">
                {children}
            </div>
        </div>
    </div>
);

// --- CUSTOM HOOKS ---
const useProfessorCheckinStatus = (
    professor: Professor, 
    globalSchedule: GlobalSchedule[], 
    showToast: (msg: string, type?: 'success' | 'error') => void
) => {
    const [currentClass, setCurrentClass] = useState<Schedule | GlobalSchedule | null>(null);
    const [checkinState, setCheckinState] = useState<{
        status: 'idle' | 'checking' | 'checked-in' | 'no-class' | 'error';
        message: string;
    }>({
        status: 'idle',
        message: 'Verificando horario...',
    });

    const checkAvailability = useCallback(async () => {
        const now = new Date();
        const today = DAYS_OF_WEEK[now.getDay()];
        const gracePeriodMinutes = 15;
        const classWindowMinutes = 90;

        const checkTimeWindow = (classTimeStr: string) => {
            const [classHour, classMinute] = classTimeStr.split(':').map(Number);
            const classTimeMinutes = classHour * 60 + classMinute;
            const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
            return currentTimeMinutes >= (classTimeMinutes - gracePeriodMinutes) &&
                   currentTimeMinutes < (classTimeMinutes + classWindowMinutes);
        };

        const professorSchedule = await fb.fetchProfessorScheduleOnce(professor.id) as Schedule[];
        let foundClass: Schedule | GlobalSchedule | undefined = professorSchedule.find(s => s.day === today && checkTimeWindow(s.time));

        if (!foundClass) {
            foundClass = globalSchedule.find(s => s.day === today && s.sede === professor.sede && checkTimeWindow(s.time));
        }
        
        if (!foundClass) {
            setCheckinState({ status: 'no-class', message: 'No tienes una clase programada ahora.' });
            setCurrentClass(null);
            return;
        }

        const checkinsToday = await fb.getAllDocs<ProfessorAttendance>(fb.professorAttendanceCollection, 'timestamp');
        const hasCheckedIn = checkinsToday.some(a => 
            a.professorId === professor.id &&
            a.className === foundClass!.className &&
            a.timestamp.toDate() > new Date(new Date().setHours(0,0,0,0))
        );

        if (hasCheckedIn) {
             setCheckinState({ status: 'checked-in', message: `Ya marcaste asistencia para ${foundClass.className}` });
             setCurrentClass(foundClass);
             return;
        }

        setCheckinState({ status: 'idle', message: `Listo para marcar para ${foundClass.className}` });
        setCurrentClass(foundClass);

    }, [professor.id, professor.sede, globalSchedule]);

    useEffect(() => {
        checkAvailability();
        const interval = setInterval(checkAvailability, 60000);
        return () => clearInterval(interval);
    }, [checkAvailability]);

    const handleCheckin = async () => {
        if (!currentClass) {
            showToast('No hay una clase activa para marcar.', 'error');
            return;
        }
        
        setCheckinState({ status: 'checking', message: 'Obteniendo ubicación...' });
        
        try {
            const now = new Date();
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
            });
            
            setCheckinState({ status: 'checking', message: 'Verificando distancia...' });
            const userCoords = { lat: position.coords.latitude, lon: position.coords.longitude };
            const sedeCoords = SEDE_COORDINATES[professor.sede];
            if (!sedeCoords) throw new Error(`Coordenadas para la sede "${professor.sede}" no encontradas.`);

            const distance = haversineDistance(userCoords, sedeCoords);
            if (distance > 500) throw new Error(`Estás a ${Math.round(distance)}m. Debes estar a menos de 500m.`);
            
            const [classHour, classMinute] = currentClass.time.split(':').map(Number);
            const classTimeToday = new Date();
            classTimeToday.setHours(classHour, classMinute, 0, 0);

            const minutesLate = (now.getTime() - classTimeToday.getTime()) / 60000;
            const status = minutesLate > 10 ? 'TARDE' : 'EN HORA';
            
            await fb.addProfessorAttendance({
                professorId: professor.id,
                professorName: professor.name,
                sede: professor.sede,
                className: currentClass.className,
                status,
            });

            showToast(`Asistencia registrada (${status})`);
            checkAvailability();

        } catch (err: any) {
            let errorMessage = 'Ocurrió un error inesperado al verificar la ubicación.';
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            if (errorMessage.includes("User denied Geolocation")) {
                errorMessage = "Acceso a la ubicación denegado. Debes permitirlo para marcar asistencia.";
            } else if (errorMessage.includes("Timeout expired")) {
                errorMessage = "No se pudo obtener tu ubicación a tiempo. Revisa tu conexión e inténtalo de nuevo.";
            }
            
            showToast(errorMessage, 'error');
            setCheckinState({status: 'error', message: errorMessage});
            setTimeout(() => checkAvailability(), 3000);
        }
    };

    return { checkinState, currentClass, handleCheckin };
}


// --- MAIN APP COMPONENT ---

export default function App() {
    type AppState = 'roleSelection' | 'adminLogin' | 'professorLogin' | 'kiosko' | 'adminPanel' | 'professorDashboard';
    const [appState, setAppState] = useState<AppState>('roleSelection');
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [loggedInProfessor, setLoggedInProfessor] = useState<Professor | null>(null);

    // Data states
    const [students, setStudents] = useState<Student[]>([]);
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [professorAttendance, setProfessorAttendance] = useState<ProfessorAttendance[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [globalSchedule, setGlobalSchedule] = useState<GlobalSchedule[]>([]);

    // Toast handler
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
    };

    // Authentication
    useEffect(() => {
        const unsubscribePromise = fb.onAuthChange((user) => {
            setUser(user);
            if (user) {
                setAppState('adminPanel');
            } else if (appState === 'adminPanel' || appState === 'professorDashboard') {
                setAppState('roleSelection');
            }
            setLoading(false);
        });
        return () => {
            unsubscribePromise.then(unsubscribe => unsubscribe());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Data fetching
    useEffect(() => {
        const unsubStudents = fb.createFirestoreSubscription<Student>(fb.studentsCollection, setStudents, 'name', 'asc');
        const unsubAttendance = fb.createFirestoreSubscription<AttendanceRecord>(fb.attendanceCollection, setAttendance);
        const unsubAnnouncements = fb.createFirestoreSubscription<Announcement>(fb.announcementsCollection, setAnnouncements);
        const unsubProfessors = fb.createFirestoreSubscription<Professor>(fb.professorsCollection, setProfessors, 'name', 'asc');
        const unsubProfAttendance = fb.createFirestoreSubscription<ProfessorAttendance>(fb.professorAttendanceCollection, setProfessorAttendance);
        const unsubPayments = fb.createFirestoreSubscription<Payment>(fb.paymentsCollection, setPayments, 'paymentDate', 'desc');
        const unsubGlobalSchedule = fb.createFirestoreSubscription<GlobalSchedule>(fb.globalScheduleCollection, setGlobalSchedule, 'time', 'asc');

        return () => {
            unsubStudents();
            unsubAttendance();
            unsubAnnouncements();
            unsubProfessors();
            unsubProfAttendance();
            unsubPayments();
            unsubGlobalSchedule();
        };
    }, []);

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
        const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
        setError('');
        setLoading(true);
        try {
            await fb.login(email, password);
        } catch (err: any) {
            setError('Email o contraseña incorrectos.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await fb.logout();
        setLoggedInProfessor(null);
        setAppState('roleSelection');
    };

    if (loading && appState !== 'adminLogin' && !user) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Spinner />
            </div>
        );
    }

    const renderContent = () => {
        switch (appState) {
            case 'roleSelection':
                return <RoleSelectionScreen setAppState={setAppState} />;
            case 'adminLogin':
                return <LoginScreen handleLogin={handleLogin} error={error} loading={loading} setAppState={setAppState}/>;
            case 'professorLogin':
                return <ProfessorLoginScreen 
                    setAppState={setAppState} 
                    setLoggedInProfessor={setLoggedInProfessor} 
                />;
            case 'kiosko':
                return <KioskoScreen students={students} isStandalone={true} setAppState={setAppState} showToast={showToast} globalSchedule={globalSchedule} />;
            case 'professorDashboard':
                if (loggedInProfessor) {
                    return <ProfessorDashboardScreen 
                                professor={loggedInProfessor} 
                                attendance={attendance} 
                                onLogout={() => { setLoggedInProfessor(null); setAppState('roleSelection'); }}
                                globalSchedule={globalSchedule}
                                showToast={showToast}
                           />;
                }
                 setAppState('professorLogin');
                 return null;
            case 'adminPanel':
                if (user) {
                    return <AdminPanel
                        handleLogout={handleLogout}
                        students={students}
                        attendance={attendance}
                        announcements={announcements}
                        professors={professors}
                        professorAttendance={professorAttendance}
                        payments={payments}
                        globalSchedule={globalSchedule}
                        showToast={showToast}
                    />;
                }
                setAppState('adminLogin');
                return null;
            default:
                return <RoleSelectionScreen setAppState={setAppState} />;
        }
    };
    
    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8">
            <header className="flex items-center justify-between mb-8 relative">
                 <div className="w-full flex justify-center">
                    <img src="https://i.postimg.cc/YSnL9Hjn/Designer-(1).png" alt="Flow Fight Logo" className="h-16 md:h-20 object-contain cursor-pointer" onClick={() => appState !== 'adminPanel' && appState !== 'professorDashboard' && setAppState('roleSelection')} />
                </div>
            </header>

            <main>{renderContent()}</main>

            {toast && (
                <div className={`fixed bottom-10 right-10 font-bold py-3 px-6 rounded-lg shadow-xl transition-opacity duration-300 z-50 fade-in ${toast.type === 'success' ? 'bg-lime-500 text-gray-900' : 'bg-red-500 text-white'}`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
}

// --- APP SCREENS ---

const RoleSelectionScreen: React.FC<{ setAppState: (state: any) => void }> = React.memo(({ setAppState }) => {
    const RoleButton: React.FC<{ icon: string; title: string; onClick: () => void }> = ({ icon, title, onClick }) => (
        <button
            onClick={onClick}
            className="bg-gray-800 p-8 rounded-lg shadow-xl text-center w-full hover:bg-gray-700 transition-smooth card-hover flex flex-col items-center justify-center space-y-4"
        >
            <IonIcon name={icon} className="text-6xl text-lime-500" />
            <h2 className="text-2xl font-bold text-white">{title}</h2>
        </button>
    );

    return (
        <div className="max-w-4xl mx-auto fade-in">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <RoleButton icon="today-outline" title="Modo Kiosko" onClick={() => setAppState('kiosko')} />
                <RoleButton icon="school-outline" title="Acceso Profesor" onClick={() => setAppState('professorLogin')} />
                <RoleButton icon="shield-checkmark-outline" title="Acceso Admin" onClick={() => setAppState('adminLogin')} />
            </div>
        </div>
    );
});

const LoginScreen: React.FC<{ handleLogin: any, error: string, loading: boolean, setAppState: (state:any) => void }> = React.memo(({ handleLogin, error, loading, setAppState }) => {
    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-sm mx-auto fade-in">
            <h2 className="text-xl font-semibold text-center text-gray-300 mb-6">Acceso de Administrador</h2>
            <form onSubmit={handleLogin} className="space-y-4">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                    <input type="email" id="email" name="email" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-lime-500 transition-smooth" placeholder="admin@flowfight.com" required />
                </div>
                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">Contraseña</label>
                    <input type="password" id="password" name="password" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-lime-500 transition-smooth" placeholder="••••••••" required />
                </div>
                <button type="submit" disabled={loading} className="w-full bg-lime-500 text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-lime-400 transition-smooth disabled:bg-lime-700 disabled:cursor-not-allowed flex items-center justify-center h-10">
                    {loading ? <Spinner size="sm"/> : 'Entrar'}
                </button>
            </form>
            {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}
             <button onClick={() => setAppState('roleSelection')} className="w-full mt-4 text-center text-gray-400 hover:text-lime-500 text-sm transition-smooth">
                Volver a selección de rol
            </button>
        </div>
    );
});

const ProfessorLoginScreen: React.FC<{ setAppState: (state: any) => void; setLoggedInProfessor: (prof: Professor) => void; }> = ({ setAppState, setLoggedInProfessor }) => {
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const pinDisplayRef = useRef<HTMLDivElement>(null);

    const handlePinKey = (key: string) => {
        if (loading) return;
        setError('');
        if (pin.length < 4) {
            setPin(pin + key);
        }
    };

    const handleBackspace = () => {
        if (loading) return;
        setError('');
        setPin(pin.slice(0, -1));
    };

    const handleClear = () => {
        if (loading) return;
        setError('');
        setPin('');
    };

    const handleProfessorLogin = useCallback(async () => {
        if (pin.length !== 4) return;
        setLoading(true);
        setError('');
        try {
            const professor = await fb.getProfessorByPin(pin) as Professor | null;
            if (!professor) {
                throw new Error('PIN incorrecto.');
            }
            setLoggedInProfessor(professor);
            setAppState('professorDashboard');

        } catch (err: any) {
            setError(err.message);
            pinDisplayRef.current?.classList.add('shake-error');
            setTimeout(() => {
                pinDisplayRef.current?.classList.remove('shake-error');
                setPin('');
            }, 500);
        } finally {
            setLoading(false);
        }
    }, [pin, setAppState, setLoggedInProfessor]);

    useEffect(() => {
        if (pin.length === 4) {
            handleProfessorLogin();
        }
    }, [pin, handleProfessorLogin]);
    

    const pinDots = Array(4).fill(0).map((_, i) => (
        <div key={i} className={`w-6 h-6 rounded-full border-2 transition-colors ${pin.length > i ? 'bg-lime-500 border-lime-500' : 'border-gray-500'}`}></div>
    ));

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-sm mx-auto text-center fade-in">
            <h2 className="text-2xl font-semibold mb-2">Acceso Profesor</h2>
            <p className="text-gray-400 mb-6">Ingresa tu PIN de 4 dígitos.</p>
            <div ref={pinDisplayRef} className="flex justify-center space-x-4 mb-4">
                {pinDots}
            </div>
            <p className="text-red-400 text-center text-sm mb-4 h-5">{error}</p>
            <div className="grid grid-cols-3 gap-4 mb-6">
                {keys.map(key => (
                    <button key={key} onClick={() => handlePinKey(key)} className="pin-key bg-gray-700 text-white text-2xl font-bold py-4 rounded-lg hover:bg-gray-600 transition-smooth">
                        {key}
                    </button>
                ))}
                <button onClick={handleClear} className="pin-key-clear bg-gray-600 text-white text-lg font-bold py-4 rounded-lg hover:bg-gray-500 transition-smooth">
                    C
                </button>
                <button onClick={() => handlePinKey('0')} className="pin-key bg-gray-700 text-white text-2xl font-bold py-4 rounded-lg hover:bg-gray-600 transition-smooth">
                    0
                </button>
                <button onClick={handleBackspace} className="bg-gray-600 text-white py-4 rounded-lg hover:bg-gray-500 transition-smooth flex items-center justify-center">
                    <IonIcon name="backspace-outline" className="text-2xl"/>
                </button>
            </div>
            {loading && <div className="flex justify-center mb-4"><Spinner /></div>}
            <button onClick={() => setAppState('roleSelection')} className="w-full bg-gray-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-gray-500 transition-smooth">
                Cancelar
            </button>
        </div>
    );
};

const KioskoScreen: React.FC<{
    students: Student[];
    isStandalone: boolean;
    setAppState: (state: any) => void;
    showToast: (msg: string, type?: 'success' | 'error') => void;
    globalSchedule: GlobalSchedule[];
}> = ({ students, isStandalone, setAppState, showToast, globalSchedule }) => {
    const [selectedSede, setSelectedSede] = useState('todas');
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

    const filteredStudents = useMemo(() => {
        if (selectedSede === 'todas') return students;
        return students.filter(s => s.sede === selectedSede);
    }, [students, selectedSede]);
    
    const getWelcomeMessage = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "¡Buenos días, guerreros!";
        if (hour < 19) return "¡Buenas tardes, luchadores!";
        return "¡Buenas noches, campeones!";
    };

    const handleCheckin = async (className: string) => {
        if (!selectedStudent) return;

        if (selectedStudent.classesRemaining <= 0) {
            showToast('El alumno no tiene clases restantes.', 'error');
            return;
        }
        
        const now = new Date();
        const expiryDate = selectedStudent.membershipExpiresAt?.toDate();
        if (!expiryDate || now > expiryDate) {
            showToast('La membresía del alumno ha vencido.', 'error');
            return;
        }

        const newClasses = selectedStudent.classesRemaining - 1;
        try {
            await fb.updateStudent(selectedStudent.id, { classesRemaining: newClasses });
            await fb.addAttendance({
                studentId: selectedStudent.id,
                studentName: selectedStudent.name,
                className: className,
                sede: selectedStudent.sede
            });
            showToast(`Check-in de ${selectedStudent.name} confirmado! (Quedan ${newClasses})`);
            setSelectedStudent(null);
        } catch (error) {
            showToast('Error al confirmar el check-in', 'error');
            console.error(error);
        }
    };
    
    const todaysScheduleForSede = useMemo(() => {
        if (!selectedStudent) return [];
        const today = DAYS_OF_WEEK[new Date().getDay()];
        return globalSchedule.filter(s => s.day === today && s.sede === selectedStudent.sede);
    }, [globalSchedule, selectedStudent]);

    return (
        <div className="fade-in">
            {isStandalone &&
                <button onClick={() => setAppState('roleSelection')} className="mb-4 text-lime-500 hover:underline flex items-center transition-smooth">
                    <IonIcon name="arrow-back-outline" className="mr-2" />
                    Volver a selección de rol
                </button>
            }
            <h2 className="text-3xl font-bold mb-2 text-center">{getWelcomeMessage()}</h2>
            <p className="text-center text-gray-400 mb-6">Toca tu nombre para registrar tu asistencia.</p>
            <div className="flex justify-center mb-6">
                <select value={selectedSede} onChange={e => setSelectedSede(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-lime-500 transition-smooth">
                    <option value="todas">Todas las Sedes</option>
                    <option value="chimbote">Sede Chimbote</option>
                    <option value="nuevo-chimbote">Sede Nuevo Chimbote</option>
                </select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                {filteredStudents.length > 0 ? filteredStudents.map(student => {
                    const isExpired = student.classesRemaining <= 0 || (student.membershipExpiresAt && student.membershipExpiresAt.toDate() < new Date());
                    return (
                        <div key={student.id} onClick={() => setSelectedStudent(student)}
                            className={`student-card group cursor-pointer bg-gray-800 p-4 rounded-lg text-center transition-smooth card-hover ${isExpired ? 'opacity-60' : ''}`}>
                            <img src={student.photoUrl} alt={student.name} className={`w-28 h-28 object-cover rounded-full mx-auto mb-3 border-4 ${isExpired ? 'border-red-500' : 'border-gray-600 group-hover:border-lime-500'}`} />
                            <h3 className="font-bold text-lg truncate">{student.name}</h3>
                        </div>
                    );
                }) : <p className="col-span-full text-center text-gray-400">No hay alumnos en esta sede.</p>}
            </div>

            {selectedStudent && (
                <Modal onClose={() => setSelectedStudent(null)} title={`Check-in de ${selectedStudent.name}`}>
                    <div className="text-center">
                        <img src={selectedStudent.photoUrl} alt={selectedStudent.name} className={`w-24 h-24 object-cover rounded-full mx-auto mb-4 border-4 ${selectedStudent.classesRemaining <= 0 ? 'border-red-500' : 'border-lime-500'}`} />
                        <p className="text-lg font-semibold mb-4">
                            {selectedStudent.classesRemaining > 0 ? `Te quedan ${selectedStudent.classesRemaining} clases.` : '¡Plan vencido!'}
                        </p>
                        {selectedStudent.classesRemaining > 0 && (!selectedStudent.membershipExpiresAt || selectedStudent.membershipExpiresAt.toDate() > new Date()) && (
                             <>
                                <p className="text-gray-400 mb-6">¿A qué clase vas a entrar?</p>
                                <div className="flex flex-col space-y-3">
                                    {todaysScheduleForSede.length > 0 ? todaysScheduleForSede.map(scheduleItem => (
                                        <button key={scheduleItem.id} onClick={() => handleCheckin(scheduleItem.className)} className="w-full bg-gray-700 text-white font-bold py-3 px-4 rounded-lg hover:bg-gray-600 transition-smooth">
                                            {scheduleItem.time} - {scheduleItem.className}
                                        </button>
                                    )) : <p className="text-gray-500">No hay clases programadas para hoy en esta sede.</p>}
                                </div>
                            </>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
};


// --- ADMIN PANEL & VIEWS ---

type ModalState =
  | null
  | { type: 'editStudent'; student: Student }
  | { type: 'confirm'; title: string; text: string; onConfirm: () => void }
  | { type: 'schedule'; professor: Professor };

const AdminPanel: React.FC<{
    handleLogout: () => void;
    students: Student[];
    attendance: AttendanceRecord[];
    announcements: Announcement[];
    professors: Professor[];
    professorAttendance: ProfessorAttendance[];
    payments: Payment[];
    globalSchedule: GlobalSchedule[];
    showToast: (msg: string, type?: 'success' | 'error') => void;
}> = (props) => {
    const TABS = ['Dashboard', 'Kiosko', 'Alumnos', 'Pagos', 'Horarios', 'Asistencia', 'Profesores', 'Avisos', 'Reportes'];
    type TabName = 'Dashboard' | 'Kiosko' | 'Alumnos' | 'Pagos' | 'Horarios' | 'Asistencia' | 'Profesores' | 'Avisos' | 'Reportes';

    const [activeTab, setActiveTab] = useState<TabName>('Dashboard');
    const [adminUnlocked, setAdminUnlocked] = useState(false);
    const [pinModalOpen, setPinModalOpen] = useState(false);
    const [targetTab, setTargetTab] = useState<TabName | null>(null);
    const [modal, setModal] = useState<ModalState>(null);

    const handleTabClick = (tab: TabName) => {
        if (['Kiosko', 'Avisos'].includes(tab)) {
            setActiveTab(tab);
        } else {
            if (adminUnlocked) {
                setActiveTab(tab);
            } else {
                setTargetTab(tab);
                setPinModalOpen(true);
            }
        }
    };
    
    const onPinSuccess = () => {
        setAdminUnlocked(true);
        setPinModalOpen(false);
        if (targetTab) {
            setActiveTab(targetTab);
            targetTab && props.showToast('Modo admin desbloqueado', 'success');
            setTargetTab(null);
        }
    };

    const studentsAtRiskCount = useMemo(() => {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return props.students.filter(s => {
             const expiryDate = s.membershipExpiresAt?.toDate();
             return (s.classesRemaining > 0 && s.classesRemaining <= 3) || (expiryDate && expiryDate > now && expiryDate <= sevenDaysFromNow);
        }).length;
    }, [props.students]);

    const renderActiveTab = () => {
        switch(activeTab) {
            case 'Dashboard': return <DashboardView students={props.students} attendance={props.attendance} />;
            case 'Kiosko': return <KioskoScreen students={props.students} isStandalone={false} setAppState={() => {}} showToast={props.showToast} globalSchedule={props.globalSchedule} />;
            case 'Alumnos': return <AlumnosView students={props.students} showToast={props.showToast} setModal={setModal} />;
            case 'Pagos': return <PagosView students={props.students} payments={props.payments} showToast={props.showToast} />;
            case 'Horarios': return <HorariosView schedule={props.globalSchedule} showToast={props.showToast} />;
            case 'Asistencia': return <AsistenciaView attendance={props.attendance} />;
            case 'Profesores': return <ProfesoresView professors={props.professors} showToast={props.showToast} setModal={setModal} />;
            case 'Avisos': return <AvisosView announcements={props.announcements} showToast={props.showToast} adminUnlocked={adminUnlocked} onUnlockRequest={() => setPinModalOpen(true)} setModal={setModal} />;
            case 'Reportes': return <ReportesView students={props.students} attendance={props.attendance} professorAttendance={props.professorAttendance} showToast={props.showToast} />;
            default: return null;
        }
    }

    const renderModal = () => {
        if (!modal) return null;

        switch (modal.type) {
            case 'editStudent':
                return <EditStudentModal student={modal.student} onClose={() => setModal(null)} showToast={props.showToast} />;
            case 'confirm':
                return <ConfirmModal title={modal.title} text={modal.text} onConfirm={modal.onConfirm} onClose={() => setModal(null)} />;
            case 'schedule':
                 return <ScheduleModal professor={modal.professor} onClose={() => setModal(null)} showToast={props.showToast} />;
            default:
                return null;
        }
    };


    return (
        <div className="fade-in">
             <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
                <h1 className="text-2xl font-bold text-white">Panel de Administrador</h1>
                <button onClick={props.handleLogout} className="bg-gray-700 hover:bg-red-500/50 text-white font-semibold py-2 px-4 rounded-lg transition-smooth flex items-center space-x-2">
                    <IonIcon name="log-out-outline" />
                    <span>Salir</span>
                </button>
            </div>
            
            <nav className="flex items-center justify-center space-x-1 md:space-x-2 mb-8 bg-gray-800 p-2 rounded-lg overflow-x-auto">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => handleTabClick(tab as TabName)}
                        className={`tab-button relative flex-1 text-center font-medium px-3 py-2 rounded-md transition-smooth whitespace-nowrap ${activeTab === tab ? 'text-lime-500 bg-gray-700' : 'text-gray-400 hover:text-lime-500'}`}
                    >
                        {tab}
                        {tab === 'Dashboard' && studentsAtRiskCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                                {studentsAtRiskCount}
                            </span>
                        )}
                    </button>
                ))}
            </nav>
            
            {pinModalOpen && (
                 <PinModal 
                    onClose={() => { setPinModalOpen(false); setTargetTab(null); }} 
                    onSuccess={onPinSuccess} 
                    correctPin={ADMIN_PIN}
                    title="Modo Admin"
                    prompt="Ingresa el PIN de admin para continuar."
                 />
            )}

            {renderModal()}
            <div>
                {renderActiveTab()}
            </div>
        </div>
    );
};

const DashboardView: React.FC<{ students: Student[], attendance: AttendanceRecord[] }> = ({ students, attendance }) => {
    const stats = useMemo(() => {
        const now = new Date();
        return {
        total: students.length,
        active: students.filter(s => s.classesRemaining > 0 && s.membershipExpiresAt && s.membershipExpiresAt.toDate() > now).length,
        expired: students.filter(s => s.classesRemaining <= 0 || (s.membershipExpiresAt && s.membershipExpiresAt.toDate() <= now)).length,
        today: attendance.filter(a => new Date(a.timestamp.seconds * 1000).toDateString() === new Date().toDateString()).length,
    }}, [students, attendance]);

    const sedeData = useMemo(() => {
        const data = students.reduce((acc, student) => {
            const sede = student.sede ? (student.sede.charAt(0).toUpperCase() + student.sede.slice(1).replace('-', ' ')) : 'Sin Sede';
            acc[sede] = (acc[sede] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.keys(data).map(key => ({ name: key, value: data[key] }));
    }, [students]);
    
    const studentsAtRisk = useMemo(() => {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return students
            .filter(s => {
                const expiryDate = s.membershipExpiresAt?.toDate();
                const isExpiringSoon = expiryDate && expiryDate > now && expiryDate <= sevenDaysFromNow;
                const lowClasses = s.classesRemaining > 0 && s.classesRemaining <= 3;
                return isExpiringSoon || lowClasses;
            })
            .sort((a, b) => (a.membershipExpiresAt?.seconds || 0) - (b.membershipExpiresAt?.seconds || 0));
    }, [students]);

    const COLORS = ['#84cc16', '#22c55e', '#3b82f6', '#f59e0b'];

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-center">Dashboard de Flow Fight</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
               <div className="bg-gradient-to-br from-lime-500 to-lime-600 p-6 rounded-lg shadow-lg text-gray-900 card-hover transition-smooth">Total Alumnos: <span className="font-bold text-2xl">{stats.total}</span></div>
               <div className="bg-gradient-to-br from-green-500 to-green-600 p-6 rounded-lg shadow-lg text-gray-900 card-hover transition-smooth">Activos: <span className="font-bold text-2xl">{stats.active}</span></div>
               <div className="bg-gradient-to-br from-red-500 to-red-600 p-6 rounded-lg shadow-lg text-gray-900 card-hover transition-smooth">Vencidos: <span className="font-bold text-2xl">{stats.expired}</span></div>
               <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-6 rounded-lg shadow-lg text-gray-900 card-hover transition-smooth">Check-ins Hoy: <span className="font-bold text-2xl">{stats.today}</span></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 flex items-center">
                        <IonIcon name="warning" className="text-yellow-500 text-2xl mr-2" />
                        Alertas de Membresía
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                        {studentsAtRisk.length > 0 ? studentsAtRisk.map(s => {
                            const expiryDate = s.membershipExpiresAt?.toDate();
                            const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - new Date().getTime()) / (1000 * 3600 * 24)) : 0;
                             return (
                             <div key={s.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-lg pulse-warning">
                                <div className="flex items-center space-x-3">
                                    <img src={s.photoUrl} alt={s.name} className="w-10 h-10 rounded-full object-cover" />
                                    <div>
                                        <p className="font-semibold">{s.name}</p>
                                        <p className="text-xs text-gray-400 capitalize">{s.sede}</p>
                                    </div>
                                </div>
                                <div className='text-right'>
                                <span className="bg-yellow-500 text-gray-900 text-xs font-bold px-2 py-1 rounded">{s.classesRemaining} {s.classesRemaining === 1 ? 'clase' : 'clases'}</span>
                                {expiryDate && daysLeft <= 7 && <p className="text-xs text-yellow-400 mt-1">Vence en {daysLeft} día(s)</p>}
                                </div>
                            </div>
                        )}) : <p className="text-gray-400 text-center py-4">¡Todo bien! No hay alumnos próximos a vencer.</p>}
                    </div>
                </div>
                 <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-80">
                    <h3 className="text-xl font-semibold mb-4">Alumnos por Sede</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={sedeData} dataKey="value" nameKey="name" cx="50%" cy="40%" outerRadius={80} fill="#8884d8" label>
                                {sedeData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                            <Legend wrapperStyle={{ color: '#fff', paddingTop: '20px' }}/>
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

const AlumnosView: React.FC<{ students: Student[], showToast: (msg: string, type?: 'success' | 'error') => void, setModal: (modal: ModalState) => void }> = ({ students, showToast, setModal }) => {
    const [name, setName] = useState('');
    const [photoUrl, setPhotoUrl] = useState('');
    const [plan, setPlan] = useState('');
    const [sede, setSede] = useState('');
    const [classesRemaining, setClassesRemaining] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const selectedPlan = PLAN_DETAILS[plan];
        if (selectedPlan) {
            setClassesRemaining(selectedPlan.classes);
        } else {
            setClassesRemaining(0);
        }
    }, [plan]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !plan || !sede) {
            showToast('Completa todos los campos obligatorios', 'error');
            return;
        }
        setSubmitting(true);
        try {
            await fb.addStudent({ name, photoUrl: photoUrl || `https://ui-avatars.com/api/?name=${name.replace(' ','+')}&background=1f2937&color=84cc16`, plan, sede, classesRemaining });
            showToast('Alumno añadido con éxito');
            setName(''); setPhotoUrl(''); setPlan(''); setSede('');
        } catch (error) {
            showToast('Error al añadir alumno', 'error');
            console.error(error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = (student: Student) => {
        setModal({
            type: 'confirm',
            title: `¿Eliminar a ${student.name}?`,
            text: 'Esta acción no se puede deshacer.',
            onConfirm: async () => {
                try {
                    await fb.deleteStudent(student.id);
                    showToast('Alumno eliminado');
                } catch (e) {
                    showToast('Error al eliminar', 'error');
                }
                setModal(null);
            }
        });
    };

    const handleRenew = (student: Student) => {
        const planDetails = PLAN_DETAILS[student.plan];
        if (!planDetails) {
            showToast('El plan del alumno no es válido', 'error');
            return;
        }
        setModal({
            type: 'confirm',
            title: `¿Renovar a ${student.name}?`,
            text: `Se asignarán ${planDetails.classes} clases y se extenderá su membresía por 30 días.`,
            onConfirm: async () => {
                try {
                    await fb.renewStudentMembership(student.id, planDetails.classes);
                    showToast(`Membresía de ${student.name} renovada.`);
                } catch (e) {
                    showToast('Error al renovar membresía', 'error');
                }
                setModal(null);
            }
        });
    };
    
    const getMembershipStatus = (student: Student) => {
        const now = new Date();
        const expiryDate = student.membershipExpiresAt?.toDate();
        if (!expiryDate || now > expiryDate) {
            return { status: 'expired', icon: 'alert-circle', color: 'text-red-500', text: 'Membresía Vencida' };
        }
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (expiryDate <= sevenDaysFromNow) {
            return { status: 'expiring', icon: 'time-outline', color: 'text-yellow-500', text: `Vence el ${expiryDate.toLocaleDateString()}` };
        }
        return { status: 'active', icon: null, color: '', text: '' };
    };

    return (
        <div className="space-y-8">
            <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Nuevo Alumno</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre Completo" className="col-span-1 md:col-span-2 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" required />
                    <div className="col-span-1 md:col-span-2">
                        <div className="flex justify-between items-center mb-1">
                            <label htmlFor="student-photo-url" className="block text-sm font-medium text-gray-300">URL de la Foto (Opcional)</label>
                            <a href="https://postimages.org/" target="_blank" rel="noopener noreferrer" className="text-xs text-lime-500 hover:underline flex items-center">
                                <IonIcon name="cloud-upload-outline" className="mr-1" />
                                Subir en Postimages
                            </a>
                        </div>
                        <input id="student-photo-url" type="text" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="https://postimg.cc/..." className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" />
                    </div>
                    <select value={plan} onChange={e => setPlan(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" required>
                        <option value="">Seleccionar Plan</option>
                        {Object.entries(PLAN_DETAILS).map(([key, { name }]) => (
                            <option key={key} value={key}>{name}</option>
                        ))}
                    </select>
                    <select value={sede} onChange={e => setSede(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" required>
                        <option value="">Seleccionar Sede</option>
                        <option value="chimbote">Chimbote</option>
                        <option value="nuevo-chimbote">Nuevo Chimbote</option>
                    </select>
                     <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-gray-300 mb-1">Clases Asignadas</label>
                        <input type="number" value={classesRemaining} onChange={e => setClassesRemaining(Number(e.target.value))} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" required />
                    </div>
                    <button type="submit" disabled={submitting} className="col-span-1 md:col-span-2 w-full bg-lime-500 text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-lime-400 transition-smooth h-10 flex items-center justify-center">
                        {submitting ? <Spinner size="sm" /> : 'Guardar Alumno'}
                    </button>
                </form>
            </div>
            <div>
                 <h3 className="text-xl font-semibold mb-4">Lista de Alumnos ({students.length})</h3>
                 <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                    {students.map(student => {
                        const status = getMembershipStatus(student);
                        const isInactive = student.classesRemaining <= 0 || status.status === 'expired';
                        return (
                         <div key={student.id} className={`bg-gray-800 p-4 rounded-lg flex items-center justify-between transition-smooth ${isInactive ? 'bg-red-900/20' : ''}`}>
                            <div className="flex items-center space-x-4 min-w-0">
                                <img src={student.photoUrl} alt={student.name} className={`w-12 h-12 object-cover rounded-full ${isInactive ? 'border-2 border-red-500' : ''}`} />
                                <div className="min-w-0">
                                    <div className="flex items-center space-x-2">
                                        <h4 className="font-semibold truncate">{student.name}</h4>
                                        {status.icon && <IonIcon name={status.icon} className={`${status.color} text-lg`} title={status.text} />}
                                    </div>
                                    <p className={`text-sm ${isInactive ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
                                        Clases: {student.classesRemaining}
                                    </p>
                                </div>
                            </div>
                            <div className="flex space-x-3 flex-shrink-0 items-center">
                                {student.notes && (
                                    <div className="relative group">
                                        <IonIcon name="chatbubble-ellipses-outline" className="text-gray-500" />
                                        <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-900 text-white text-xs rounded py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                                            {student.notes}
                                        </div>
                                    </div>
                                )}
                                <button onClick={() => handleRenew(student)} title="Renovar Membresía" className="text-lime-400 hover:text-lime-300 transition-smooth"><IonIcon name="sync-outline" /></button>
                                <button onClick={() => setModal({ type: 'editStudent', student })} className="text-blue-400 hover:text-blue-300 transition-smooth"><IonIcon name="pencil-outline" /></button>
                                <button onClick={() => handleDelete(student)} className="text-red-400 hover:text-red-300 transition-smooth"><IonIcon name="trash-outline" /></button>
                            </div>
                        </div>
                    )})}
                 </div>
            </div>
        </div>
    );
};

const AsistenciaView: React.FC<{ attendance: AttendanceRecord[] }> = ({ attendance }) => {
    const [filterSede, setFilterSede] = useState('todas');
    const [filterClase, setFilterClase] = useState('todas');

    const filteredAttendance = useMemo(() => {
        return attendance.filter(a => {
            const sedeMatch = filterSede === 'todas' || a.sede === filterSede;
            const claseMatch = filterClase === 'todas' || a.className === filterClase;
            return sedeMatch && claseMatch;
        });
    }, [attendance, filterSede, filterClase]);

    return (
        <div className="space-y-4">
            <div className="bg-gray-800 p-4 rounded-lg flex flex-col md:flex-row gap-4">
                <select value={filterSede} onChange={e => setFilterSede(e.target.value)} className="w-full md:w-1/3 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2">
                    <option value="todas">Todas las Sedes</option>
                    <option value="chimbote">Chimbote</option>
                    <option value="nuevo-chimbote">Nuevo Chimbote</option>
                </select>
                <select value={filterClase} onChange={e => setFilterClase(e.target.value)} className="w-full md:w-1/3 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2">
                    <option value="todas">Todas las Clases</option>
                    {CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg overflow-x-auto">
                 <table className="w-full min-w-full text-left">
                    <thead>
                        <tr className="border-b border-gray-700">
                            <th className="py-2 px-4">Fecha</th>
                            <th className="py-2 px-4">Alumno</th>
                            <th className="py-2 px-4">Clase</th>
                            <th className="py-2 px-4">Sede</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAttendance.map(entry => (
                             <tr key={entry.id} className="border-b border-gray-700">
                                <td className="py-2 px-4 text-gray-400">{new Date(entry.timestamp.seconds * 1000).toLocaleString('es-PE')}</td>
                                <td className="py-2 px-4 font-medium">{entry.studentName}</td>
                                <td className="py-2 px-4">{entry.className}</td>
                                <td className="py-2 px-4 capitalize">{entry.sede}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ProfesoresView: React.FC<{ professors: Professor[], showToast: any, setModal: (m: ModalState) => void }> = ({ professors, showToast, setModal }) => {
    const [profName, setProfName] = useState('');
    const [profSede, setProfSede] = useState<'chimbote' | 'nuevo-chimbote' | ''>('');
    const [profPin, setProfPin] = useState('');
    const [submitting, setSubmitting] = useState(false);
    
    const handleAddProfessor = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!profName || !profSede || profPin.length !== 4) {
            showToast('Completa todos los campos (PIN debe ser de 4 dígitos)', 'error');
            return;
        }
        setSubmitting(true);
        try {
            await fb.addProfessor({name: profName, sede: profSede, pin: profPin});
            showToast('Profesor añadido');
            setProfName(''); setProfSede(''); setProfPin('');
        } catch(e) {
            showToast('Error al añadir profesor', 'error');
        } finally {
            setSubmitting(false);
        }
    }

    const handleDelete = (prof: Professor) => {
        setModal({
            type: 'confirm',
            title: `¿Eliminar a ${prof.name}?`,
            text: 'Se eliminará al profesor y todos sus horarios.',
            onConfirm: async () => {
                try {
                    await fb.deleteProfessor(prof.id);
                    showToast('Profesor eliminado');
                } catch(e) {
                    showToast('Error al eliminar', 'error');
                }
                setModal(null);
            }
        });
    }

    return (
        <div className="space-y-8">
            <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Nuevo Profesor</h3>
                <form onSubmit={handleAddProfessor} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="md:col-span-2">
                        <label className="text-sm text-gray-400">Nombre del Profesor</label>
                        <input type="text" value={profName} onChange={e => setProfName(e.target.value)} placeholder="Nombre Completo" className="w-full bg-gray-700 p-2 rounded mt-1" />
                    </div>
                    <div>
                        <label className="text-sm text-gray-400">Sede</label>
                        <select value={profSede} onChange={e => setProfSede(e.target.value as any)} className="w-full bg-gray-700 p-2 rounded mt-1">
                            <option value="">Seleccionar</option>
                            <option value="chimbote">Chimbote</option>
                            <option value="nuevo-chimbote">Nuevo Chimbote</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-sm text-gray-400">PIN (4 dígitos)</label>
                        <input type="text" value={profPin} onChange={e => setProfPin(e.target.value.replace(/\D/g, ''))} placeholder="1234" maxLength={4} className="w-full bg-gray-700 p-2 rounded mt-1" />
                    </div>
                    <button type="submit" disabled={submitting} className="md:col-span-4 w-full bg-lime-500 text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-lime-400 h-10 flex items-center justify-center transition-smooth">
                         {submitting ? <Spinner size="sm" /> : 'Añadir Profesor'}
                    </button>
                </form>
            </div>
            
            <div>
                 <h3 className="text-xl font-semibold mb-4">Lista de Profesores ({professors.length})</h3>
                 <div className="space-y-3">
                    {professors.map(prof => (
                        <div key={prof.id} className="bg-gray-800 p-4 rounded-lg flex items-center justify-between">
                             <div>
                                <h4 className="font-semibold">{prof.name}</h4>
                                <p className="text-sm text-gray-400 capitalize">{prof.sede}</p>
                            </div>
                            <div className="flex space-x-2">
                                <button onClick={() => setModal({ type: 'schedule', professor: prof })} className="text-blue-400 hover:text-blue-300 transition-smooth"><IonIcon name="calendar-outline" /></button>
                                <button onClick={() => handleDelete(prof)} className="text-red-400 hover:text-red-300 transition-smooth"><IonIcon name="trash-outline" /></button>
                            </div>
                        </div>
                    ))}
                 </div>
            </div>
        </div>
    );
};

const AvisosView: React.FC<{ announcements: Announcement[], showToast: any, adminUnlocked: boolean, onUnlockRequest: () => void, setModal: (m: ModalState) => void }> = ({ announcements, showToast, adminUnlocked, onUnlockRequest, setModal }) => {
    const [title, setTitle] = useState('');
    const [text, setText] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isSubmitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!title || !text) {
            showToast('El título y el texto son obligatorios', 'error');
            return;
        }
        setSubmitting(true);
        try {
            await fb.addAnnouncement({ title, text, imageUrl });
            showToast('Aviso publicado con éxito');
            setTitle(''); setText(''); setImageUrl('');
        } catch (error) {
            showToast('Error al publicar el aviso', 'error');
            console.error(error);
        } finally {
            setSubmitting(false);
        }
    }
    
    const handleDelete = (ann: Announcement) => {
        setModal({
            type: 'confirm',
            title: `¿Eliminar aviso "${ann.title}"?`,
            text: 'Esta acción no se puede deshacer.',
            onConfirm: async () => {
                try {
                    await fb.deleteAnnouncement(ann.id);
                    showToast('Aviso eliminado');
                } catch(e) {
                    showToast('Error al eliminar', 'error');
                }
                setModal(null);
            }
        });
    }

    return (
        <div className="space-y-8">
            <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Publicar Nuevo Aviso</h3>
                {adminUnlocked ? (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Título del Aviso" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" required />
                        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Escribe tu aviso aquí..." className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" rows={4} required></textarea>
                         <div className="w-full">
                            <div className="flex justify-between items-center mb-1">
                                <label htmlFor="announcement-image-url" className="block text-sm font-medium text-gray-300">URL de Imagen (Opcional)</label>
                                <a href="https://postimages.org/" target="_blank" rel="noopener noreferrer" className="text-xs text-lime-500 hover:underline flex items-center">
                                    <IonIcon name="cloud-upload-outline" className="mr-1" />
                                    Subir en Postimages
                                </a>
                            </div>
                            <input id="announcement-image-url" type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://postimg.cc/..." className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2" />
                        </div>
                        <button type="submit" disabled={isSubmitting} className="w-full bg-lime-500 text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-lime-400 transition-smooth h-10 flex items-center justify-center">
                            {isSubmitting ? <Spinner size="sm"/> : 'Publicar Aviso'}
                        </button>
                    </form>
                ) : (
                    <div className="text-center p-4 border-2 border-dashed border-gray-600 rounded-lg">
                        <p className="text-gray-400 mb-4">Se requiere PIN de admin para publicar.</p>
                        <button onClick={onUnlockRequest} className="bg-lime-500 text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-lime-400 transition-smooth">Desbloquear</button>
                    </div>
                )}
            </div>
             <div className="space-y-4">
                {announcements.length > 0 ? announcements.map(ann => (
                    <div key={ann.id} className="bg-gray-800 rounded-lg shadow-md overflow-hidden relative group">
                        {ann.imageUrl && <img src={ann.imageUrl} alt={ann.title} className="w-full h-48 object-cover" />}
                        <div className="p-6">
                            <h3 className="text-xl font-semibold text-lime-500 mb-2">{ann.title}</h3>
                            <p className="text-gray-300 whitespace-pre-wrap mb-4">{ann.text}</p>
                            <p className="text-xs text-gray-500">Publicado el {new Date(ann.createdAt.seconds * 1000).toLocaleDateString('es-PE')}</p>
                        </div>
                        {adminUnlocked && (
                             <button onClick={() => handleDelete(ann)} className="absolute top-2 right-2 bg-red-600 p-2 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                <IonIcon name="trash-outline" />
                            </button>
                        )}
                    </div>
                )) : <p className="text-center text-gray-500">No hay avisos publicados.</p>}
            </div>
        </div>
    );
};

const ReportesView: React.FC<{ students: Student[]; attendance: AttendanceRecord[]; professorAttendance: ProfessorAttendance[], showToast: (msg: string, type?: 'success'|'error') => void }> = ({ students, attendance, professorAttendance, showToast }) => {
    
    const attendanceByMonth = useMemo(() => {
        const data = attendance.reduce((acc, record) => {
            const date = record.timestamp.toDate();
            const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            acc[month] = (acc[month] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(data).map(([name, Asistencias]) => ({ name, Asistencias })).sort((a,b) => a.name.localeCompare(b.name));
    }, [attendance]);

    const popularClasses = useMemo(() => {
        const data = attendance.reduce((acc, record) => {
            acc[record.className] = (acc[record.className] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(data).map(([name, Asistencias]) => ({ name, Asistencias })).sort((a, b) => b.Asistencias - a.Asistencias);
    }, [attendance]);

    const newStudentsByMonth = useMemo(() => {
        const data = students.reduce((acc, student) => {
            const date = student.createdAt.toDate();
            const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            acc[month] = (acc[month] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(data).map(([name, Nuevos]) => ({ name, Nuevos })).sort((a,b) => a.name.localeCompare(b.name));
    }, [students]);

    const handleExport = async (collectionRef: any, filename: string, headers: string[], mapping: Record<string, string>, orderByField?: string) => {
        try {
            const data = await fb.getAllDocs(collectionRef, orderByField);
            if(data.length === 0) {
                showToast(`No hay datos para exportar en ${filename}`, 'error');
                return;
            }
            const csv = convertToCSV(data, headers, mapping);
            downloadCSV(csv, filename);
            showToast(`Reporte ${filename} descargado!`, 'success');
        } catch(e) {
            console.error("Export failed", e);
            showToast("Error al exportar los datos.", 'error');
        }
    };
    
    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-80">
                    <h3 className="text-xl font-semibold mb-4">Asistencia por Mes</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={attendanceByMonth}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                            <Bar dataKey="Asistencias" fill="#84cc16" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-80">
                    <h3 className="text-xl font-semibold mb-4">Clases Populares</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={popularClasses.slice(0, 5)} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis type="number" stroke="#9ca3af" />
                            <YAxis type="category" dataKey="name" stroke="#9ca3af" width={120} />
                            <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                            <Bar dataKey="Asistencias" fill="#22c55e" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                 <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-80 lg:col-span-2">
                    <h3 className="text-xl font-semibold mb-4">Nuevos Alumnos por Mes</h3>
                    <ResponsiveContainer width="100%" height="100%">
                         <LineChart data={newStudentsByMonth}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                            <Legend />
                            <Line type="monotone" dataKey="Nuevos" stroke="#3b82f6" strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className="bg-gray-800 p-6 rounded-lg">
                <h2 className="text-2xl font-semibold mb-4">Exportar Datos</h2>
                <p className="text-gray-300 mb-6">Descarga copias de seguridad de tus datos en formato CSV, compatible con Excel.</p>
                <div className="flex flex-col md:flex-row gap-4">
                    <button onClick={() => handleExport(fb.studentsCollection, 'alumnos.csv', ['name', 'sede', 'plan', 'classesRemaining'], {name: 'Nombre', sede: 'Sede', plan: 'Plan', classesRemaining: 'Clases Restantes'})} className="flex-1 bg-lime-500 text-gray-900 font-bold py-3 px-5 rounded-lg hover:bg-lime-400 transition-smooth flex items-center justify-center space-x-2">
                        <IonIcon name="people-outline" className="text-xl" />
                        <span>Exportar Alumnos</span>
                    </button>
                    <button onClick={() => handleExport(fb.attendanceCollection, 'asistencia_alumnos.csv', ['timestamp', 'studentName', 'className', 'sede'], {timestamp: 'Fecha', studentName: 'Alumno', className: 'Clase', sede: 'Sede'}, 'timestamp')} className="flex-1 bg-blue-500 text-white font-bold py-3 px-5 rounded-lg hover:bg-blue-400 transition-smooth flex items-center justify-center space-x-2">
                        <IonIcon name="list-outline" className="text-xl" />
                        <span>Exportar Asistencia Alumnos</span>
                    </button>
                    <button onClick={() => handleExport(fb.professorAttendanceCollection, 'asistencia_profesores.csv', ['timestamp', 'professorName', 'className', 'sede', 'status'], {timestamp: 'Fecha', professorName: 'Profesor', className: 'Clase', sede: 'Sede', status: 'Estado'}, 'timestamp')} className="flex-1 bg-purple-500 text-white font-bold py-3 px-5 rounded-lg hover:bg-purple-400 transition-smooth flex items-center justify-center space-x-2">
                        <IonIcon name="school-outline" className="text-xl" />
                        <span>Exportar Asistencia Profesores</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const PagosView: React.FC<{ students: Student[]; payments: Payment[]; showToast: (msg: string, type?: 'success' | 'error') => void }> = ({ students, payments, showToast }) => {
    const [selectedStudentId, setSelectedStudentId] = useState('');
    const [amount, setAmount] = useState(0);
    const [isSubmitting, setSubmitting] = useState(false);

    const handleStudentSelect = (studentId: string) => {
        setSelectedStudentId(studentId);
        const student = students.find(s => s.id === studentId);
        if (student) {
            const planKey = Object.keys(PLAN_DETAILS).find(key => PLAN_DETAILS[key].name.includes(student.plan)) || student.plan;
            const priceString = PLAN_DETAILS[planKey]?.name.match(/S\/\s*(\d+)/)?.[1];
            setAmount(priceString ? parseInt(priceString, 10) : 0);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const student = students.find(s => s.id === selectedStudentId);
        if (!student || amount <= 0) {
            showToast('Selecciona un alumno y un monto válido', 'error');
            return;
        }
        setSubmitting(true);
        try {
            const planDetails = PLAN_DETAILS[student.plan];
            if (!planDetails) throw new Error('Plan de alumno no válido');
            
            await fb.addPayment({
                studentId: student.id,
                studentName: student.name,
                amount,
                plan: student.plan,
            });
            await fb.renewStudentMembership(student.id, planDetails.classes);

            showToast(`Pago de S/${amount} registrado para ${student.name}`);
            setSelectedStudentId('');
            setAmount(0);
        } catch (err) {
            console.error(err);
            showToast('Error al registrar el pago', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Registrar Pago</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <select value={selectedStudentId} onChange={e => handleStudentSelect(e.target.value)} className="md:col-span-2 bg-gray-700 p-2 rounded" required>
                        <option value="">Seleccionar Alumno...</option>
                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} placeholder="Monto (S/)" className="bg-gray-700 p-2 rounded" required />
                    <button type="submit" disabled={isSubmitting} className="md:col-span-3 w-full bg-lime-500 text-gray-900 font-bold py-2 rounded transition-smooth h-10 flex items-center justify-center">
                        {isSubmitting ? <Spinner size="sm" /> : 'Registrar Pago y Renovar Membresía'}
                    </button>
                </form>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Historial de Pagos</h3>
                <div className="max-h-[50vh] overflow-y-auto">
                    <table className="w-full min-w-full text-left">
                        <thead><tr className="border-b border-gray-700">
                            <th className="py-2 px-4">Fecha</th><th className="py-2 px-4">Alumno</th><th className="py-2 px-4">Monto</th>
                        </tr></thead>
                        <tbody>
                            {payments.map(p => (
                                <tr key={p.id} className="border-b border-gray-700">
                                    <td className="py-2 px-4 text-gray-400">{p.paymentDate.toDate().toLocaleString('es-PE')}</td>
                                    <td className="py-2 px-4 font-medium">{p.studentName}</td>
                                    <td className="py-2 px-4">S/ {p.amount}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const HorariosView: React.FC<{ schedule: GlobalSchedule[]; showToast: (msg: string, type?: 'success'|'error') => void }> = ({ schedule, showToast }) => {
    const [day, setDay] = useState(DAYS_OF_WEEK[1]);
    const [time, setTime] = useState('18:00');
    const [className, setClassName] = useState(CLASS_OPTIONS[0]);
    const [sede, setSede] = useState<'chimbote' | 'nuevo-chimbote'>('chimbote');

    const handleAdd = async () => {
        try {
            await fb.addGlobalSchedule({ day, time, className, sede });
            showToast('Clase añadida al horario general');
        } catch (e) {
            showToast('Error al añadir clase', 'error');
        }
    };
    
    const handleDelete = async (id: string) => {
        try {
            await fb.deleteGlobalSchedule(id);
            showToast('Clase eliminada del horario');
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    }

    return (
        <div className="space-y-8">
             <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Añadir Clase al Horario General</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
                    <select value={day} onChange={e => setDay(e.target.value)} className="bg-gray-700 p-2 rounded">
                        {DAYS_OF_WEEK.filter(d=>d !== "Domingo").map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                     <input type="time" value={time} onChange={e => setTime(e.target.value)} className="bg-gray-700 p-2 rounded" />
                     <select value={className} onChange={e => setClassName(e.target.value)} className="bg-gray-700 p-2 rounded">
                        {CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                     <select value={sede} onChange={e => setSede(e.target.value as any)} className="bg-gray-700 p-2 rounded">
                        <option value="chimbote">Chimbote</option>
                        <option value="nuevo-chimbote">Nuevo Chimbote</option>
                    </select>
                </div>
                <button onClick={handleAdd} className="w-full mt-4 bg-lime-500 text-gray-900 font-bold py-2 rounded transition-smooth">Añadir Clase</button>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg">
                <h3 className="text-xl font-semibold mb-4">Horario General Actual</h3>
                <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                    {schedule.length > 0 ? schedule.map(s => (
                        <div key={s.id} className="bg-gray-700 p-2 rounded flex justify-between items-center">
                            <span>{s.day} {s.time} - {s.className} ({s.sede})</span>
                            <button onClick={() => handleDelete(s.id)} className="text-red-400 hover:text-red-300 transition-smooth"><IonIcon name="trash-outline"/></button>
                        </div>
                    )) : <p className="text-gray-500 text-center">No hay clases en el horario general.</p>}
                </div>
            </div>
        </div>
    );
};

const ProfessorDashboardScreen: React.FC<{ 
    professor: Professor; 
    attendance: AttendanceRecord[]; 
    onLogout: () => void;
    globalSchedule: GlobalSchedule[];
    showToast: (msg: string, type?: 'success' | 'error') => void;
}> = ({ professor, attendance, onLogout, globalSchedule, showToast }) => {
    const [schedule, setSchedule] = useState<Schedule[]>([]);
    const { checkinState, handleCheckin } = useProfessorCheckinStatus(professor, globalSchedule, showToast);
    
    useEffect(() => {
        const unsub = fb.getProfessorSchedule(professor.id, setSchedule);
        return () => unsub();
    }, [professor.id]);

    const scheduleByDay = useMemo(() => {
        return schedule.reduce((acc, s) => {
            (acc[s.day] = acc[s.day] || []).push(s);
            return acc;
        }, {} as Record<string, Schedule[]>);
    }, [schedule]);

    const recentCheckins = useMemo(() => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        return attendance.filter(a => a.timestamp.toDate() > oneHourAgo && a.sede === professor.sede);
    }, [attendance, professor.sede]);

    const checkinButtonDisabled = checkinState.status !== 'idle';
    const checkinButtonText = {
        'idle': 'Marcar Asistencia',
        'checking': 'Verificando...',
        'checked-in': 'Asistencia Marcada',
        'no-class': 'Marcar Asistencia',
        'error': 'Reintentar Asistencia'
    }[checkinState.status];

    return (
        <div className="fade-in space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold">Bienvenido, {professor.name}</h2>
                    <p className="text-gray-400">Sede {professor.sede === 'chimbote' ? 'Chimbote' : 'Nuevo Chimbote'}</p>
                </div>
                <button onClick={onLogout} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-smooth flex items-center space-x-2">
                    <IonIcon name="log-out-outline" />
                    <span>Salir</span>
                </button>
            </div>

             <div className="bg-gray-800 p-6 rounded-lg text-center">
                 <button onClick={handleCheckin} disabled={checkinButtonDisabled} className={`w-full max-w-md mx-auto text-lg font-bold py-4 px-4 rounded-lg transition-smooth h-16 flex items-center justify-center space-x-3
                    ${!checkinButtonDisabled ? 'bg-lime-500 text-gray-900 hover:bg-lime-400' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}>
                     {checkinState.status === 'checking' ? <Spinner /> : <IonIcon name="checkmark-circle-outline" className="text-2xl" />}
                     <span>{checkinButtonText}</span>
                 </button>
                 <p className="text-gray-400 text-sm mt-3 h-5">{checkinState.message}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 bg-gray-800 p-6 rounded-lg">
                    <h3 className="text-xl font-semibold mb-4">Tu Horario Semanal</h3>
                    <div className="space-y-4">
                        {Object.keys(scheduleByDay).length > 0 ? DAYS_OF_WEEK.filter(d => scheduleByDay[d]).map(day => (
                            <div key={day}>
                                <h4 className="font-bold text-lime-500">{day}</h4>
                                <ul className="list-disc list-inside text-gray-300">
                                    {scheduleByDay[day].map(s => <li key={s.id}>{s.time} - {s.className}</li>)}
                                </ul>
                            </div>
                        )) : <p className="text-gray-500">No tienes un horario personal asignado. Puedes marcar asistencia para las clases del horario general de tu sede.</p>}
                    </div>
                </div>
                <div className="bg-gray-800 p-6 rounded-lg">
                    <h3 className="text-xl font-semibold mb-4">Check-ins Recientes</h3>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {recentCheckins.length > 0 ? recentCheckins.map(a => (
                            <div key={a.id} className="bg-gray-700 p-3 rounded-lg">
                                <p className="font-semibold">{a.studentName}</p>
                                <p className="text-xs text-gray-400">{a.className} - {a.timestamp.toDate().toLocaleTimeString()}</p>
                            </div>
                        )) : <p className="text-gray-500">No hay check-ins recientes.</p>}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- MODAL COMPONENTS ---

const EditStudentModal: React.FC<{ student: Student, onClose: () => void, showToast: any }> = ({ student, onClose, showToast }) => {
    const [formData, setFormData] = useState({...student, notes: student.notes || ''});
    const [submitting, setSubmitting] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    useEffect(() => {
        const plan = PLAN_DETAILS[formData.plan];
        if(plan && formData.plan !== student.plan) { // Only auto-update if plan changes
            setFormData(fd => ({ ...fd, classesRemaining: plan.classes }));
        }
    }, [formData.plan, student.plan]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const { id, ...dataToSave } = formData;
            await fb.updateStudent(student.id, {
                ...dataToSave,
                classesRemaining: Number(formData.classesRemaining),
                membershipExpiresAt: formData.membershipExpiresAt, // Already a timestamp
            });
            showToast('Alumno actualizado');
            onClose();
        } catch(e) {
            showToast('Error al actualizar', 'error');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal onClose={onClose} title={`Editar ${student.name}`}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="text-sm text-gray-400">Nombre Completo</label>
                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 p-2 rounded mt-1" />
                </div>
                <div>
                    <label className="text-sm text-gray-400">URL de Foto</label>
                    <input type="text" name="photoUrl" value={formData.photoUrl} onChange={handleChange} className="w-full bg-gray-700 p-2 rounded mt-1" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm text-gray-400">Plan</label>
                        <select name="plan" value={formData.plan} onChange={handleChange} className="w-full bg-gray-700 p-2 rounded mt-1">
                            {Object.entries(PLAN_DETAILS).map(([key, { name }]) => (
                                <option key={key} value={key}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm text-gray-400">Sede</label>
                        <select name="sede" value={formData.sede} onChange={handleChange} className="w-full bg-gray-700 p-2 rounded mt-1">
                            <option value="chimbote">Chimbote</option>
                            <option value="nuevo-chimbote">Nuevo Chimbote</option>
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm text-gray-400">Clases Restantes</label>
                        <input type="number" name="classesRemaining" value={formData.classesRemaining} onChange={handleChange} className="w-full bg-gray-700 p-2 rounded mt-1" />
                    </div>
                     <div>
                        <label className="text-sm text-gray-400">Vencimiento</label>
                        <input type="date" name="membershipExpiresAt" 
                               value={formData.membershipExpiresAt ? formData.membershipExpiresAt.toDate().toISOString().split('T')[0] : ''} 
                               onChange={e => setFormData({...formData, membershipExpiresAt: e.target.value ? fb.Timestamp.fromDate(new Date(e.target.value)) : null})} 
                               className="w-full bg-gray-700 p-2 rounded mt-1" />
                    </div>
                </div>
                <div>
                    <label className="text-sm text-gray-400">Notas (privado)</label>
                    <textarea name="notes" value={formData.notes} onChange={handleChange} rows={3} className="w-full bg-gray-700 p-2 rounded mt-1" placeholder="Alergias, objetivos, etc."></textarea>
                </div>
                 <button type="submit" disabled={submitting} className="w-full bg-lime-500 text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-lime-400 h-10 flex items-center justify-center transition-smooth">
                    {submitting ? <Spinner size="sm" /> : 'Guardar Cambios'}
                </button>
            </form>
        </Modal>
    );
};

const ConfirmModal: React.FC<{ title: string, text: string, onConfirm: () => void, onClose: () => void }> = ({ title, text, onConfirm, onClose }) => (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50 fade-in">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-sm mx-auto text-center">
            <h2 className="text-2xl font-semibold mb-2">{title}</h2>
            <p className="text-gray-400 mb-6">{text}</p>
            <div className="flex space-x-4">
                <button onClick={onClose} className="flex-1 bg-gray-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-gray-500 transition-smooth">Cancelar</button>
                <button onClick={onConfirm} className="flex-1 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-400 transition-smooth">Confirmar</button>
            </div>
        </div>
    </div>
);

const ScheduleModal: React.FC<{ professor: Professor, onClose: () => void, showToast: any }> = ({ professor, onClose, showToast }) => {
    const [schedule, setSchedule] = useState<Schedule[]>([]);
    const [day, setDay] = useState(DAYS_OF_WEEK[1]);
    const [time, setTime] = useState('18:00');
    const [className, setClassName] = useState(CLASS_OPTIONS[0]);

    useEffect(() => {
        const unsub = fb.getProfessorSchedule(professor.id, setSchedule);
        return () => unsub();
    }, [professor.id]);

    const handleAdd = async () => {
        if(!day || !time || !className) {
            showToast('Completa todos los campos', 'error');
            return;
        }
        try {
            await fb.addProfessorSchedule(professor.id, { day, time, className });
            showToast('Horario añadido');
        } catch(e) { showToast('Error al añadir', 'error');}
    }
    
    const handleDelete = async (scheduleId: string) => {
        try {
            await fb.deleteProfessorSchedule(professor.id, scheduleId);
            showToast('Horario eliminado');
        } catch(e) { showToast('Error al eliminar', 'error');}
    }

    return (
        <Modal onClose={onClose} title={`Horario de ${professor.name}`}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select value={day} onChange={e => setDay(e.target.value)} className="bg-gray-700 p-2 rounded">
                        {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                     <input type="time" value={time} onChange={e => setTime(e.target.value)} className="bg-gray-700 p-2 rounded" />
                     <select value={className} onChange={e => setClassName(e.target.value)} className="bg-gray-700 p-2 rounded">
                        {CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <button onClick={handleAdd} className="w-full bg-lime-500 text-gray-900 font-bold py-2 rounded transition-smooth">Añadir Clase</button>
                <div className="space-y-2">
                    <h4 className="font-semibold mt-4">Horario Actual</h4>
                    {schedule.length > 0 ? schedule.map(s => (
                        <div key={s.id} className="bg-gray-700 p-2 rounded flex justify-between items-center">
                            <span>{s.day} {s.time} - {s.className}</span>
                            <button onClick={() => handleDelete(s.id)} className="text-red-400 hover:text-red-300 transition-smooth"><IonIcon name="trash-outline"/></button>
                        </div>
                    )) : <p className="text-gray-500 text-center">No hay clases asignadas.</p>}
                </div>
            </div>
        </Modal>
    );
};


const PinModal: React.FC<{
    onClose: () => void;
    onSuccess: () => void;
    correctPin: string;
    title: string;
    prompt: string;
}> = ({ onClose, onSuccess, correctPin, title, prompt }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const pinDisplayRef = useRef<HTMLDivElement>(null);

    const handlePinKey = (key: string) => {
        setError('');
        if (pin.length < 4) {
            setPin(pin + key);
        }
    };

    const handleBackspace = () => {
        setError('');
        setPin(pin.slice(0, -1));
    };
    
    const handleClear = () => {
        setError('');
        setPin('');
    };

    useEffect(() => {
        if (pin.length === 4) {
            if (pin === correctPin) {
                onSuccess();
            } else {
                setError('PIN Incorrecto');
                pinDisplayRef.current?.classList.add('shake-error');
                setTimeout(() => {
                    pinDisplayRef.current?.classList.remove('shake-error');
                    setPin('');
                }, 500);
            }
        }
    }, [pin, correctPin, onSuccess]);

    const pinDots = Array(4).fill(0).map((_, i) => (
        <div key={i} className={`w-6 h-6 rounded-full border-2 transition-colors ${pin.length > i ? 'bg-lime-500 border-lime-500' : 'border-gray-500'}`}></div>
    ));

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50 fade-in">
            <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-sm mx-auto text-center">
                <h2 className="text-2xl font-semibold mb-2">{title}</h2>
                <p className="text-gray-400 mb-6">{prompt}</p>
                <div ref={pinDisplayRef} className="flex justify-center space-x-4 mb-4">
                    {pinDots}
                </div>
                <p className="text-red-400 text-center text-sm mb-4 h-5">{error}</p>
                <div className="grid grid-cols-3 gap-4 mb-6">
                    {keys.map(key => (
                        <button key={key} onClick={() => handlePinKey(key)} className="pin-key bg-gray-700 text-white text-2xl font-bold py-4 rounded-lg hover:bg-gray-600 transition-smooth">
                            {key}
                        </button>
                    ))}
                     <button onClick={handleClear} className="pin-key-clear bg-gray-600 text-white text-lg font-bold py-4 rounded-lg hover:bg-gray-500 transition-smooth">
                        C
                    </button>
                    <button onClick={() => handlePinKey('0')} className="pin-key bg-gray-700 text-white text-2xl font-bold py-4 rounded-lg hover:bg-gray-600 transition-smooth">
                        0
                    </button>
                    <button onClick={handleBackspace} className="bg-gray-600 text-white py-4 rounded-lg hover:bg-gray-500 transition-smooth flex items-center justify-center">
                        <IonIcon name="backspace-outline" className="text-2xl"/>
                    </button>
                </div>
                <button onClick={onClose} className="w-full bg-gray-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-gray-500 transition-smooth">
                    Cancelar
                </button>
            </div>
        </div>
    );
};
