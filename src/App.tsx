import { useState, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import { 
  ChevronLeft, ChevronRight, Settings, Calendar as CalendarIcon, 
  Plus, Trash2, X, AlertTriangle, Download, PieChart as PieChartIcon, 
  Briefcase, CalendarOff, CheckCircle2, Wallet, 
  ArrowDownToLine, ArrowUpFromLine, HandCoins,
  History, Save, Target, CreditCard, LogOut
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, 
  ResponsiveContainer, Legend 
} from 'recharts';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, onAuthStateChanged, signInAnonymously, 
  signInWithPopup, linkWithPopup, GoogleAuthProvider, signOut 
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, addDoc, deleteDoc
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

type Frequency = 'daily' | 'monthly';
type Tab = 'calendar' | 'savings' | 'insights' | 'settings';
type LinkedType = 'goal' | 'debt' | null;
type ExceptionType = 'absent' | 'expense_skip' | 'income_skip';

interface WorkOverride { start: string; end: string; days: number[]; }
interface AppSettings {
  cutoffs: number[]; defaultWorkDays: number[]; workOverrides: WorkOverride[];
  healthThresholds: { safe: number; caution: number; danger?: number };
}
interface Expense { id: string; date: string; amount: number | string; description: string; name?: string; category?: string; linkedType?: LinkedType; linkedTo?: string | null; createdAt?: string; ruleId?: string; }
interface Income { id: string; date: string; amount: number | string; name: string; description?: string; category?: string; linkedTo?: string | null; isReceived: boolean; createdAt?: string; ruleId?: string; }
interface FixedExpense { id: string; name: string; amount: number | string; frequency: Frequency; date: number | string | null; workingDaysOnly: boolean; createdAt?: string; category?: string; }
interface IncomeRule { id: string; name: string; amount: number | string; frequency: Frequency; date: number | string | null; workingDaysOnly: boolean; category: string; createdAt?: string; }
interface ExceptionEntry { id: string; date: string; type: ExceptionType; targetId: string | null; }
interface SavingsGoal { id: string; name: string; targetAmount: number | string; createdAt?: string; }
interface Debt { id: string; name: string; initialAmount: number | string; createdAt?: string; }
interface CycleStats { expectedIncome: number; cycleReceivedIncome: number; cycleFixed: number; cycleManualExpenses: number; totalExpenses: number; availableReality: number; healthPercent: number; healthState: 'safe' | 'caution' | 'danger'; startStr: string; endStr: string; }
interface NavButtonProps { icon: LucideIcon; label: string; active: boolean; onClick: () => void; }
interface StatsHeaderProps { stats: CycleStats; isCurrent: boolean; }
interface StatCardProps { title: string; value: number; icon: ReactNode; className?: string; highlight?: boolean; }
interface MergedCalendarViewProps {
  calendarMonth: Date; setCalendarMonth: Dispatch<SetStateAction<Date>>; settings: AppSettings;
  expenses: Expense[]; fixedExpenses: FixedExpense[]; incomes: Income[]; incomeRules: IncomeRule[]; exceptions: ExceptionEntry[];
  viewedStart: string; viewedEnd: string; todayStart: string; todayEnd: string; openDayModal: (date: string) => void;
  showIncome: boolean; setShowIncome: Dispatch<SetStateAction<boolean>>; showExpenses: boolean; setShowExpenses: Dispatch<SetStateAction<boolean>>;
}
interface SavingsDebtViewProps { user: User | null; db: Firestore | null; appId: string; savingsGoals: SavingsGoal[]; debts: Debt[]; expenses: Expense[]; }
interface DayDetailsModalProps {
  isOpen: boolean; onClose: () => void; dateStr: string | null; expenses: Expense[]; fixedExpenses: FixedExpense[];
  incomes: Income[]; incomeRules: IncomeRule[]; exceptions: ExceptionEntry[]; settings: AppSettings;
  savingsGoals: SavingsGoal[]; debts: Debt[]; user: User | null; db: Firestore | null; appId: string;
}
type ConfirmData =
  | { action: 'delete'; type: 'expense' | 'income'; data: Expense | Income }
  | { action: 'skip'; type: 'fixedExp' | 'fixedInc'; data: FixedExpense | IncomeRule }
  | { action: 'toggleAbsent' }
  | { action: 'markReceived'; type: 'fixedInc'; data: IncomeRule };
type ConfirmVariant = 'danger' | 'warning' | 'primary';
interface ConfirmDetails { title: string; message: string; confirmText: string; variant: ConfirmVariant; }
interface ConfirmModalProps { isOpen: boolean; title: string; message: string; onConfirm: () => void | Promise<void>; onCancel: () => void; confirmText?: string; variant?: ConfirmVariant; }
interface InsightsViewProps { expenses: Expense[]; incomes: Income[]; stats: CycleStats; }
interface SettingsViewProps { settings: AppSettings; user: User | null; db: Firestore | null; appId: string; fixedExpenses: FixedExpense[]; incomeRules: IncomeRule[]; }

const DEFAULT_EXPENSE_CATEGORIES = ['Food', 'Transport', 'Utilities', 'Entertainment', 'Shopping', 'Other'];
const DEFAULT_INCOME_CATEGORIES = ['Salary', 'Freelance', 'Gift', 'Reimbursement', 'Investment', 'Other'];
const DAYS_OF_WEEK = [
  { id: 0, short: 'Sun', long: 'Sunday' },
  { id: 1, short: 'Mon', long: 'Monday' },
  { id: 2, short: 'Tue', long: 'Tuesday' },
  { id: 3, short: 'Wed', long: 'Wednesday' },
  { id: 4, short: 'Thu', long: 'Thursday' },
  { id: 5, short: 'Fri', long: 'Friday' },
  { id: 6, short: 'Sat', long: 'Saturday' }
];

const THEME_STYLES = `
  :root {
    --atx-bg: #f8fafc;
    --atx-card: #ffffff;
    --atx-text: #1e293b;
    --atx-text-muted: #64748b;
    --atx-border: #e2e8f0;
    
    /* Default: Safe */
    --atx-accent: #10b981; 
    --atx-accent-light: #d1fae5;
    --atx-accent-hover: #059669;
    
    --status-safe: #10b981;
    --status-safe-light: #d1fae5;
    --status-caution: #f59e0b;
    --status-caution-light: #fef3c7;
    --status-danger: #ef4444;
    --status-danger-light: #fee2e2;
    --status-neutral: #3b82f6;

    --atx-view-band: var(--atx-accent-light);
    --atx-today-band: #f1f5f9;
  }
  
  .theme-wrapper[data-budget-state="safe"] {
    --atx-accent: var(--status-safe);
    --atx-accent-light: var(--status-safe-light);
    --atx-accent-hover: #059669;
  }
  
  .theme-wrapper[data-budget-state="caution"] {
    --atx-accent: var(--status-caution);
    --atx-accent-light: var(--status-caution-light);
    --atx-accent-hover: #d97706;
  }
  
  .theme-wrapper[data-budget-state="danger"] {
    --atx-accent: var(--status-danger);
    --atx-accent-light: var(--status-danger-light);
    --atx-accent-hover: #dc2626;
  }

  .atx-container {
    background-color: var(--atx-bg);
    color: var(--atx-text);
    min-height: 100vh;
    transition: background-color 0.3s ease;
  }
  
  .atx-card {
    background-color: var(--atx-card);
    border: 1px solid var(--atx-border);
  }
`;

const formatPHP = (amount: number | string | null | undefined) => {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0);
};

