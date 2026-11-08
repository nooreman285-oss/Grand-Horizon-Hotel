// Pure pricing functions (no DB access) so they are easy to unit test.
const round = n => Math.round(n * 100) / 100;

// One rate per night: base * weekend rule (Fri/Sat) * seasonal rule (date range)
function nightlyRates(base, ci, co, rules = []) {
  const out = [];
  const end = new Date(co + 'T00:00:00Z');
  for (const d = new Date(ci + 'T00:00:00Z'); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10), wd = d.getUTCDay();
    let m = 1;
    for (const r of rules) {
      if (r.type === 'weekend' && (wd === 5 || wd === 6)) m *= r.multiplier;
      if (r.type === 'season' && ds >= r.start_date && ds <= r.end_date) m *= r.multiplier;
    }
    out.push({ date: ds, rate: round(base * m) });
  }
  return out;
}

// total = (nights x rate + services - discount) + tax
function calc({ base, ci, co, rules = [], services = [], percent = 0, taxRate = +(process.env.TAX_RATE || 0.1) }) {
  const nights = nightlyRates(base, ci, co, rules);
  const roomTotal = round(nights.reduce((s, n) => s + n.rate, 0));
  const servicesTotal = round(services.reduce((s, x) => s + x.price * x.qty, 0));
  const subtotal = roomTotal + servicesTotal;
  const discount = round(subtotal * percent / 100);
  const tax = round((subtotal - discount) * taxRate);
  return { nights, nightCount: nights.length, roomTotal, servicesTotal, discount, tax, total: round(subtotal - discount + tax) };
}
module.exports = { nightlyRates, calc, round };
