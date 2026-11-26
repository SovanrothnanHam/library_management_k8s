// ============================================================================
//  LIBRARIAN MICROSERVICE  -  the "Librarian Office"  (port 3003)
// ============================================================================
//  Admin only (the gateway checks the JWT role = admin before forwarding).
//  APIs:
//     POST   /librarian/addbook
//     DELETE /librarian/removebook/:id
//     GET    /librarian/viewallbooks
//     GET    /librarian/viewallmembers
//     GET    /librarian/viewborrowedbooks
//     PUT    /librarian/markreturned
// ============================================================================

const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./dbconnect');
const User = require('./models/User');
const Book = require('./models/Book');
const Borrow = require('./models/Borrow');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;

connectDB();

// SECURITY GATE: block direct access
app.use((req, res, next) => {
  if (req.headers['x-gateway-secret'] !== GATEWAY_SECRET) {
    return res.status(403).json({ message: 'Direct access blocked. Please call this API through the API Gateway.' });
  }
  console.log(`${new Date().toISOString()}  ${req.method} ${req.originalUrl}`); // shows up in docker logs
  next();
});

// ----------------------------------------------------------------------------
// POST /librarian/addbook
// body: { "title": "...", "author": "...", "isbn": "...", "category": "...", "totalCopies": 3 }
// ----------------------------------------------------------------------------
app.post('/librarian/addbook', async (req, res) => {
  try {
    const { title, author, isbn, category } = req.body || {};
    const totalCopies = req.body && req.body.totalCopies !== undefined ? Number(req.body.totalCopies) : 1;

    if (!title || !author || !isbn) {
      return res.status(400).json({ message: 'title, author and isbn are required.' });
    }
    if (!Number.isInteger(totalCopies) || totalCopies < 1) {
      return res.status(400).json({ message: 'totalCopies must be a whole number of 1 or more.' });
    }
    if (await Book.findOne({ isbn })) {
      return res.status(409).json({ message: 'A book with this ISBN already exists.' });
    }

    const book = await Book.create({ title, author, isbn, category, totalCopies, availableCopies: totalCopies });
    return res.status(201).json({ message: 'Book added successfully.', book });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not add the book.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// GET /librarian/viewallbooks             -> every book, including 0 copies left
// GET /librarian/viewallbooks?query=java  -> filter by title, author or category
// ----------------------------------------------------------------------------
app.get('/librarian/viewallbooks', async (req, res) => {
  try {
    const filter = {};
    if (req.query.query) {
      const rx = new RegExp(String(req.query.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { author: rx }, { category: rx }];
    }
    const books = await Book.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ count: books.length, books });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not fetch books.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// DELETE /librarian/removebook/:id
// A book that is currently borrowed cannot be removed.
// ----------------------------------------------------------------------------
app.delete('/librarian/removebook/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid book id.' });
    }

    const activeBorrow = await Borrow.findOne({ bookId: id, status: 'borrowed' });
    if (activeBorrow) {
      return res.status(409).json({ message: 'This book is currently borrowed and cannot be removed.' });
    }

    const book = await Book.findByIdAndDelete(id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }
    return res.status(200).json({ message: `Book "${book.title}" removed successfully.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not remove the book.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// GET /librarian/viewallmembers   (passwords are never returned)
// ----------------------------------------------------------------------------
app.get('/librarian/viewallmembers', async (req, res) => {
  try {
    const members = await User.find({ role: 'member' }).select('-password');
    return res.status(200).json({ count: members.length, members });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not fetch members.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// GET /librarian/viewborrowedbooks            -> books currently borrowed
// GET /librarian/viewborrowedbooks?status=all -> every borrow record
// (status can be: borrowed (default), returned, all)
// ----------------------------------------------------------------------------
app.get('/librarian/viewborrowedbooks', async (req, res) => {
  try {
    const status = req.query.status || 'borrowed';
    const filter = status === 'all' ? {} : { status };
    const records = await Borrow.find(filter).sort({ borrowDate: -1 });
    return res.status(200).json({ count: records.length, borrows: records });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not fetch borrowed books.', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// PUT /librarian/markreturned
// body: { "borrowId": "..." }
// Marks the record as returned and puts the copy back on the shelf.
// ----------------------------------------------------------------------------
app.put('/librarian/markreturned', async (req, res) => {
  try {
    const { borrowId } = req.body || {};
    if (!borrowId || !mongoose.isValidObjectId(borrowId)) {
      return res.status(400).json({ message: 'A valid borrowId is required.' });
    }

    const record = await Borrow.findOneAndUpdate(
      { _id: borrowId, status: 'borrowed' },
      { status: 'returned', returnDate: new Date() },
      { new: true }
    );
    if (!record) {
      return res.status(404).json({ message: 'No active borrow record found with that id.' });
    }

    const book = await Book.findByIdAndUpdate(record.bookId, { $inc: { availableCopies: 1 } }, { new: true });
    return res.status(200).json({
      message: 'Book marked as returned.',
      borrow: record,
      availableCopies: book ? book.availableCopies : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not mark the book as returned.', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`📚 Librarian Microservice running on port ${PORT}`);
});