const toYYYYMMDD = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getActivePeriod = (targetDate: Date, cutoffs: number[] = [13, 29]) => {
  if (!cutoffs || cutoffs.length === 0) cutoffs = [13, 29];
  const d = new Date(targetDate);
  const year = d.getFullYear();
  const month = d.getMonth();

  let candidates: Date[] = [];
  [-2, -1, 0, 1, 2].forEach(offset => {
    let m = month + offset;
    let y = year;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    
    cutoffs.forEach(c => {
       let dateObj = new Date(y, m, c);
       if (dateObj.getMonth() !== m) dateObj = new Date(y, m + 1, 0); 
       candidates.push(dateObj);
    });
  });

  candidates = candidates.map(c => c.getTime())
    .filter((val, i, self) => self.indexOf(val) === i)
    .sort((a, b) => a - b)
    .map(t => new Date(t));

  const targetTime = new Date(year, month, d.getDate()).getTime();
  
  let start = candidates[0];
  let end = candidates[1];

  for (let i = 0; i < candidates.length - 1; i++) {
    if (targetTime >= candidates[i].getTime() && targetTime < candidates[i+1].getTime()) {
       start = candidates[i];
       end = new Date(candidates[i+1].getTime() - 86400000); 
       break;
    }
  }
  return { start, end };
};

const getBaseWorkDay = (dateStr: string, dateObj: Date, settings: AppSettings) => {
  if (settings.workOverrides && settings.workOverrides.length > 0) {
    const override = settings.workOverrides.find(ov => dateStr >= ov.start && dateStr <= ov.end);
    if (override) return override.days.includes(dateObj.getDay());
  }
  const defaultPattern = settings.defaultWorkDays || [1, 2, 3, 4, 5];
  return defaultPattern.includes(dateObj.getDay());
};

const isAbsent = (dateStr: string, exceptions: ExceptionEntry[]) => {
  return exceptions.some(e => e.date === dateStr && e.type === 'absent');
};

// Firebase project credentials come from environment variables (set these in
// a .env file - see the accompanying .env.example) instead of being baked in,
// so real keys never get committed to source control.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
const app = firebaseReady ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const googleProvider = new GoogleAuthProvider();

