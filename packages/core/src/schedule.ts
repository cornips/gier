import { DAY } from './deal/history';

const HOUR = 60 * 60 * 1000;

export interface SalesEvent {
  name: string;
  start: Date;
  end: Date;
}

/** Black Friday is the day after the fourth Thursday of November. */
export function blackFriday(year: number): Date {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstThursday = 1 + ((4 - nov1.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, 10, firstThursday + 21 + 1));
}

/**
 * Known sales periods around which prices move. Prime Day dates are announced by Amazon each year,
 * so they are configurable instead of computed.
 */
export function salesEvents(year: number, extra: SalesEvent[] = []): SalesEvent[] {
  const bf = blackFriday(year);
  return [
    {
      name: 'Singles Day',
      start: new Date(Date.UTC(year, 10, 9)),
      end: new Date(Date.UTC(year, 10, 12)),
    },
    {
      name: 'Black Friday',
      start: new Date(bf.getTime() - 10 * DAY),
      end: new Date(bf.getTime() + 4 * DAY),
    },
    {
      name: 'Boxing Day',
      start: new Date(Date.UTC(year, 11, 26)),
      end: new Date(Date.UTC(year, 11, 31)),
    },
    ...extra,
  ];
}

export interface ScheduleInput {
  now: Date;
  hasDealLabel: boolean;
  /** Number of price changes in the last 30 days. */
  recentChanges: number;
  failStreak: number;
  events?: SalesEvent[];
}

/** Adaptive check interval (ADR-006/010): 4–12 hours, faster during sales and when a deal label shows. */
export function nextCheckDelay(input: ScheduleInput): number {
  const events = input.events ?? salesEvents(input.now.getUTCFullYear());
  const inEvent = events.some((e) => input.now >= e.start && input.now <= e.end);
  let hours = input.recentChanges >= 6 ? 4 : input.recentChanges >= 2 ? 6 : 12;
  if (inEvent || input.hasDealLabel) hours = Math.min(hours, 4);
  if (input.failStreak > 0) hours = Math.min(48, hours * 2 ** Math.min(input.failStreak, 3));
  // Jitter of ±10% spreads requests so shops never see a fixed pattern.
  const jitter = 1 + (Math.random() * 0.2 - 0.1);
  return Math.round(hours * HOUR * jitter);
}
