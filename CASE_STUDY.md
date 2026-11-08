# Case Study: Grand Horizon Hotel Booking System

## Problem
A hotel needs one system where guests can book rooms themselves, reception can handle arrivals and departures, and the owner can see occupancy and revenue. The hard part is correctness: two people must never be able to book the same room for overlapping dates, and prices must stay right with weekends, seasons, services, discounts and tax.

## Tech stack and why
- **Node.js + Express**: simple REST API, easy to test with Supertest.
- **SQLite (built-in node:sqlite)**: zero setup, transactions are synchronous, ideal for a single-hotel app.
- **JWT + bcrypt + role middleware**: stateless auth with three roles.
- **Vanilla JS SPA**: no build step, fast to load, and the same `validators.js` runs on client and server.
- **PDFKit, Chart.js, Multer**: invoices, analytics charts, image uploads.

## Challenge: date-overlap logic
Two stays [aIn, aOut) and [bIn, bOut) overlap when `aIn < bOut AND aOut > bIn`. Check-out day is exclusive, so a guest leaving on the 10th and another arriving on the 10th is allowed. First version only compared whether a new check-in fell *inside* an existing stay, which missed the case where a new stay completely **wraps** an existing one. The single formula above covers every case (partial overlap on either side, inside, and wrapping).

Race conditions: the availability check and the insert run inside one `db.transaction`, so two simultaneous requests cannot both pass the check. Only `Confirmed` and `CheckedIn` bookings block a room, so cancelling automatically frees the dates without extra cleanup.

## Other challenges
- **Room status:** instead of storing Booked/Occupied (which goes stale), status is computed live from bookings; only Cleaning and Maintenance are stored.
- **Dynamic pricing:** each night is priced on its own (weekend and seasonal multipliers), then services, discount and tax are applied in a pure function that is unit tested.
- **Matching validation:** one shared validators file removed client/server drift.

## Result
Three roles, 6 pages, full CRUD on rooms, bookings, guests and services, analytics with a date filter, PDF invoices, reviews, dynamic pricing, and automated tests including overlap rejection and an end-to-end booking flow.
