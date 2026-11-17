import * as fs from 'fs';
import * as path from 'path';
import {
  assignCodes,
  bucketsFor,
  buildRequestContext,
  buildRideLines,
  fieldShape,
  formatLocalTime,
  formatWindow,
  hhmmTo12h,
  minutesUntilClose,
  normalizeRideName,
  ofUsual,
  reachableBeforeClose,
  restrictedFor,
  TYPICAL_HEIGHT_IN,
  typicalHeightInches,
  vsUsual,
} from './buildPromptInputs';
import { RideForPrompt, RideLine } from './promptInputs';
import { HistoricalBucket, Persona, Ride, VerdictReasons } from '../types';

const LA = 'America/Los_Angeles';
const NY = 'America/New_York';

function reasons(over: Partial<VerdictReasons> = {}): VerdictReasons {
  return {
    primary: 'none', current: 0, typical: null, todayP30: null, todayP80: null,
    p10: null, p90: null, beatableSoon: true, betterWindowWait: null,
    betterWindowInMin: null, star: false, ...over,
  };
}

function ride(id: string, name: string, over: Partial<Ride> = {}): Ride {
  return {
    id, name, land: 'x', status: 'OPERATING', currentWait: 30,
    historicalAverage: null, rideStats: null, prediction: null, recentHistory: null,
    lat: null, lng: null, closedAt: null, verdict: null, ...over,
  };
}

function cand(id: string, name: string, walk: number | null, over: Partial<Ride> = {}): RideForPrompt {
  return { ride: ride(id, name, over), walkMinutes: walk, walkYards: walk === null ? null : walk * 80 };
}

function persona(over: Partial<Persona> = {}): Persona {
  return { tripDuration: null, youngestAge: null, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [], ...over };
}

function ha(waits: (number | null)[]) {
  return {
    dayType: 'weekend' as const,
    buckets: waits.map((wait, i) => ({
      offsetMinutes: i * 30, timeSlot: '13:30-14:00', wait, sampleCount: wait === null ? 0 : 10,
    })) as unknown as [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket],
  };
}

// ── assignCodes ──

describe('assignCodes', () => {
  it('assigns r1..rN nearest-first, ties by name, unknown walk last', () => {
    const map = assignCodes([
      cand('c', 'Space Mountain', 12),
      cand('n', 'No Coords', null),
      cand('b', 'Matterhorn Bobsleds', 3),
      cand('a', 'Alice in Wonderland', 3),
      cand('z', 'Buzz', 1),
    ]);
    expect([...map.entries()].map(([code, c]) => `${code}:${c.ride.id}`))
      .toEqual(['r1:z', 'r2:a', 'r3:b', 'r4:c', 'r5:n']);
  });

  it('produces unique sequential codes and keeps every candidate', () => {
    const cands = Array.from({ length: 30 }, (_, i) => cand(`id${i}`, `Ride ${i}`, i % 7));
    const map = assignCodes(cands);
    expect(map.size).toBe(30);
    expect([...map.keys()]).toEqual(Array.from({ length: 30 }, (_, i) => `r${i + 1}`));
    expect(new Set([...map.values()].map(c => c.ride.id)).size).toBe(30);
  });

  it('returns an empty map for no candidates', () => {
    expect(assignCodes([]).size).toBe(0);
  });
});

// ── ofUsual / vsUsual ──

describe('ofUsual', () => {
  it.each([
    [59, 'far-below'], [60, 'below'], [84, 'below'], [85, 'about'],
    [100, 'about'], [115, 'about'], [116, 'above'], [150, 'above'], [151, 'far-above'],
  ])('wait %i vs usual 100 → %s', (wait, label) => {
    expect(ofUsual(wait, 100)).toBe(label);
  });

  it('is null when either side is missing or usual is not positive', () => {
    expect(ofUsual(null, 30)).toBeNull();
    expect(ofUsual(30, null)).toBeNull();
    expect(ofUsual(30, 0)).toBeNull();
  });
});

