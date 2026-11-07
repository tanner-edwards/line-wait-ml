import { jumpEase, JUMP_MIN, P_FALL_JUMP_THRESHOLD } from './jumpEase';

// A neutral ride whose wait just went 30 -> 50 (p50 30 -> threshold 10).
function input(over: Partial<Parameters<typeof jumpEase>[0]> = {}, pred: Record<string, number | undefined> = {}) {
  return {
    verdict: 'neutral' as const,
    mlPred: { wait_now: 50, wait_prev: 30, p_fall_60: 0.8, ...pred },
    p50: 30,
    currentWait: 50,
    ...over,
  };
}

describe('jumpEase', () => {
  it('fires on a neutral or skip up-jump the model expects to ease', () => {
    expect(jumpEase(input())).toBe(true);
    expect(jumpEase(input({ verdict: 'skip' }))).toBe(true);
  });

  it('never fires on go or star', () => {
    expect(jumpEase(input({ verdict: 'go' }))).toBe(false);
    expect(jumpEase(input({ verdict: 'star' }))).toBe(false);
  });

  it('needs p_fall_60 at or above the threshold', () => {
    expect(jumpEase(input({}, { p_fall_60: P_FALL_JUMP_THRESHOLD }))).toBe(true);
    expect(jumpEase(input({}, { p_fall_60: 0.69 }))).toBe(false);
  });

  it('uses the 10-min floor on short rides', () => {
    expect(jumpEase(input({ currentWait: 40 }, { wait_now: 40, wait_prev: 30 }))).toBe(true);
    expect(jumpEase(input({ currentWait: 35 }, { wait_now: 35, wait_prev: 30 }))).toBe(false);
  });

  it('scales with the ride: 25% of p50 when that is bigger', () => {
    // p50 80 -> threshold 20
    expect(jumpEase(input({ p50: 80, currentWait: 75 }, { wait_now: 75, wait_prev: 60 }))).toBe(false);
    expect(jumpEase(input({ p50: 80, currentWait: 80 }, { wait_now: 80, wait_prev: 60 }))).toBe(true);
  });

  it('falls back to the floor when p50 is unknown', () => {
    expect(jumpEase(input({ p50: null, currentWait: 40 }, { wait_now: 40, wait_prev: 30 }))).toBe(true);
    expect(JUMP_MIN).toBe(10);
  });

  it('is off when the live wait is already back down', () => {
    expect(jumpEase(input({ currentWait: 35 }))).toBe(false);
    expect(jumpEase(input({ currentWait: null }))).toBe(false);
  });

  it('is off without the poll pair or the classifier (older cron image or model)', () => {
    expect(jumpEase(input({}, { wait_prev: undefined }))).toBe(false);
    expect(jumpEase(input({}, { wait_now: undefined }))).toBe(false);
    expect(jumpEase(input({}, { p_fall_60: undefined }))).toBe(false);
    expect(jumpEase(input({ mlPred: undefined }))).toBe(false);
  });

  it('down-jumps never fire', () => {
    expect(jumpEase(input({ currentWait: 30 }, { wait_now: 30, wait_prev: 50 }))).toBe(false);
  });
});