// Namespace for this app's data inside Firestore: artifacts/{appId}/users/{uid}/...
// This is just a fixed label and unrelated to the Firebase "appId" above.
const appId = 'ataraxia';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // Whether losing the session should auto-start a fresh anonymous one.
  // Turned off right before an explicit sign-out so we don't silently spin
  // up a brand-new empty account the instant someone signs out of Google.
  const autoAnonRef = useRef(true);
  const [activeTab, setActiveTab] = useState<Tab>('calendar'); // 'calendar', 'savings', 'insights', 'settings'
  
  const [settings, setSettings] = useState<AppSettings>({
    cutoffs: [13, 29], defaultWorkDays: [1, 2, 3, 4, 5], workOverrides: [],
    healthThresholds: { safe: 50, caution: 20, danger: 20 }
  });
  
  // Collections State
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [incomeRules, setIncomeRules] = useState<IncomeRule[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]); 
  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]); 
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  
  // Navigation State
  const [viewedCycleAnchor, setViewedCycleAnchor] = useState<Date>(new Date()); 
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date()); 

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);

  // Calendar view toggles
  const [showIncome, setShowIncome] = useState<boolean>(true);
  const [showExpenses, setShowExpenses] = useState<boolean>(true);

  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setAuthLoading(false);
        return;
      }
      if (autoAnonRef.current) {
        signInAnonymously(auth)
          .catch(err => console.error('Anonymous sign-in failed:', err))
          .finally(() => setAuthLoading(false));
      } else {
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    if (!auth) return;
    autoAnonRef.current = true;
    setAuthError(null);
    try {
      if (auth.currentUser?.isAnonymous) {
        // Upgrade the current anonymous account so today's local data carries
        // over, instead of starting a separate, empty Google-linked account.
        await linkWithPopup(auth.currentUser, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (err: any) {
      if (err?.code === 'auth/credential-already-in-use') {
        // This Google account already has its own saved data from another
        // device or session - switch to that account instead of the local one.
        try {
          await signInWithPopup(auth, googleProvider);
        } catch (err2) {
          console.error(err2);
          setAuthError('Could not sign in with Google. Please try again.');
        }
      } else if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        console.error(err);
        setAuthError('Could not sign in with Google. Please try again.');
      }
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    autoAnonRef.current = false;
    await signOut(auth);
  };

  useEffect(() => {
    if (!user || !db) return;
    const basePath = `artifacts/${appId}/users/${user.uid}`;
    
    const unsubs = [
      onSnapshot(doc(db, basePath, 'settings', 'config'), (snap) => {
        if (snap.exists()) setSettings(prev => ({ ...prev, ...(snap.data() as Partial<AppSettings>) }));
      }),
      onSnapshot(collection(db, basePath, 'expenses'), (snap) => setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Expense))),
      onSnapshot(collection(db, basePath, 'fixedExpenses'), (snap) => setFixedExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }) as FixedExpense))),
      onSnapshot(collection(db, basePath, 'incomeRules'), (snap) => setIncomeRules(snap.docs.map(d => ({ id: d.id, ...d.data() }) as IncomeRule))),
      onSnapshot(collection(db, basePath, 'incomes'), (snap) => setIncomes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Income))),
      onSnapshot(collection(db, basePath, 'exceptions'), (snap) => setExceptions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExceptionEntry))),
      onSnapshot(collection(db, basePath, 'savingsGoals'), (snap) => setSavingsGoals(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SavingsGoal))),
      onSnapshot(collection(db, basePath, 'debts'), (snap) => setDebts(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Debt)))
    ];

    return () => unsubs.forEach(u => u());
  }, [user]);

  const todayCycle = useMemo(() => getActivePeriod(new Date(), settings.cutoffs), [settings.cutoffs]);
  const viewedCycle = useMemo(() => getActivePeriod(viewedCycleAnchor, settings.cutoffs), [viewedCycleAnchor, settings.cutoffs]);

  const cycleStats = useMemo(() => {
    const startStr = toYYYYMMDD(viewedCycle.start);
    const endStr = toYYYYMMDD(viewedCycle.end);
    
    let expectedIncome = 0;
    let cycleFixed = 0;
    let currDate = new Date(viewedCycle.start);
    const endDate = new Date(viewedCycle.end);
    
    while(currDate <= endDate) {
      const currStr = toYYYYMMDD(currDate);
      const isActualWorkDay = getBaseWorkDay(currStr, currDate, settings) && !isAbsent(currStr, exceptions);
      
      fixedExpenses.forEach(exp => {
        if (exceptions.some(ex => ex.date === currStr && ex.targetId === exp.id && ex.type === 'expense_skip')) return;
        if (exp.workingDaysOnly && !isActualWorkDay) return;
        if (exp.frequency === 'daily' || (exp.frequency === 'monthly' && Number(exp.date) === currDate.getDate())) {
          cycleFixed += Number(exp.amount);
        }
      });

      incomeRules.forEach(inc => {
        if (exceptions.some(ex => ex.date === currStr && ex.targetId === inc.id && ex.type === 'income_skip')) return;
        if (inc.workingDaysOnly && !isActualWorkDay) return;
        if (inc.frequency === 'daily' || (inc.frequency === 'monthly' && Number(inc.date) === currDate.getDate())) {
          expectedIncome += Number(inc.amount);
        }
      });

      currDate.setDate(currDate.getDate() + 1);
    }

    let cycleManualExpenses = expenses.filter(e => e.date >= startStr && e.date <= endStr).reduce((sum, e) => sum + Number(e.amount), 0);
    let cycleReceivedIncome = incomes.filter(i => i.date >= startStr && i.date <= endStr).reduce((sum, i) => sum + Number(i.amount), 0);
    let manualExpected = incomes.filter(i => !i.isReceived && i.date >= startStr && i.date <= endStr).reduce((sum, i) => sum + Number(i.amount), 0);
    expectedIncome += manualExpected;

    const totalExpenses = cycleFixed + cycleManualExpenses;
    const availableReality = cycleReceivedIncome - totalExpenses;
    const healthPercent = expectedIncome > 0 ? (availableReality / expectedIncome) * 100 : 0;
    
    let healthState: CycleStats['healthState'] = 'safe';
    if (healthPercent <= (settings.healthThresholds?.danger || 20) || availableReality < 0) healthState = 'danger';
    else if (healthPercent <= (settings.healthThresholds?.caution || 50)) healthState = 'caution';

    return { 
      expectedIncome, cycleReceivedIncome, cycleFixed, cycleManualExpenses, 
      totalExpenses, availableReality, healthPercent, healthState, startStr, endStr 
    };
  }, [settings, expenses, fixedExpenses, incomeRules, incomes, exceptions, viewedCycle]);

  const globalDebtTotal = useMemo(() => {
    return debts.reduce((total, debt) => {
      const payments = expenses.filter(e => e.linkedType === 'debt' && e.linkedTo === debt.id).reduce((sum, e) => sum + Number(e.amount), 0);
      const balance = Number(debt.initialAmount) - payments;
      return total + Math.max(0, balance);
    }, 0);
  }, [debts, expenses]);

  const handlePrevCycle = () => {
    const prevAnchor = new Date(viewedCycle.start.getTime() - 86400000);
    setViewedCycleAnchor(prevAnchor);
    setCalendarMonth(prevAnchor);
  };
  const handleNextCycle = () => {
    const nextAnchor = new Date(viewedCycle.end.getTime() + 86400000);
    setViewedCycleAnchor(nextAnchor);
    setCalendarMonth(nextAnchor);
  };
  const handleCurrentCycle = () => {
    setViewedCycleAnchor(new Date());
    setCalendarMonth(new Date());
  };
  const isViewingCurrentCycle = viewedCycle.start.getTime() === todayCycle.start.getTime();

  if (!firebaseReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 p-6 text-center">
        <div>
          <p className="font-bold text-gray-700 mb-1">Firebase isn't configured</p>
          <p className="text-sm max-w-sm">Add your Firebase project's credentials as VITE_FIREBASE_* environment variables (see .env.example), then restart the dev server.</p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading Ataraxia...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center p-6 gap-4">
        <Briefcase className="w-10 h-10 text-emerald-500" />
        <div>
          <h1 className="text-xl font-bold text-gray-800">Ataraxia</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xs">You're signed out. Sign in with Google to see your synced budget.</p>
        </div>
        {authError && <p className="text-sm text-red-600">{authError}</p>}
        <button onClick={handleGoogleSignIn} className="flex items-center gap-2 bg-white border border-gray-300 shadow-sm px-4 py-2 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
          <GoogleGIcon className="w-5 h-5" /> Continue with Google
        </button>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: THEME_STYLES }} />
      <div className={`theme-wrapper atx-container pb-20`} data-budget-state={cycleStats.healthState}>
        
        {}
        <header className="atx-card border-b sticky top-0 z-10 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-[var(--atx-accent)] transition-colors" /> Ataraxia
            </h1>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-3">
                <div className="bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-rose-500" />
                  <span className="text-xs font-bold text-rose-700">Debt: {formatPHP(globalDebtTotal)}</span>
                </div>
              </div>

              <AuthControl user={user} onSignIn={handleGoogleSignIn} onSignOut={handleSignOut} />

              <div className="flex space-x-1 sm:space-x-2">
                <NavButton icon={CalendarIcon} label="Dashboard" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
                <NavButton icon={Target} label="Savings" active={activeTab === 'savings'} onClick={() => setActiveTab('savings')} />
                <NavButton icon={PieChartIcon} label="Insights" active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} />
                <NavButton icon={Settings} label="Config" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
              </div>
            </div>
          </div>
        </header>

        {authError && (
          <div className="max-w-5xl mx-auto px-4 pt-3">
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg flex items-center justify-between gap-3">
              <span>{authError}</span>
              <button onClick={() => setAuthError(null)} className="text-red-400 hover:text-red-600 shrink-0"><X className="w-4 h-4"/></button>
            </div>
          </div>
        )}

        <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {activeTab === 'calendar' && (
            <div className="animate-in fade-in duration-300 space-y-6">
              
              <div className="sm:hidden mb-2 bg-rose-50 px-3 py-2 rounded-lg border border-rose-100 flex items-center justify-between">
                <span className="text-xs font-bold text-rose-700 flex items-center gap-2"><CreditCard className="w-4 h-4" /> Total Outstanding Debt</span>
                <span className="text-sm font-bold text-rose-700">{formatPHP(globalDebtTotal)}</span>
              </div>

              {/* Cycle Navigation */}
              <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-[var(--atx-border)] gap-3">
                <button onClick={handlePrevCycle} className="w-full sm:w-auto flex justify-center items-center gap-1 text-sm font-semibold text-gray-600 hover:text-[var(--atx-accent)] hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Prev Cycle
                </button>
                <div className="flex flex-col items-center">
                  <span className="text-sm font-bold text-gray-900 tracking-wide">
                    {viewedCycle.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {viewedCycle.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {!isViewingCurrentCycle && (
                    <button onClick={handleCurrentCycle} className="text-[10px] uppercase font-bold text-[var(--atx-accent)] bg-[var(--atx-accent-light)] px-2 py-0.5 rounded-full mt-1 flex items-center gap-1 hover:brightness-95">
                      <History className="w-3 h-3" /> Back to Current
                    </button>
                  )}
                </div>
                <button onClick={handleNextCycle} className="w-full sm:w-auto flex justify-center items-center gap-1 text-sm font-semibold text-gray-600 hover:text-[var(--atx-accent)] hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors">
                  Next Cycle <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <StatsHeader stats={cycleStats} isCurrent={isViewingCurrentCycle} />
              
              <MergedCalendarView 
                calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
                settings={settings} expenses={expenses} fixedExpenses={fixedExpenses} 
                incomes={incomes} incomeRules={incomeRules} exceptions={exceptions}
                viewedStart={cycleStats.startStr} viewedEnd={cycleStats.endStr}
                todayStart={toYYYYMMDD(todayCycle.start)} todayEnd={toYYYYMMDD(todayCycle.end)}
                openDayModal={(d) => { setSelectedDateStr(d); setIsModalOpen(true); }}
                showIncome={showIncome} setShowIncome={setShowIncome}
                showExpenses={showExpenses} setShowExpenses={setShowExpenses}
              />
            </div>
          )}

          {activeTab === 'savings' && (
            <SavingsDebtView 
              user={user} db={db} appId={appId}
              savingsGoals={savingsGoals} debts={debts} expenses={expenses}
            />
          )}
          
          {activeTab === 'insights' && (
            <InsightsView expenses={expenses} incomes={incomes} stats={cycleStats} />
          )}
          
          {activeTab === 'settings' && (
            <SettingsView 
              settings={settings} user={user} db={db} appId={appId} 
              fixedExpenses={fixedExpenses} incomeRules={incomeRules} 
            />
          )}
        </main>

        <DayDetailsModal 
          isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setTimeout(() => setSelectedDateStr(null), 300); }}
          dateStr={selectedDateStr}
          expenses={expenses} fixedExpenses={fixedExpenses}
          incomes={incomes} incomeRules={incomeRules}
          exceptions={exceptions} settings={settings}
          savingsGoals={savingsGoals} debts={debts}
          user={user} db={db} appId={appId} 
        />
      </div>
    </>
  );
}

