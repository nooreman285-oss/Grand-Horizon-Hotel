require('dotenv').config();
const express = require('express'), cors = require('cors'), path = require('path'), fs = require('fs');
const jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs'), multer = require('multer'), PDFDocument = require('pdfkit');
const db = require('./db'), V = require('../public/js/validators'), { calc } = require('./pricing');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const UP = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UP, { recursive: true });
const STAFF = ['receptionist', 'admin'];

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());
app.use('/uploads', express.static(UP));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const today = () => new Date().toISOString().slice(0, 10);
const httpErr = (status, message, fields) => Object.assign(new Error(message), { status, fields });
const bad = f => { if (Object.keys(f).length) throw httpErr(400, 'Please fix the highlighted fields', f); };
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone });
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); }
  catch { return next(httpErr(401, 'Authentication required')); }
  if (roles.length && !roles.includes(req.user.role)) return next(httpErr(403, 'You do not have permission for this action'));
  next();
};
const parseRoom = r => r && { ...r, amenities: JSON.parse(r.amenities || '[]'), images: JSON.parse(r.images || '[]') };

// Overlap rule: two stays overlap when newIn < existingOut AND newOut > existingIn.
// Same-day turnover (check-out day == next check-in day) is allowed.
const isFree = (roomId, ci, co, ignoreId = 0) => !db.prepare(
  `SELECT 1 FROM bookings WHERE room_id=? AND id!=? AND status IN ('Confirmed','CheckedIn') AND ? < check_out AND ? > check_in`
).get(roomId, ignoreId, ci, co);

// Room status is computed live from bookings; only Cleaning/Maintenance are stored manually.
function liveStatus(r) {
  if (r.status !== 'Available') return r.status;
  if (db.prepare(`SELECT 1 FROM bookings WHERE room_id=? AND status='CheckedIn'`).get(r.id)) return 'Occupied';
  const t = today();
  if (db.prepare(`SELECT 1 FROM bookings WHERE room_id=? AND status='Confirmed' AND check_in<=? AND check_out>?`).get(r.id, t, t)) return 'Booked';
  return 'Available';
}
const svcOf = id => db.prepare('SELECT bs.service_id id, s.name, bs.price, bs.qty FROM booking_services bs JOIN services s ON s.id=bs.service_id WHERE bs.booking_id=?').all(id);
const getBooking = id => {
  const b = db.prepare('SELECT b.*, r.number room_number, r.type room_type FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.id=?').get(id);
  if (b) b.services = svcOf(id);
  return b;
};
const own = (req, b) => STAFF.includes(req.user.role) || b.user_id === req.user.id;

function makeQuote(b) {
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(b.roomId);
  if (!room) throw httpErr(404, 'Room not found');
  const e = V.dates(b.checkIn, b.checkOut, today());
  if (e) throw httpErr(400, e, { checkIn: e });
  const rules = db.prepare('SELECT * FROM price_rules WHERE active=1').all();
  const map = {};
  for (const id of (b.services || []).map(Number)) {
    const s = db.prepare('SELECT * FROM services WHERE id=?').get(id);
    if (!s) throw httpErr(400, 'Unknown service selected');
    map[id] = map[id] || { id: s.id, name: s.name, price: s.price, qty: 0 };
    map[id].qty++;
  }
  let percent = 0;
  if (b.code) {
    const c = db.prepare('SELECT * FROM discount_codes WHERE code=? AND active=1').get(String(b.code).trim().toUpperCase());
    if (!c) throw httpErr(400, 'Invalid discount code', { code: 'Invalid discount code' });
    percent = c.percent;
  }
  const services = Object.values(map);
  return { room, services, ...calc({ base: room.price, ci: b.checkIn, co: b.checkOut, rules, services, percent }) };
}

