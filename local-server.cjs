const os = require('os');
const server = require('./socket-server.cjs');
const port = Number(process.env.PORT) || 3000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Meme Machine on http://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) for (const net of list || []) {
    if (net.family === 'IPv4' && !net.internal) console.log(`Same-Wi-Fi invite: http://${net.address}:${port}`);
  }
});
