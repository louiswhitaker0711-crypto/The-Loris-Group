/**
 * Tab registry — every screen that's eligible to live on the bottom bar
 * (or in the Profile Quick Access list when hidden).
 *
 * IDs are stable strings persisted to /api/me/tab-prefs. Adding a new tab
 * here is automatic — existing users will see it as visible by default
 * (controlled by `defaultVisibleByRole`).
 *
 * `kind: 'tab'` items are screens hosted inside the (tabs)/_layout.tsx
 * navigator — selecting them switches the current tab.
 * `kind: 'route'` items are external screens (push them onto the stack).
 */
import { Ionicons } from '@expo/vector-icons';

export type Role = 'trainee' | 'leader' | 'admin';

export type TabItem = {
  id: string;
  /** Short label shown on the bottom bar (max ~7 chars looks best). */
  label: string;
  /** Short label for the collapsed sidebar rail, when `label` is too long for it. */
  short?: string;
  /** Longer label shown in the customize screen. */
  longLabel: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** 'tab' = expo-router Tabs.Screen name; 'route' = push via router.push. */
  kind: 'tab' | 'route';
  /** For kind='tab' this is the screen name; for kind='route' the href. */
  target: string;
  visibleFor: Role[];
  /** Only shown while OwnerIQ is switched on. */
  needsOwnerIQ?: boolean;
  /** Whether this item is on by default in the bottom bar (per role). */
  defaultVisibleByRole: Partial<Record<Role, boolean>>;
};

// The streamlined side menu (the Owner, 29 Oct 2026): Home · Bells · Sector ·
// COD · Library · Planner (notes are written there; the Notes folder opens
// from it) · MGP · KPIs · Inbox · Admin, all showing, no "More". Everything that used to have its
// own item still exists, in one of these:
//   Performance Hub → Bells (Bells | Spider); the BAs list → tap a name on Bells;
//   Coaching library + Manual + Campaign Knowledge → Library; Coaching's
//   The Cycle and My Progress → COD; Quality → a Home card when the week's
//   report lands; Earnings + breakeven → Profile; Territory → Admin › Office
//   tools; Schedule opens from Profile (everyone knows the timetable).
export const TAB_REGISTRY: TabItem[] = [
  {
    id: 'home', label: 'Home', longLabel: 'Home Dashboard',
    icon: 'home-outline', kind: 'tab', target: 'index',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    // Was the Performance Hub; the id stays 'hires' so saved menus keep it.
    id: 'hires', label: 'Bells', longLabel: 'Bells — the weekly board and the spider diagram',
    icon: 'notifications-outline', kind: 'tab', target: 'hires',
    visibleFor: ['leader', 'admin'],
    defaultVisibleByRole: { leader: true, admin: true },
  },
  {
    // Everyone's day in their sector: set-up, the sector map, breakdown and
    // the 6pm reset; whoever leads the sector (Coach or BA) manages it here.
    id: 'my-sector', label: 'Sector', longLabel: 'Sector — set-up, map and breakdown for today',
    icon: 'people-circle-outline', kind: 'route', target: '/my-sector',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    // One surface for the whole Cycle of Development, a BA's journey included.
    id: 'progress', label: 'COD', longLabel: 'COD — Cycle of Development (all stages)',
    icon: 'trending-up-outline', kind: 'tab', target: 'progress',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    // Campaign Knowledge, the Training Manual, the Coaching library and the
    // BA Academy workbooks, in one place.
    id: 'library', label: 'Library', longLabel: 'Library — the playbook, the manual and coaching resources',
    icon: 'library-outline', kind: 'route', target: '/library',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },

  // Everything on the side menu, no "More" (the Owner, 29 Oct 2026).
  {
    id: 'weekly-planner', label: 'Planner', longLabel: 'Daily / Weekly Planner',
    icon: 'calendar-number-outline', kind: 'route', target: '/weekly-planner',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    id: 'mgp', label: 'MGP', longLabel: 'Monthly Goal Planners',
    icon: 'bar-chart-outline', kind: 'route', target: '/monthly-planner',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    id: 'field-kpis', label: 'KPIs', longLabel: 'Field KPIs',
    icon: 'speedometer-outline', kind: 'route', target: '/field-kpis',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    id: 'live-ops', label: 'Live Operations', short: 'Live Ops', longLabel: 'Live Operations — sectors in the field, door by door',
    icon: 'radio-outline', kind: 'route', target: '/live-ops',
    visibleFor: ['trainee', 'leader', 'admin'], needsOwnerIQ: true,
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    id: 'notifications', label: 'Inbox', longLabel: 'Inbox — Notification History',
    icon: 'mail-outline', kind: 'route', target: '/notifications',
    visibleFor: ['trainee', 'leader', 'admin'],
    defaultVisibleByRole: { trainee: true, leader: true, admin: true },
  },
  {
    id: 'admin', label: 'Admin', longLabel: 'Admin',
    icon: 'shield-outline', kind: 'tab', target: 'admin',
    visibleFor: ['admin'],
    defaultVisibleByRole: { admin: true },
  },
];

/** Menus saved before the streamline (29 Oct 2026) are set back to the new
 *  default once, so everyone gets the same short menu in the same order. */
export const MENU_RESET_AT = '2026-10-29T15:30:00Z';


/** Items eligible for a given user role. */
export function eligibleForRole(role: Role | undefined | null): TabItem[] {
  if (!role) return [];
  return TAB_REGISTRY.filter((t) => t.visibleFor.includes(role));
}


/** The default ordered list (visible items first) for a given role. */
export function defaultPrefsForRole(role: Role | undefined | null): { id: string; visible: boolean }[] {
  if (!role) return [];
  const items = eligibleForRole(role);
  return items.map((t) => ({
    id: t.id,
    visible: !!t.defaultVisibleByRole[role],
  }));
}


/** Resolve saved prefs against the registry, dropping items the user
 *  cannot see (e.g. role changed) and appending newly-added items at the
 *  bottom (visible by default per role). */
export function resolveTabPrefs(
  saved: { id: string; visible: boolean }[] | null | undefined,
  role: Role | undefined | null,
): { item: TabItem; visible: boolean }[] {
  if (!role) return [];
  const eligible = eligibleForRole(role);
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const out: { item: TabItem; visible: boolean }[] = [];
  const used = new Set<string>();
  for (const sv of saved || []) {
    if (!eligibleIds.has(sv.id) || used.has(sv.id)) continue;
    const item = eligible.find((e) => e.id === sv.id)!;
    out.push({ item, visible: !!sv.visible });
    used.add(sv.id);
  }
  // Append any new items not in saved prefs at end — except Home, which
  // goes FIRST so users with older saved prefs get it in the leftmost slot
  // (it's the landing screen; burying it past the 5-tab cutoff would make
  // it unreachable from the bar).
  for (const e of eligible) {
    if (used.has(e.id)) continue;
    const entry = { item: e, visible: !!e.defaultVisibleByRole[role] };
    if (e.id === 'home') out.unshift(entry);
    else out.push(entry);
  }
  return out;
}


/** Maximum pinned sidebar items (Profile is always there). The name is historical. */
export const MAX_BOTTOM_TABS = 12;
/** Minimum bottom-bar items the user must keep enabled. */
export const MIN_BOTTOM_TABS = 1;
