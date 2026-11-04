import jwt from 'jsonwebtoken';
import { getPool } from './db.js';
import { AUTH_COOKIE_NAME } from './auth.js';

function readCookie(header = '', name) {
  for (const piece of header.split(';')) {
    const [key, ...rest] = piece.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function configureSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie || '', AUTH_COOKIE_NAME);
      const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'saitama-bot' });
      const user = await getPool().query('SELECT id FROM users WHERE id=$1', [payload.sub]);
      if (!user.rowCount) return next(new Error('Unauthorized'));
      socket.data.userId = payload.sub;
      next();
    } catch { next(new Error('Unauthorized')); }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
  });
}