describe('vsUsual', () => {
  it('is signed and rounded', () => {
    expect(vsUsual(25, 40)).toBe(-15);
    expect(vsUsual(55, 40)).toBe(15);
    expect(vsUsual(30, 27.6)).toBe(2);
  });
  it('is null when either side is missing', () => {
    expect(vsUsual(null, 30)).toBeNull();
    expect(vsUsual(30, null)).toBeNull();
  });
});

// ── restrictedFor ──

describe('restrictedFor', () => {
  it('pins the typical-height table to app/frontend/src/personaSort.ts', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../frontend/src/personaSort.ts'), 'utf8');
    const body = /TYPICAL_HEIGHT_IN[^=]*=\s*\{([^}]*)\}/.exec(src)?.[1];
    expect(body).toBeDefined();
    const frontend: Record<number, number> = {};
    for (const m of body!.matchAll(/(\d+)\s*:\s*(\d+)/g)) frontend[Number(m[1])] = Number(m[2]);
    expect(TYPICAL_HEIGHT_IN).toEqual(frontend);
    // Adult cut-over and fallback, mirrored from typicalHeightInches in the frontend.
    expect(src).toMatch(/age >= 13\) return 72/);
    expect(typicalHeightInches(13)).toBe(72);
    expect(typicalHeightInches(-1)).toBe(24);
  });

  it('flags toddler (age <= 3) or child when typical height is under the minimum', () => {
    const btm = ride('btm', 'Big Thunder', { heightMinIn: 40 });
    expect(restrictedFor(btm, persona({ youngestAge: 3 }))).toEqual(['toddler']); // 37 < 40
    expect(restrictedFor(btm, persona({ youngestAge: 4 }))).toEqual([]);          // 40, not under
    const indy = ride('indy', 'Indy', { heightMinIn: 46 });
    expect(restrictedFor(indy, persona({ youngestAge: 6 }))).toEqual(['child'])   // 45 < 46
    expect(restrictedFor(indy, persona({ youngestAge: 7 }))).toEqual([]);         // 48
    expect(restrictedFor(indy, persona({ youngestAge: 13 }))).toEqual([]);
  });

  it('flags pregnancy on an advisory or thrillLevel >= 4', () => {
    const p = persona({ accessibilityNeeds: ['pregnant'] });
    expect(restrictedFor(ride('a', 'A', { pregnancyAdvisory: true }), p)).toEqual(['pregnancy']);
    expect(restrictedFor(ride('b', 'B', { thrillLevel: 4 }), p)).toEqual(['pregnancy']);
    expect(restrictedFor(ride('c', 'C', { thrillLevel: 3 }), p)).toEqual([]);
  });

  it('flags wheelchair on transferRequired and sensory on thrillLevel >= 4', () => {
    expect(restrictedFor(ride('a', 'A', { transferRequired: true }), persona({ accessibilityNeeds: ['wheelchair'] })))
      .toEqual(['wheelchair']);
    expect(restrictedFor(ride('a', 'A', { transferRequired: false }), persona({ accessibilityNeeds: ['wheelchair'] })))
      .toEqual([]);
    expect(restrictedFor(ride('b', 'B', { thrillLevel: 5 }), persona({ accessibilityNeeds: ['sensory'] })))
      .toEqual(['sensory']);
    expect(restrictedFor(ride('b', 'B', { thrillLevel: 3 }), persona({ accessibilityNeeds: ['sensory'] })))
      .toEqual([]);
  });

  it('combines flags in a fixed order and is empty without a persona', () => {
    const r = ride('x', 'X', { heightMinIn: 44, thrillLevel: 5, pregnancyAdvisory: true, transferRequired: true });
    expect(restrictedFor(r, persona({ youngestAge: 2, accessibilityNeeds: ['sensory', 'wheelchair', 'pregnant', 'stroller'] })))
      .toEqual(['toddler', 'pregnancy', 'wheelchair', 'sensory']);
    expect(restrictedFor(r, null)).toEqual([]);
    expect(restrictedFor(r, persona())).toEqual([]);
  });
});

