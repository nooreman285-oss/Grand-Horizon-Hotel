// Built-in SQLite (Node 22.13+): no native compilation, works on Windows/Mac/Linux.
const { DatabaseSync } = process.getBuiltinModule ? process.getBuiltinModule('node:sqlite') : require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, '..', 'hotel.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
// Small helper: run fn inside one atomic transaction (rolls back if it throws).
db.transaction = fn => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'guest', phone TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rooms(
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  price REAL NOT NULL, capacity INTEGER NOT NULL, amenities TEXT DEFAULT '[]', images TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Available', description TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT DEFAULT '', price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), guest_name TEXT,
  room_id INTEGER NOT NULL REFERENCES rooms(id), check_in TEXT NOT NULL, check_out TEXT NOT NULL,
  guests INTEGER DEFAULT 1, status TEXT NOT NULL DEFAULT 'Confirmed', nights INTEGER, room_total REAL,
  services_total REAL, discount REAL DEFAULT 0, tax REAL, total REAL, code TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id, check_in, check_out);
CREATE TABLE IF NOT EXISTS booking_services(
  id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id), price REAL NOT NULL, qty INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id), user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL, comment TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS discount_codes(code TEXT PRIMARY KEY, percent REAL NOT NULL, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS price_rules(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, multiplier REAL NOT NULL,
  start_date TEXT, end_date TEXT, active INTEGER DEFAULT 1);
`);

// ---- seed data (only on an empty database) ----
if (!db.prepare('SELECT 1 FROM users').get()) {
  const u = db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)');
  u.run('Admin', 'admin@hotel.com', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 10), 'admin');
  u.run('Reception', 'reception@hotel.com', bcrypt.hashSync('Reception@123', 10), 'receptionist');
}
if (!db.prepare('SELECT 1 FROM rooms').get()) {
  const r = db.prepare('INSERT INTO rooms(number,type,price,capacity,amenities,description) VALUES(?,?,?,?,?,?)');
  [
    ['101', 'Single', 6000, 1, 'WiFi,AC,TV', 'Quiet single room for solo travellers.'],
    ['102', 'Single', 6500, 1, 'WiFi,AC,TV,Desk', 'Single room with a work desk.'],
    ['201', 'Double', 9000, 2, 'WiFi,AC,TV,Mini fridge', 'Comfortable double room with city view.'],
    ['202', 'Double', 9500, 3, 'WiFi,AC,TV,Mini fridge,Balcony', 'Double room with balcony and extra bed.'],
    ['301', 'Deluxe', 14000, 3, 'WiFi,AC,Smart TV,Bathtub,Breakfast', 'Spacious deluxe room with bathtub.'],
    ['401', 'Suite', 25000, 4, 'WiFi,AC,Smart TV,Living area,Jacuzzi,Breakfast', 'Top-floor suite with separate living area.']
  ].forEach(x => r.run(x[0], x[1], x[2], x[3], JSON.stringify(x[4].split(',')), x[5]));
}
if (!db.prepare('SELECT 1 FROM services').get()) {
  const s = db.prepare('INSERT INTO services(name,category,price) VALUES(?,?,?)');
  [['Room service dinner', 'Room service', 1500], ['Laundry (per bag)', 'Laundry', 800],
   ['Spa session', 'Spa', 4000], ['Airport pickup', 'Transport', 2500]].forEach(x => s.run(...x));
}
if (!db.prepare('SELECT 1 FROM price_rules').get()) {
  db.prepare('INSERT INTO price_rules(name,type,multiplier) VALUES(?,?,?)').run('Weekend rate (Fri & Sat)', 'weekend', 1.2);
  db.prepare('INSERT INTO price_rules(name,type,multiplier,start_date,end_date) VALUES(?,?,?,?,?)')
    .run('Winter peak season', 'season', 1.3, '2026-12-15', '2027-01-05');
  db.prepare('INSERT OR IGNORE INTO discount_codes(code,percent) VALUES(?,?)').run('WELCOME10', 10);
}
module.exports = db;