// ---------- auth ----------
app.post('/api/auth/signup', (req, res) => {
  const b = req.body; bad(V.signup(b));
  const email = b.email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw httpErr(409, 'Email already registered', { email: 'Email already registered' });
  const id = db.prepare('INSERT INTO users(name,email,password,role,phone) VALUES(?,?,?,?,?)').run(b.name.trim(), email, bcrypt.hashSync(b.password, 10), 'guest', b.phone || null).lastInsertRowid;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.status(201).json({ token: sign(u), user: pub(u) });
});
app.post('/api/auth/login', (req, res) => {
  bad(V.login(req.body));
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email).toLowerCase().trim());
  if (!u || !bcrypt.compareSync(req.body.password, u.password)) throw httpErr(401, 'Invalid email or password');
  res.json({ token: sign(u), user: pub(u) });
});
app.get('/api/auth/me', auth(), (req, res) => res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))));
app.put('/api/auth/profile', auth(), (req, res) => {
  const { name, phone } = req.body;
  if (!name || name.trim().length < 2) throw httpErr(400, 'Name must be at least 2 characters', { name: 'Name must be at least 2 characters' });
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name.trim(), phone || null, req.user.id);
  res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
});

// ---------- rooms ----------
app.get('/api/rooms', (req, res) => {
  const { checkIn, checkOut, type, minPrice, maxPrice, capacity } = req.query;
  if (checkIn || checkOut) { const e = V.dates(checkIn, checkOut, today()); if (e) throw httpErr(400, e); }
  let rows = db.prepare(`SELECT r.*, (SELECT ROUND(AVG(rating),1) FROM reviews WHERE room_id=r.id) avgRating,
    (SELECT COUNT(*) FROM reviews WHERE room_id=r.id) reviewCount FROM rooms r ORDER BY r.number`).all().map(parseRoom);
  rows = rows.filter(r => (!type || r.type === type) && (!minPrice || r.price >= +minPrice) && (!maxPrice || r.price <= +maxPrice) && (!capacity || r.capacity >= +capacity));
  if (checkIn) rows = rows.filter(r => r.status !== 'Maintenance' && isFree(r.id, checkIn, checkOut));
  res.json(rows.map(r => ({ ...r, liveStatus: liveStatus(r) })));
});
app.get('/api/rooms/:id', (req, res) => {
  const r = parseRoom(db.prepare(`SELECT r.*, (SELECT ROUND(AVG(rating),1) FROM reviews WHERE room_id=r.id) avgRating,
    (SELECT COUNT(*) FROM reviews WHERE room_id=r.id) reviewCount FROM rooms r WHERE r.id=?`).get(req.params.id));
  if (!r) throw httpErr(404, 'Room not found');
  r.liveStatus = liveStatus(r);
  r.reviews = db.prepare('SELECT v.rating, v.comment, v.created_at, u.name FROM reviews v JOIN users u ON u.id=v.user_id WHERE v.room_id=? ORDER BY v.id DESC').all(r.id);
  res.json(r);
});
const roomVals = b => [String(b.number).trim(), b.type, +b.price, +b.capacity,
  JSON.stringify(Array.isArray(b.amenities) ? b.amenities : String(b.amenities || '').split(',').map(s => s.trim()).filter(Boolean)), b.description || ''];
const uniq = e => { if (/UNIQUE/.test(e.message)) throw httpErr(409, 'Room number already exists', { number: 'Room number already exists' }); throw e; };
app.post('/api/rooms', auth('admin'), (req, res) => {
  bad(V.room(req.body));
  try {
    const id = db.prepare('INSERT INTO rooms(number,type,price,capacity,amenities,description) VALUES(?,?,?,?,?,?)').run(...roomVals(req.body)).lastInsertRowid;
    res.status(201).json(parseRoom(db.prepare('SELECT * FROM rooms WHERE id=?').get(id)));
  } catch (e) { uniq(e); }
});
app.put('/api/rooms/:id', auth('admin'), (req, res) => {
  bad(V.room(req.body));
  try {
    const r = db.prepare('UPDATE rooms SET number=?,type=?,price=?,capacity=?,amenities=?,description=? WHERE id=?').run(...roomVals(req.body), req.params.id);
    if (!r.changes) throw httpErr(404, 'Room not found');
    res.json(parseRoom(db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.id)));
  } catch (e) { if (e.status) throw e; uniq(e); }
});
app.delete('/api/rooms/:id', auth('admin'), (req, res) => {
  if (db.prepare('SELECT 1 FROM bookings WHERE room_id=?').get(req.params.id)) throw httpErr(409, 'This room has bookings. Set it to Maintenance instead of deleting it.');
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 2 * 1024 * 1024, files: 5 },
  fileFilter: (q, f, cb) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG or WEBP images are allowed'))
});
app.post('/api/rooms/:id/images', auth('admin'), upload.array('images', 5), (req, res) => {
  const r = db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.id);
  if (!r) throw httpErr(404, 'Room not found');
  const imgs = [...JSON.parse(r.images), ...req.files.map(f => '/uploads/' + f.filename)];
  db.prepare('UPDATE rooms SET images=? WHERE id=?').run(JSON.stringify(imgs), r.id);
  res.json({ images: imgs });
});
app.patch('/api/rooms/:id/status', auth(...STAFF), (req, res) => {
  if (!['Available', 'Cleaning', 'Maintenance'].includes(req.body.status)) throw httpErr(400, 'Status must be Available, Cleaning or Maintenance');
  if (!db.prepare('UPDATE rooms SET status=? WHERE id=?').run(req.body.status, req.params.id).changes) throw httpErr(404, 'Room not found');
  const r = parseRoom(db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.id));
  res.json({ ...r, liveStatus: liveStatus(r) });
});