// ── fieldShape ──

function L(ofU: RideLine['ofUsual'], vs: number | null): Pick<RideLine, 'ofUsual' | 'vsUsual'> {
  return { ofUsual: ofU, vsUsual: vs };
}

describe('fieldShape', () => {
  it('bad: none below and at least half above', () => {
    expect(fieldShape([L('above', 10), L('about', 0)])).toBe('bad');
    expect(fieldShape([L('above', 10), L('about', 0), L('about', 2)])).toBe('mixed');
    expect(fieldShape([L('above', 10), L('far-above', 30), L('below', -5)])).toBe('mixed');
  });

  it('flat: none above and vsUsual spread under the cutoff', () => {
    expect(fieldShape([L('about', 0), L('below', -14)])).toBe('flat');
    expect(fieldShape([L('about', 0), L('below', -15)])).toBe('mixed');
    expect(fieldShape([L('about', 0), L('about', 1), L('above', 3)])).toBe('mixed');
  });

  it('ignores rides without a usual; all-unknown is mixed', () => {
    expect(fieldShape([L(null, null), L('about', 0), L('about', 4)])).toBe('flat');
    expect(fieldShape([L(null, null)])).toBe('mixed');
    expect(fieldShape([])).toBe('mixed');
  });

  const dir = path.join(__dirname, 'fixtures');
  const fixtures = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  it.each(fixtures)('reproduces field, ofUsual, vsUsual, and codes for fixture %s', file => {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as {
      context: { field: string }; rides: RideLine[];
    };
    expect(fieldShape(fx.rides)).toBe(fx.context.field);
    for (const r of fx.rides) {
      expect(ofUsual(r.wait, r.usual)).toBe(r.ofUsual);
      expect(vsUsual(r.wait, r.usual)).toBe(r.vsUsual);
    }
    expect(fx.rides.map(r => r.code)).toEqual(fx.rides.map((_, i) => `r${i + 1}`));
  });

  it('covers all three shapes across the fixtures', () => {
    const shapes = new Set(fixtures.map(f =>
      JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).context.field));
    expect([...shapes].sort()).toEqual(['bad', 'flat', 'mixed']);
  });
});

// ── closing math ──

describe('reachableBeforeClose', () => {
  it('is true when hours are unknown', () => {
    expect(reachableBeforeClose(60, null)).toBe(true);
    expect(reachableBeforeClose(null, null)).toBe(true);
  });
  it('needs the walk to fit strictly before close', () => {
    expect(reachableBeforeClose(9, 10)).toBe(true);
    expect(reachableBeforeClose(10, 10)).toBe(false);
    expect(reachableBeforeClose(null, 1)).toBe(true);
    expect(reachableBeforeClose(null, 0)).toBe(false);
  });
});

describe('minutesUntilClose', () => {
  // 2026-11-14 is a Saturday; PST is UTC-8.
  const at = (iso: string) => new Date(iso);
  it('is null without hours', () => {
    expect(minutesUntilClose(null, at('2026-11-14T21:30:00Z'), LA)).toBeNull();
  });
  it('counts to close in the park zone', () => {
    expect(minutesUntilClose({ open: '08:00', close: '23:00' }, at('2026-11-14T21:30:00Z'), LA)).toBe(570);
  });
  it('handles a midnight or later close', () => {
    expect(minutesUntilClose({ open: '08:00', close: '00:00' }, at('2026-11-15T07:00:00Z'), LA)).toBe(60);  // 11 PM
    expect(minutesUntilClose({ open: '08:00', close: '01:00' }, at('2026-11-15T08:30:00Z'), LA)).toBe(30);  // 12:30 AM
  });
  it('clamps to 0 after close', () => {
    expect(minutesUntilClose({ open: '08:00', close: '22:00' }, at('2026-11-15T06:30:00Z'), LA)).toBe(0);   // 10:30 PM
  });
  it('is null on malformed hours', () => {
    expect(minutesUntilClose({ open: '??:??', close: '23:00' }, at('2026-11-14T21:30:00Z'), LA)).toBeNull();
  });
});

