process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
const request = require('supertest');
const app = require('../app');

const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const H = t => ({ Authorization: 'Bearer ' + t });
const login = async (email, password) => (await request(app).post('/api/auth/login').send({ email, password })).body.token;
const bin = (res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const book = (token, body) => request(app).post('/api/bookings').set(H(token)).send(body);

let admin, rec, guest, guest2, room;
beforeAll(async () => {
  admin = await login('admin@hotel.com', 'Admin@123');
  rec = await login('reception@hotel.com', 'Reception@123');
  guest = (await request(app).post('/api/auth/signup').send({ name: 'Test Guest', email: 'g1@test.com', password: 'password1' })).body.token;
  guest2 = (await request(app).post('/api/auth/signup').send({ name: 'Other Guest', email: 'g2@test.com', password: 'password2' })).body.token;
  room = (await request(app).post('/api/rooms').set(H(admin)).send({ number: 'T-1', type: 'Double', price: 1000, capacity: 2, amenities: 'WiFi' })).body;
});

describe('Auth & roles', () => {
  test('signup rejects short password with field error', async () => {
    const r = await request(app).post('/api/auth/signup').send({ name: 'Bob', email: 'bob@test.com', password: '123' });
    expect(r.status).toBe(400); expect(r.body.fields.password).toBeDefined();
  });
  test('signup rejects duplicate email', async () => {
    const r = await request(app).post('/api/auth/signup').send({ name: 'Dup', email: 'g1@test.com', password: 'password1' });
    expect(r.status).toBe(409);
  });
  test('login fails with wrong password', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@hotel.com', password: 'wrongpass' })).status).toBe(401);
  });
  test('protected route needs a token', async () => {
    expect((await request(app).get('/api/bookings')).status).toBe(401);
  });
  test('guest cannot create rooms (403) but admin can', async () => {
    const body = { number: 'T-2', type: 'Single', price: 500, capacity: 1 };
    expect((await request(app).post('/api/rooms').set(H(guest)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/rooms').set(H(admin)).send(body)).status).toBe(201);
  });
  test('guest cannot open analytics, admin can', async () => {
    expect((await request(app).get('/api/admin/analytics').set(H(guest))).status).toBe(403);
    expect((await request(app).get('/api/admin/analytics').set(H(admin))).status).toBe(200);
  });
});

describe('Booking rules', () => {
  test('creates a booking and calculates total (nights x rate + services - discount + tax)', async () => {
    const r = await book(guest, { roomId: room.id, checkIn: day(40), checkOut: day(42), guests: 2, services: [1], code: 'WELCOME10' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('Confirmed'); expect(r.body.nights).toBe(2);
    expect(r.body.discount).toBeCloseTo((r.body.room_total + r.body.services_total) * 0.1, 1);
    expect(r.body.total).toBeCloseTo((r.body.room_total + r.body.services_total - r.body.discount) * 1.1, 1);
  });
  test('REJECTS overlapping dates for the same room (409)', async () => {
    await book(guest, { roomId: room.id, checkIn: day(50), checkOut: day(53), guests: 1 });
    const r = await book(guest2, { roomId: room.id, checkIn: day(52), checkOut: day(55), guests: 1 });
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/already booked/);
    const inside = await book(guest2, { roomId: room.id, checkIn: day(51), checkOut: day(52), guests: 1 });
    expect(inside.status).toBe(409);
  });
  test('allows back-to-back stays (check-out day = next check-in day)', async () => {
    expect((await book(guest2, { roomId: room.id, checkIn: day(53), checkOut: day(55), guests: 1 })).status).toBe(201);
  });
  test('rejects past check-in date', async () => {
    const r = await book(guest, { roomId: room.id, checkIn: day(-2), checkOut: day(1), guests: 1 });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/Past dates/);
  });
  test('rejects check-out on or before check-in', async () => {
    const r = await book(guest, { roomId: room.id, checkIn: day(60), checkOut: day(60), guests: 1 });
    expect(r.status).toBe(400);
  });
  test('rejects more guests than room capacity', async () => {
    expect((await book(guest, { roomId: room.id, checkIn: day(70), checkOut: day(71), guests: 5 })).status).toBe(400);
  });
  test('search only returns rooms available for the dates', async () => {
    const busy = await request(app).get(`/api/rooms?checkIn=${day(51)}&checkOut=${day(52)}`);
    expect(busy.body.map(r => r.id)).not.toContain(room.id);
    const free = await request(app).get(`/api/rooms?checkIn=${day(80)}&checkOut=${day(81)}`);
    expect(free.body.map(r => r.id)).toContain(room.id);
  });
  test('cancelling frees the room for those dates', async () => {
    const b = (await book(guest, { roomId: room.id, checkIn: day(90), checkOut: day(92), guests: 1 })).body;
    expect((await book(guest2, { roomId: room.id, checkIn: day(90), checkOut: day(92), guests: 1 })).status).toBe(409);
    expect((await request(app).post(`/api/bookings/${b.id}/cancel`).set(H(guest))).status).toBe(200);
    expect((await book(guest2, { roomId: room.id, checkIn: day(90), checkOut: day(92), guests: 1 })).status).toBe(201);
  });
  test("a guest cannot cancel another guest's booking", async () => {
    const b = (await book(guest, { roomId: room.id, checkIn: day(100), checkOut: day(101), guests: 1 })).body;
    expect((await request(app).post(`/api/bookings/${b.id}/cancel`).set(H(guest2))).status).toBe(403);
  });
});

describe('Reception flow & invoice', () => {
  test('walk-in booking, check-in, check-out sets room to Cleaning, then PDF invoice works', async () => {
    const w = await book(rec, { roomId: room.id, checkIn: day(0), checkOut: day(1), guests: 1, guestName: 'Walk In' });
    expect(w.status).toBe(201);
    expect((await request(app).get(`/api/bookings/${w.body.id}/invoice`).set(H(rec))).status).toBe(400); // not completed yet
    expect((await request(app).post(`/api/bookings/${w.body.id}/checkin`).set(H(rec))).body.status).toBe('CheckedIn');
    expect((await request(app).get(`/api/rooms/${room.id}`)).body.liveStatus).toBe('Occupied');
    expect((await request(app).post(`/api/bookings/${w.body.id}/checkout`).set(H(rec))).body.status).toBe('Completed');
    expect((await request(app).get(`/api/rooms/${room.id}`)).body.liveStatus).toBe('Cleaning');
    const pdf = await request(app).get(`/api/bookings/${w.body.id}/invoice`).set(H(rec)).buffer(true).parse(bin);
    expect(pdf.status).toBe(200); expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
  });
  test('guest cannot check anyone in', async () => {
    expect((await request(app).post('/api/bookings/1/checkin').set(H(guest))).status).toBe(403);
  });
});
