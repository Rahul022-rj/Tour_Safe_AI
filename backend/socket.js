// Socket.IO: pushes live updates from the server to browsers (REST is request/response, sockets are push).
//
// Event names and payloads (server -> client):
//   location:update   {userId,name,lat,lng,accuracy,source,timestamp,zoneId,zoneName,zoneType,zoneConfidence}  operators
//   location:self     same payload                                              the tourist's own tabs
//   alert             Alert document (see models/Alert.js) with id = _id         operators and/or the tourist
//   incident          populated Incident                                        operators + the tourist concerned
//   zones:changed     {}                                                        everyone
//   tourist:status    {userId, trackingActive, online, status}                  operators
//   session:revoked   {reason}                                                  the user concerned (forces logout)
//
// Clients never choose rooms: the server puts every socket into rooms derived from the verified token.
const { Server } = require('socket.io');
const config = require('./config');

let io = null;
// userId -> number of open sockets on THIS instance (with several instances use the Redis adapter + shared presence)
const presence = new Map();

function initSocket(httpServer, { corsOrigin } = {}) {
  const { authenticate } = require('./middleware/auth'); // lazy: avoids a require cycle with models
  io = new Server(httpServer, {
    cors: { origin: corsOrigin || config.allowedOrigins },
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e5, // clients only send tiny messages
  });

  // Runs once per connection, before "connection". Same checks as the REST routes (token + account status).
  io.use(async (socket, next) => {
    try {
      socket.user = await authenticate(socket.handshake.auth?.token);
      next();
    } catch (err) {
      next(new Error(err.status ? err.message : 'Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;
    // Rooms decide who receives what:
    //   "admins"    -> every operator dashboard
    //   "user:<id>" -> only that user's own browser tabs
    socket.join(`user:${id}`);
    if (role === 'admin') socket.join('admins');

    presence.set(id, (presence.get(id) || 0) + 1);
    if (role === 'tourist' && presence.get(id) === 1) emitToAdmins('tourist:status', { userId: id, online: true });

    // Clients may ask for a heartbeat round-trip to measure connection health; nothing else is accepted
    socket.on('ping:client', (ack) => typeof ack === 'function' && ack({ t: Date.now() }));

    socket.on('disconnect', () => {
      const left = (presence.get(id) || 1) - 1;
      if (left <= 0) {
        presence.delete(id);
        if (role === 'tourist') emitToAdmins('tourist:status', { userId: id, online: false });
      } else presence.set(id, left);
    });
  });
  return io;
}

function emitToAdmins(event, data) {
  if (io) io.to('admins').emit(event, data);
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

function emitToAll(event, data) {
  if (io) io.emit(event, data);
}

// Force-disconnect every socket of a user (suspension, password change)
function disconnectUser(userId, reason) {
  if (!io) return;
  io.to(`user:${userId}`).emit('session:revoked', { reason });
  io.in(`user:${userId}`).disconnectSockets(true);
}

const isOnline = (userId) => (presence.get(String(userId)) || 0) > 0;
const onlineUserIds = () => [...presence.keys()];

function closeSocket() {
  if (io) io.close();
  io = null;
  presence.clear();
}

module.exports = { initSocket, emitToAdmins, emitToUser, emitToAll, disconnectUser, isOnline, onlineUserIds, closeSocket };
