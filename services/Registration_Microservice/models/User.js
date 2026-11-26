// USER MODEL - collection "users"
// role "admin" = Librarian, role "member" = Student/Patron
 
const mongoose = require('mongoose');
 
const UserSchema = new mongoose.Schema(
  {
    name:     { type: String, required: [true, 'Name is required'], trim: true },
    email:    { type: String, required: [true, 'Email is required'], unique: true, lowercase: true, trim: true },
    password: { type: String, required: [true, 'Password is required'] }, // always a bcrypt hash
    role:     { type: String, enum: ['admin', 'member'], default: 'member', required: true },
    phone:    { type: String, trim: true },
  },
  { timestamps: true } // adds createdAt + updatedAt
);
 
module.exports = mongoose.model('User', UserSchema);
