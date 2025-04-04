const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CASTS_DIR = path.join(__dirname, 'public', 'casts');

// Set view engine
app.set('view engine', 'ejs');

// Serve static files
app.use(express.static('public'));

// Serve node_modules files
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Serve asciinema-player files
app.use('/asciinema-player', express.static(
  path.join(__dirname, 'node_modules', 'asciinema-player', 'dist')
));

// Main route - list of cast files
app.get('/', (req, res) => {
  fs.readdir(CASTS_DIR, (err, files) => {
    if (err) {
      console.error('Error reading casts directory:', err);
      return res.status(500).send('Error reading casts directory');
    }
    
    // Filter only .cast files
    const castFiles = files.filter(file => file.endsWith('.cast'));
    
    res.render('index', { castFiles });
  });
});

// Player route
app.get('/play/:filename', (req, res) => {
  const filename = req.params.filename;
  // Validate filename to prevent directory traversal
  if (!filename.match(/^[a-zA-Z0-9_\-\.]+\.cast$/)) {
    return res.status(400).send('Invalid filename');
  }
  
  res.render('player', { filename });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Place your .cast files in: ${CASTS_DIR}`);
});