describe('hhmmTo12h', () => {
  it('formats 24h strings', () => {
    expect(hhmmTo12h('23:00')).toBe('11:00 PM');
    expect(hhmmTo12h('00:00')).toBe('12:00 AM');
    expect(hhmmTo12h('12:30')).toBe('12:30 PM');
    expect(hhmmTo12h('08:05')).toBe('8:05 AM');
    expect(hhmmTo12h('nope')).toBeNull();
  });
});

// ── window ──

describe('formatWindow', () => {
  const onePM30 = new Date('2026-11-14T21:30:00Z'); // 1:30 PM PST
  it('turns minutes-from-now into a local clock time', () => {
    expect(formatWindow(reasons({ betterWindowWait: 95, betterWindowInMin: 390 }), onePM30, LA))
      .toEqual({ wait: 95, at: '8:00 PM' });
  });
  it('rounds to the nearest 5 minutes and rounds the wait', () => {
    expect(formatWindow(reasons({ betterWindowWait: 39.6, betterWindowInMin: 392 }), onePM30, LA))
      .toEqual({ wait: 40, at: '8:00 PM' });
    expect(formatWindow(reasons({ betterWindowWait: 40, betterWindowInMin: 393 }), onePM30, LA)!.at).toBe('8:05 PM');
  });
  it('crosses midnight', () => {
    const elevenThirty = new Date('2026-11-15T07:30:00Z'); // 11:30 PM PST
    expect(formatWindow(reasons({ betterWindowWait: 20, betterWindowInMin: 45 }), elevenThirty, LA))
      .toEqual({ wait: 20, at: '12:15 AM' });
  });
  it('uses the zone it is given', () => {
    expect(formatWindow(reasons({ betterWindowWait: 20, betterWindowInMin: 30 }), onePM30, NY)!.at).toBe('5:00 PM');
  });
  it('emits far-out windows (no horizon cutoff)', () => {
    expect(formatWindow(reasons({ betterWindowWait: 50, betterWindowInMin: 540 }), onePM30, LA)!.at).toBe('10:30 PM');
  });
  it('is null without a window', () => {
    expect(formatWindow(null, onePM30, LA)).toBeNull();
    expect(formatWindow(reasons(), onePM30, LA)).toBeNull();
    // A window the engine does not rate beatableSoon is noise, not evidence.
    expect(formatWindow(reasons({ betterWindowWait: 9, betterWindowInMin: 570, beatableSoon: false }), onePM30, LA)).toBeNull();
    expect(formatWindow(reasons({ betterWindowWait: 40 }), onePM30, LA)).toBeNull();
    expect(formatWindow(reasons({ betterWindowInMin: 40 }), onePM30, LA)).toBeNull();
  });
});

describe('formatLocalTime', () => {
  it('reads "Weekday h:mm AM/PM" with a plain space', () => {
    expect(formatLocalTime(new Date('2026-11-14T21:30:00Z'), LA)).toBe('Saturday 1:30 PM');
  });
});

// ── buckets ──

describe('bucketsFor', () => {
  it('returns t+0..t+120 rounded, length 5', () => {
    expect(bucketsFor(ride('a', 'A', { historicalAverage: ha([25.4, 27.6, null, 30, 32.5, 99]) })))
      .toEqual([25, 28, null, 30, 33]);
  });
  it('is five nulls without history', () => {
    expect(bucketsFor(ride('a', 'A'))).toEqual([null, null, null, null, null]);
  });
});

// ── assembly ──

