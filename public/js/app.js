/* Grand Horizon: single-page frontend (hash routing, no build step). */
const API = window.API_URL || '';
const $ = (s, e = document) => e.querySelector(s), $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'Rs ' + Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const S = { token: localStorage.getItem('token'), user: JSON.parse(localStorage.getItem('user') || 'null') };

// ---------- helpers ----------
function toast(m, t = 'ok') { const d = document.createElement('div'); d.className = 'toast ' + t; d.textContent = m; $('#toasts').append(d); setTimeout(() => d.remove(), 3500); }
async function api(path, o = {}) {
  const isForm = o.body instanceof FormData, h = {};
  if (!isForm) h['Content-Type'] = 'application/json';
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  let r;
  try { r = await fetch(API + '/api' + path, { ...o, headers: h, body: o.body && !isForm ? JSON.stringify(o.body) : o.body }); }
  catch { throw new Error('Cannot reach the server. Check your connection.'); }
  if ((r.headers.get('content-type') || '').includes('application/pdf')) return r.blob();
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && S.token) logout(); throw Object.assign(new Error(d.error || 'Request failed'), { fields: d.fields }); }
  return d;
}
const view = h => { $('#app').innerHTML = h; window.scrollTo(0, 0); };
const empty = (t, s = '') => `<div class="state"><h3>${t}</h3><p class="muted">${s}</p></div>`;
const errorBox = m => `<div class="state err"><h3>Something went wrong</h3><p>${esc(m)}</p><button class="btn" onclick="route()">Try again</button></div>`;
const sk = n => `<div class="grid">${'<div class="card sk"></div>'.repeat(n)}</div>`;
const inp = (l, n, t = 'text', x = '') => `<label>${l}<input name="${n}" type="${t}" ${x}><small data-f="${n}"></small></label>`;
const fd = f => Object.fromEntries(new FormData(f));
const fe = (f, errs = {}) => $$('[data-f]', f).forEach(s => s.textContent = errs[s.dataset.f] || '');
const chk = errs => { if (Object.keys(errs).length) throw Object.assign(new Error('Please fix the highlighted fields'), { fields: errs }); };
const img = u => u.startsWith('http') ? u : API + u;
const stars = n => n ? `<span class="stars">★</span> ${n}` : '';
const tbl = (heads, rows) => `<div class="scroll"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function modal(title, body, onSubmit, save = 'Save') {
  const d = document.createElement('dialog');
  d.innerHTML = `<form novalidate><h3>${title}</h3>${body}<div class="actions"><button type="button" class="btn ghost" data-x>Cancel</button>${onSubmit ? `<button class="btn">${save}</button>` : ''}</div></form>`;
  document.body.append(d); d.showModal();
  const close = () => { d.close(); d.remove(); }, f = $('form', d);
  $('[data-x]', d).onclick = close; d.addEventListener('cancel', () => d.remove());
  f.onsubmit = async e => { e.preventDefault(); if (!onSubmit) return close(); try { await onSubmit(f); close(); } catch (x) { fe(f, x.fields); toast(x.message, 'bad'); } };
  return d;
}
function logout() { localStorage.clear(); S.token = null; S.user = null; location.hash = '#/login'; nav(); }
function nav() {
  const u = S.user;
  $('#nav').innerHTML = `<a href="#/">Rooms</a>` + (u ? (u.role === 'guest' ? `<a href="#/my">My bookings</a>` : `<a href="#/reception">Reception</a>`) +
    (u.role === 'admin' ? `<a href="#/admin">Admin</a>` : '') + `<span class="who">${esc(u.name)} (${u.role})</span><button id="lo" class="btn ghost sm">Log out</button>` : `<a class="btn sm" href="#/login">Log in</a>`);
  $('#lo')?.addEventListener('click', logout);
}

// ---------- router ----------
async function route() {
  const [path, q] = (location.hash || '#/').split('?'), P = new URLSearchParams(q || ''), full = location.hash || '#/';
  nav();
  const need = roles => {
    if (!S.user) { location.hash = '#/login?next=' + encodeURIComponent(full); return false; }
    if (roles && !roles.includes(S.user.role)) { view(empty('Access denied', 'Your role cannot open this page.')); return false; }
    return true;
  };
  let m;
  try {
    if (path === '#/' || path === '#') await home(P);
    else if ((m = path.match(/^#\/room\/(\d+)/))) await roomPage(m[1], P);
    else if ((m = path.match(/^#\/book\/(\d+)/))) { if (need()) await bookPage(m[1], P); }
    else if (path === '#/my') { if (need(['guest'])) await myBookings(); }
    else if (path === '#/reception') { if (need(['receptionist', 'admin'])) await reception(); }
    else if (path === '#/admin') { if (need(['admin'])) await admin(); }
    else if (path === '#/login') loginPage(P);
    else view(empty('Page not found', '<a href="#/">Back to rooms</a>'));
  } catch (e) { view(errorBox(e.message)); }
}
window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ---------- login / signup ----------
function loginPage(P) {
  let mode = 'login';
  const draw = () => {
    view(`<div class="auth card"><h2>${mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
      <form id="f" novalidate>${mode === 'signup' ? inp('Full name', 'name') : ''}${inp('Email', 'email', 'email')}${inp('Password', 'password', 'password')}
      <button class="btn wide">${mode === 'login' ? 'Login' : 'Sign up'}</button></form>
      <p class="muted">${mode === 'login' ? 'New guest?' : 'Already registered?'} <a href="#" id="sw">${mode === 'login' ? 'Create an account' : 'Log in'}</a></p>
      <p class="muted small">Demo staff: admin@hotel.com / Admin@123 and reception@hotel.com / Reception@123</p></div>`);
    $('#sw').onclick = e => { e.preventDefault(); mode = mode === 'login' ? 'signup' : 'login'; draw(); };
    $('#f').onsubmit = async e => {
      e.preventDefault(); const b = fd(e.target), errs = V[mode](b); fe(e.target, errs); if (Object.keys(errs).length) return;
      try {
        const r = await api('/auth/' + mode, { method: 'POST', body: b });
        S.token = r.token; S.user = r.user; localStorage.setItem('token', r.token); localStorage.setItem('user', JSON.stringify(r.user));
        toast('Welcome, ' + r.user.name);
        location.hash = P.get('next') || (r.user.role === 'guest' ? '#/' : r.user.role === 'admin' ? '#/admin' : '#/reception');
      } catch (x) { fe(e.target, x.fields); toast(x.message, 'bad'); }
    };
  };
  draw();
}

// ---------- 1. home / room search ----------
const card = (r, b = {}) => `<a class="card room" href="#/room/${r.id}?ci=${b.checkIn || ''}&co=${b.checkOut || ''}">
  <div class="img" style="${r.images[0] ? `background-image:url('${img(r.images[0])}')` : ''}">${r.images[0] ? '' : esc(r.type)}</div>
  <div class="body"><div class="row"><h3>${esc(r.type)} ${esc(r.number)}</h3><span class="badge ${r.liveStatus}">${r.liveStatus}</span></div>
  <p class="muted">Up to ${r.capacity} guest${r.capacity > 1 ? 's' : ''} ${r.avgRating ? '· ' + stars(r.avgRating) + ` (${r.reviewCount})` : ''}</p>
  <p class="price">${money(r.price)}<small> / night</small></p></div></a>`;

async function home(P) {
  view(`<section class="hero"><h1>Find your perfect stay</h1><p>Pick your dates and see only the rooms that are free.</p>
    <form id="sf" class="search" novalidate>
      <label>Check-in<input type="date" name="checkIn" min="${today()}" value="${P.get('checkIn') || ''}"></label>
      <label>Check-out<input type="date" name="checkOut" min="${today()}" value="${P.get('checkOut') || ''}"></label>
      <label>Room type<select name="type"><option value="">Any</option>${V.TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
      <label>Guests<input type="number" name="capacity" min="1" max="10" placeholder="Any"></label>
      <label>Min price<input type="number" name="minPrice" min="0" placeholder="0"></label>
      <label>Max price<input type="number" name="maxPrice" min="0" placeholder="Any"></label>
      <button class="btn">Search</button></form><small class="formerr" id="dateErr"></small></section><div id="res"></div>`);
  const run = async () => {
    const b = fd($('#sf')), hasDates = b.checkIn || b.checkOut;
    const e = hasDates ? V.dates(b.checkIn, b.checkOut, today()) : null;
    $('#dateErr').textContent = e || ''; if (e) return;
    $('#res').innerHTML = sk(6);
    try {
      const rooms = await api('/rooms?' + new URLSearchParams(Object.entries(b).filter(([, v]) => v)));
      $('#res').innerHTML = rooms.length ? `<div class="grid">${rooms.map(r => card(r, b)).join('')}</div>` : empty('No rooms match your search', 'Try different dates or loosen the price and guest filters.');
    } catch (x) { $('#res').innerHTML = errorBox(x.message); }
  };
  $('#sf').onsubmit = e => { e.preventDefault(); run(); };
  run();
}

// ---------- 2. room details ----------
async function roomPage(id, P) {
  view(sk(1));
  const r = await api('/rooms/' + id), ci = P.get('ci'), co = P.get('co');
  const g = r.images.length ? r.images.slice(0, 3).map(u => `<div class="img" style="background-image:url('${img(u)}')"></div>`).join('') : `<div class="img">${esc(r.type)}</div>`;
  view(`<a href="#/">← All rooms</a><div class="two" style="margin-top:12px"><div><div class="gallery">${g}</div>
    <h1>${esc(r.type)} ${esc(r.number)}</h1><p class="muted">${r.avgRating ? stars(r.avgRating) + ` from ${r.reviewCount} review${r.reviewCount > 1 ? 's' : ''}` : 'No reviews yet'}</p>
    <p>${esc(r.description)}</p><h4>Amenities</h4><p>${r.amenities.map(a => `<span class="badge">${esc(a)}</span>`).join(' ') || '<span class="muted">None listed</span>'}</p>
    <h3>Guest reviews</h3>${r.reviews.length ? r.reviews.map(v => `<div class="card pad" style="margin-bottom:8px"><b>${esc(v.name)}</b> <span class="stars">${'★'.repeat(v.rating)}</span><p>${esc(v.comment)}</p></div>`).join('') : empty('No reviews yet', 'Reviews appear after guests complete a stay.')}</div>
    <aside class="card pad" style="align-self:start"><p class="price">${money(r.price)}<small> / night</small></p><p class="muted">Sleeps ${r.capacity} · <span class="badge ${r.liveStatus}">${r.liveStatus}</span></p>
    <p class="muted small">Weekend and seasonal rates are applied automatically at booking.</p>
    <a class="btn wide" href="#/book/${r.id}?ci=${ci || ''}&co=${co || ''}">Book this room</a></aside></div>`);
}

// ---------- 3. booking + payment summary ----------
const summary = q => `<h3>Payment summary</h3><table class="sum"><tbody>
  ${q.nights.length <= 7 ? q.nights.map(n => `<tr><td class="muted">${n.date}</td><td>${money(n.rate)}</td></tr>`).join('') : ''}
  <tr><td>Room (${q.nightCount} night${q.nightCount > 1 ? 's' : ''})</td><td>${money(q.roomTotal)}</td></tr>
  ${q.services.map(s => `<tr><td>${esc(s.name)} × ${s.qty}</td><td>${money(s.price * s.qty)}</td></tr>`).join('')}
  ${q.discount ? `<tr><td>Discount</td><td>- ${money(q.discount)}</td></tr>` : ''}
  <tr><td>Tax</td><td>${money(q.tax)}</td></tr><tr><td><b>Total</b></td><td><b>${money(q.total)}</b></td></tr></tbody></table>
  <p class="muted small">Payment is collected at the hotel. The room is held as soon as you confirm.</p>`;

async function bookPage(id, P) {
  view(sk(1));
  const [room, services] = await Promise.all([api('/rooms/' + id), api('/services')]), staff = S.user.role !== 'guest';
  view(`<div class="two"><form id="bf" class="card pad" novalidate><h2>Book ${esc(room.type)} ${esc(room.number)}</h2>
    ${staff ? inp('Guest name', 'guestName') + inp('Guest email (optional, links to their account)', 'guestEmail', 'email') : ''}
    <div class="cols">${inp('Check-in', 'checkIn', 'date', `min="${today()}" value="${P.get('ci') || ''}"`)}${inp('Check-out', 'checkOut', 'date', `min="${today()}" value="${P.get('co') || ''}"`)}</div>
    ${inp('Guests', 'guests', 'number', `min="1" max="${room.capacity}" value="1"`)}
    <h4>Add services</h4>${services.map(s => `<label class="chk"><input type="checkbox" name="svc" value="${s.id}"> ${esc(s.name)} <span class="muted">${money(s.price)}</span></label>`).join('') || '<p class="muted">No services available.</p>'}
    ${inp('Discount code (optional)', 'code')}<small class="formerr" data-f="_"></small><button class="btn wide" id="bb">Confirm booking</button></form>
    <aside class="card pad" id="sum" style="align-self:start"></aside></div>`);
  const f = $('#bf');
  const get = () => ({ roomId: +id, checkIn: f.checkIn.value, checkOut: f.checkOut.value, guests: +f.guests.value, code: f.code.value.trim(),
    services: $$('[name=svc]:checked', f).map(x => +x.value), ...(staff ? { guestName: f.guestName.value, guestEmail: f.guestEmail.value } : {}) });
  const upd = async () => {
    const b = get(), e = V.dates(b.checkIn, b.checkOut, today());
    if (e) { $('#sum').innerHTML = `<h3>Payment summary</h3><p class="muted">${esc(e)}</p>`; return false; }
    try {
      const q = await api('/quote?' + new URLSearchParams({ roomId: b.roomId, checkIn: b.checkIn, checkOut: b.checkOut, services: b.services.join(','), code: b.code }));
      $('#sum').innerHTML = summary(q); return true;
    } catch (x) { $('#sum').innerHTML = `<h3>Payment summary</h3><p class="bad-t">${esc(x.message)}</p>`; return false; }
  };
  f.addEventListener('change', upd); upd();
  f.onsubmit = async e => {
    e.preventDefault(); const b = get(), errs = {};
    const de = V.dates(b.checkIn, b.checkOut, today()); if (de) errs.checkIn = de;
    if (!(b.guests >= 1 && b.guests <= room.capacity)) errs.guests = `Enter 1 to ${room.capacity} guests`;
    if (staff && b.guestName.trim().length < 2) errs.guestName = 'Guest name is required';
    fe(f, errs); if (Object.keys(errs).length) return;
    $('#bb').disabled = true;
    try { await api('/bookings', { method: 'POST', body: b }); toast('Booking confirmed'); location.hash = staff ? '#/reception' : '#/my'; }
    catch (x) { fe(f, x.fields); $('[data-f=_]', f).textContent = x.message; toast(x.message, 'bad'); $('#bb').disabled = false; }
  };
}

// ---------- 4. my bookings (guest dashboard) ----------
async function myBookings() {
  view(sk(3));
  const list = await api('/bookings');
  view(`<h1>My bookings</h1>` + (list.length ? list.map(b => `<div class="card bk"><div class="row"><h3>${esc(b.room_type)} ${esc(b.room_number)}</h3><span class="badge ${b.status}">${b.status}</span></div>
    <p>${b.check_in} → ${b.check_out} · ${b.nights} night${b.nights > 1 ? 's' : ''} · ${b.guests} guest${b.guests > 1 ? 's' : ''}</p>
    <p class="muted">${b.services.map(s => esc(s.name)).join(', ') || 'No extra services'} · <b>${money(b.total)}</b></p>
    <div class="acts">${b.status === 'Confirmed' ? `<button class="btn sm ghost" data-a="modify" data-id="${b.id}">Change dates</button><button class="btn sm danger" data-a="cancel" data-id="${b.id}">Cancel</button>` : ''}
    ${b.status === 'Completed' ? `<button class="btn sm" data-a="invoice" data-id="${b.id}">Download invoice</button>${b.reviewed ? '<span class="muted">Reviewed</span>' : `<button class="btn sm ghost" data-a="review" data-id="${b.id}">Rate your stay</button>`}` : ''}</div></div>`).join('')
    : empty('No bookings yet', '<a href="#/">Search rooms</a> to make your first booking.')));
  $$('[data-a]').forEach(btn => btn.onclick = async () => {
    const b = list.find(x => x.id == btn.dataset.id), a = btn.dataset.a;
    try {
      if (a === 'cancel') { if (!confirm('Cancel this booking?')) return; await api(`/bookings/${b.id}/cancel`, { method: 'POST' }); toast('Booking cancelled'); myBookings(); }
      if (a === 'invoice') { const blob = await api(`/bookings/${b.id}/invoice`); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `invoice-${b.id}.pdf`; l.click(); }
      if (a === 'modify') {
        const services = await api('/services');
        modal('Change your stay', `${inp('Check-in', 'checkIn', 'date', `min="${today()}" value="${b.check_in}"`)}${inp('Check-out', 'checkOut', 'date', `min="${today()}" value="${b.check_out}"`)}
          <h4>Services</h4>${services.map(s => `<label class="chk"><input type="checkbox" name="svc" value="${s.id}" ${b.services.some(x => x.id === s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}`,
        async f => {
          const v = fd(f), e = V.dates(v.checkIn, v.checkOut, today()); if (e) chk({ checkIn: e });
          await api('/bookings/' + b.id, { method: 'PUT', body: { checkIn: v.checkIn, checkOut: v.checkOut, services: $$('[name=svc]:checked', f).map(x => +x.value) } });
          toast('Booking updated'); myBookings();
        });
      }
      if (a === 'review') modal('Rate your stay', `<label>Rating<select name="rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select><small data-f="rating"></small></label><label>Comment<textarea name="comment" maxlength="500"></textarea><small data-f="comment"></small></label>`,
        async f => { const v = fd(f); chk(V.review(v)); await api('/reviews', { method: 'POST', body: { bookingId: b.id, ...v } }); toast('Thanks for your review'); myBookings(); }, 'Submit review');
    } catch (x) { toast(x.message, 'bad'); }
  });
}

