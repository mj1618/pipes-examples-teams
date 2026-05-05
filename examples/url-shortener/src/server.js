import express from 'express';
import { saveUrl, getUrl, incrementVisits } from './store.js';

const app = express();
app.use(express.json());

/**
 * Generate a random 6-character alphanumeric code
 * @returns {string}
 */
function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /shorten - shorten a URL
app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const code = generateCode();
  saveUrl(code, url);

  const short = `${req.protocol}://${req.get('host')}/${code}`;
  return res.status(201).json({ short, url });
});

// GET /stats/:code - get stats for a short code
app.get('/stats/:code', (req, res) => {
  const { code } = req.params;
  const entry = getUrl(code);

  if (!entry) {
    return res.status(404).json({ error: 'Short code not found' });
  }

  return res.json({ code, url: entry.url, visits: entry.visits });
});

// GET /:code - redirect to original URL
app.get('/:code', (req, res) => {
  const { code } = req.params;
  const entry = getUrl(code);

  if (!entry) {
    return res.status(404).json({ error: 'Short code not found' });
  }

  incrementVisits(code);
  return res.redirect(302, entry.url);
});

export default app;

// Start server if run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`URL Shortener running on port ${PORT}`);
  });
}