describe('buildRideLines + buildRequestContext', () => {
  const now = new Date('2026-11-14T21:30:00Z'); // Saturday 1:30 PM PST
  const codeMap = assignCodes([
    cand('uuid-space', 'Space Mountain', 3, {
      currentWait: 15, heightMinIn: 40, thrillLevel: 4,
      historicalAverage: ha([15, 25, 35, 38, 40, 41]),
      verdict: { verdict: 'star', reasons: reasons({ primary: 'rare-low', typical: 45 }) },
    }),
    cand('uuid-buzz', 'Buzz Lightyear Astro Blasters', 1, {
      currentWait: 25,
      verdict: { verdict: 'neutral', reasons: reasons({ typical: 30, betterWindowWait: 15, betterWindowInMin: 390 }) },
    }),
    cand('uuid-mh', 'Matterhorn Bobsleds', 8, { currentWait: 25, verdict: null }),
  ]);
  const lines = buildRideLines(codeMap, {
    persona: persona({ youngestAge: 3, mustDoRideIds: ['uuid-mh'] }),
    reopens: new Map([['uuid-space', 20]]),
    anchorRideId: 'uuid-buzz',
    now,
    timeZone: LA,
  });

  it('builds every RideLine field', () => {
    expect(lines).toEqual([
      {
        code: 'r1', rideId: 'uuid-buzz', name: 'Buzz Lightyear Astro Blasters',
        wait: 25, arrive: 25, usual: 30, ofUsual: 'below', vsUsual: -5, walk: 1,
        verdict: 'neutral', reason: 'none', wanted: false, restricted: [],
        reopenedMinAgo: null, buckets: [null, null, null, null, null], trend: null,
        // 390 min out is beyond WINDOW_MAX_MIN, so the window is withheld from the model.
        window: null, isAnchor: true,
      },
      {
        code: 'r2', rideId: 'uuid-space', name: 'Space Mountain',
        wait: 15, arrive: 16, usual: 45, ofUsual: 'far-below', vsUsual: -30, walk: 3,
        verdict: 'star', reason: 'rare-low', wanted: false, restricted: ['toddler'],
        reopenedMinAgo: 20, buckets: [15, 25, 35, 38, 40], trend: 'rising',
        window: null, isAnchor: false,
      },
      {
        code: 'r3', rideId: 'uuid-mh', name: 'Matterhorn Bobsleds',
        wait: 25, arrive: 25, usual: null, ofUsual: null, vsUsual: null, walk: 8,
        verdict: 'neutral', reason: 'none', wanted: true, restricted: [],
        reopenedMinAgo: null, buckets: [null, null, null, null, null], trend: null,
        window: null, isAnchor: false,
      },
    ]);
  });

  it('never puts a UUID where the model reads a code', () => {
    for (const l of lines) expect(l.code).toMatch(/^r\d+$/);
  });

  it('builds the request context', () => {
    expect(buildRequestContext({
      parkSlug: 'disneyland', now, parkHours: { open: '08:00', close: '23:00' },
      lines, weather: '71F, feels like 71, clear', batchSize: 6,
    })).toEqual({
      park: 'Disneyland',
      localTime: 'Saturday 1:30 PM',
      closesAt: '11:00 PM',
      minutesUntilClose: 570,
      field: 'mixed',
      weather: '71F, feels like 71, clear',
      anchor: { code: 'r1', name: 'Buzz Lightyear Astro Blasters' },
      batchSize: 6,
    });
  });

  it('has null hours fields and no anchor when unknown', () => {
    const ctx = buildRequestContext({
      parkSlug: 'california-adventure', now, parkHours: null,
      lines: lines.map(l => ({ ...l, isAnchor: false })), weather: null, batchSize: 6,
    });
    expect(ctx.park).toBe('Disney California Adventure');
    expect(ctx.closesAt).toBeNull();
    expect(ctx.minutesUntilClose).toBeNull();
    expect(ctx.anchor).toBeNull();
  });
});

describe('normalizeRideName', () => {
  it('lowercases, strips punctuation and diacritics, collapses whitespace', () => {
    expect(normalizeRideName("  Peter Pan’s   Flight ")).toBe('peter pans flight');
    expect(normalizeRideName('Guardians of the Galaxy – Mission: BREAKOUT!'))
      .toBe(normalizeRideName('guardians of the galaxy - mission breakout'));
    expect(normalizeRideName('Café')).toBe('cafe');
  });
});