function NavButton({ icon: Icon, label, active, onClick }: NavButtonProps) {
  return (
    <button onClick={onClick} title={label} className={`p-2 rounded-lg transition-all flex items-center gap-1.5 ${active ? 'bg-[var(--atx-accent-light)] text-[var(--atx-accent)] font-semibold shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
      <Icon className="w-5 h-5" />
      <span className="text-xs hidden md:inline-block">{label}</span>
    </button>
  );
}

function GoogleGIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
    </svg>
  );
}

function AuthControl({ user, onSignIn, onSignOut }: { user: User | null; onSignIn: () => void; onSignOut: () => void; }) {
  if (!user || user.isAnonymous) {
    return (
      <button onClick={onSignIn} className="flex items-center gap-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 border border-gray-200 px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors">
        <GoogleGIcon className="w-4 h-4" />
        <span className="hidden sm:inline">Sign in with Google</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {user.photoURL ? (
        <img src={user.photoURL} alt={user.displayName || 'Account'} referrerPolicy="no-referrer" className="w-7 h-7 rounded-full border border-gray-200" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
          {(user.displayName || user.email || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <span className="hidden md:inline text-sm font-semibold text-gray-700 max-w-[120px] truncate">{user.displayName || user.email}</span>
      <button onClick={onSignOut} title="Sign out" className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

function StatsHeader({ stats, isCurrent }: StatsHeaderProps) {
  const { expectedIncome, cycleReceivedIncome, totalExpenses, availableReality, healthState } = stats;

  return (
    <div className="space-y-4">
      {(healthState === 'caution' || healthState === 'danger') && isCurrent && (
        <div className={`p-3 rounded-lg flex items-start gap-3 border shadow-sm ${healthState === 'danger' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">{healthState === 'danger' ? 'Danger Zone: Budget Low' : 'Caution: Monitoring Spending'}</h4>
            <p className="text-xs mt-0.5">Your actual available budget (received minus spent) is running low relative to expectations.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard title="Expected Income" value={expectedIncome} icon={<Wallet className="w-4 h-4 text-gray-400"/>} className="border-l-4 border-l-gray-300" />
        <StatCard title="Received Income" value={cycleReceivedIncome} icon={<ArrowDownToLine className="w-4 h-4 text-[var(--status-safe)]"/>} className="border-l-4 border-l-[var(--status-safe)]" />
        <StatCard title="Total Spent" value={totalExpenses} icon={<ArrowUpFromLine className="w-4 h-4 text-[var(--status-danger)]"/>} className="border-l-4 border-l-[var(--status-danger)]" />
        <StatCard title="Available (Reality)" value={availableReality} icon={<CheckCircle2 className="w-4 h-4 text-[var(--atx-accent)]"/>} className="border-l-4 border-l-[var(--atx-accent)] md:col-span-1 col-span-2" highlight />
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, className = "", highlight = false }: StatCardProps) {
  return (
    <div className={`atx-card p-4 rounded-xl shadow-sm flex flex-col justify-between h-full ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <p className="text-xs text-[var(--atx-text-muted)] font-medium uppercase tracking-wide">{title}</p>
        {icon}
      </div>
      <p className={`text-xl sm:text-2xl font-bold truncate ${highlight ? (value < 0 ? 'text-[var(--status-danger)]' : 'text-[var(--atx-accent)]') : 'text-gray-800'}`}>
        {formatPHP(value)}
      </p>
    </div>
  );
}

function MergedCalendarView({ 
  calendarMonth, setCalendarMonth, settings, expenses, fixedExpenses, incomes, incomeRules, exceptions,
  viewedStart, viewedEnd, todayStart, todayEnd, openDayModal, showIncome, setShowIncome, showExpenses, setShowExpenses
}: MergedCalendarViewProps) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const todayStr = toYYYYMMDD(new Date());

  const days: (Date | null)[] = Array<Date | null>(firstDayOfWeek).fill(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

  return (
    <div className="atx-card rounded-xl shadow-sm overflow-hidden border border-[var(--atx-border)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-b border-[var(--atx-border)] bg-gray-50 gap-4">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-gray-500"/>
          {calendarMonth.toLocaleString('default', { month: 'long' })} {year}
        </h2>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-2 text-sm bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
            <button onClick={() => setShowIncome(!showIncome)} className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${showIncome ? 'bg-emerald-50 text-emerald-700 font-bold' : 'text-gray-400 hover:bg-gray-50'}`}>
              <HandCoins className="w-3.5 h-3.5"/> Income
            </button>
            <div className="w-px h-4 bg-gray-200"></div>
            <button onClick={() => setShowExpenses(!showExpenses)} className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${showExpenses ? 'bg-rose-50 text-rose-700 font-bold' : 'text-gray-400 hover:bg-gray-50'}`}>
              <ArrowUpFromLine className="w-3.5 h-3.5"/> Expenses
            </button>
          </div>

          <div className="flex space-x-1 bg-white rounded-lg shadow-sm border border-gray-200 p-1">
            <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))} className="p-1.5 rounded hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))} className="p-1.5 rounded hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-7 border-b border-[var(--atx-border)] bg-white">
        {DAYS_OF_WEEK.map(day => (
          <div key={day.id} className="py-2.5 text-center text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">
            {day.short}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr bg-gray-100 gap-[1px]">
        {days.map((dateObj, idx) => {
          if (!dateObj) return <div key={`empty-${idx}`} className="bg-white min-h-[100px] sm:min-h-[120px]" />;

          const dateStr = toYYYYMMDD(dateObj);
          const dayOfMonth = dateObj.getDate();
          const baseWorkDay = getBaseWorkDay(dateStr, dateObj, settings);
          const isDayAbsent = isAbsent(dateStr, exceptions);
          const isActualWorkDay = baseWorkDay && !isDayAbsent;
          
          let expTotal = 0;
          let incTotal = 0;
          
          // Accumulate Expenses
          if (showExpenses) {
            fixedExpenses.forEach(item => {
              if (exceptions.some(ex => ex.date === dateStr && ex.targetId === item.id && ex.type === 'expense_skip')) return;
              if (item.workingDaysOnly && !isActualWorkDay) return;
              if (item.frequency === 'daily' || (item.frequency === 'monthly' && Number(item.date) === dayOfMonth)) expTotal += Number(item.amount);
            });
            expenses.filter(e => e.date === dateStr).forEach(e => expTotal += Number(e.amount));
          }

          // Accumulate Income
          if (showIncome) {
            incomeRules.forEach(item => {
              if (exceptions.some(ex => ex.date === dateStr && ex.targetId === item.id && ex.type === 'income_skip')) return;
              if (item.workingDaysOnly && !isActualWorkDay) return;
              if (item.frequency === 'daily' || (item.frequency === 'monthly' && Number(item.date) === dayOfMonth)) incTotal += Number(item.amount);
            });
            incomes.filter(i => i.date === dateStr).forEach(i => incTotal += Number(i.amount));
          }

          const isViewedCycle = dateStr >= viewedStart && dateStr <= viewedEnd;
          const isTodayCycle = dateStr >= todayStart && dateStr <= todayEnd;
          const isFuture = dateStr > todayStr;
          
          let bgClass = 'bg-white opacity-50 grayscale-[30%]'; // Default out-of-cycle
          if (isViewedCycle) {
             bgClass = isTodayCycle ? 'bg-[var(--atx-today-band)]' : 'bg-[var(--atx-view-band)]';
          }

          return (
            <div 
              key={dateStr} onClick={() => openDayModal(dateStr)}
              className={`relative min-h-[100px] sm:min-h-[120px] p-1.5 cursor-pointer flex flex-col group border border-transparent hover:border-[var(--atx-accent)] transition-all overflow-hidden
                ${bgClass}
                ${dateStr === viewedStart ? 'rounded-tl-xl rounded-bl-xl' : ''}
                ${dateStr === viewedEnd ? 'rounded-tr-xl rounded-br-xl' : ''}
              `}
            >
              <div className="flex justify-between items-start z-10 mb-1">
                <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-all
                  ${dateStr === todayStr ? `ring-2 ring-[var(--atx-accent)] ring-offset-1 bg-[var(--atx-accent)] text-white` : isViewedCycle ? 'text-gray-900' : 'text-gray-400'}
                `}>
                  {dayOfMonth}
                </div>
                
                <div className="flex flex-col items-end gap-0.5">
                  {!baseWorkDay && <CalendarOff className="w-3 h-3 text-gray-400" aria-label="Scheduled Off Day"/>}
                  {isDayAbsent && <div className="w-3.5 h-3.5 rounded bg-red-100 flex items-center justify-center"><X className="w-2.5 h-2.5 text-red-500" aria-label="Marked Absent"/></div>}
                </div>
              </div>

              <div className="flex-1 mt-auto z-10 flex flex-col justify-end gap-1 overflow-y-auto hidden-scrollbar">
                {showIncome && incTotal > 0 && (
                  <div className={`text-[10px] sm:text-xs font-bold rounded px-1 py-0.5 text-center truncate ${isFuture && !incomes.some(i=>i.date===dateStr && i.isReceived) ? 'bg-emerald-50 text-emerald-500 border border-emerald-200 border-dashed' : 'bg-emerald-100 text-emerald-700'}`}>
                    +{formatPHP(incTotal)}
                  </div>
                )}
                {showExpenses && expTotal > 0 && (
                  <div className={`text-[10px] sm:text-xs font-bold rounded px-1 py-0.5 text-center truncate ${isFuture && !expenses.some(e=>e.date===dateStr) ? 'bg-rose-50 text-rose-400 border border-rose-200 border-dashed' : 'bg-rose-100 text-rose-700'}`}>
                    -{formatPHP(expTotal)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <style dangerouslySetInnerHTML={{__html: `.hidden-scrollbar::-webkit-scrollbar { display: none; } .hidden-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}} />
    </div>
  );
}

function SavingsDebtView({ user, db, appId, savingsGoals, debts, expenses }: SavingsDebtViewProps) {
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [debtName, setDebtName] = useState('');
  const [debtInitial, setDebtInitial] = useState('');

  const handleAddGoal = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !db || !goalName || !goalTarget) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'savingsGoals'), { name: goalName, targetAmount: parseFloat(goalTarget), createdAt: new Date().toISOString() });
    setGoalName(''); setGoalTarget('');
  };

  const handleAddDebt = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !db || !debtName || !debtInitial) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'debts'), { name: debtName, initialAmount: parseFloat(debtInitial), createdAt: new Date().toISOString() });
    setDebtName(''); setDebtInitial('');
  };

  const deleteItem = async (coll: 'savingsGoals' | 'debts', id: string) => {
    if(!user || !db) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, coll, id));
  };

  // Compute progress/balances based on linked expenses
  const goalsWithProgress = savingsGoals.map(g => {
    const saved = expenses.filter(e => e.linkedType === 'goal' && e.linkedTo === g.id).reduce((s, e) => s + Number(e.amount), 0);
    return { ...g, saved, pct: Math.min(100, (saved / (Number(g.targetAmount) || 1)) * 100) };
  });

  const debtsWithBalance = debts.map(d => {
    const paid = expenses.filter(e => e.linkedType === 'debt' && e.linkedTo === d.id).reduce((s, e) => s + Number(e.amount), 0);
    const balance = Math.max(0, Number(d.initialAmount) - paid);
    return { ...d, paid, balance, pct: Math.min(100, (paid / (Number(d.initialAmount) || 1)) * 100) };
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-300">
      {/* Goals Section */}
      <div className="atx-card p-5 rounded-xl shadow-sm border-t-4 border-t-emerald-400">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-emerald-800"><Target className="w-5 h-5"/> Savings Goals</h2>
        <form onSubmit={handleAddGoal} className="flex flex-col sm:flex-row gap-2 mb-6 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
          <input type="text" placeholder="Goal Name" required value={goalName} onChange={e=>setGoalName(e.target.value)} className="flex-1 p-2 rounded border border-gray-200 text-sm outline-none focus:border-emerald-400" />
          <input type="number" placeholder="Target ₱" required step="0.01" value={goalTarget} onChange={e=>setGoalTarget(e.target.value)} className="w-full sm:w-28 p-2 rounded border border-gray-200 text-sm outline-none focus:border-emerald-400" />
          <button type="submit" className="bg-emerald-500 text-white p-2 rounded font-bold hover:bg-emerald-600 transition-colors"><Plus className="w-5 h-5 mx-auto"/></button>
        </form>

        <div className="space-y-4">
          {goalsWithProgress.length === 0 && <p className="text-sm text-gray-500 italic text-center py-4">No savings goals set.</p>}
          {goalsWithProgress.map(g => (
            <div key={g.id} className="bg-white border border-gray-100 p-4 rounded-lg shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-bold text-gray-800">{g.name}</h4>
                  <p className="text-[11px] text-gray-500">Target: {formatPHP(g.targetAmount)}</p>
                </div>
                <button onClick={()=>deleteItem('savingsGoals', g.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
              </div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-emerald-600">{formatPHP(g.saved)}</span>
                <span className="text-gray-400">{g.pct.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-emerald-400 h-2 rounded-full transition-all" style={{width: `${g.pct}%`}}></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Debts Section */}
      <div className="atx-card p-5 rounded-xl shadow-sm border-t-4 border-t-rose-400">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-rose-800"><CreditCard className="w-5 h-5"/> Debts & Loans</h2>
        <form onSubmit={handleAddDebt} className="flex flex-col sm:flex-row gap-2 mb-6 bg-rose-50 p-3 rounded-lg border border-rose-100">
          <input type="text" placeholder="Debt Name" required value={debtName} onChange={e=>setDebtName(e.target.value)} className="flex-1 p-2 rounded border border-gray-200 text-sm outline-none focus:border-rose-400" />
          <input type="number" placeholder="Owed ₱" required step="0.01" value={debtInitial} onChange={e=>setDebtInitial(e.target.value)} className="w-full sm:w-28 p-2 rounded border border-gray-200 text-sm outline-none focus:border-rose-400" />
          <button type="submit" className="bg-rose-500 text-white p-2 rounded font-bold hover:bg-rose-600 transition-colors"><Plus className="w-5 h-5 mx-auto"/></button>
        </form>

        <div className="space-y-4">
          {debtsWithBalance.length === 0 && <p className="text-sm text-gray-500 italic text-center py-4">No active debts.</p>}
          {debtsWithBalance.map(d => (
            <div key={d.id} className="bg-white border border-gray-100 p-4 rounded-lg shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-bold text-gray-800">{d.name}</h4>
                  <p className="text-[11px] text-gray-500">Initial: {formatPHP(d.initialAmount)}</p>
                </div>
                <button onClick={()=>deleteItem('debts', d.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
              </div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-gray-500">Paid: {formatPHP(d.paid)}</span>
                <span className="text-rose-600">Left: {formatPHP(d.balance)}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-rose-400 h-2 rounded-full transition-all" style={{width: `${d.pct}%`}}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Reusing logic from the updated constraints, merging expense and income inputs into one modal interface

function DayDetailsModal({ 
  isOpen, onClose, dateStr, expenses, fixedExpenses, incomes, incomeRules, exceptions, settings,
  savingsGoals, debts, user, db, appId 
}: DayDetailsModalProps) {
  const [subTab, setSubTab] = useState<'expense' | 'income'>('expense'); // 'expense' or 'income'
  const [amount, setAmount] = useState('');
  const [descName, setDescName] = useState('');
  const [category, setCategory] = useState('');
  const [linkedTo, setLinkedTo] = useState(''); // "goal_id" or "debt_id" or ""
  
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null); 

  useEffect(() => { if (isOpen) { setSubTab('expense'); setAmount(''); setDescName(''); setCategory(''); setLinkedTo(''); } }, [isOpen]);

  if (!isOpen || !dateStr) return null;

  const dateObj = new Date(dateStr);
  const baseWorkDay = getBaseWorkDay(dateStr, dateObj, settings);
  const isDayAbsent = isAbsent(dateStr, exceptions);

  const dailyFixedExp = fixedExpenses.filter(exp => (exp.frequency === 'daily' || (exp.frequency === 'monthly' && Number(exp.date) === dateObj.getDate())));
  const dailyFixedInc = incomeRules.filter(inc => (inc.frequency === 'daily' || (inc.frequency === 'monthly' && Number(inc.date) === dateObj.getDate())));
  const customExp = expenses.filter(e => e.date === dateStr);
  const customInc = incomes.filter(i => i.date === dateStr);

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!amount || !descName || !user || !db) return;

    let linkedType: LinkedType = null;
    let finalLinkedTo: string | null = null;
    if (subTab === 'expense' && linkedTo) {
      const [type, id] = linkedTo.split('_');
      linkedType = type === 'goal' || type === 'debt' ? type : null;
      finalLinkedTo = id;
    }

    try {
      const collName = subTab === 'expense' ? 'expenses' : 'incomes';
      const payload = subTab === 'expense' 
        ? { date: dateStr, amount: parseFloat(amount), description: descName, category: category || DEFAULT_EXPENSE_CATEGORIES[0], linkedType, linkedTo: finalLinkedTo, createdAt: new Date().toISOString() }
        : { date: dateStr, amount: parseFloat(amount), name: descName, category: category || DEFAULT_INCOME_CATEGORIES[0], isReceived: true, createdAt: new Date().toISOString() };
      
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, collName), payload);
      setAmount(''); setDescName(''); setLinkedTo('');
    } catch (err) { console.error(err); }
  };

  const executeAction = async () => {
    if (!confirmData || !user || !db) return;
    try {
      if (confirmData.action === 'delete') {
        const coll = confirmData.type === 'expense' ? 'expenses' : 'incomes';
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, coll, confirmData.data.id));
      } else if (confirmData.action === 'skip') {
        const skipType = confirmData.type === 'fixedExp' ? 'expense_skip' : 'income_skip';
        await addDoc(
          collection(db, 'artifacts', appId, 'users', user.uid, 'exceptions'),
          { date: dateStr, type: skipType, targetId: confirmData.data.id }
        );
      } else if (confirmData.action === 'toggleAbsent') {
        if (isDayAbsent) {
          const docFind = exceptions.find(e => e.date === dateStr && e.type === 'absent');
          if (docFind) {
            await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'exceptions', docFind.id));
          }
        } else {
          await addDoc(
            collection(db, 'artifacts', appId, 'users', user.uid, 'exceptions'),
            { date: dateStr, type: 'absent', targetId: null }
          );
        }
      } else if (confirmData.action === 'markReceived') {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'incomes'), {
          date: dateStr,
          amount: confirmData.data.amount,
          name: confirmData.data.name,
          category: confirmData.data.category,
          ruleId: confirmData.data.id,
          isReceived: true,
          createdAt: new Date().toISOString(),
        });
      }
      setConfirmData(null);
    } catch (err) { console.error(err); }
  };

  const getConfirmationDetails = (): ConfirmDetails | null => {
    if (!confirmData) return null;
    if (confirmData.action === 'delete') return { title: 'Delete Entry?', message: 'Permanently remove this manual record?', confirmText: 'Delete', variant: 'danger' };
    if (confirmData.action === 'skip') return { title: 'Skip Schedule?', message: `Skip "${confirmData.data.name}" for this date only?`, confirmText: 'Skip Today', variant: 'warning' };
    if (confirmData.action === 'toggleAbsent') return { 
      title: isDayAbsent ? 'Remove Absence?' : 'Mark as Absent?', 
      message: isDayAbsent ? 'Restore working-days-only entries for this date?' : 'Cancel all working-days-only expenses and incomes for this date.',
      confirmText: isDayAbsent ? 'Restore' : 'Mark Absent', variant: isDayAbsent ? 'primary' : 'warning'
    };
    if (confirmData.action === 'markReceived') return { title: 'Mark Received?', message: `Confirm receipt of ${formatPHP(confirmData.data.amount)} from ${confirmData.data.name}?`, confirmText: 'Confirm', variant: 'primary' };
    return null;
  };

  const cDetails = getConfirmationDetails();

  return (
    <>
      <div className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
        
        <div className={`relative bg-gray-50 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[95vh] transition-transform duration-300 ease-out transform ${isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-8'}`}>
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-white rounded-t-2xl">
            <div>
              <h3 className="font-bold text-gray-900 text-lg">{dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
              <div className="flex items-center gap-2 mt-1">
                {!baseWorkDay && <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">Scheduled Off Day</span>}
                {baseWorkDay && isDayAbsent && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Marked Absent</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {baseWorkDay && (
                <button onClick={() => setConfirmData({ action: 'toggleAbsent' })} className={`text-[11px] px-2.5 py-1.5 rounded-lg font-bold border transition-colors ${isDayAbsent ? 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50' : 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100'}`}>
                  {isDayAbsent ? 'Remove Absence' : 'Mark Absent'}
                </button>
              )}
              <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"><X className="w-5 h-5" /></button>
            </div>
          </div>

          <div className="flex bg-white border-b border-gray-200 p-2 gap-2">
            <button onClick={() => setSubTab('expense')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${subTab === 'expense' ? 'bg-rose-50 text-rose-700 border border-rose-200 shadow-sm' : 'bg-transparent text-gray-500 hover:bg-gray-50'}`}>Expense</button>
            <button onClick={() => setSubTab('income')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${subTab === 'income' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm' : 'bg-transparent text-gray-500 hover:bg-gray-50'}`}>Income</button>
          </div>

          <div className="p-4 overflow-y-auto space-y-6 flex-1 bg-gray-50">
            {/* Expected / Scheduled Items */}
            <div>
              <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                {subTab === 'expense' ? 'Automated Expenses' : 'Expected Income'}
              </h4>
              
              {subTab === 'expense' ? (
                dailyFixedExp.length === 0 ? <p className="text-xs text-gray-500 italic px-2">None today.</p> : (
                  <div className="space-y-2">
                    {dailyFixedExp.map(exp => {
                      const inactive = exceptions.some(ex => ex.date === dateStr && ex.targetId === exp.id && ex.type === 'expense_skip') || (exp.workingDaysOnly && (!baseWorkDay || isDayAbsent));
                      return (
                        <div key={exp.id} className={`flex justify-between items-center p-3 rounded-lg border text-sm transition-all ${inactive ? 'bg-gray-100 border-gray-200 opacity-60' : 'bg-white border-gray-200 shadow-sm'}`}>
                          <span className={`font-semibold ${inactive ? 'line-through text-gray-500' : 'text-gray-800'}`}>{exp.name}</span>
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-rose-500">-{formatPHP(exp.amount)}</span>
                            {!inactive && <button onClick={() => setConfirmData({ type: 'fixedExp', action: 'skip', data: exp })} className="text-[10px] text-orange-500 border border-orange-200 hover:bg-orange-50 px-2 py-1 rounded">Skip</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                dailyFixedInc.length === 0 ? <p className="text-xs text-gray-500 italic px-2">None today.</p> : (
                  <div className="space-y-2">
                    {dailyFixedInc.map(inc => {
                      const inactive = exceptions.some(ex => ex.date === dateStr && ex.targetId === inc.id && ex.type === 'income_skip') || (inc.workingDaysOnly && (!baseWorkDay || isDayAbsent));
                      const received = customInc.some(ci => ci.ruleId === inc.id && ci.isReceived);
                      return (
                        <div key={inc.id} className={`flex justify-between items-center p-3 rounded-lg border text-sm transition-all ${inactive ? 'bg-gray-100 border-gray-200 opacity-60' : received ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200 shadow-sm'}`}>
                          <span className={`font-semibold ${inactive ? 'line-through text-gray-500' : 'text-gray-800'}`}>{inc.name}</span>
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-emerald-600">+{formatPHP(inc.amount)}</span>
                            {!inactive && !received && <button onClick={() => setConfirmData({ type: 'fixedInc', action: 'markReceived', data: inc })} className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-2.5 py-1 rounded font-bold shadow-sm">Receive</button>}
                            {!inactive && !received && <button onClick={() => setConfirmData({ type: 'fixedInc', action: 'skip', data: inc })} className="text-[10px] text-gray-400 hover:text-orange-500 px-1">Skip</button>}
                            {received && <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Done</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* Manual Entries */}
            <div>
              <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Logged Records</h4>
              <div className="space-y-2">
                {(subTab === 'expense' ? customExp : customInc.filter(i => !i.ruleId)).map(item => (
                  <div key={item.id} className="flex justify-between items-center bg-white border border-gray-200 p-3 rounded-lg shadow-sm">
                    <div>
                      <p className="text-gray-800 font-semibold text-sm">{item.description || item.name}</p>
                      <p className="text-[10px] text-gray-400 uppercase mt-0.5">{item.category} {item.linkedTo && `• Linked`}</p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`font-bold ${subTab === 'expense' ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {subTab === 'expense' ? '-' : '+'}{formatPHP(item.amount)}
                      </span>
                      <button onClick={() => setConfirmData({ type: subTab, action: 'delete', data: item })} className="text-gray-300 hover:text-red-500 p-1 bg-gray-50 rounded"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
                {(subTab === 'expense' ? customExp : customInc).length === 0 && <p className="text-xs text-gray-500 italic px-2">No manual records.</p>}
              </div>
            </div>

            {/* Add New Form */}
            <form onSubmit={handleAdd} className={`p-4 rounded-xl border shadow-sm ${subTab === 'expense' ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <h4 className={`text-sm font-bold mb-3 flex items-center gap-2 ${subTab === 'expense' ? 'text-rose-700' : 'text-emerald-700'}`}>
                <Plus className="w-4 h-4"/> Log New {subTab === 'expense' ? 'Expense' : 'Income'}
              </h4>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="text" placeholder={subTab === 'expense' ? 'Description' : 'Source'} required value={descName} onChange={e => setDescName(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-1 focus:ring-gray-400" />
                  <input type="number" placeholder="Amount" required step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} className="w-full sm:w-28 p-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-1 focus:ring-gray-400" />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select value={category} onChange={e => setCategory(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm bg-white outline-none">
                    <option value="" disabled>Select Category</option>
                    {(subTab === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  
                  {subTab === 'expense' && (savingsGoals.length > 0 || debts.length > 0) && (
                    <select value={linkedTo} onChange={e => setLinkedTo(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm bg-white outline-none">
                      <option value="">No Link (Regular Expense)</option>
                      {savingsGoals.length > 0 && <optgroup label="Savings Goals">{savingsGoals.map(g => <option key={g.id} value={`goal_${g.id}`}>Contribution: {g.name}</option>)}</optgroup>}
                      {debts.length > 0 && <optgroup label="Debts">{debts.map(d => <option key={d.id} value={`debt_${d.id}`}>Payment: {d.name}</option>)}</optgroup>}
                    </select>
                  )}
                  <button type="submit" className={`text-white px-5 py-2 rounded-lg text-sm font-bold shadow-sm ${subTab === 'expense' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      <ConfirmModal 
        isOpen={!!confirmData} {...(cDetails ?? { title: '', message: '', confirmText: 'Confirm', variant: 'danger' })}
        onConfirm={executeAction} onCancel={() => setConfirmData(null)}
      />
    </>
  );
}

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = "Confirm", variant = "danger" }: ConfirmModalProps) {
  if (!isOpen) return null;
  const btnClass = variant === "danger" ? "bg-red-600 hover:bg-red-700" : variant === "warning" ? "bg-orange-500 hover:bg-orange-600" : "bg-[var(--atx-accent)] hover:bg-[var(--atx-accent-hover)]";
  
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel}></div>
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xs sm:max-w-sm p-6 transform animate-in zoom-in-95 duration-200">
        <h3 className="font-bold text-lg mb-2 text-gray-900">{title}</h3>
        <p className="text-gray-600 text-sm mb-6">{message}</p>
        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-bold text-white rounded-lg shadow-sm ${btnClass}`}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

function InsightsView({ expenses, incomes, stats }: InsightsViewProps) {
  const [metricType, setMetricType] = useState('expense'); 
  
  const chartData = useMemo(() => {
    const dataMap: Record<string, number> = {};
    const categories = metricType === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES;
    const sourceData = metricType === 'expense' ? expenses : incomes;
    categories.forEach(c => dataMap[c] = 0);
    
    sourceData.forEach(item => {
      if (item.date >= stats.startStr && item.date <= stats.endStr) {
        dataMap[item.category || 'Other'] = (dataMap[item.category || 'Other'] || 0) + Number(item.amount);
      }
    });

    return Object.keys(dataMap).map(key => ({ name: key, value: dataMap[key] })).filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  }, [expenses, incomes, stats, metricType]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

  const handleExport = () => {
    const csvRows = ["Type,Date,Description,Category,Amount"];
    expenses.forEach(e => csvRows.push(`Expense,${e.date},"${e.description}",${e.category || 'Other'},${e.amount}`));
    incomes.forEach(i => csvRows.push(`Income,${i.date},"${i.name}",${i.category || 'Other'},${i.amount}`));
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csvRows.join("\n"));
    link.download = `Ataraxia_Export.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="atx-card p-6 rounded-xl shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Cycle Breakdown</h2>
            <p className="text-xs text-gray-500 mt-1">Based on viewed cycle: {stats.startStr} to {stats.endStr}</p>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button onClick={() => setMetricType('expense')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${metricType === 'expense' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Expenses</button>
            <button onClick={() => setMetricType('income')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${metricType === 'income' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Income</button>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <PieChartIcon className="w-10 h-10 mb-2 opacity-20"/>
            <p className="text-sm italic">No data to display for this cycle.</p>
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={4} dataKey="value">
                  {chartData.map((_, i) => <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <RechartsTooltip formatter={(val: unknown) => formatPHP(Number(val ?? 0))} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}/>
                <Legend verticalAlign="bottom" height={36} iconType="circle"/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="atx-card p-6 rounded-xl flex justify-between items-center shadow-sm">
        <div>
          <h3 className="font-bold text-gray-900">Export All Data</h3>
          <p className="text-xs text-gray-500">Download complete transaction history (CSV).</p>
        </div>
        <button onClick={handleExport} className="bg-gray-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-800 transition-all flex items-center gap-2"><Download className="w-4 h-4" /> CSV</button>
      </div>
    </div>
  );
}

function SettingsView({ settings, user, db, appId, fixedExpenses, incomeRules }: SettingsViewProps) {
  const [localConfig, setLocalConfig] = useState<AppSettings>(settings);
  const isDirty = JSON.stringify(localConfig) !== JSON.stringify(settings);
  useEffect(() => { if (!isDirty) setLocalConfig(settings); }, [settings, isDirty]);

  const handleConfigChange = <K extends keyof AppSettings,>(k: K, v: AppSettings[K]) => setLocalConfig(p => ({ ...p, [k]: v }));

  const handleSaveGeneral = async () => {
    if (!user || !db) return;
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), localConfig, { merge: true });
  };

  const toggleWorkDay = (dayIndex: number) => {
    const current = localConfig.defaultWorkDays || [];
    handleConfigChange('defaultWorkDays', current.includes(dayIndex) ? current.filter(d => d !== dayIndex) : [...current, dayIndex].sort());
  };

  const [newOverride, setNewOverride] = useState<WorkOverride>({ start: '', end: '', days: [1, 2, 3, 4, 5] });
  const addOverride = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newOverride.start || !newOverride.end) return;
    handleConfigChange('workOverrides', [...(localConfig.workOverrides || []), newOverride]);
    setNewOverride({ start: '', end: '', days: [1,2,3,4,5] });
  };
  const removeOverride = (idx: number) => {
    const overrides = [...(localConfig.workOverrides || [])];
    overrides.splice(idx, 1);
    handleConfigChange('workOverrides', overrides);
  };

  const addRule = async (e: FormEvent<HTMLFormElement>, type: 'income' | 'expense') => {
    e.preventDefault();
    if (!user || !db) return;
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const amount = Number(fd.get('amount') ?? 0);
    const frequency = String(fd.get('frequency') ?? 'daily') as Frequency;
    const date = frequency === 'monthly' ? Number(fd.get('date') ?? 0) || null : null;
    const workingDaysOnly = fd.get('workingDaysOnly') === 'on';
    const createdAt = new Date().toISOString();

    if (type === 'income') {
      const payload: Omit<IncomeRule, 'id'> = {
        name, amount, frequency, date, workingDaysOnly,
        category: String(fd.get('category') ?? DEFAULT_INCOME_CATEGORIES[0]),
        createdAt,
      };
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'incomeRules'), payload);
    } else {
      const payload: Omit<FixedExpense, 'id'> = {
        name, amount, frequency, date, workingDaysOnly, createdAt,
      };
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'fixedExpenses'), payload);
    }

    e.currentTarget.reset();
  };

  const removeRule = async (id: string, type: 'income' | 'expense') => {
    if (!user || !db) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, type === 'income' ? 'incomeRules' : 'fixedExpenses', id));
  };

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      
      <section className="atx-card p-5 rounded-xl shadow-sm relative overflow-hidden">
        <div className={`absolute top-0 left-0 w-full h-1 transition-all ${isDirty ? 'bg-orange-500' : 'bg-transparent'}`}></div>
        <div className="flex justify-between items-center mb-5 border-b pb-3">
          <h3 className="text-lg font-bold">General Setup</h3>
          <button onClick={handleSaveGeneral} disabled={!isDirty} className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${isDirty ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}><Save className="w-4 h-4"/> Save</button>
        </div>
        
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Cycle Cut-off Dates</label>
            <input type="text" value={localConfig.cutoffs?.join(', ') || ''} onChange={e => handleConfigChange('cutoffs', e.target.value.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n>=1 && n<=31))} className="w-full max-w-sm p-2 border border-gray-300 rounded focus:ring-1 focus:ring-[var(--atx-accent)] outline-none text-sm font-medium" placeholder="13, 29" />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Default Weekly Schedule</label>
            <div className="flex gap-2 flex-wrap">
              {DAYS_OF_WEEK.map((day) => (
                <button key={day.id} onClick={() => toggleWorkDay(day.id)} className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${localConfig.defaultWorkDays?.includes(day.id) ? 'bg-[var(--atx-accent)] text-white border-transparent' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {day.short}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Date-Range Overrides</label>
            <form onSubmit={addOverride} className="bg-gray-50 p-3 rounded-lg border border-gray-200 flex gap-2 flex-wrap items-center mb-3">
              <input type="date" required value={newOverride.start} onChange={e=>setNewOverride({...newOverride, start: e.target.value})} className="p-1.5 border rounded text-xs outline-none" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="date" required value={newOverride.end} onChange={e=>setNewOverride({...newOverride, end: e.target.value})} className="p-1.5 border rounded text-xs outline-none mr-2" />
              <button type="submit" className="ml-auto bg-gray-900 text-white px-3 py-1.5 rounded text-xs font-bold">Add Override</button>
            </form>
            <div className="space-y-2">
              {(localConfig.workOverrides || []).map((ov, idx) => (
                <div key={idx} className="flex justify-between items-center p-2 border border-gray-200 rounded bg-white shadow-sm text-sm">
                  <span className="font-bold">{ov.start} to {ov.end}</span>
                  <button onClick={() => removeOverride(idx)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Rules Manager */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="atx-card p-5 rounded-xl shadow-sm border-t-4 border-t-emerald-400">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><HandCoins className="w-5 h-5 text-emerald-500"/> Scheduled Income</h3>
          <form onSubmit={e => addRule(e, 'income')} className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 mb-4 space-y-3">
            <input name="name" type="text" placeholder="Source Name" required className="w-full p-2 border rounded text-sm outline-none focus:border-emerald-400" />
            <div className="flex gap-2">
              <input name="amount" type="number" placeholder="Amt" step="0.01" required className="flex-1 p-2 border rounded text-sm outline-none focus:border-emerald-400" />
              <select name="category" required className="flex-1 p-2 border rounded text-sm bg-white outline-none">
                {DEFAULT_INCOME_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-center text-sm">
              <select name="frequency" className="p-2 border rounded bg-white outline-none flex-1">
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
              <input name="date" type="number" placeholder="Day" min="1" max="31" className="p-2 border rounded w-16 outline-none" />
            </div>
            <label className="flex items-center space-x-2 text-xs"><input name="workingDaysOnly" type="checkbox" /><span>Work Days Only</span></label>
            <button type="submit" className="w-full bg-emerald-600 text-white rounded py-2 text-sm font-bold">Add Income Rule</button>
          </form>
          <div className="space-y-2">
            {incomeRules.map((rule) => (
              <div key={rule.id} className="flex justify-between items-center p-2 border rounded bg-white shadow-sm">
                <div>
                  <p className="font-bold text-sm">{rule.name} {rule.workingDaysOnly && <Briefcase className="w-3 h-3 inline text-emerald-500"/>}</p>
                  <p className="text-[10px] text-gray-500">{rule.frequency} {rule.date ? `(Day ${rule.date})` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-emerald-600 text-sm">+{formatPHP(rule.amount)}</span>
                  <button onClick={() => removeRule(rule.id, 'income')} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="atx-card p-5 rounded-xl shadow-sm border-t-4 border-t-rose-400">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><ArrowUpFromLine className="w-5 h-5 text-rose-500"/> Fixed Expenses</h3>
          <form onSubmit={e => addRule(e, 'expense')} className="bg-rose-50 p-3 rounded-lg border border-rose-100 mb-4 space-y-3">
            <input name="name" type="text" placeholder="Expense Name" required className="w-full p-2 border rounded text-sm outline-none focus:border-rose-400" />
            <input name="amount" type="number" placeholder="Amount" step="0.01" required className="w-full p-2 border rounded text-sm outline-none focus:border-rose-400" />
            <div className="flex gap-2 items-center text-sm">
              <select name="frequency" className="p-2 border rounded bg-white outline-none flex-1">
                <option value="daily">Daily</option>
                <option value="monthly">Monthly</option>
              </select>
              <input name="date" type="number" placeholder="Day" min="1" max="31" className="p-2 border rounded w-16 outline-none" />
            </div>
            <label className="flex items-center space-x-2 text-xs"><input name="workingDaysOnly" type="checkbox" /><span>Work Days Only</span></label>
            <button type="submit" className="w-full bg-rose-600 text-white rounded py-2 text-sm font-bold">Add Expense Rule</button>
          </form>
          <div className="space-y-2">
            {fixedExpenses.map((exp) => (
              <div key={exp.id} className="flex justify-between items-center p-2 border rounded bg-white shadow-sm">
                <div>
                  <p className="font-bold text-sm">{exp.name} {exp.workingDaysOnly && <Briefcase className="w-3 h-3 inline text-rose-500"/>}</p>
                  <p className="text-[10px] text-gray-500">{exp.frequency} {exp.date ? `(Day ${exp.date})` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-rose-500 text-sm">-{formatPHP(exp.amount)}</span>
                  <button onClick={() => removeRule(exp.id, 'expense')} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