// ---------- services ----------
app.get('/api/services', (req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY category, name').all()));
app.post('/api/services', auth('admin'), (req, res) => {
  bad(V.service(req.body));
  const id = db.prepare('INSERT INTO services(name,category,price) VALUES(?,?,?)').run(req.body.name.trim(), req.body.category || '', +req.body.price).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id=?').get(id));
});
app.put('/api/services/:id', auth('admin'), (req, res) => {
  bad(V.service(req.body));
  if (!db.prepare('UPDATE services SET name=?,category=?,price=? WHERE id=?').run(req.body.name.trim(), req.body.category || '', +req.body.price, req.params.id).changes) throw httpErr(404, 'Service not found');
  res.json(db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id));
});
app.delete('/api/services/:id', auth('admin'), (req, res) => {
  if (db.prepare('SELECT 1 FROM booking_services WHERE service_id=?').get(req.params.id)) throw httpErr(409, 'This service is used in bookings and cannot be deleted');
  db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- quote + bookings ----------
app.get('/api/quote', (req, res) => {
  const q = req.query;
  const r = makeQuote({ roomId: q.roomId, checkIn: q.checkIn, checkOut: q.checkOut, code: q.code, services: q.services ? String(q.services).split(',').filter(Boolean) : [] });
  delete r.room; res.json(r);
});

app.post('/api/bookings', auth(), (req, res) => {
  const b = req.body, guests = +b.guests || 1;
  const e = V.dates(b.checkIn, b.checkOut, today());
  if (e) throw httpErr(400, e, { checkIn: e });
  let userId = req.user.id, guestName = req.user.name;
  if (STAFF.includes(req.user.role)) { // walk-in booking created by staff
    if (!b.guestName || b.guestName.trim().length < 2) throw httpErr(400, 'Guest name is required for walk-in bookings', { guestName: 'Guest name is required' });
    guestName = b.guestName.trim();
    const u = b.guestEmail && db.prepare("SELECT id FROM users WHERE email=? AND role='guest'").get(String(b.guestEmail).toLowerCase());
    userId = u ? u.id : null;
  }
  const id = db.transaction(() => {
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(b.roomId);
    if (!room) throw httpErr(404, 'Room not found');
    if (room.status === 'Maintenance') throw httpErr(409, 'This room is under maintenance');
    if (guests < 1 || guests > room.capacity) throw httpErr(400, `This room fits up to ${room.capacity} guests`, { guests: `Max ${room.capacity} guests` });
    if (!isFree(room.id, b.checkIn, b.checkOut)) throw httpErr(409, 'This room is already booked for the selected dates');
    const q = makeQuote(b);
    const info = db.prepare(`INSERT INTO bookings(user_id,guest_name,room_id,check_in,check_out,guests,nights,room_total,services_total,discount,tax,total,code)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(userId, guestName, room.id, b.checkIn, b.checkOut, guests, q.nightCount, q.roomTotal, q.servicesTotal, q.discount, q.tax, q.total, b.code ? String(b.code).trim().toUpperCase() : null);
    for (const s of q.services) db.prepare('INSERT INTO booking_services(booking_id,service_id,price,qty) VALUES(?,?,?,?)').run(info.lastInsertRowid, s.id, s.price, s.qty);
    return info.lastInsertRowid;
  })();
  res.status(201).json(getBooking(id));
});

app.get('/api/bookings', auth(), (req, res) => {
  const staff = STAFF.includes(req.user.role);
  const rows = db.prepare(`SELECT b.*, r.number room_number, r.type room_type, (SELECT 1 FROM reviews v WHERE v.booking_id=b.id) reviewed
    FROM bookings b JOIN rooms r ON r.id=b.room_id ${staff ? '' : 'WHERE b.user_id=?'} ORDER BY b.check_in DESC, b.id DESC`).all(...(staff ? [] : [req.user.id]));
  res.json(rows.map(b => ({ ...b, reviewed: !!b.reviewed, services: svcOf(b.id) })));
});

app.put('/api/bookings/:id', auth(), (req, res) => {
  const b0 = getBooking(req.params.id);
  if (!b0) throw httpErr(404, 'Booking not found');
  if (!own(req, b0)) throw httpErr(403, 'This is not your booking');
  if (b0.status !== 'Confirmed') throw httpErr(400, 'Only confirmed bookings can be modified');
  const b = req.body, e = V.dates(b.checkIn, b.checkOut, today());
  if (e) throw httpErr(400, e, { checkIn: e });
  db.transaction(() => {
    if (!isFree(b0.room_id, b.checkIn, b.checkOut, b0.id)) throw httpErr(409, 'This room is already booked for the selected dates');
    const q = makeQuote({ roomId: b0.room_id, checkIn: b.checkIn, checkOut: b.checkOut, services: b.services || [], code: b.code ?? b0.code });
    db.prepare('UPDATE bookings SET check_in=?,check_out=?,nights=?,room_total=?,services_total=?,discount=?,tax=?,total=? WHERE id=?')
      .run(b.checkIn, b.checkOut, q.nightCount, q.roomTotal, q.servicesTotal, q.discount, q.tax, q.total, b0.id);
    db.prepare('DELETE FROM booking_services WHERE booking_id=?').run(b0.id);
    for (const s of q.services) db.prepare('INSERT INTO booking_services(booking_id,service_id,price,qty) VALUES(?,?,?,?)').run(b0.id, s.id, s.price, s.qty);
  })();
  res.json(getBooking(b0.id));
});

// Cancelling sets status=Cancelled; isFree() ignores cancelled bookings, so the dates are free again.
app.post('/api/bookings/:id/cancel', auth(), (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) throw httpErr(404, 'Booking not found');
  if (!own(req, b)) throw httpErr(403, 'This is not your booking');
  if (b.status !== 'Confirmed') throw httpErr(400, 'Only confirmed bookings can be cancelled');
  db.prepare("UPDATE bookings SET status='Cancelled' WHERE id=?").run(b.id);
  res.json(getBooking(b.id));
});
app.post('/api/bookings/:id/checkin', auth(...STAFF), (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) throw httpErr(404, 'Booking not found');
  if (b.status !== 'Confirmed') throw httpErr(400, 'Only confirmed bookings can be checked in');
  if (b.check_in > today()) throw httpErr(400, 'Too early: check-in date has not arrived yet');
  db.prepare("UPDATE bookings SET status='CheckedIn' WHERE id=?").run(b.id);
  res.json(getBooking(b.id));
});
app.post('/api/bookings/:id/checkout', auth(...STAFF), (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) throw httpErr(404, 'Booking not found');
  if (b.status !== 'CheckedIn') throw httpErr(400, 'Only checked-in guests can be checked out');
  db.transaction(() => {
    db.prepare("UPDATE bookings SET status='Completed' WHERE id=?").run(b.id);
    db.prepare("UPDATE rooms SET status='Cleaning' WHERE id=?").run(b.room_id);
  })();
  res.json(getBooking(b.id));
});

// ---------- invoice (PDF) ----------
app.get('/api/bookings/:id/invoice', auth(), (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) throw httpErr(404, 'Booking not found');
  if (!own(req, b)) throw httpErr(403, 'This is not your booking');
  if (b.status !== 'Completed') throw httpErr(400, 'Invoice is available after the stay is completed');
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${b.id}.pdf`);
  doc.pipe(res);
  const money = n => 'Rs ' + Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  doc.fontSize(22).text(process.env.HOTEL_NAME || 'Grand Horizon Hotel');
  doc.fontSize(10).fillColor('#666').text('Gujranwala, Punjab, Pakistan').moveDown();
  doc.fillColor('#000').fontSize(16).text(`Invoice #INV-${String(b.id).padStart(5, '0')}`);
  doc.fontSize(10).text(`Issued: ${today()}`).moveDown();
  doc.text(`Guest: ${b.guest_name}`).text(`Room: ${b.room_number} (${b.room_type})`)
    .text(`Stay: ${b.check_in} to ${b.check_out} (${b.nights} night${b.nights > 1 ? 's' : ''})`).text(`Guests: ${b.guests}`).moveDown();
  const row = (l, v, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(l, 50, doc.y, { continued: true, width: 350 }).text(v, { align: 'right' }); };
  row(`Room charges (${b.nights} night${b.nights > 1 ? 's' : ''})`, money(b.room_total));
  b.services.forEach(s => row(`${s.name} x${s.qty}`, money(s.price * s.qty)));
  if (b.discount) row(`Discount${b.code ? ' (' + b.code + ')' : ''}`, '- ' + money(b.discount));
  row('Tax', money(b.tax)); doc.moveDown(0.5);
  doc.fontSize(13); row('Total', money(b.total), true);
  doc.font('Helvetica').fontSize(9).fillColor('#666').moveDown(2).text('Thank you for staying with us.', { align: 'center' });
  doc.end();
});

// ---------- guests (customers) ----------
app.get('/api/guests', auth(...STAFF), (req, res) => res.json(db.prepare(`SELECT u.id,u.name,u.email,u.phone,COUNT(b.id) bookings,
  COALESCE(SUM(CASE WHEN b.status!='Cancelled' THEN b.total END),0) spent FROM users u LEFT JOIN bookings b ON b.user_id=u.id
  WHERE u.role='guest' GROUP BY u.id ORDER BY u.name`).all()));
app.get('/api/guests/:id/bookings', auth(...STAFF), (req, res) => res.json(db.prepare(
  'SELECT b.*, r.number room_number, r.type room_type FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.user_id=? ORDER BY b.check_in DESC').all(req.params.id)));
app.put('/api/guests/:id', auth('admin'), (req, res) => {
  const { name, phone } = req.body;
  if (!name || name.trim().length < 2) throw httpErr(400, 'Name must be at least 2 characters', { name: 'Name must be at least 2 characters' });
  if (!db.prepare("UPDATE users SET name=?, phone=? WHERE id=? AND role='guest'").run(name.trim(), phone || null, req.params.id).changes) throw httpErr(404, 'Guest not found');
  res.json({ ok: true });
});
app.delete('/api/guests/:id', auth('admin'), (req, res) => {
  if (db.prepare('SELECT 1 FROM bookings WHERE user_id=?').get(req.params.id)) throw httpErr(409, 'This guest has booking history and cannot be deleted');
  db.prepare("DELETE FROM users WHERE id=? AND role='guest'").run(req.params.id);
  res.json({ ok: true });
});

// ---------- staff (admin only) ----------
app.get('/api/staff', auth('admin'), (req, res) => res.json(db.prepare("SELECT id,name,email,role FROM users WHERE role IN ('receptionist','admin') ORDER BY id").all()));
app.post('/api/staff', auth('admin'), (req, res) => {
  bad(V.signup(req.body));
  const email = req.body.email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw httpErr(409, 'Email already registered', { email: 'Email already registered' });
  const id = db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(req.body.name.trim(), email, bcrypt.hashSync(req.body.password, 10), 'receptionist').lastInsertRowid;
  res.status(201).json({ id, name: req.body.name.trim(), email, role: 'receptionist' });
});
app.delete('/api/staff/:id', auth('admin'), (req, res) => {
  if (+req.params.id === req.user.id) throw httpErr(400, 'You cannot delete your own account');
  db.prepare("DELETE FROM users WHERE id=? AND role='receptionist'").run(req.params.id);
  res.json({ ok: true });
});

// ---------- reviews (bonus) ----------
app.post('/api/reviews', auth('guest'), (req, res) => {
  const b = req.body; bad(V.review(b));
  const bk = db.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').get(b.bookingId, req.user.id);
  if (!bk) throw httpErr(404, 'Booking not found');
  if (bk.status !== 'Completed') throw httpErr(400, 'You can review a room only after a completed stay');
  if (db.prepare('SELECT 1 FROM reviews WHERE booking_id=?').get(bk.id)) throw httpErr(409, 'You already reviewed this stay');
  db.prepare('INSERT INTO reviews(booking_id,room_id,user_id,rating,comment) VALUES(?,?,?,?,?)').run(bk.id, bk.room_id, req.user.id, +b.rating, (b.comment || '').trim());
  res.status(201).json({ ok: true });
});

// ---------- pricing rules + discount codes (bonus, admin) ----------
app.get('/api/pricing/codes', auth('admin'), (req, res) => res.json(db.prepare('SELECT * FROM discount_codes ORDER BY code').all()));
app.post('/api/pricing/codes', auth('admin'), (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase(), pct = +req.body.percent;
  const f = {};
  if (!/^[A-Z0-9]{3,20}$/.test(code)) f.code = 'Use 3-20 letters or numbers';
  if (!(pct > 0 && pct <= 100)) f.percent = 'Percent must be between 1 and 100';
  bad(f);
  db.prepare('INSERT OR REPLACE INTO discount_codes(code,percent,active) VALUES(?,?,1)').run(code, pct);
  res.status(201).json({ code, percent: pct });
});
app.delete('/api/pricing/codes/:code', auth('admin'), (req, res) => { db.prepare('DELETE FROM discount_codes WHERE code=?').run(req.params.code); res.json({ ok: true }); });
app.get('/api/pricing/rules', auth('admin'), (req, res) => res.json(db.prepare('SELECT * FROM price_rules ORDER BY id').all()));
app.post('/api/pricing/rules', auth('admin'), (req, res) => {
  const b = req.body, f = {};
  if (!b.name || !b.name.trim()) f.name = 'Name is required';
  if (!['weekend', 'season'].includes(b.type)) f.type = 'Type must be weekend or season';
  if (!(+b.multiplier >= 0.5 && +b.multiplier <= 5)) f.multiplier = 'Multiplier must be between 0.5 and 5';
  if (b.type === 'season') {
    if (!V.isDate(b.start_date) || !V.isDate(b.end_date)) f.start_date = 'Start and end dates are required';
    else if (b.end_date < b.start_date) f.end_date = 'End date must be after start date';
  }
  bad(f);
  const id = db.prepare('INSERT INTO price_rules(name,type,multiplier,start_date,end_date) VALUES(?,?,?,?,?)').run(b.name.trim(), b.type, +b.multiplier, b.type === 'season' ? b.start_date : null, b.type === 'season' ? b.end_date : null).lastInsertRowid;
  res.status(201).json({ id });
});
app.delete('/api/pricing/rules/:id', auth('admin'), (req, res) => { db.prepare('DELETE FROM price_rules WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// ---------- analytics (admin) ----------
app.get('/api/admin/analytics', auth('admin'), (req, res) => {
  const to = req.query.to || today();
  const from = req.query.from || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  if (!V.isDate(from) || !V.isDate(to) || to < from) throw httpErr(400, 'Invalid date range');
  const total = db.prepare('SELECT COUNT(*) c FROM rooms').get().c || 1;
  const bs = db.prepare("SELECT b.*, r.type FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.status!='Cancelled'").all();
  const occupancy = [], end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(from + 'T00:00:00Z'), i = 0; d <= end && i < 366; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    occupancy.push({ date: ds, rate: Math.round(bs.filter(b => b.check_in <= ds && ds < b.check_out).length / total * 1000) / 10 });
  }
  const inRange = bs.filter(b => b.check_in <= to && b.check_out > from), rev = {}, byType = {};
  for (const b of inRange) { const m = b.check_in.slice(0, 7); rev[m] = (rev[m] || 0) + b.total; byType[b.type] = (byType[b.type] || 0) + 1; }
  res.json({
    occupancy,
    revenue: Object.entries(rev).sort().map(([month, t]) => ({ month, total: t })),
    byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
    summary: { bookings: inRange.length, revenue: inRange.reduce((s, b) => s + b.total, 0),
      avgOccupancy: occupancy.length ? Math.round(occupancy.reduce((s, o) => s + o.rate, 0) / occupancy.length * 10) / 10 : 0 }
  });
});

// ---------- errors ----------
app.use('/api', (req, res, next) => next(httpErr(404, 'Endpoint not found')));
app.use((e, req, res, next) => {
  const s = e.status || (e instanceof multer.MulterError || /Only JPG/.test(e.message) ? 400 : 500);
  if (s === 500) console.error(e);
  res.status(s).json({ error: s === 500 ? 'Server error. Please try again.' : e.message, fields: e.fields });
});

module.exports = app;
