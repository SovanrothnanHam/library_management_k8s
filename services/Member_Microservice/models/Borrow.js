// BORROW MODEL - collection "borrows" (shared by Librarian and Member services)
 
const mongoose = require('mongoose');
 
const BorrowSchema = new mongoose.Schema(
  {
    userId:     { type: String, required: true },
    userEmail:  { type: String, required: true },
    userName:   { type: String },
    bookId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    bookTitle:  { type: String },
    borrowDate: { type: Date, default: Date.now },
    dueDate:    { type: Date, required: true },
    returnDate: { type: Date },
    status:     { type: String, enum: ['borrowed', 'returned'], default: 'borrowed' },
  },
  { timestamps: true }
);
 
module.exports = mongoose.model('Borrow', BorrowSchema);
