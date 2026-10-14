import { useState, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import { 
  ChevronLeft, ChevronRight, Settings, Calendar as CalendarIcon, 
  Plus, Trash2, X, AlertTriangle, Download, PieChart as PieChartIcon, 
  Briefcase, CalendarOff, CheckCircle2, Wallet, 
  ArrowDownToLine, ArrowUpFromLine, HandCoins,
  History, Save, Target, CreditCard, LogOut,
  TrendingUp, TrendingDown, Lightbulb, Info, Layers
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, 
  ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, ReferenceLine
} from 'recharts';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged,
  signInWithPopup, linkWithPopup, GoogleAuthProvider, signOut
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, addDoc, deleteDoc
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

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
const appId = 'ataraxia'; 
const googleProvider = new GoogleAuthProvider();

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

// One line of the unified money ledger (a logged record or a scheduled occurrence).
interface LedgerEntry {
  date: string; kind: 'income' | 'expense'; amount: number; category: string; label: string;
  source: 'manual' | 'scheduled';
  received: boolean; // income: money actually in hand. Expenses are always "received" (spent/committed).
  linkedType: LinkedType;
}
// Everything we know about one pay cycle, including what was carried in from the cycle before it.
interface CycleRow {
  index: number; startStr: string; endStr: string;
  carryIn: number;
  receivedIncome: number; pendingIncome: number; expectedIncome: number;
  scheduledExpenses: number; manualExpenses: number; totalExpenses: number;
  closingActual: number; closingProjected: number;
  available: number; // what the dashboard shows as Available (actual for past/current, projected for future)
  isCurrent: boolean; isFuture: boolean; projectionDepth: number;
  entries: LedgerEntry[];
}
interface CycleStats {
  startStr: string; endStr: string; carryIn: number;
  expectedIncome: number; cycleReceivedIncome: number; pendingIncome: number;
  cycleFixed: number; cycleManualExpenses: number; totalExpenses: number;
  availableReality: number; healthPercent: number; healthState: HealthState;
  isProjection: boolean; projectionDepth: number;
}
interface ScheduleContext {
  settings: AppSettings;
  ruleStarts: Record<string, string>; // rule id -> first date the rule applies (start of the cycle it was created in)
  skips: Set<string>;
  absences: Set<string>;
}
interface LedgerSources { expenses: Expense[]; incomes: Income[]; fixedExpenses: FixedExpense[]; incomeRules: IncomeRule[]; }
interface DayFlows { scheduledExpense: number; loggedExpense: number; scheduledIncome: number; loggedIncome: number; pendingIncome: number; hasLoggedExpense: boolean; }
type GoalWithProgress = SavingsGoal & { saved: number; pct: number };

interface NavButtonProps { icon: LucideIcon; label: string; active: boolean; onClick: () => void; }
interface StatsHeaderProps { stats: CycleStats; isCurrent: boolean; missedIncome: number; daysLeft: number; }
interface StatCardProps { title: string; value: number; icon: ReactNode; className?: string; highlight?: boolean; sub?: string; signed?: boolean; }
interface MergedCalendarViewProps {
  calendarMonth: Date; setCalendarMonth: Dispatch<SetStateAction<Date>>; schedule: ScheduleContext;
  expenses: Expense[]; fixedExpenses: FixedExpense[]; incomes: Income[]; incomeRules: IncomeRule[];
  viewedStart: string; viewedEnd: string; todayStart: string; todayEnd: string; openDayModal: (date: string) => void;
  showIncome: boolean; setShowIncome: Dispatch<SetStateAction<boolean>>; showExpenses: boolean; setShowExpenses: Dispatch<SetStateAction<boolean>>;
}
interface SavingsDebtViewProps {
  user: User | null; db: Firestore | null; appId: string; savingsGoals: SavingsGoal[]; debts: Debt[]; expenses: Expense[];
  cycles: CycleRow[]; cutoffs: number[]; todayStartStr: string; cyclesPerMonth: number;
}
interface SplitPlannerProps { goals: GoalWithProgress[]; cycles: CycleRow[]; cutoffs: number[]; todayStartStr: string; cyclesPerMonth: number; }
interface DayDetailsModalProps {
  isOpen: boolean; onClose: () => void; dateStr: string | null; expenses: Expense[]; fixedExpenses: FixedExpense[];
  incomes: Income[]; incomeRules: IncomeRule[]; exceptions: ExceptionEntry[]; schedule: ScheduleContext;
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
interface InsightsViewProps { cycles: CycleRow[]; viewedStartStr: string; cyclesPerMonth: number; }
interface SettingsViewProps {
  settings: AppSettings; user: User | null; db: Firestore | null; appId: string;
  fixedExpenses: FixedExpense[]; incomeRules: IncomeRule[]; expenses: Expense[]; incomes: Income[];
}

interface NamedAmount { name: string; value: number; }
interface TopItem extends NamedAmount { count: number; }
interface WeekdayStat { day: string; avg: number; total: number; }
interface CycleSeriesPoint { label: string; fullLabel: string; carryIn: number; income: number; spent: number; scheduled: number; logged: number; net: number; balance: number; status: string; }
interface ReportInsight { tone: InsightTone; title: string; text: string; }
interface ReportData {
  rows: CycleRow[]; startStr: string; endStr: string; asOf: string; days: number; includesCurrent: boolean;
  closingBalance: number; balanceLabel: string;
  income: number; pendingIncome: number; spent: number; scheduledSpent: number; loggedSpent: number;
  net: number; savingsRate: number | null; avgCycleIncome: number; avgCycleSpent: number; avgDaily: number;
  goalContrib: number; debtPaid: number;
  expenseCats: NamedAmount[]; incomeCats: NamedAmount[]; topItems: TopItem[]; weekday: WeekdayStat[];
  series: CycleSeriesPoint[]; prev: { income: number; spent: number } | null;
  insights: ReportInsight[];
}

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

const CAUTION_PERCENT = 20;
const DANGER_PERCENT = 10;

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#84cc16'];
const RANGE_OPTIONS: { id: InsightRange; label: string }[] = [
  { id: 'cycle', label: 'Viewed Cycle' },
  { id: '1m', label: '1 Month' },
  { id: '3m', label: '3 Months' },
  { id: '6m', label: '6 Months' },
  { id: '1y', label: '1 Year' },
  { id: 'all', label: 'All Time' },
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

// ---------------------------------------------------------------------------
// Date + number helpers
// ---------------------------------------------------------------------------
const parseYMD = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const daysBetween = (fromStr: string, toStr: string) => Math.round((parseYMD(toStr).getTime() - parseYMD(fromStr).getTime()) / 86400000);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const shortDate = (s: string) => parseYMD(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDate = (s: string) => parseYMD(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const compactPHP = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${sign}${Math.round(abs)}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const formatMonths = (m: number) => {
  const text = Number.isInteger(m) ? String(m) : m.toFixed(1);
  return `${text} ${m === 1 ? 'month' : 'months'}`;
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
  let end = addDays(candidates[1], -1);

  for (let i = 0; i < candidates.length - 1; i++) {
    if (targetTime >= candidates[i].getTime() && targetTime < candidates[i+1].getTime()) {
       start = candidates[i];
       end = addDays(candidates[i+1], -1);
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

// ---------------------------------------------------------------------------
// Scheduled rules (fixed expenses + recurring income)
// ---------------------------------------------------------------------------
type ScheduledRule = FixedExpense | IncomeRule;

const skipKey = (type: ExceptionType, targetId: string | null, date: string) => `${type}|${targetId ?? ''}|${date}`;

const makeSchedule = (settings: AppSettings, fixedExpenses: FixedExpense[], incomeRules: IncomeRule[], exceptions: ExceptionEntry[]): ScheduleContext => {
  const ruleStarts: Record<string, string> = {};
  const allRules: ScheduledRule[] = [...fixedExpenses, ...incomeRules];
  allRules.forEach(rule => {
    if (!rule.createdAt) return;
    const created = new Date(rule.createdAt);
    if (isNaN(created.getTime())) return;
    // A rule counts for the whole cycle it was created in, but not for earlier cycles.
    ruleStarts[rule.id] = toYYYYMMDD(getActivePeriod(created, settings.cutoffs).start);
  });
  const skips = new Set<string>();
  const absences = new Set<string>();
  exceptions.forEach(ex => {
    if (ex.type === 'absent') absences.add(ex.date);
    else skips.add(skipKey(ex.type, ex.targetId, ex.date));
  });
  return { settings, ruleStarts, skips, absences };
};

const isWorkingDay = (sc: ScheduleContext, dateStr: string, dateObj: Date) =>
  getBaseWorkDay(dateStr, dateObj, sc.settings) && !sc.absences.has(dateStr);

// A monthly rule on the 29th/30th/31st lands on the last day of shorter months instead of being skipped.
const ruleHitsDay = (frequency: Frequency, ruleDate: number | string | null, d: Date) => {
  if (frequency === 'daily') return true;
  const day = Number(ruleDate);
  if (!day) return false;
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === Math.min(day, lastDay);
};

// Is the rule due on this date at all (ignoring skips and absences)? Used to list it in the day view.
const ruleScheduledOn = (sc: ScheduleContext, rule: ScheduledRule, dateStr: string, d: Date) => {
  const start = sc.ruleStarts[rule.id];
  if (start && dateStr < start) return false;
  return ruleHitsDay(rule.frequency, rule.date, d);
};

// Is the rule actually in effect on this date (not skipped, and the work-day requirement is met)?
const ruleLiveOn = (sc: ScheduleContext, rule: ScheduledRule, dateStr: string, d: Date, skipType: ExceptionType) => {
  if (!ruleScheduledOn(sc, rule, dateStr, d)) return false;
  if (sc.skips.has(skipKey(skipType, rule.id, dateStr))) return false;
  if (rule.workingDaysOnly && !isWorkingDay(sc, dateStr, d)) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Ledger + cycle engine (single source of truth for every number on screen)
// ---------------------------------------------------------------------------
const buildCycleEntries = (startStr: string, endStr: string, sc: ScheduleContext, src: LedgerSources, receivedRuleDays: Set<string>): LedgerEntry[] => {
  const entries: LedgerEntry[] = [];

  for (let d = parseYMD(startStr); toYYYYMMDD(d) <= endStr; d = addDays(d, 1)) {
    const ds = toYYYYMMDD(d);
    src.fixedExpenses.forEach(exp => {
      if (!ruleLiveOn(sc, exp, ds, d, 'expense_skip')) return;
      entries.push({ date: ds, kind: 'expense', amount: num(exp.amount), category: exp.category || exp.name || 'Scheduled', label: exp.name, source: 'scheduled', received: true, linkedType: null });
    });
    src.incomeRules.forEach(inc => {
      if (!ruleLiveOn(sc, inc, ds, d, 'income_skip')) return;
      // Once marked received, the received record represents it. Don't count it twice.
      if (receivedRuleDays.has(`${inc.id}|${ds}`)) return;
      entries.push({ date: ds, kind: 'income', amount: num(inc.amount), category: inc.category || 'Other', label: inc.name, source: 'scheduled', received: false, linkedType: null });
    });
  }

  src.incomes.forEach(i => {
    if (i.date < startStr || i.date > endStr) return;
    entries.push({ date: i.date, kind: 'income', amount: num(i.amount), category: i.category || 'Other', label: i.name || i.description || 'Income', source: i.ruleId ? 'scheduled' : 'manual', received: i.isReceived !== false, linkedType: null });
  });
  src.expenses.forEach(e => {
    if (e.date < startStr || e.date > endStr) return;
    entries.push({ date: e.date, kind: 'expense', amount: num(e.amount), category: e.category || 'Other', label: e.description || e.name || 'Expense', source: 'manual', received: true, linkedType: e.linkedType ?? null });
  });

  return entries;
};

const emptyRow = (startStr: string, endStr: string): CycleRow => ({
  index: 0, startStr, endStr, carryIn: 0, receivedIncome: 0, pendingIncome: 0, expectedIncome: 0,
  scheduledExpenses: 0, manualExpenses: 0, totalExpenses: 0, closingActual: 0, closingProjected: 0, available: 0,
  isCurrent: false, isFuture: false, projectionDepth: 0, entries: []
});

/**
 * Builds every cycle from the first one with any data up to the later of (today's cycle, the viewed cycle).
 *
 *  - Past + current cycles:  Available = Carried Over + Received income - Total spent
 *    and the cycle's leftover (positive or negative) becomes the next cycle's Carried Over.
 *  - The cycle right after today's:  Carried Over = today's Available (what you have if you stop spending now).
 *  - Cycles further ahead:  Carried Over = the previous cycle's projected balance (Expected income - Spent).
 */
const buildCycles = (src: LedgerSources, sc: ScheduleContext, todayStartStr: string, viewedStartStr: string): CycleRow[] => {
  const cutoffs = sc.settings.cutoffs;

  const dates: string[] = [];
  src.expenses.forEach(e => { if (e.date) dates.push(e.date); });
  src.incomes.forEach(i => { if (i.date) dates.push(i.date); });
  Object.values(sc.ruleStarts).forEach(s => dates.push(s));

  let firstStart = todayStartStr;
  if (dates.length > 0) {
    const earliest = dates.reduce((a, b) => (a < b ? a : b));
    firstStart = toYYYYMMDD(getActivePeriod(parseYMD(earliest), cutoffs).start);
  }
  const chainStart = [firstStart, todayStartStr, viewedStartStr].reduce((a, b) => (a < b ? a : b));
  const chainEnd = todayStartStr > viewedStartStr ? todayStartStr : viewedStartStr;

  const receivedRuleDays = new Set<string>();
  src.incomes.forEach(i => { if (i.ruleId && i.isReceived !== false) receivedRuleDays.add(`${i.ruleId}|${i.date}`); });

  const rows: CycleRow[] = [];
  let anchor = parseYMD(chainStart);
  for (let guard = 0; guard < 1500; guard++) {
    const p = getActivePeriod(anchor, cutoffs);
    const startStr = toYYYYMMDD(p.start);
    if (startStr > chainEnd) break;
    const endStr = toYYYYMMDD(p.end);

    const entries = buildCycleEntries(startStr, endStr, sc, src, receivedRuleDays);
    const row = emptyRow(startStr, endStr);
    row.index = rows.length;
    row.entries = entries;
    entries.forEach(e => {
      if (e.kind === 'income') {
        if (e.received) row.receivedIncome += e.amount; else row.pendingIncome += e.amount;
      } else if (e.source === 'scheduled') row.scheduledExpenses += e.amount;
      else row.manualExpenses += e.amount;
    });
    row.receivedIncome = round2(row.receivedIncome);
    row.pendingIncome = round2(row.pendingIncome);
    row.expectedIncome = round2(row.receivedIncome + row.pendingIncome);
    row.scheduledExpenses = round2(row.scheduledExpenses);
    row.manualExpenses = round2(row.manualExpenses);
    row.totalExpenses = round2(row.scheduledExpenses + row.manualExpenses);
    rows.push(row);

    anchor = addDays(p.end, 1);
  }

  const foundCurrent = rows.findIndex(r => r.startStr === todayStartStr);
  const curIdx = foundCurrent >= 0 ? foundCurrent : rows.length - 1;

  rows.forEach((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    row.carryIn = prev === null ? 0 : (i <= curIdx + 1 ? prev.closingActual : prev.closingProjected);
    row.closingActual = round2(row.carryIn + row.receivedIncome - row.totalExpenses);
    row.closingProjected = round2(row.carryIn + row.expectedIncome - row.totalExpenses);
    row.isCurrent = i === curIdx;
    row.isFuture = i > curIdx;
    row.projectionDepth = i > curIdx ? i - curIdx : 0;
    row.available = row.isFuture ? row.closingProjected : row.closingActual;
  });

  return rows;
};

// Budget status = what's left (Available, including carry-over) as a share of this cycle's own earnings.
const evaluateHealth = (available: number, earnings: number): { percent: number; state: HealthState } => {
  const percent = earnings > 0 ? (available / earnings) * 100 : 0;
  if (available < 0) return { percent, state: 'danger' };
  if (earnings <= 0) return { percent, state: 'safe' };
  if (percent < DANGER_PERCENT) return { percent, state: 'danger' };
  if (percent < CAUTION_PERCENT) return { percent, state: 'caution' };
  return { percent, state: 'safe' };
};

const rowToStats = (row: CycleRow): CycleStats => {
  const health = evaluateHealth(row.available, row.expectedIncome);
  return {
    startStr: row.startStr, endStr: row.endStr, carryIn: row.carryIn,
    expectedIncome: row.expectedIncome, cycleReceivedIncome: row.receivedIncome, pendingIncome: row.pendingIncome,
    cycleFixed: row.scheduledExpenses, cycleManualExpenses: row.manualExpenses, totalExpenses: row.totalExpenses,
    availableReality: row.available, healthPercent: health.percent, healthState: health.state,
    isProjection: row.isFuture, projectionDepth: row.projectionDepth
  };
};

// Totals for one calendar day, matching exactly what the cycle engine counts.
const getDayFlows = (sc: ScheduleContext, fixedExpenses: FixedExpense[], incomeRules: IncomeRule[], expenses: Expense[], incomes: Income[], dateStr: string, d: Date): DayFlows => {
  const flows: DayFlows = { scheduledExpense: 0, loggedExpense: 0, scheduledIncome: 0, loggedIncome: 0, pendingIncome: 0, hasLoggedExpense: false };
  fixedExpenses.forEach(exp => {
    if (ruleLiveOn(sc, exp, dateStr, d, 'expense_skip')) flows.scheduledExpense += num(exp.amount);
  });
  expenses.forEach(e => {
    if (e.date !== dateStr) return;
    flows.loggedExpense += num(e.amount);
    flows.hasLoggedExpense = true;
  });
  const dayIncomes = incomes.filter(i => i.date === dateStr);
  incomeRules.forEach(inc => {
    if (!ruleLiveOn(sc, inc, dateStr, d, 'income_skip')) return;
    if (dayIncomes.some(i => i.ruleId === inc.id && i.isReceived !== false)) return;
    flows.scheduledIncome += num(inc.amount);
    flows.pendingIncome += num(inc.amount);
  });
  dayIncomes.forEach(i => {
    flows.loggedIncome += num(i.amount);
    if (i.isReceived === false) flows.pendingIncome += num(i.amount);
  });
  return flows;
};

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = Object.keys(firebaseConfig).length > 0 ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const googleProvider = new GoogleAuthProvider();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
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
    
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        }
      } catch (err) { console.error("Auth error:", err); }
    };
    initAuth();

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
        await linkWithPopup(auth.currentUser, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (err: any) {
      if (err?.code === 'auth/credential-already-in-use') {
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
  const todayStartStr = toYYYYMMDD(todayCycle.start);
  const viewedStartStr = toYYYYMMDD(viewedCycle.start);
  const cyclesPerMonth = Math.max(1, new Set(settings.cutoffs && settings.cutoffs.length > 0 ? settings.cutoffs : [13, 29]).size);

  // Every number on the dashboard, savings planner and insights comes from this one chain of cycles.
  const schedule = useMemo(() => makeSchedule(settings, fixedExpenses, incomeRules, exceptions), [settings, fixedExpenses, incomeRules, exceptions]);
  const cycles = useMemo(
    () => buildCycles({ expenses, incomes, fixedExpenses, incomeRules }, schedule, todayStartStr, viewedStartStr),
    [expenses, incomes, fixedExpenses, incomeRules, schedule, todayStartStr, viewedStartStr]
  );
  const viewedRow = cycles.find(c => c.startStr === viewedStartStr);
  const cycleStats = useMemo(
    () => rowToStats(viewedRow ?? emptyRow(viewedStartStr, toYYYYMMDD(viewedCycle.end))),
    [viewedRow, viewedStartStr, viewedCycle]
  );

  // Scheduled income from finished cycles that was never marked as received (so it isn't in the carry-over).
  const missedIncome = useMemo(
    () => round2(cycles.filter(c => !c.isCurrent && !c.isFuture).reduce((sum, c) => sum + c.pendingIncome, 0)),
    [cycles]
  );

  const globalDebtTotal = useMemo(() => {
    return debts.reduce((total, debt) => {
      const payments = expenses.filter(e => e.linkedType === 'debt' && e.linkedTo === debt.id).reduce((sum, e) => sum + Number(e.amount), 0);
      const balance = Number(debt.initialAmount) - payments;
      return total + Math.max(0, balance);
    }, 0);
  }, [debts, expenses]);

  const handlePrevCycle = () => {
    const prevAnchor = addDays(viewedCycle.start, -1);
    setViewedCycleAnchor(prevAnchor);
    setCalendarMonth(prevAnchor);
  };
  const handleNextCycle = () => {
    const nextAnchor = addDays(viewedCycle.end, 1);
    setViewedCycleAnchor(nextAnchor);
    setCalendarMonth(nextAnchor);
  };
  const handleCurrentCycle = () => {
    setViewedCycleAnchor(new Date());
    setCalendarMonth(new Date());
  };
  const isViewingCurrentCycle = viewedStartStr === todayStartStr;
  const isViewingFutureCycle = viewedStartStr > todayStartStr;
  const daysLeft = isViewingCurrentCycle ? Math.max(1, daysBetween(toYYYYMMDD(new Date()), cycleStats.endStr) + 1) : 0;

if (!firebaseReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 p-6 text-center">
        <div>
          <p className="font-bold text-gray-700 mb-1">Firebase isn't configured</p>
          <p className="text-sm max-w-sm">Add your Firebase project's credentials as VITE_FIREBASE_* environment variables, then restart the dev server.</p>
        </div>
      </div>
    );
  }

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading Ataraxia...</div>;

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
                  {isViewingFutureCycle && (
                    <span className="text-[10px] uppercase font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mt-1">Preview</span>
                  )}
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

              <StatsHeader stats={cycleStats} isCurrent={isViewingCurrentCycle} missedIncome={missedIncome} daysLeft={daysLeft} />
              
              <MergedCalendarView 
                calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
                schedule={schedule} expenses={expenses} fixedExpenses={fixedExpenses} 
                incomes={incomes} incomeRules={incomeRules}
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
              cycles={cycles} cutoffs={settings.cutoffs} todayStartStr={todayStartStr} cyclesPerMonth={cyclesPerMonth}
            />
          )}
          
          {activeTab === 'insights' && (
            <InsightsView cycles={cycles} viewedStartStr={viewedStartStr} cyclesPerMonth={cyclesPerMonth} />
          )}
          
          {activeTab === 'settings' && (
            <SettingsView 
              settings={settings} user={user} db={db} appId={appId} 
              fixedExpenses={fixedExpenses} incomeRules={incomeRules} 
              expenses={expenses} incomes={incomes}
            />
          )}
        </main>

        <DayDetailsModal 
          isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setTimeout(() => setSelectedDateStr(null), 300); }}
          dateStr={selectedDateStr}
          expenses={expenses} fixedExpenses={fixedExpenses}
          incomes={incomes} incomeRules={incomeRules}
          exceptions={exceptions} schedule={schedule}
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

function StatsHeader({ stats, isCurrent, missedIncome, daysLeft }: StatsHeaderProps) {
  const { carryIn, expectedIncome, cycleReceivedIncome, totalExpenses, availableReality, healthState, healthPercent, isProjection, projectionDepth } = stats;
  const showWarning = (healthState === 'caution' || healthState === 'danger') && (isCurrent || isProjection);
  const pctLeft = expectedIncome > 0 ? Math.max(0, healthPercent) : null;
  const perDay = isCurrent && daysLeft > 0 ? Math.max(0, availableReality) / daysLeft : null;

  const availableSub = [
    pctLeft !== null ? `${pctLeft.toFixed(0)}% of cycle earnings` : null,
    perDay !== null ? `≈ ${formatPHP(perDay)}/day for ${plural(daysLeft, 'day', 'days')}` : null
  ].filter(Boolean).join(' · ');

  const warningTitle = isProjection
    ? (healthState === 'danger' ? 'Projected Shortfall' : 'Projected: Tight Budget')
    : (healthState === 'danger' ? 'Danger Zone: Budget Low' : 'Caution: Budget Getting Low');
  const warningMessage = availableReality < 0
    ? `${isProjection ? 'You would be' : 'You are'} ${formatPHP(Math.abs(availableReality))} over budget for this cycle.`
    : `Only ${formatPHP(availableReality)}${pctLeft !== null ? ` (${pctLeft.toFixed(0)}% of this cycle's earnings)` : ''} ${isProjection ? 'would be left' : 'is left'}.`;

  return (
    <div className="space-y-4">
      {isProjection && (
        <div className="p-3 rounded-lg flex items-start gap-3 border shadow-sm bg-blue-50 border-blue-200 text-blue-800">
          <Info className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">Preview of an upcoming cycle</h4>
            <p className="text-xs mt-0.5">
              {projectionDepth === 1
                ? `Starts with ${formatPHP(carryIn)} carried over from your current Available balance, which is what you'd have if you spend nothing more than what's already scheduled. Income you haven't received yet this cycle isn't counted.`
                : `Starts with ${formatPHP(carryIn)} projected from the cycle before it, assuming all expected income arrives and you spend nothing beyond what's scheduled.`}
            </p>
          </div>
        </div>
      )}

      {showWarning && (
        <div className={`p-3 rounded-lg flex items-start gap-3 border shadow-sm ${healthState === 'danger' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">{warningTitle}</h4>
            <p className="text-xs mt-0.5">{warningMessage}</p>
            <p className="text-[11px] mt-1 opacity-80">Caution starts below {CAUTION_PERCENT}% of the cycle's earnings, danger below {DANGER_PERCENT}%.</p>
          </div>
        </div>
      )}

      {missedIncome > 0 && (isCurrent || isProjection) && (
        <div className="p-3 rounded-lg flex items-start gap-3 border bg-gray-50 border-gray-200 text-gray-700">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
          <p className="text-xs">
            {formatPHP(missedIncome)} of expected income from past cycles was never marked as received, so it isn't part of your carried-over balance. Open those days on the calendar and tap Receive to include it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <StatCard title="Carried Over" value={carryIn} icon={<Layers className="w-4 h-4 text-gray-400"/>} className="border-l-4 border-l-blue-400" sub={isProjection ? 'Projected from before' : 'From previous cycle'} signed />
        <StatCard title="Expected Income" value={expectedIncome} icon={<Wallet className="w-4 h-4 text-gray-400"/>} className="border-l-4 border-l-gray-300" sub="This cycle only" />
        <StatCard title="Received Income" value={cycleReceivedIncome} icon={<ArrowDownToLine className="w-4 h-4 text-[var(--status-safe)]"/>} className="border-l-4 border-l-[var(--status-safe)]" />
        <StatCard title="Total Spent" value={totalExpenses} icon={<ArrowUpFromLine className="w-4 h-4 text-[var(--status-danger)]"/>} className="border-l-4 border-l-[var(--status-danger)]" sub="Logged + scheduled" />
        <StatCard title={isProjection ? 'Projected Available' : 'Available (Reality)'} value={availableReality} icon={<CheckCircle2 className="w-4 h-4 text-[var(--atx-accent)]"/>} className="border-l-4 border-l-[var(--atx-accent)] md:col-span-1 col-span-2" highlight sub={availableSub || undefined} />
      </div>
      <p className="text-[11px] text-gray-400 px-1">
        {isProjection ? 'Projected Available = Carried Over + Expected Income − Total Spent' : 'Available = Carried Over + Received Income − Total Spent'}
      </p>
    </div>
  );
}

function StatCard({ title, value, icon, className = "", highlight = false, sub, signed = false }: StatCardProps) {
  const valueColor = highlight
    ? (value < 0 ? 'text-[var(--status-danger)]' : 'text-[var(--atx-accent)]')
    : (signed && value < 0 ? 'text-[var(--status-danger)]' : 'text-gray-800');
  return (
    <div className={`atx-card p-4 rounded-xl shadow-sm flex flex-col justify-between h-full ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <p className="text-xs text-[var(--atx-text-muted)] font-medium uppercase tracking-wide">{title}</p>
        {icon}
      </div>
      <div>
        <p className={`text-xl sm:text-2xl font-bold truncate ${valueColor}`}>
          {formatPHP(value)}
        </p>
        {sub && <p className="text-[10px] text-gray-400 mt-1 leading-snug">{sub}</p>}
      </div>
    </div>
  );
}

function MergedCalendarView({ 
  calendarMonth, setCalendarMonth, schedule, expenses, fixedExpenses, incomes, incomeRules,
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
          const baseWorkDay = getBaseWorkDay(dateStr, dateObj, schedule.settings);
          const isDayAbsent = schedule.absences.has(dateStr);

          const flows = getDayFlows(schedule, fixedExpenses, incomeRules, expenses, incomes, dateStr, dateObj);
          const expTotal = showExpenses ? flows.scheduledExpense + flows.loggedExpense : 0;
          const incTotal = showIncome ? flows.scheduledIncome + flows.loggedIncome : 0;

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
                  <div className={`text-[10px] sm:text-xs font-bold rounded px-1 py-0.5 text-center truncate ${flows.pendingIncome > 0 ? 'bg-emerald-50 text-emerald-500 border border-emerald-200 border-dashed' : 'bg-emerald-100 text-emerald-700'}`}>
                    +{formatPHP(incTotal)}
                  </div>
                )}
                {showExpenses && expTotal > 0 && (
                  <div className={`text-[10px] sm:text-xs font-bold rounded px-1 py-0.5 text-center truncate ${isFuture && !flows.hasLoggedExpense ? 'bg-rose-50 text-rose-400 border border-rose-200 border-dashed' : 'bg-rose-100 text-rose-700'}`}>
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


function SavingsDebtView({ user, db, appId, savingsGoals, debts, expenses, cycles, cutoffs, todayStartStr, cyclesPerMonth }: SavingsDebtViewProps) {
  const [subTab, setSubTab] = useState<'overview' | 'split'>('overview');
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
  const goalsWithProgress: GoalWithProgress[] = savingsGoals.map(g => {
    const saved = expenses.filter(e => e.linkedType === 'goal' && e.linkedTo === g.id).reduce((s, e) => s + Number(e.amount), 0);
    return { ...g, saved, pct: Math.min(100, (saved / (Number(g.targetAmount) || 1)) * 100) };
  });

  const debtsWithBalance = debts.map(d => {
    const paid = expenses.filter(e => e.linkedType === 'debt' && e.linkedTo === d.id).reduce((s, e) => s + Number(e.amount), 0);
    const balance = Math.max(0, Number(d.initialAmount) - paid);
    return { ...d, paid, balance, pct: Math.min(100, (paid / (Number(d.initialAmount) || 1)) * 100) };
  });

  return (
    <div className="space-y-6">
      <div className="inline-flex bg-gray-100 p-1 rounded-lg">
        <button onClick={() => setSubTab('overview')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${subTab === 'overview' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Goals & Debts</button>
        <button onClick={() => setSubTab('split')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${subTab === 'split' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500'}`}>Split Planner</button>
      </div>

      {subTab === 'split' ? (
        <SplitPlanner goals={goalsWithProgress} cycles={cycles} cutoffs={cutoffs} todayStartStr={todayStartStr} cyclesPerMonth={cyclesPerMonth} />
      ) : (
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
      )}
    </div>
  );
}

function SplitPlanner({ goals, cycles, cutoffs, todayStartStr, cyclesPerMonth }: SplitPlannerProps) {
  const [source, setSource] = useState<string>('custom'); // a goal id, or 'custom'
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [unit, setUnit] = useState<'cycles' | 'months'>('cycles');
  const [length, setLength] = useState('6');
  const [startNext, setStartNext] = useState(false);

  const goal = goals.find(g => g.id === source);
  const remainingForGoal = goal ? Math.max(0, num(goal.targetAmount) - goal.saved) : 0;
  const amount = goal ? remainingForGoal : Math.max(0, num(customAmount));
  const itemName = goal ? goal.name : (customName.trim() || 'Your goal');

  const lengthNum = Math.min(120, Math.max(1, Math.floor(num(length)) || 1));
  const totalCycles = Math.min(120, unit === 'cycles' ? lengthNum : lengthNum * cyclesPerMonth);
  const totalMonths = totalCycles / cyclesPerMonth;

  const perCycle = amount / totalCycles;
  const perMonth = perCycle * cyclesPerMonth;

  // Split in whole centavos so the schedule always adds up exactly to the target.
  const schedule = useMemo(() => {
    const first = getActivePeriod(parseYMD(todayStartStr), cutoffs);
    let anchor = startNext ? addDays(first.end, 1) : first.start;
    const cents = Math.round(amount * 100);
    const base = Math.floor(cents / totalCycles);
    const extra = cents - base * totalCycles;
    const rows: { n: number; start: string; end: string; amount: number; cumulative: number; remaining: number }[] = [];
    let running = 0;
    for (let i = 0; i < totalCycles; i++) {
      const p = getActivePeriod(anchor, cutoffs);
      const portion = (base + (i < extra ? 1 : 0)) / 100;
      running = round2(running + portion);
      rows.push({ n: i + 1, start: toYYYYMMDD(p.start), end: toYYYYMMDD(p.end), amount: portion, cumulative: running, remaining: round2(Math.max(0, amount - running)) });
      anchor = addDays(p.end, 1);
    }
    return rows;
  }, [amount, totalCycles, startNext, todayStartStr, cutoffs]);

  // What you typically have left over per finished cycle (income actually received minus spending, ignoring goal contributions).
  const avgSurplus = useMemo(() => {
    const finished = cycles.filter(c => !c.isCurrent && !c.isFuture && c.entries.length > 0).slice(-6);
    if (finished.length === 0) return null;
    const total = finished.reduce((sum, c) => {
      const spentExcludingGoals = c.entries.filter(e => e.kind === 'expense' && e.linkedType !== 'goal').reduce((s, e) => s + e.amount, 0);
      return sum + (c.receivedIncome - spentExcludingGoals);
    }, 0);
    return total / finished.length;
  }, [cycles]);

  const optionCycles = [2, 4, 6, 12, 24];

  let verdict: { tone: 'good' | 'warn' | 'bad' | 'info'; text: string } | null = null;
  if (amount > 0) {
    if (avgSurplus === null) {
      verdict = { tone: 'info', text: 'Once you have a few finished cycles, this will compare the plan with what you usually have left over.' };
    } else if (avgSurplus <= 0) {
      verdict = { tone: 'bad', text: `Your recent cycles ended with no money left over on average, so this plan would need spending cuts or more income.` };
    } else {
      const share = (perCycle / avgSurplus) * 100;
      const needed = Math.ceil(amount / avgSurplus);
      if (share <= 70) verdict = { tone: 'good', text: `That's ${share.toFixed(0)}% of the ${formatPHP(avgSurplus)} you usually have left per cycle. Comfortable.` };
      else if (share <= 100) verdict = { tone: 'warn', text: `That's ${share.toFixed(0)}% of the ${formatPHP(avgSurplus)} you usually have left per cycle. Doable, but tight.` };
      else verdict = { tone: 'bad', text: `That's more than the ${formatPHP(avgSurplus)} you usually have left per cycle. At your usual pace it would take about ${needed} ${needed === 1 ? 'cycle' : 'cycles'} / ${formatMonths(needed / cyclesPerMonth)}.` };
    }
  }
  const verdictClass = verdict === null ? '' : verdict.tone === 'good' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : verdict.tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : verdict.tone === 'bad' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-600';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-in slide-in-from-bottom-4 duration-300">
      <div className="lg:col-span-2 atx-card p-5 rounded-xl shadow-sm border-t-4 border-t-emerald-400 space-y-5 self-start">
        <div>
          <h2 className="text-lg font-bold text-emerald-800 flex items-center gap-2"><Target className="w-5 h-5"/> Split a Cost</h2>
          <p className="text-xs text-gray-500 mt-1">Spread what you want to buy across your pay cycles to see what to set aside each time.</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">What are you saving for?</label>
          <select value={source} onChange={e => setSource(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm bg-white outline-none">
            <option value="custom">Something new (enter an amount)</option>
            {goals.length > 0 && <optgroup label="Your savings goals">{goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>}
          </select>
        </div>

        {goal ? (
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Target</span><span className="font-bold">{formatPHP(goal.targetAmount)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Already saved</span><span className="font-bold text-emerald-700">{formatPHP(goal.saved)}</span></div>
            <div className="flex justify-between border-t border-emerald-100 pt-1"><span className="text-gray-600 font-semibold">Left to split</span><span className="font-bold">{formatPHP(remainingForGoal)}</span></div>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            <input type="text" placeholder="Name (optional)" value={customName} onChange={e => setCustomName(e.target.value)} className="col-span-3 p-2 border border-gray-300 rounded text-sm outline-none focus:border-emerald-400" />
            <input type="number" placeholder="Cost ₱" min="0" step="0.01" value={customAmount} onChange={e => setCustomAmount(e.target.value)} className="col-span-2 p-2 border border-gray-300 rounded text-sm outline-none focus:border-emerald-400" />
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">Split it over</label>
          <div className="flex gap-2">
            <input type="number" min="1" max="120" value={length} onChange={e => setLength(e.target.value)} className="w-24 p-2 border border-gray-300 rounded text-sm outline-none focus:border-emerald-400" />
            <div className="flex bg-gray-100 p-1 rounded-lg flex-1">
              <button onClick={() => setUnit('cycles')} className={`flex-1 px-3 py-1 text-xs font-bold rounded-md transition-colors ${unit === 'cycles' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Cycles</button>
              <button onClick={() => setUnit('months')} className={`flex-1 px-3 py-1 text-xs font-bold rounded-md transition-colors ${unit === 'months' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Months</button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">{plural(cyclesPerMonth, 'cycle', 'cycles')} per month with your current cut-off dates.</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">Start saving</label>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button onClick={() => setStartNext(false)} className={`flex-1 px-3 py-1 text-xs font-bold rounded-md transition-colors ${!startNext ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>This cycle</button>
            <button onClick={() => setStartNext(true)} className={`flex-1 px-3 py-1 text-xs font-bold rounded-md transition-colors ${startNext ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Next cycle</button>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-600 mb-2">Compare options</p>
          <div className="grid grid-cols-5 gap-1.5">
            {optionCycles.map(n => (
              <button key={n} disabled={amount <= 0} onClick={() => { setUnit('cycles'); setLength(String(n)); }}
                className={`rounded-lg border p-1.5 text-center transition-colors ${totalCycles === n ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'} disabled:opacity-40`}>
                <span className="block text-[11px] font-bold text-gray-800">{n}/{formatMonths(n / cyclesPerMonth).replace(' months', 'mo').replace(' month', 'mo')}</span>
                <span className="block text-[10px] text-gray-500 truncate">{amount > 0 ? compactPHP(amount / n) : '—'}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Cycles / months, with the amount to set aside each cycle.</p>
        </div>
      </div>

      <div className="lg:col-span-3 space-y-6">
        {amount <= 0 ? (
          <div className="atx-card p-10 rounded-xl shadow-sm text-center text-gray-400">
            <Target className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm italic">{goal ? `${goal.name} is already fully funded.` : 'Enter a cost to see how it splits across your cycles.'}</p>
          </div>
        ) : (
          <>
            <div className="atx-card p-6 rounded-xl shadow-sm">
              <p className="text-xs text-gray-500">{itemName} · {formatPHP(amount)}</p>
              <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                  <p className="text-3xl font-bold text-emerald-700">{formatPHP(perCycle)}</p>
                  <p className="text-xs text-gray-500">per cycle</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-800">{formatPHP(perMonth)}</p>
                  <p className="text-xs text-gray-500">per month</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-xl font-bold text-gray-800">{totalCycles} {totalCycles === 1 ? 'cycle' : 'cycles'} / {formatMonths(totalMonths)}</p>
                  <p className="text-xs text-gray-500">done by {schedule.length > 0 ? longDate(schedule[schedule.length - 1].end) : '—'}</p>
                </div>
              </div>
              {verdict && (
                <div className={`mt-4 p-3 rounded-lg border text-xs flex items-start gap-2 ${verdictClass}`}>
                  <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{verdict.text}</p>
                </div>
              )}
            </div>

            <div className="atx-card rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--atx-border)] bg-gray-50">
                <h3 className="font-bold text-gray-800 text-sm">Saving schedule</h3>
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white sticky top-0 text-[11px] text-gray-400">
                    <tr>
                      <th className="text-left font-semibold px-5 py-2">Cycle</th>
                      <th className="text-left font-semibold px-2 py-2">Dates</th>
                      <th className="text-right font-semibold px-2 py-2">Set aside</th>
                      <th className="text-right font-semibold px-2 py-2">Total saved</th>
                      <th className="text-right font-semibold px-5 py-2">Still to go</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map(r => (
                      <tr key={r.n} className="border-t border-gray-100">
                        <td className="px-5 py-2 font-semibold text-gray-700">{r.n}/{totalCycles}</td>
                        <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{shortDate(r.start)} – {shortDate(r.end)}</td>
                        <td className="px-2 py-2 text-right font-bold text-emerald-700">{formatPHP(r.amount)}</td>
                        <td className="px-2 py-2 text-right text-gray-700">{formatPHP(r.cumulative)}</td>
                        <td className="px-5 py-2 text-right text-gray-500">{formatPHP(r.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 px-1">
              To track progress, log each contribution as an expense linked to the goal on the calendar. The goal's saved amount updates automatically.
            </p>
          </>
        )}
      </div>
    </div>
  );
}


// Reusing logic from the updated constraints, merging expense and income inputs into one modal interface

function DayDetailsModal({ 
  isOpen, onClose, dateStr, expenses, fixedExpenses, incomes, incomeRules, exceptions, schedule,
  savingsGoals, debts, user, db, appId 
}: DayDetailsModalProps) {
  const [subTab, setSubTab] = useState<'expense' | 'income'>('expense'); // 'expense' or 'income'
  const [amount, setAmount] = useState('');
  const [descName, setDescName] = useState('');
  const [category, setCategory] = useState('');
  const [linkedTo, setLinkedTo] = useState(''); // "goal_id" or "debt_id" or ""
  
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null); 

  useEffect(() => { if (isOpen) { setSubTab('expense'); setAmount(''); setDescName(''); setLinkedTo(''); } }, [isOpen]);

  if (!isOpen || !dateStr) return null;

  const dateObj = parseYMD(dateStr);
  const baseWorkDay = getBaseWorkDay(dateStr, dateObj, schedule.settings);
  const isDayAbsent = schedule.absences.has(dateStr);

  const dailyFixedExp = fixedExpenses.filter(exp => ruleScheduledOn(schedule, exp, dateStr, dateObj));
  const dailyFixedInc = incomeRules.filter(inc => ruleScheduledOn(schedule, inc, dateStr, dateObj));
  const customExp = expenses.filter(e => e.date === dateStr);
  const customInc = incomes.filter(i => i.date === dateStr);

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!amount || !descName || !user || !db) return;

    let linkedType: LinkedType = null;
    let finalLinkedTo: string | null = null;
    if (subTab === 'expense' && linkedTo) {
      const sep = linkedTo.indexOf('_');
      const type = linkedTo.slice(0, sep);
      linkedType = type === 'goal' || type === 'debt' ? type : null;
      finalLinkedTo = linkedTo.slice(sep + 1);
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
        const rule = confirmData.data;
        // Guard against a double tap creating a second "received" record (which would double the income).
        const alreadyReceived = incomes.some(i => i.ruleId === rule.id && i.date === dateStr && i.isReceived !== false);
        if (!alreadyReceived) {
          await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'incomes'), {
            date: dateStr,
            amount: rule.amount,
            name: rule.name,
            category: rule.category,
            ruleId: rule.id,
            isReceived: true,
            createdAt: new Date().toISOString(),
          });
        }
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
                      const inactive = !ruleLiveOn(schedule, exp, dateStr, dateObj, 'expense_skip');
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
                      const inactive = !ruleLiveOn(schedule, inc, dateStr, dateObj, 'income_skip');
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

const RANGE_MONTHS: Record<'1m' | '3m' | '6m' | '1y', number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
const RANGE_NOUN: Record<InsightRange, string> = { cycle: 'cycle', '1m': 'month', '3m': '3 months', '6m': '6 months', '1y': '12 months', all: 'period' };
const sumOf = (list: number[]) => list.reduce((a, b) => a + b, 0);

const groupByCategory = (list: LedgerEntry[]): NamedAmount[] => {
  const totals = new Map<string, number>();
  list.forEach(e => totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount));
  return Array.from(totals, ([name, value]) => ({ name, value: round2(value) }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);
};

const buildReport = (cycles: CycleRow[], range: InsightRange, viewedStartStr: string, cyclesPerMonth: number, todayStr: string): ReportData | null => {
  if (cycles.length === 0) return null;

  const foundCurrent = cycles.findIndex(c => c.isCurrent);
  const curIdx = foundCurrent >= 0 ? foundCurrent : cycles.length - 1;
  const foundViewed = cycles.findIndex(c => c.startStr === viewedStartStr);
  const viewedIdx = foundViewed >= 0 ? foundViewed : curIdx;
  const firstActive = cycles.findIndex(c => c.entries.length > 0);

  let startIdx = viewedIdx;
  let endIdx = viewedIdx;
  if (range !== 'cycle') {
    endIdx = curIdx;
    const span = range === 'all' ? curIdx + 1 : RANGE_MONTHS[range] * cyclesPerMonth;
    startIdx = Math.max(0, curIdx - span + 1);
    // Don't pad the report with empty cycles from before you started using the app.
    if (firstActive >= 0) startIdx = Math.max(startIdx, Math.min(firstActive, curIdx));
  }

  const rows = cycles.slice(startIdx, endIdx + 1);
  if (rows.length === 0) return null;
  const len = rows.length;
  const startStr = rows[0].startStr;
  const endStr = rows[len - 1].endStr;
  const includesCurrent = rows.some(r => r.isCurrent);

  const income = round2(sumOf(rows.map(r => r.receivedIncome)));
  const pendingIncome = round2(sumOf(rows.map(r => r.pendingIncome)));
  const spent = round2(sumOf(rows.map(r => r.totalExpenses)));
  const scheduledSpent = round2(sumOf(rows.map(r => r.scheduledExpenses)));
  const loggedSpent = round2(sumOf(rows.map(r => r.manualExpenses)));
  const net = round2(income - spent);
  const savingsRate = income > 0 ? (net / income) * 100 : null;

  const entries = rows.flatMap(r => r.entries);
  const expenseEntries = entries.filter(e => e.kind === 'expense');
  const receivedIncomeEntries = entries.filter(e => e.kind === 'income' && e.received);

  // "Per day" figures only look at days that have already happened.
  const asOf = endStr < todayStr ? endStr : todayStr;
  const days = asOf >= startStr ? daysBetween(startStr, asOf) + 1 : 0;
  const spentToDate = sumOf(expenseEntries.filter(e => e.date <= asOf).map(e => e.amount));
  const avgDaily = days > 0 ? spentToDate / days : 0;

  const goalContrib = round2(sumOf(expenseEntries.filter(e => e.linkedType === 'goal').map(e => e.amount)));
  const debtPaid = round2(sumOf(expenseEntries.filter(e => e.linkedType === 'debt').map(e => e.amount)));

  const expenseCats = groupByCategory(expenseEntries);
  const incomeCats = groupByCategory(receivedIncomeEntries);

  const itemMap = new Map<string, TopItem>();
  expenseEntries.forEach(e => {
    const name = e.label.trim() || 'Untitled';
    const key = name.toLowerCase();
    const existing = itemMap.get(key);
    if (existing) { existing.value += e.amount; existing.count += 1; }
    else itemMap.set(key, { name, value: e.amount, count: 1 });
  });
  const topItems = Array.from(itemMap.values()).map(v => ({ ...v, value: round2(v.value) })).sort((a, b) => b.value - a.value).slice(0, 8);

  const weekdayTotals = new Array<number>(7).fill(0);
  const weekdayDays = new Array<number>(7).fill(0);
  const loggedToDate = expenseEntries.filter(e => e.source === 'manual' && e.date <= asOf);
  loggedToDate.forEach(e => { weekdayTotals[parseYMD(e.date).getDay()] += e.amount; });
  for (let i = 0, d = parseYMD(startStr); i < days; i++, d = addDays(d, 1)) weekdayDays[d.getDay()] += 1;
  const weekday: WeekdayStat[] = [1, 2, 3, 4, 5, 6, 0].map(id => ({
    day: DAYS_OF_WEEK[id].short, total: round2(weekdayTotals[id]), avg: weekdayDays[id] > 0 ? round2(weekdayTotals[id] / weekdayDays[id]) : 0
  }));

  const series: CycleSeriesPoint[] = rows.map(r => ({
    label: len > 12 ? `${shortDate(r.startStr)} '${r.startStr.slice(2, 4)}` : shortDate(r.startStr),
    fullLabel: `${shortDate(r.startStr)} – ${shortDate(r.endStr)}`,
    carryIn: r.carryIn, income: r.receivedIncome, spent: r.totalExpenses, scheduled: r.scheduledExpenses, logged: r.manualExpenses,
    net: round2(r.receivedIncome - r.totalExpenses), balance: r.available,
    status: r.isFuture ? 'Projected' : r.isCurrent ? 'In progress' : ''
  }));

  // Compare with the window of the same length right before this one.
  let prev: ReportData['prev'] = null;
  if (range !== 'all' && startIdx - len >= 0) {
    const prevRows = cycles.slice(startIdx - len, startIdx);
    const prevSpent = round2(sumOf(prevRows.map(r => r.totalExpenses)));
    if (prevSpent > 0) prev = { income: round2(sumOf(prevRows.map(r => r.receivedIncome))), spent: prevSpent };
  }

  const lastRow = rows[len - 1];
  const closingBalance = lastRow.available;
  const balanceLabel = lastRow.isCurrent ? 'Available now' : lastRow.isFuture ? 'Projected balance' : 'Balance at end';

  // ---- Written insights ----
  const insights: ReportInsight[] = [];
  const completed = rows.filter(r => !r.isCurrent && !r.isFuture);

  if (income > 0) {
    if (net < 0) insights.push({ tone: 'bad', title: 'Spending is above income', text: `You spent ${formatPHP(-net)} more than you received in this period.` });
    else if (savingsRate !== null && savingsRate >= 20) insights.push({ tone: 'good', title: 'Healthy savings rate', text: `You kept ${savingsRate.toFixed(0)}% of what you received (${formatPHP(net)}).` });
    else if (savingsRate !== null) insights.push({ tone: 'warn', title: 'Thin margin', text: `You kept only ${savingsRate.toFixed(0)}% of what you received (${formatPHP(net)}). A common goal is 20% or more.` });
  } else if (spent > 0) {
    insights.push({ tone: 'info', title: 'No income received yet', text: 'Nothing has been marked as received in this period, so the numbers below only show spending.' });
  }

  if (prev !== null) {
    const change = ((spent - prev.spent) / prev.spent) * 100;
    const progressNote = includesCurrent ? ' The current cycle is still in progress.' : '';
    if (Math.abs(change) < 5) insights.push({ tone: 'info', title: 'Spending is steady', text: `Within ${Math.abs(change).toFixed(0)}% of the previous ${RANGE_NOUN[range]} (${formatPHP(prev.spent)}).${progressNote}` });
    else insights.push({ tone: change > 0 ? 'warn' : 'good', title: change > 0 ? 'Spending is up' : 'Spending is down', text: `${Math.abs(change).toFixed(0)}% ${change > 0 ? 'higher' : 'lower'} than the previous ${RANGE_NOUN[range]} (${formatPHP(prev.spent)}).${progressNote}` });
  }

  if (expenseCats.length > 0 && spent > 0) {
    const top = expenseCats[0];
    insights.push({ tone: 'info', title: `${top.name} is your biggest category`, text: `${formatPHP(top.value)}, or ${((top.value / spent) * 100).toFixed(0)}% of everything you spent.` });
  }

  if (scheduledSpent > 0 && spent > 0) {
    insights.push({ tone: 'info', title: 'Scheduled vs logged spending', text: `${((scheduledSpent / spent) * 100).toFixed(0)}% of spending (${formatPHP(scheduledSpent)}) comes from your scheduled expenses. The other ${formatPHP(loggedSpent)} was logged by hand.` });
  }

  if (completed.length >= 1) {
    const over = completed.filter(r => r.totalExpenses > r.receivedIncome).length;
    if (over === 0) insights.push({ tone: 'good', title: 'No overspent cycles', text: `Every finished cycle in this period ended with income covering spending (${completed.length} of ${completed.length}).` });
    else insights.push({ tone: over === completed.length ? 'bad' : 'warn', title: 'Overspent cycles', text: `Spending went above income in ${over} of ${completed.length} finished ${completed.length === 1 ? 'cycle' : 'cycles'}.` });
  }

  if (completed.length >= 2) {
    const ranked = [...completed].sort((a, b) => (b.receivedIncome - b.totalExpenses) - (a.receivedIncome - a.totalExpenses));
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    insights.push({ tone: 'info', title: 'Best and toughest cycles', text: `Best: ${shortDate(best.startStr)} – ${shortDate(best.endStr)} (${formatPHP(best.receivedIncome - best.totalExpenses)} net). Toughest: ${shortDate(worst.startStr)} – ${shortDate(worst.endStr)} (${formatPHP(worst.receivedIncome - worst.totalExpenses)} net).` });
  }

  if (days >= 14 && loggedToDate.length >= 5) {
    const ranked = weekday.filter(w => w.total > 0).sort((a, b) => b.avg - a.avg);
    if (ranked.length >= 2) {
      const high = ranked[0];
      const low = ranked[ranked.length - 1];
      insights.push({ tone: 'info', title: 'Your priciest weekday', text: `On days you log spending, ${high.day} averages ${formatPHP(high.avg)} while ${low.day} averages ${formatPHP(low.avg)}.` });
    }
  }

  const loggedExpenseEntries = expenseEntries.filter(e => e.source === 'manual' && e.date <= asOf);
  if (loggedExpenseEntries.length > 0) {
    const biggest = loggedExpenseEntries.reduce((a, b) => (b.amount > a.amount ? b : a));
    insights.push({ tone: 'info', title: 'Largest logged expense', text: `${formatPHP(biggest.amount)} for "${biggest.label}" on ${longDate(biggest.date)}.` });
  }

  if (receivedIncomeEntries.length > 0 && incomeCats.length > 0 && income > 0) {
    const topInc = incomeCats[0];
    insights.push({ tone: 'info', title: `${topInc.name} is your main income`, text: `${formatPHP(topInc.value)}, or ${((topInc.value / income) * 100).toFixed(0)}% of what you received.` });
  }

  if (goalContrib > 0 || debtPaid > 0) {
    const parts = [goalContrib > 0 ? `${formatPHP(goalContrib)} went to savings goals` : '', debtPaid > 0 ? `${formatPHP(debtPaid)} went to debt payments` : ''].filter(Boolean);
    insights.push({ tone: 'good', title: 'Building your future', text: `${parts.join(' and ')} in this period.` });
  }

  if (includesCurrent && lastRow.isCurrent) {
    const left = daysBetween(todayStr, lastRow.endStr) + 1;
    if (lastRow.available < 0) {
      insights.push({ tone: 'bad', title: 'Over budget this cycle', text: `You're ${formatPHP(-lastRow.available)} below zero after scheduled expenses. Next cycle would start in the red unless income comes in.` });
    } else {
      insights.push({ tone: 'info', title: 'If you stop spending now', text: `You'd carry ${formatPHP(lastRow.available)} into the next cycle. To use it up evenly you could spend about ${formatPHP(lastRow.available / Math.max(1, left))} a day for the remaining ${plural(Math.max(1, left), 'day', 'days')}.` });
    }
  }

  if (completed.length > 0) {
    const missed = round2(sumOf(completed.map(r => r.pendingIncome)));
    if (missed > 0) insights.push({ tone: 'warn', title: 'Income never marked as received', text: `${formatPHP(missed)} of expected income in finished cycles isn't counted in your balance. Mark it received on the calendar if you did get it.` });
  }

  return {
    rows, startStr, endStr, asOf, days, includesCurrent, closingBalance, balanceLabel,
    income, pendingIncome, spent, scheduledSpent, loggedSpent, net, savingsRate,
    avgCycleIncome: income / len, avgCycleSpent: spent / len, avgDaily, goalContrib, debtPaid,
    expenseCats, incomeCats, topItems, weekday, series, prev, insights
  };
};

const TOOLTIP_STYLE = { borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' };

function InsightIcon({ tone }: { tone: InsightTone }) {
  if (tone === 'good') return <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />;
  if (tone === 'bad') return <TrendingDown className="w-4 h-4 shrink-0 mt-0.5" />;
  if (tone === 'warn') return <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />;
  return <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />;
}

const INSIGHT_BOX: Record<InsightTone, string> = {
  good: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  bad: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-slate-50 border-slate-200 text-slate-700'
};

function ReportStat({ title, value, sub, valueClass = 'text-gray-900' }: { title: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="atx-card p-4 rounded-xl shadow-sm">
      <p className="text-[11px] text-[var(--atx-text-muted)] font-medium">{title}</p>
      <p className={`text-xl font-bold mt-1 truncate ${valueClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="atx-card p-5 rounded-xl shadow-sm">
      <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function InsightsView({ cycles, viewedStartStr, cyclesPerMonth }: InsightsViewProps) {
  const [range, setRange] = useState<InsightRange>('1m');
  const [metricType, setMetricType] = useState<'expense' | 'income'>('expense');
  const todayStr = toYYYYMMDD(new Date());

  const report = useMemo(
    () => buildReport(cycles, range, viewedStartStr, cyclesPerMonth, todayStr),
    [cycles, range, viewedStartStr, cyclesPerMonth, todayStr]
  );

  const pieData = report ? (metricType === 'expense' ? report.expenseCats : report.incomeCats) : [];
  const pieTotal = sumOf(pieData.map(p => p.value));
  const hasData = !!report && report.rows.some(r => r.entries.length > 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="atx-card p-5 rounded-xl shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Financial Report</h2>
            {report && (
              <p className="text-xs text-gray-500 mt-1">
                {longDate(report.startStr)} – {longDate(report.endStr)} · {plural(report.rows.length, 'cycle', 'cycles')}
                {report.includesCurrent ? ' · includes the current cycle in progress' : ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
            {RANGE_OPTIONS.map(opt => (
              <button key={opt.id} onClick={() => setRange(opt.id)} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${range === opt.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {!report || !hasData ? (
        <div className="atx-card p-12 rounded-xl shadow-sm flex flex-col items-center justify-center text-gray-400">
          <PieChartIcon className="w-10 h-10 mb-2 opacity-20"/>
          <p className="text-sm italic">No data to display for this period.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <ReportStat title="Income received" value={formatPHP(report.income)} valueClass="text-emerald-600" sub={report.pendingIncome > 0 ? `+${formatPHP(report.pendingIncome)} still expected` : `${formatPHP(report.avgCycleIncome)} per cycle`} />
            <ReportStat title="Total spent" value={formatPHP(report.spent)} valueClass="text-rose-600" sub={`${formatPHP(report.avgCycleSpent)} per cycle`} />
            <ReportStat title="Net (income − spent)" value={formatPHP(report.net)} valueClass={report.net < 0 ? 'text-red-600' : 'text-gray-900'} sub="Before carry-over" />
            <ReportStat title="Savings rate" value={report.savingsRate === null ? '—' : `${report.savingsRate.toFixed(0)}%`} valueClass={report.savingsRate !== null && report.savingsRate < 0 ? 'text-red-600' : 'text-gray-900'} sub="Share of income kept" />
            <ReportStat title="Avg daily spend" value={formatPHP(report.avgDaily)} sub={report.days > 0 ? `Over ${plural(report.days, 'day', 'days')} so far` : 'No days elapsed yet'} />
            <ReportStat title={report.balanceLabel} value={formatPHP(report.closingBalance)} valueClass={report.closingBalance < 0 ? 'text-red-600' : 'text-blue-600'} sub="Includes carry-over" />
          </div>

          {report.insights.length > 0 && (
            <div className="atx-card p-5 rounded-xl shadow-sm">
              <h3 className="font-bold text-gray-900 text-sm mb-3 flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500"/> Insights</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.insights.map((item, i) => (
                  <div key={i} className={`p-3 rounded-lg border flex items-start gap-2.5 ${INSIGHT_BOX[item.tone]}`}>
                    <InsightIcon tone={item.tone} />
                    <div>
                      <p className="text-xs font-bold">{item.title}</p>
                      <p className="text-xs mt-0.5 opacity-90">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Income vs spending" subtitle="Received income and total spending for each cycle">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v: number) => compactPHP(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                    <RechartsTooltip formatter={(val: unknown) => formatPHP(Number(val ?? 0))} contentStyle={TOOLTIP_STYLE} />
                    <Legend iconType="circle" />
                    <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="spent" name="Spent" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="Balance over time" subtitle="Available balance at the end of each cycle, including carry-over">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={report.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v: number) => compactPHP(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                    <RechartsTooltip formatter={(val: unknown) => formatPHP(Number(val ?? 0))} contentStyle={TOOLTIP_STYLE} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                    <Area type="monotone" dataKey="balance" name="Balance" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title={metricType === 'expense' ? 'Where your money went' : 'Where your income came from'} subtitle={metricType === 'expense' ? 'Logged and scheduled expenses by category' : 'Received income by category'}>
              <div className="flex bg-gray-100 p-1 rounded-lg w-fit mb-2">
                <button onClick={() => setMetricType('expense')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${metricType === 'expense' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Expenses</button>
                <button onClick={() => setMetricType('income')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${metricType === 'income' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Income</button>
              </div>
              {pieData.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <PieChartIcon className="w-10 h-10 mb-2 opacity-20"/>
                  <p className="text-sm italic">No {metricType} data for this period.</p>
                </div>
              ) : (
                <>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                          {pieData.map((_, i) => <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip formatter={(val: unknown) => formatPHP(Number(val ?? 0))} contentStyle={TOOLTIP_STYLE}/>
                        <Legend verticalAlign="bottom" height={36} iconType="circle"/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {pieData.slice(0, 6).map((c, i) => (
                      <div key={c.name} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-gray-600"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}></span>{c.name}</span>
                        <span className="font-semibold text-gray-800">{formatPHP(c.value)} <span className="text-gray-400 font-normal">· {pieTotal > 0 ? ((c.value / pieTotal) * 100).toFixed(0) : 0}%</span></span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>

            <ChartCard title="Biggest expenses" subtitle="Top items by total amount (repeating items are combined)">
              {report.topItems.length === 0 ? (
                <p className="text-sm italic text-gray-400 py-10 text-center">No expenses in this period.</p>
              ) : (
                <div className="space-y-3">
                  {report.topItems.map(item => {
                    const widthPct = (item.value / report.topItems[0].value) * 100;
                    return (
                      <div key={item.name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-700 truncate pr-2">{item.name}{item.count > 1 ? <span className="text-gray-400 font-normal"> ×{item.count}</span> : null}</span>
                          <span className="font-bold text-rose-600 shrink-0">{formatPHP(item.value)}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className="bg-rose-400 h-1.5 rounded-full" style={{ width: `${widthPct}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Scheduled vs logged spending" subtitle="Fixed expenses you set up compared with what you logged by hand">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v: number) => compactPHP(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                    <RechartsTooltip formatter={(val: unknown) => formatPHP(Number(val ?? 0))} contentStyle={TOOLTIP_STYLE} />
                    <Legend iconType="circle" />
                    <Bar dataKey="scheduled" name="Scheduled" stackId="spend" fill="#94a3b8" />
                    <Bar dataKey="logged" name="Logged" stackId="spend" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="Logged spending by weekday" subtitle={report.days > 0 ? 'Average you logged per day, counting only days that have happened' : 'No days have elapsed yet'}>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.weekday} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v: number) => compactPHP(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                    <RechartsTooltip formatter={(val: unknown) => formatPHP(Number(val ?? 0))} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="avg" name="Average" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <div className="atx-card rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--atx-border)] bg-gray-50">
              <h3 className="font-bold text-gray-900 text-sm">Cycle by cycle</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Balance = Carried over + Income − Spent. Projected cycles use expected income.</p>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-white sticky top-0 text-[11px] text-gray-400">
                  <tr>
                    <th className="text-left font-semibold px-5 py-2">Cycle</th>
                    <th className="text-right font-semibold px-2 py-2">Carried over</th>
                    <th className="text-right font-semibold px-2 py-2">Income</th>
                    <th className="text-right font-semibold px-2 py-2">Spent</th>
                    <th className="text-right font-semibold px-2 py-2">Net</th>
                    <th className="text-right font-semibold px-5 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.series].reverse().map(p => (
                    <tr key={p.fullLabel} className="border-t border-gray-100">
                      <td className="px-5 py-2 text-gray-700 whitespace-nowrap">
                        {p.fullLabel}
                        {p.status && <span className="ml-2 text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">{p.status}</span>}
                      </td>
                      <td className={`px-2 py-2 text-right ${p.carryIn < 0 ? 'text-red-500' : 'text-gray-500'}`}>{formatPHP(p.carryIn)}</td>
                      <td className="px-2 py-2 text-right text-emerald-600">{formatPHP(p.income)}</td>
                      <td className="px-2 py-2 text-right text-rose-600">{formatPHP(p.spent)}</td>
                      <td className={`px-2 py-2 text-right font-semibold ${p.net < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatPHP(p.net)}</td>
                      <td className={`px-5 py-2 text-right font-bold ${p.balance < 0 ? 'text-red-600' : 'text-blue-600'}`}>{formatPHP(p.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 px-1">
            Spending for the current cycle includes scheduled expenses that are still due. Looking for your CSV export? It's now in Config.
          </p>
        </>
      )}
    </div>
  );
}


// Wraps a text cell for CSV. Quotes are escaped, and a leading = + - @ is neutralised so spreadsheets don't run it as a formula.
const csvText = (value: unknown) => {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function SettingsView({ settings, user, db, appId, fixedExpenses, incomeRules, expenses, incomes }: SettingsViewProps) {
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

  const handleExport = () => {
    const records: { date: string; line: string }[] = [];
    expenses.forEach(e => records.push({ date: e.date, line: ['Expense', e.date, csvText(e.description || e.name || ''), csvText(e.category || 'Other'), String(num(e.amount)), 'Spent', csvText(e.linkedType ? `${e.linkedType === 'goal' ? 'Savings goal' : 'Debt'} payment` : '')].join(',') }));
    incomes.forEach(i => records.push({ date: i.date, line: ['Income', i.date, csvText(i.name || i.description || ''), csvText(i.category || 'Other'), String(num(i.amount)), i.isReceived === false ? 'Expected' : 'Received', csvText(i.ruleId ? 'Scheduled income' : '')].join(',') }));
    records.sort((a, b) => a.date.localeCompare(b.date));

    const csv = ['Type,Date,Description,Category,Amount,Status,Note', ...records.map(r => r.line)].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Ataraxia_Export_${toYYYYMMDD(new Date())}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
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

      {/* Export */}
      <section className="atx-card p-5 rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Export All Data</h3>
          <p className="text-xs text-gray-500">Download your complete transaction history (CSV), {expenses.length + incomes.length} records.</p>
        </div>
        <button onClick={handleExport} className="bg-gray-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-800 transition-all flex items-center justify-center gap-2"><Download className="w-4 h-4" /> CSV</button>
      </section>
    </div>
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
