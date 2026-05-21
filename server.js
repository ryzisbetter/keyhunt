{
  "name": "keyhunt-backend",
  "version": "1.0.0",
  "description": "Game account & key price aggregation and comparison engine",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0"
  }
}
