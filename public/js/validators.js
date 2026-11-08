// Shared by the browser AND the server, so client and server validation always match.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V = factory();
})(this, function () {
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
  const TYPES = ['Single', 'Double', 'Deluxe', 'Suite'];
  return {
    isDate, isEmail, TYPES,
    signup(b) {
      const f = {};
      if (!b.name || b.name.trim().length < 2) f.name = 'Name must be at least 2 characters';
      if (!isEmail(b.email)) f.email = 'Enter a valid email address';
      if (!b.password || b.password.length < 8) f.password = 'Password must be at least 8 characters';
      return f;
    },
    login(b) {
      const f = {};
      if (!isEmail(b.email)) f.email = 'Enter a valid email address';
      if (!b.password) f.password = 'Password is required';
      return f;
    },
    dates(ci, co, today) {
      if (!isDate(ci) || !isDate(co)) return 'Select valid check-in and check-out dates';
      if (ci < today) return 'Past dates are not allowed';
      if (co <= ci) return 'Check-out must be after check-in';
      return null;
    },
    room(b) {
      const f = {};
      if (!b.number || !String(b.number).trim()) f.number = 'Room number is required';
      if (!TYPES.includes(b.type)) f.type = 'Choose a valid room type';
      if (!(+b.price > 0)) f.price = 'Price must be greater than 0';
      if (!(+b.capacity >= 1 && +b.capacity <= 10)) f.capacity = 'Capacity must be between 1 and 10';
      return f;
    },
    service(b) {
      const f = {};
      if (!b.name || b.name.trim().length < 2) f.name = 'Name must be at least 2 characters';
      if (b.price === '' || b.price == null || isNaN(+b.price) || +b.price < 0) f.price = 'Price must be 0 or more';
      return f;
    },
    image(file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Only JPG, PNG or WEBP images are allowed';
      if (file.size > 2 * 1024 * 1024) return 'Each image must be smaller than 2 MB';
      return null;
    },
    review(b) {
      const f = {};
      if (!(+b.rating >= 1 && +b.rating <= 5)) f.rating = 'Choose a rating from 1 to 5';
      if (b.comment && b.comment.length > 500) f.comment = 'Comment must be 500 characters or fewer';
      return f;
    }
  };
});
