const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const db = require('./db'); // Koneksi MySQL buatanmu

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Folder upload
const uploadDir = path.join(__dirname, 'public/images/profiles');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Menyimpan user aktif dan socket ID
const aktifUsers = new Map();        // socket.id => username
const userSockets = {};              // username => socket.id

// Socket.IO
io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);

  // User masuk (global)
  socket.on('user connected', (username) => {
    aktifUsers.set(socket.id, username);
    userSockets[username] = socket.id;
    updateUserList();
    console.log(`${username} terhubung (global chat)`);
  });

  // User masuk (private chat)
  socket.on('join user room', (username) => {
    userSockets[username] = socket.id;
    console.log(`${username} terhubung ke room pribadi (${socket.id})`);
  });

  // Join ke room khusus
  socket.on('join private', (room) => {
    socket.join(room);
  });

  // Pesan umum
  socket.on('chat message', ({ username, message }) => {
    db.query('INSERT INTO messages (username, message) VALUES (?, ?)', [username, message]);
    io.emit('chat message', { username, message });
  });

  // Pesan pribadi
  socket.on('private message', ({ room, from, to, message }) => {
    io.to(room).emit('private message', { from, message });

    // Jika user belum berada di private chat, kirim notifikasi
    const receiverSocket = userSockets[to];
    if (receiverSocket) {
      io.to(receiverSocket).emit('notify message', { from, to });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const username = aktifUsers.get(socket.id);
    if (username) {
      aktifUsers.delete(socket.id);
      delete userSockets[username];
      updateUserList();
      console.log(`🔴 ${username} disconnect (${socket.id})`);
    }
  });

  // Kirim update daftar user aktif
  function updateUserList() {
    const userList = Array.from(aktifUsers.values());
    io.emit('active users', userList);
  }
});

// API: Register
app.post('/register', (req, res) => {
  upload.single('foto')(req, res, async (err) => {
    if (err) return res.status(400).send('Upload gagal: ' + err.message);

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Username dan password wajib diisi.');

    const hashed = await bcrypt.hash(password, 10);
    const foto = req.file ? '/images/profiles/' + req.file.filename : '/images/profiles/default.jpg';

    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
      if (results.length > 0) return res.status(400).send('Username sudah terdaftar.');

      db.query('INSERT INTO users (username, password, foto) VALUES (?, ?, ?)',
        [username, hashed, foto],
        (err) => {
          if (err) return res.status(500).send('Gagal simpan user');
          res.send(`<script>alert("Registrasi berhasil!"); window.location.href="/login.html";</script>`);
        });
    });
  });
});

// API: Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
    if (results.length === 0) return res.status(400).send('Username tidak ditemukan');

    const match = bcrypt.compareSync(password, results[0].password);
    if (!match) return res.status(400).send('Password salah');

    res.redirect(`/chat.html?user=${encodeURIComponent(username)}`);
  });
});

// API: Info foto user
app.get('/api/userinfo', (req, res) => {
  const username = req.query.username;
  db.query('SELECT foto FROM users WHERE username = ?', [username], (err, results) => {
    if (err || results.length === 0) return res.json({});
    res.json({ foto: results[0].foto });
  });
});

// API: Semua user (untuk daftar teman)
app.get('/api/allusers', (req, res) => {
  db.query('SELECT username FROM users', (err, results) => {
    if (err) return res.status(500).json({ error: err });
    const usernames = results.map(row => row.username);
    res.json(usernames);
  });
});

// Jalankan server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
