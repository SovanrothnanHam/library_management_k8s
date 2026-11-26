// BOOK MODEL - collection "books" (shared by Librarian and Member services)
 
const mongoose = require('mongoose');
 
const BookSchema = new mongoose.Schema(
  {
    title:           { type: String, required: true, trim: true },
    author:          { type: String, required: true, trim: true },
    isbn:            { type: String, required: true, unique: true, trim: true },
    category:        { type: String, trim: true },
    totalCopies:     { type: Number, required: true, min: 1, default: 1 },
    availableCopies: { type: Number, required: true, min: 0, default: 1 },
  },
  { timestamps: true }
);
 
module.exports = mongoose.model('Book', BookSchema);
