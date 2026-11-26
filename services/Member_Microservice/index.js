// ============================================================================
//  MEMBER MICROSERVICE  -  the "Member Desk"  (port 3004)
// ============================================================================
//  Member only (the gateway checks the JWT role = member before forwarding).
//  The gateway passes WHO is asking in the headers x-user-id / x-user-email,
//  so a member can only ever see and borrow as themselves.
//  APIs:
//     GET  /member/viewallbooks
//     GET  /member/searchbooks?query=...
//     POST /member/borrowbook
//     GET  /member/myhistory
// ============================================================================

const express = require('express');
const os = require('os');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./dbconnect');
const Book = require('./models/Book');
const Borrow = require('./models/Borrow');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const LOAN_DAYS = 14;

connectDB();

// LOAD BALANCER PROOF: every response says which container answered
// (the container hostname is member1 or member2, see docker-compose.yml)
app.use((req, res, next) => {
  res.set('X-Served-By', process.env.SERVED_BY || os.hostname());
  next();
});

// SECURITY GATE: block direct access + identify the caller
app.use((req, res, next) => {
  if (req.headers['x-gateway-secret'] !== GATEWAY_SECRET) {
    return res.status(403).json({ message: 'Direct access blocked. Please call this API through the API Gateway.' });
  }
  req.callerId = req.headers['x-user-id'];
  req.callerEmail = req.headers['x-user-email'];
  req.callerName = req.headers['x-user-name'] ? decodeURIComponent(req.headers['x-user-name']) : undefined;
  if (!req.callerId || !req.callerEmail) {
    return res.status(401).json({ message: 'Could not identify the logged-in member.' });
  }
  console.log(`${new Date().toISOString()}  ${req.method} ${req.originalUrl}`); // shows up in docker logs
  next();
});

// escape special characters so a search text can never break the regex
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ----------------------------------------------------------------------------
// GET /member/viewallbooks            -> every book in the library
// GET /member/viewallbooks?query=java -> filter by title, author or category
// Books with availableCopies = 0 are shown too (the member can see they are out).
// ----------------------------------------------------------------------------
app.get('/member/viewallbooks', async (req, res) => {
  try {
    const filter = {};
    if (req.query.query) {
      const rx = new RegExp(escapeRegex(req.query.query), 'i');
      filter.$or = [{ title: rx }, { author: rx }, { category: rx }];
    }
    const books = await Book.find(filter).sort({ title: 1 });
    return res.status(200).json({ count: books.length, books });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not fetch books.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// GET /member/searchbooks?query=java     (title, author or category)
// Only books that still have copies available are returned.
// ----------------------------------------------------------------------------
app.get('/member/searchbooks', async (req, res) => {
  try {
    const filter = { availableCopies: { $gt: 0 } };
    if (req.query.query) {
      const rx = new RegExp(escapeRegex(req.query.query), 'i');
      filter.$or = [{ title: rx }, { author: rx }, { category: rx }];
    }

    const books = await Book.find(filter);
    if (books.length === 0) {
      return res.status(404).json({ message: 'No available books found.' });
    }
    return res.status(200).json({ count: books.length, books });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Search failed.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// POST /member/borrowbook      body: { "bookId": "..." }
// ----------------------------------------------------------------------------
app.post('/member/borrowbook', async (req, res) => {
  try {
    const { bookId } = req.body || {};
    if (!bookId || !mongoose.isValidObjectId(bookId)) {
      return res.status(400).json({ message: 'A valid bookId is required.' });
    }

    // 1) the member must not already hold this book
    const already = await Borrow.findOne({ userId: req.callerId, bookId, status: 'borrowed' });
    if (already) {
      return res.status(400).json({ message: 'You have already borrowed this book.' });
    }

    // 2) take one copy off the shelf (only if at least one is available)
    const book = await Book.findOneAndUpdate(
      { _id: bookId, availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } },
      { new: true }
    );
    if (!book) {
      const exists = await Book.exists({ _id: bookId });
      return exists
        ? res.status(400).json({ message: 'No copies of this book are available right now.' })
        : res.status(404).json({ message: 'Book not found.' });
    }

    // 3) create the borrow record (put the copy back if this fails)
    try {
      const dueDate = new Date(Date.now() + LOAN_DAYS * 24 * 60 * 60 * 1000);
      const borrow = await Borrow.create({
        userId: req.callerId,
        userEmail: req.callerEmail,
        userName: req.callerName,
        bookId: book._id,
        bookTitle: book.title,
        dueDate,
      });
      return res.status(201).json({ message: 'Book borrowed successfully.', borrow, availableCopies: book.availableCopies });
    } catch (e) {
      await Book.findByIdAndUpdate(book._id, { $inc: { availableCopies: 1 } });
      throw e;
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not borrow the book.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// GET /member/myhistory      -> only the logged-in member's own records
// ----------------------------------------------------------------------------
app.get('/member/myhistory', async (req, res) => {
  try {
    const history = await Borrow.find({ userId: req.callerId }).sort({ borrowDate: -1 });
    return res.status(200).json({ count: history.length, history });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not fetch borrowing history.', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎓 Member Microservice running on port ${PORT}`);
});
