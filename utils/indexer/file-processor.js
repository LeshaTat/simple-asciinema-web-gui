/**
 * File processing utilities for cast file indexing
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { parseFilenameDate } = require('../parseFilename');

// Convert callbacks to promises
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const gunzipAsync = promisify(zlib.gunzip);

// Path constants
const CASTS_DIR = path.join(__dirname, '../..', 'public', 'casts');
const ZIP_DIR = path.join(CASTS_DIR, 'zip');

/**
 * Strip ANSI color codes from text
 * Based on strip-colors.js utility
 * 
 * @param {string} text - Text with ANSI color codes
 * @returns {string} - Text without ANSI color codes
 */
function stripColors(text) {
  if (!text) return '';
  
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')                 // ANSI color/style
    .replace(/\x1B\][0-9];.*?\x07/g, '')                   // OSC escape sequences
    .replace(/\x1B\][0-9].*;.*?(\x1B\\|\x07)/g, '')        // OSC escape sequences alternate format
    .replace(/\x1B[@-Z\\-_]/g, '')                         // ANSI escapes
    .replace(/\x1B[[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') // ANSI sequences
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '')         // Control characters
    .replace(/\r/g, '');                                   // Carriage returns
}

/**
 * Load and decompress a gzipped cast file from disk
 * 
 * @param {string} filePath - Path to the gzipped cast file
 * @returns {Promise<Array>} - Array of parsed events
 */
async function loadGzippedCastFile(filePath) {
  try {
    // Read the compressed file
    const compressedData = await readFileAsync(filePath);
    
    // Decompress the file in memory
    const data = await gunzipAsync(compressedData);
    
    // Convert to string and split into lines
    const content = data.toString('utf8');
    const lines = content.split('\n');
    const events = [];
    
    // Parse each line as JSON
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      try {
        const event = JSON.parse(line);
        events.push(event);
      } catch (e) {
        // Skip lines that can't be parsed
      }
    }
    
    return events;
  } catch (err) {
    console.error(`Error loading gzipped cast file ${filePath}:`, err);
    throw err;
  }
}

/**
 * Load a non-gzipped cast file
 * 
 * @param {string} filePath - Path to the cast file
 * @returns {Promise<Array>} - Array of parsed events
 */
async function loadPlainCastFile(filePath) {
  try {
    // Read the file
    const content = await readFileAsync(filePath, 'utf8');
    
    // Split into lines
    const lines = content.split('\n');
    const events = [];
    
    // Parse each line as JSON
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      try {
        const event = JSON.parse(line);
        events.push(event);
      } catch (e) {
        // Skip lines that can't be parsed
      }
    }
    
    return events;
  } catch (err) {
    console.error(`Error loading cast file ${filePath}:`, err);
    throw err;
  }
}

/**
 * Find all cast files (both regular and gzipped)
 * 
 * @returns {Promise<Array<{path: string, isGzipped: boolean}>>} - Array of file objects
 */
async function findAllCastFiles() {
  const result = [];
  
  // Find regular cast files in the main directory
  try {
    const files = await readdirAsync(CASTS_DIR);
    const castFiles = files.filter(file => file.endsWith('.cast') && !file.includes('.cast.plain'));
    
    for (const filename of castFiles) {
      result.push({
        path: path.join(CASTS_DIR, filename),
        isGzipped: false
      });
    }
  } catch (err) {
    console.error(`Error reading casts directory:`, err);
  }
  
  // Find gzipped cast files in the zip directory
  try {
    const files = await readdirAsync(ZIP_DIR);
    const gzippedFiles = files.filter(file => file.endsWith('.cast.gz'));
    
    for (const filename of gzippedFiles) {
      result.push({
        path: path.join(ZIP_DIR, filename),
        isGzipped: true
      });
    }
  } catch (err) {
    console.error(`Error reading zip directory:`, err);
  }
  
  return result;
}

module.exports = {
  stripColors,
  loadGzippedCastFile,
  loadPlainCastFile,
  findAllCastFiles,
  CASTS_DIR,
  ZIP_DIR,
  statAsync
};