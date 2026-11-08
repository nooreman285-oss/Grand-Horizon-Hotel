// Unit tests for the validators shared with the frontend, and for pricing logic.
const V = require('../../public/js/validators');
const { calc, nightlyRates } = require('../pricing');

describe('shared validators (used by browser + server)', () => {
  test('dates: past, reversed and valid ranges', () => {
    expect(V.dates('2020-01-01', '2020-01-03', '2026-01-01')).toMatch(/Past/);
    expect(V.dates('2026-02-05', '2026-02-05', '2026-01-01')).toMatch(/after check-in/);
    expect(V.dates('2026-02-05', '2026-02-07', '2026-01-01')).toBeNull();
  });
  test('signup: flags bad name, email and password', () => {
    expect(Object.keys(V.signup({ name: 'A', email: 'nope', password: 'short' })).sort()).toEqual(['email', 'name', 'password']);
    expect(V.signup({ name: 'Noor Eman', email: 'a@b.co', password: 'longenough' })).toEqual({});
  });
  test('image: rejects wrong type and files over 2MB', () => {
    expect(V.image({ type: 'application/pdf', size: 100 })).toMatch(/JPG/);
    expect(V.image({ type: 'image/png', size: 3 * 1024 * 1024 })).toMatch(/2 MB/);
    expect(V.image({ type: 'image/jpeg', size: 1000 })).toBeNull();
  });
});

describe('pricing', () => {
  test('weekend rule applies per night (Fri+Sat x1.5, Sun x1)', () => {
    const rules = [{ type: 'weekend', multiplier: 1.5 }];
    const n = nightlyRates(100, '2030-01-04', '2030-01-07', rules); // Fri, Sat, Sun
    expect(n.map(x => x.rate)).toEqual([150, 150, 100]);
  });
  test('seasonal rule + discount + tax produce the right total', () => {
    const rules = [{ type: 'season', multiplier: 2, start_date: '2030-02-01', end_date: '2030-02-10' }];
    const r = calc({ base: 100, ci: '2030-02-02', co: '2030-02-04', rules, services: [{ price: 50, qty: 2 }], percent: 10, taxRate: 0.1 });
    // room 400 + services 100 = 500; discount 50; tax 45; total 495
    expect([r.roomTotal, r.servicesTotal, r.discount, r.tax, r.total]).toEqual([400, 100, 50, 45, 495]);
  });
});
