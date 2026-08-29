const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Map serverless API handlers for local execution
const configHandler = require('./api/config');
const createHandler = require('./api/create');
const joinHandler = require('./api/join');
const lockHandler = require('./api/lock');
const guessHandler = require('./api/guess');
const restartHandler = require('./api/restart');

app.get('/api/config', configHandler);
app.post('/api/create', createHandler);
app.post('/api/join', joinHandler);
app.post('/api/lock', lockHandler);
app.post('/api/guess', guessHandler);
app.post('/api/restart', restartHandler);

// Catch-all route to serve index.html for single-page routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Local development server running on http://localhost:${PORT}`);
});
