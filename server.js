const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CASTS_DIR = path.join(__dirname, 'public', 'casts');

// Helper functions to parse filenames
function parseFilenameDate(filename) {
  // Match pattern like asciinema_2025-04-04_13-56-53.cast
  const match = filename.match(/asciinema_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.cast/);
  if (match) {
    return {
      date: match[1],
      time: match[2].replace(/-/g, ':'),
      dateObj: new Date(`${match[1]}T${match[2].replace(/-/g, ':')}`)
    };
  }
  return null;
}

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

// Timeline view - organized by date
app.get('/timeline', (req, res) => {
  fs.readdir(CASTS_DIR, (err, files) => {
    if (err) {
      console.error('Error reading casts directory:', err);
      return res.status(500).send('Error reading casts directory');
    }
    
    // Filter only .cast files and sort by date (newest first)
    const castFiles = files
      .filter(file => file.endsWith('.cast'))
      .sort()
      .reverse();
    
    // Group recordings by date
    const recordingsByDate = {};
    
    castFiles.forEach(filename => {
      const dateInfo = parseFilenameDate(filename);
      
      if (dateInfo) {
        // If this date doesn't exist yet, create an array for it
        if (!recordingsByDate[dateInfo.date]) {
          recordingsByDate[dateInfo.date] = [];
        }
        
        // Add this recording to its date
        recordingsByDate[dateInfo.date].push({
          filename,
          timeString: dateInfo.time.replace(/:/g, ':'),
          dateObj: dateInfo.dateObj
        });
      }
      // Skip files that don't match our timestamp pattern
    });
    
    // Sort recordings within each date by time
    Object.keys(recordingsByDate).forEach(date => {
      recordingsByDate[date].sort((a, b) => {
        if (a.dateObj && b.dateObj) {
          return b.dateObj - a.dateObj; // Newest first
        }
        return 0;
      });
    });
    
    // Helper function to format dates nicely
    const formatDate = (dateString) => {
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      } catch (e) {
        return dateString;
      }
    };
    
    res.render('timeline', { 
      recordingsByDate, 
      formatDate,
      activeFile: req.query.file || null
    });
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