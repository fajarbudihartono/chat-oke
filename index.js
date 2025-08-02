const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const db = require('./db'); // Koneksi MySQL

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
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
const aktifUsers = new Map();   // socket.id => username
const userSockets = {};         // username => socket.id

// Socket.IO
io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);

  socket.on('user connected', (username) => {
    aktifUsers.set(socket.id, username);
    userSockets[username] = socket.id;
    updateUserList();
    console.log(`${username} terhubung`);
  });

  socket.on('join user room', (username) => {
    userSockets[username] = socket.id;
    console.log(`${username} masuk private room (${socket.id})`);
  });

  socket.on('join private', (room) => {
    socket.join(room);
  });

  socket.on('chat message', ({ username, message }) => {
    db.query('INSERT INTO messages (username, message) VALUES (?, ?)', [username, message], (err) => {
      if (err) console.error('DB error:', err);
    });
    io.emit('chat message', { username, message });
  });

  socket.on('private message', ({ room, from, to, message }) => {
    io.to(room).emit('private message', { from, message });

    const receiverSocket = userSockets[to];
    if (receiverSocket) {
      io.to(receiverSocket).emit('notify message', { from, to });
    }
  });

  socket.on('disconnect', () => {
    const username = aktifUsers.get(socket.id);
    if (username) {
      aktifUsers.delete(socket.id);
      delete userSockets[username];
      updateUserList();
      console.log(`🔴 ${username} disconnect`);
    }
  });

  function updateUserList() {
    const userList = Array.from(aktifUsers.values());
    io.emit('active users', userList);
  }
});

// Register
app.post('/register', upload.single('foto'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Username dan password wajib diisi.');

  const hashed = await bcrypt.hash(password, 10);
  const foto = req.file ? '/images/profiles/' + req.file.filename : '/images/profiles/default.jpg';

  db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
    if (err) return res.status(500).send('Error database');
    if (results.length > 0) return res.status(400).send('Username sudah terdaftar.');

    db.query('INSERT INTO users (username, password, foto) VALUES (?, ?, ?)', [username, hashed, foto], (err2) => {
      if (err2) return res.status(500).send('Gagal simpan user');
      res.send(`<script>alert("Registrasi berhasil!"); window.location.href="/login.html";</script>`);
    });
  });
});

// Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
    if (err) return res.status(500).send('Error database');
    if (results.length === 0) return res.status(400).send('Username tidak ditemukan');

    const match = bcrypt.compareSync(password, results[0].password);
    if (!match) return res.status(400).send('Password salah');

    res.redirect(`/chat.html?user=${encodeURIComponent(username)}`);
  });
});

// Info foto user
app.get('/api/userinfo', (req, res) => {
  const username = req.query.username;
  db.query('SELECT foto FROM users WHERE username = ?', [username], (err, results) => {
    if (err || results.length === 0) return res.json({});
    res.json({ foto: results[0].foto });
  });
});

// Semua user
app.get('/api/allusers', (req, res) => {
  db.query('SELECT username FROM users', (err, results) => {
    if (err) return res.status(500).json({ error: err });
    const usernames = results.map(row => row.username);
    res.json(usernames);
  });
});

// Jalankan server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});
