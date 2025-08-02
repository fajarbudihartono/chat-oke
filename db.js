// db.js
const mysql = require('mysql2');

const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '', // default XAMPP
  database: 'chat_app',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log('✅ Pool koneksi MySQL siap digunakan.');

module.exports = db;