// ---------- 5. receptionist panel ----------
async function reception() {
  view(sk(2));
  const [bk, rooms] = await Promise.all([api('/bookings'), api('/rooms')]), t = today();
  view(`<div class="row"><h1>Reception</h1><a class="btn" href="#/">+ Walk-in booking</a></div>
    <div class="kpis"><div><b>${bk.filter(b => b.status === 'Confirmed' && b.check_in === t).length}</b>Arrivals today</div><div><b>${bk.filter(b => b.status === 'CheckedIn').length}</b>In house</div>
    <div><b>${bk.filter(b => b.status === 'CheckedIn' && b.check_out <= t).length}</b>Departures due</div><div><b>${rooms.filter(r => r.liveStatus === 'Available').length}/${rooms.length}</b>Rooms free now</div></div>
    <h3>Bookings</h3><div class="filters"><label>Search guest<input id="q" placeholder="Name or booking #"></label><label>Status<select id="st"><option value="">All</option>${['Confirmed', 'CheckedIn', 'Completed', 'Cancelled'].map(s => `<option>${s}</option>`).join('')}</select></label></div>
    <div id="bt" style="margin-top:10px"></div><h3>Room status</h3>
    ${tbl(['Room', 'Type', 'Status', 'Set status'], rooms.map(r => [esc(r.number), r.type, `<span class="badge ${r.liveStatus}">${r.liveStatus}</span>`,
      `<select data-room="${r.id}">${['Available', 'Cleaning', 'Maintenance'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`]))}`);
  const draw = () => {
    const q = $('#q').value.toLowerCase(), st = $('#st').value;
    const rows = bk.filter(b => (!st || b.status === st) && (!q || (b.guest_name || '').toLowerCase().includes(q) || String(b.id) === q));
    $('#bt').innerHTML = rows.length ? tbl(['#', 'Guest', 'Room', 'Dates', 'Total', 'Status', ''], rows.map(b => [b.id, esc(b.guest_name), `${esc(b.room_type)} ${esc(b.room_number)}`, `${b.check_in} → ${b.check_out}`, money(b.total), `<span class="badge ${b.status}">${b.status}</span>`,
      (b.status === 'Confirmed' && b.check_in <= t ? `<button class="btn sm" data-a="checkin" data-id="${b.id}">Check in</button> ` : '') + (b.status === 'Confirmed' ? `<button class="btn sm danger" data-a="cancel" data-id="${b.id}">Cancel</button>` : '') + (b.status === 'CheckedIn' ? `<button class="btn sm" data-a="checkout" data-id="${b.id}">Check out</button>` : '')])) : empty('No bookings found', 'Change the search or status filter.');
    $$('#bt [data-a]').forEach(btn => btn.onclick = async () => {
      try { await api(`/bookings/${btn.dataset.id}/${btn.dataset.a}`, { method: 'POST' }); toast('Done'); reception(); } catch (x) { toast(x.message, 'bad'); }
    });
  };
  $('#q').oninput = draw; $('#st').onchange = draw; draw();
  $$('[data-room]').forEach(s => s.onchange = async () => { try { await api(`/rooms/${s.dataset.room}/status`, { method: 'PATCH', body: { status: s.value } }); toast('Room status updated'); reception(); } catch (x) { toast(x.message, 'bad'); } });
}

// ---------- 6. admin dashboard ----------
let adminTab = 'analytics', charts = [];
const head = (t, id = 'add') => `<div class="row"><h3>${t}</h3><button class="btn" id="${id}">+ Add</button></div>`;
const acts = (id, edit = true) => (edit ? `<button class="btn sm ghost" data-e="${id}">Edit</button> ` : '') + `<button class="btn sm danger" data-d="${id}">Delete</button>`;
function wire(el, list, open, path) {
  $('#add', el).onclick = () => open();
  $$('[data-e]', el).forEach(b => b.onclick = () => open(list.find(x => x.id == b.dataset.e)));
  $$('[data-d]', el).forEach(b => b.onclick = async () => {
    if (!confirm('Delete this item?')) return;
    try { await api(path + b.dataset.d, { method: 'DELETE' }); toast('Deleted'); admin(); } catch (e) { toast(e.message, 'bad'); }
  });
}
async function admin() {
  const T = ['analytics', 'rooms', 'services', 'guests', 'staff', 'pricing'];
  view(`<h1>Admin dashboard</h1><div class="tabs">${T.map(t => `<button data-t="${t}" class="${t === adminTab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div id="tab">${sk(2)}</div>`);
  $$('.tabs button').forEach(b => b.onclick = () => { adminTab = b.dataset.t; admin(); });
  const el = $('#tab');
  try { await ({ analytics, rooms: adminRooms, services: adminServices, guests: adminGuests, staff: adminStaff, pricing: adminPricing }[adminTab])(el); }
  catch (e) { el.innerHTML = errorBox(e.message); }
}

async function analytics(el) {
  const to = today(), from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `<form id="af" class="filters"><label>From<input type="date" name="from" value="${from}"></label><label>To<input type="date" name="to" value="${to}"></label><button class="btn">Apply</button></form>
    <div class="kpis" id="kpi"></div><div class="charts"><div class="card pad"><h4>Occupancy rate (%)</h4><canvas id="c1"></canvas></div>
    <div class="card pad"><h4>Revenue per month (Rs)</h4><canvas id="c2"></canvas></div><div class="card pad"><h4>Bookings by room type</h4><canvas id="c3"></canvas></div></div>`;
  const load = async () => {
    const f = fd($('#af'));
    if (!f.from || !f.to || f.to < f.from) return toast('End date must be on or after the start date', 'bad');
    const d = await api(`/admin/analytics?from=${f.from}&to=${f.to}`);
    $('#kpi').innerHTML = `<div><b>${d.summary.bookings}</b>Bookings</div><div><b>${money(d.summary.revenue)}</b>Revenue</div><div><b>${d.summary.avgOccupancy}%</b>Avg occupancy</div>`;
    charts.forEach(c => c.destroy()); charts = [];
    if (typeof Chart === 'undefined') return toast('Charts library failed to load', 'bad');
    const opt = { responsive: true, plugins: { legend: { display: false } } }, col = '#0b4f5c';
    charts.push(new Chart($('#c1'), { type: 'line', data: { labels: d.occupancy.map(o => o.date.slice(5)), datasets: [{ data: d.occupancy.map(o => o.rate), borderColor: col, backgroundColor: 'rgba(11,79,92,.12)', fill: true, tension: .3 }] }, options: { ...opt, scales: { y: { min: 0, max: 100 } } } }));
    charts.push(new Chart($('#c2'), { type: 'bar', data: { labels: d.revenue.map(r => r.month), datasets: [{ data: d.revenue.map(r => r.total), backgroundColor: '#d9a441' }] }, options: opt }));
    charts.push(new Chart($('#c3'), { type: 'doughnut', data: { labels: d.byType.map(t => t.type), datasets: [{ data: d.byType.map(t => t.count), backgroundColor: ['#0b4f5c', '#d9a441', '#6b9aa5', '#b3261e'] }] }, options: { responsive: true } }));
  };
  $('#af').onsubmit = e => { e.preventDefault(); load().catch(x => toast(x.message, 'bad')); };
  await load();
}

async function adminRooms(el) {
  const rooms = await api('/rooms');
  el.innerHTML = head('Rooms') + (rooms.length ? tbl(['No.', 'Type', 'Price', 'Capacity', 'Status', 'Images', ''], rooms.map(r => [esc(r.number), r.type, money(r.price), r.capacity, `<span class="badge ${r.liveStatus}">${r.liveStatus}</span>`, r.images.length, acts(r.id)])) : empty('No rooms yet', 'Add your first room.'));
  const open = r => {
    const x = r || {};
    const d = modal(r ? 'Edit room' : 'Add room', `${inp('Room number', 'number', 'text', `value="${esc(x.number || '')}"`)}
      <label>Type<select name="type">${V.TYPES.map(t => `<option ${x.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select><small data-f="type"></small></label>
      ${inp('Price per night (Rs)', 'price', 'number', `min="1" value="${x.price || ''}"`)}${inp('Capacity', 'capacity', 'number', `min="1" max="10" value="${x.capacity || 2}"`)}
      ${inp('Amenities (comma separated)', 'amenities', 'text', `value="${esc((x.amenities || []).join(', '))}"`)}<label>Description<textarea name="description">${esc(x.description || '')}</textarea></label>
      <label>Images (JPG, PNG or WEBP, max 2 MB each, up to 5)<input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple><small data-f="images"></small></label><div class="thumbs" id="prev"></div>`,
    async f => {
      const b = fd(f); delete b.images; const errs = V.room(b), files = [...f.images.files];
      if (files.length > 5) errs.images = 'Choose at most 5 images';
      for (const file of files) { const m = V.image(file); if (m) { errs.images = `${file.name}: ${m}`; break; } }
      chk(errs);
      const saved = await api(r ? '/rooms/' + r.id : '/rooms', { method: r ? 'PUT' : 'POST', body: b });
      if (files.length) { const data = new FormData(); files.forEach(file => data.append('images', file)); await api(`/rooms/${saved.id}/images`, { method: 'POST', body: data }); }
      toast('Room saved'); admin();
    });
    $('[name=images]', d).onchange = e => {
      const box = $('#prev', d); box.innerHTML = '';
      [...e.target.files].forEach(file => { const m = V.image(file); if (m) return fe(d, { images: `${file.name}: ${m}` }); const i = new Image(); i.alt = 'Preview'; i.src = URL.createObjectURL(file); box.append(i); });
    };
  };
  wire(el, rooms, open, '/rooms/');
}

async function adminServices(el) {
  const list = await api('/services');
  el.innerHTML = head('Services') + (list.length ? tbl(['Name', 'Category', 'Price', ''], list.map(s => [esc(s.name), esc(s.category), money(s.price), acts(s.id)])) : empty('No services yet', 'Add room service, laundry or spa items.'));
  wire(el, list, s => modal(s ? 'Edit service' : 'Add service', `${inp('Name', 'name', 'text', `value="${esc(s?.name || '')}"`)}${inp('Category', 'category', 'text', `value="${esc(s?.category || '')}" placeholder="Room service, Laundry, Spa"`)}${inp('Price (Rs)', 'price', 'number', `min="0" value="${s?.price ?? ''}"`)}`,
    async f => { const b = fd(f); chk(V.service(b)); await api(s ? '/services/' + s.id : '/services', { method: s ? 'PUT' : 'POST', body: b }); toast('Service saved'); admin(); }), '/services/');
}

async function adminGuests(el) {
  const list = await api('/guests');
  el.innerHTML = `<h3>Guests</h3>` + (list.length ? tbl(['Name', 'Email', 'Phone', 'Bookings', 'Spent', ''], list.map(g => [esc(g.name), esc(g.email), esc(g.phone || '-'), g.bookings, money(g.spent),
    `<button class="btn sm ghost" data-h="${g.id}">History</button> ${acts(g.id)}`])) : empty('No guests yet', 'Guests appear here after they sign up.'));
  if (!list.length) return;
  $$('[data-e]', el).forEach(b => b.onclick = () => { const g = list.find(x => x.id == b.dataset.e);
    modal('Edit guest', `${inp('Name', 'name', 'text', `value="${esc(g.name)}"`)}${inp('Phone', 'phone', 'text', `value="${esc(g.phone || '')}"`)}`,
      async f => { const v = fd(f); chk(v.name.trim().length < 2 ? { name: 'Name must be at least 2 characters' } : {}); await api('/guests/' + g.id, { method: 'PUT', body: v }); toast('Guest updated'); admin(); }); });
  $$('[data-d]', el).forEach(b => b.onclick = async () => { if (!confirm('Delete this guest?')) return; try { await api('/guests/' + b.dataset.d, { method: 'DELETE' }); toast('Deleted'); admin(); } catch (e) { toast(e.message, 'bad'); } });
  $$('[data-h]', el).forEach(b => b.onclick = async () => {
    try {
      const h = await api(`/guests/${b.dataset.h}/bookings`);
      modal('Booking history', h.length ? tbl(['Room', 'Dates', 'Total', 'Status'], h.map(x => [esc(x.room_number), `${x.check_in} → ${x.check_out}`, money(x.total), x.status])) : empty('No bookings', ''), null);
    } catch (e) { toast(e.message, 'bad'); }
  });
}

async function adminStaff(el) {
  const list = await api('/staff');
  el.innerHTML = head('Staff') + tbl(['Name', 'Email', 'Role', ''], list.map(s => [esc(s.name), esc(s.email), s.role, s.role === 'admin' ? '' : acts(s.id, false)]));
  wire(el, list, () => modal('Add receptionist', `${inp('Full name', 'name')}${inp('Email', 'email', 'email')}${inp('Temporary password', 'password', 'password')}`,
    async f => { const b = fd(f); chk(V.signup(b)); await api('/staff', { method: 'POST', body: b }); toast('Receptionist added'); admin(); }), '/staff/');
}

async function adminPricing(el) {
  const [codes, rules] = await Promise.all([api('/pricing/codes'), api('/pricing/rules')]);
  el.innerHTML = `<div class="row"><h3>Price rules</h3><button class="btn" id="addr">+ Add rule</button></div>` +
    (rules.length ? tbl(['Name', 'Type', 'Multiplier', 'Dates', ''], rules.map(r => [esc(r.name), r.type, '×' + r.multiplier, r.type === 'season' ? `${r.start_date} → ${r.end_date}` : 'Fri & Sat', `<button class="btn sm danger" data-r="${r.id}">Delete</button>`])) : empty('No price rules', 'Rooms use their base price.')) +
    `<div class="row" style="margin-top:20px"><h3>Discount codes</h3><button class="btn" id="addc">+ Add code</button></div>` +
    (codes.length ? tbl(['Code', 'Discount', ''], codes.map(c => [esc(c.code), c.percent + '%', `<button class="btn sm danger" data-c="${c.code}">Delete</button>`])) : empty('No discount codes', ''));
  $('#addr').onclick = () => modal('Add price rule', `<label>Type<select name="type"><option value="weekend">Weekend (Fri &amp; Sat)</option><option value="season">Season (date range)</option></select></label>
    ${inp('Name', 'name')}${inp('Multiplier (1.2 = +20%)', 'multiplier', 'number', 'step="0.05" min="0.5" max="5" value="1.2"')}${inp('Season start', 'start_date', 'date')}${inp('Season end', 'end_date', 'date')}`,
    async f => { const b = fd(f); const errs = {}; if (!b.name.trim()) errs.name = 'Name is required'; if (!(+b.multiplier >= 0.5 && +b.multiplier <= 5)) errs.multiplier = 'Use a value between 0.5 and 5';
      if (b.type === 'season' && (!b.start_date || !b.end_date || b.end_date < b.start_date)) errs.start_date = 'Choose a valid date range'; chk(errs);
      await api('/pricing/rules', { method: 'POST', body: b }); toast('Rule added'); admin(); });
  $('#addc').onclick = () => modal('Add discount code', `${inp('Code', 'code')}${inp('Percent off', 'percent', 'number', 'min="1" max="100"')}`,
    async f => { await api('/pricing/codes', { method: 'POST', body: fd(f) }); toast('Code added'); admin(); });
  const del = (sel, attr, path) => $$(sel, el).forEach(b => b.onclick = async () => { if (!confirm('Delete this item?')) return; try { await api(path + b.dataset[attr], { method: 'DELETE' }); toast('Deleted'); admin(); } catch (e) { toast(e.message, 'bad'); } });
  del('[data-r]', 'r', '/pricing/rules/'); del('[data-c]', 'c', '/pricing/codes/');
}
