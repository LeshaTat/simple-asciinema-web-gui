/**
 * utils/maintain-casts.js
 *
 * Compresses .cast files to .cast.gz, writes a .gz.info sidecar, then
 * deletes the original.  All disk operations are atomic so Syncthing
 * never sees a half-written file.
 *
 * Info file fields:
 *   duration        — actual recording duration in seconds
 *   cast_version    — asciicast format version (2 or 3)
 *   compressed_at   — ISO timestamp of when compression ran
 *   original_size   — byte size of the original .cast file
 *   compressed_size — byte size of the resulting .gz file
 *
 * Duration extraction:
 *   v2  — absolute timestamps → last event timestamp = total duration
 *   v3  — relative intervals  → sum of all intervals = total duration
 *   Either version may have header.duration (only present in converted
 *   files, not live recordings), which takes precedence when present.
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const zlib    = require('zlib');
const { promisify } = require('util');
const { pipeline }  = require('stream');

const readFileAsync  = promisify(fs.readFile);
const readdirAsync   = promisify(fs.readdir);
const statAsync      = promisify(fs.stat);
const mkdirAsync     = promisify(fs.mkdir);
const accessAsync    = promisify(fs.access);
const renameAsync    = promisify(fs.rename);
const pipelineAsync  = promisify(pipeline);

const args     = process.argv.slice(2);
const getArg   = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const CASTS_DIR = getArg('--casts-dir') || path.join(__dirname, '..', 'public', 'casts');
const ZIP_DIR   = path.join(CASTS_DIR, 'zip');

// ---------------------------------------------------------------------------
// Duration extraction — v2 and v3
// ---------------------------------------------------------------------------

/**
 * Extract recording duration from the text content of a .cast file.
 *
 * Returns { duration, source, version } or throws.
 */
function extractDuration(content) {
  const lines = content.split('\n');

  let header;
  try { header = JSON.parse(lines[0]); }
  catch { throw new Error('cannot parse header'); }

  if (!header || typeof header !== 'object') {
    throw new Error('header is not a JSON object');
  }

  const version = header.version || 2;

  // header.duration is only written by `asciinema convert`, not by the live
  // recorder — but use it when present as it's already the ground truth.
  if (typeof header.duration === 'number' && header.duration > 0) {
    return { duration: header.duration, source: 'header.duration', version };
  }

  // Skip blank lines and v3 comment lines (start with #)
  const eventLines = lines
    .slice(1)
    .filter(l => { const t = l.trim(); return t && !t.startsWith('#'); });

  if (version >= 3) {
    // v3: timestamps are intervals between events — sum them all
    let total = 0;
    for (const line of eventLines) {
      try {
        const ev = JSON.parse(line);
        if (Array.isArray(ev) && typeof ev[0] === 'number' && ev[0] >= 0) {
          total += ev[0];
        }
      } catch { /* skip unparseable lines */ }
    }
    if (total === 0) throw new Error('no events or all intervals are zero');
    return { duration: total, source: 'sum of v3 intervals', version };
  } else {
    // v2: timestamps are absolute seconds since session start
    // Scan backwards — first valid hit is the last (largest) timestamp
    for (let i = eventLines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(eventLines[i]);
        if (Array.isArray(ev) && typeof ev[0] === 'number' && ev[0] > 0) {
          return { duration: ev[0], source: 'last v2 timestamp', version };
        }
      } catch { /* skip */ }
    }
    throw new Error('no events with valid timestamps found');
  }
}

/**
 * Read a .cast file and extract its duration.
 */
async function getRecordingDuration(filePath) {
  const content = await readFileAsync(filePath, 'utf8');
  return extractDuration(content);
}

// ---------------------------------------------------------------------------
// Atomic compression
// ---------------------------------------------------------------------------

/**
 * Compress inputPath → outputPath using gzip.
 * Writes to a .tmp file first, then renames atomically.
 * Cleans up the tmp file on failure.
 */
async function compressFileAtomic(inputPath, outputPath) {
  const tmpPath = outputPath + '.tmp';
  try {
    const read  = fs.createReadStream(inputPath);
    const write = fs.createWriteStream(tmpPath);
    const gz    = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
    await pipelineAsync(read, gz, write);
    await renameAsync(tmpPath, outputPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Verify a gz file by fully decompressing it in memory.
 * Returns true if valid, false if corrupt.
 */
async function verifyGz(gzPath) {
  try {
    const buf = await readFileAsync(gzPath);
    zlib.gunzipSync(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a .gz.info file atomically (tmp → rename).
 */
async function writeInfoFileAtomic(infoPath, data) {
  const tmpPath = infoPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await renameAsync(tmpPath, infoPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function maintainCastFiles() {
  // Ensure zip directory exists
  try {
    await accessAsync(ZIP_DIR, fs.constants.F_OK);
  } catch {
    console.log(`Creating zip directory: ${ZIP_DIR}`);
    await mkdirAsync(ZIP_DIR, { recursive: true });
  }

  const files     = await readdirAsync(CASTS_DIR);
  const castFiles = files.filter(f =>
    f.endsWith('.cast') &&
    f !== 'example.cast' &&
    f !== 'zip'
  );

  console.log(`Found ${castFiles.length} cast file(s)`);

  // Skip the most recently modified file — it may still be recording
  let latestFile = null, latestMtime = 0;
  for (const filename of castFiles) {
    try {
      const stats = await statAsync(path.join(CASTS_DIR, filename));
      if (stats.mtimeMs > latestMtime) {
        latestMtime = stats.mtimeMs;
        latestFile  = filename;
      }
    } catch { /* ignore inaccessible files */ }
  }

  for (const filename of castFiles) {
    if (filename === latestFile) {
      console.log(`Skipping ${filename} — most recent file (may still be recording)`);
      continue;
    }

    const originalPath = path.join(CASTS_DIR, filename);
    const gzPath       = path.join(ZIP_DIR, `${filename}.gz`);
    const infoPath     = gzPath + '.info';

    // Check what already exists
    const gzExists   = await accessAsync(gzPath,   fs.constants.F_OK).then(() => true).catch(() => false);
    const infoExists = await accessAsync(infoPath,  fs.constants.F_OK).then(() => true).catch(() => false);

    if (gzExists && infoExists) {
      // Already fully processed — just clean up the leftover original if present
      console.log(`Already compressed: ${filename}`);
      try {
        await fs.promises.unlink(originalPath);
        console.log(`  Deleted leftover original: ${filename}`);
      } catch { /* already gone, that's fine */ }
      continue;
    }

    // --- Compress (atomic) ---
    if (!gzExists) {
      console.log(`Compressing: ${filename}`);
      try {
        await compressFileAtomic(originalPath, gzPath);
      } catch (err) {
        console.error(`  ⚠️  Compression failed for ${filename}: ${err.message}`);
        continue;
      }
    } else {
      console.log(`Using existing gz (no info yet): ${filename}`);
    }

    // --- Verify the gz before doing anything irreversible ---
    const valid = await verifyGz(gzPath);
    if (!valid) {
      console.error(`  ⚠️  gz verification failed for ${filename} — keeping original, removing bad gz`);
      try { await fs.promises.unlink(gzPath); } catch { /* ignore */ }
      continue;
    }

    // --- Extract duration from the original (still on disk) ---
    let durationResult;
    try {
      durationResult = await getRecordingDuration(originalPath);
      console.log(`  Duration: ${durationResult.duration.toFixed(3)}s (v${durationResult.version}, ${durationResult.source})`);
    } catch (err) {
      console.error(`  ⚠️  Could not extract duration for ${filename}: ${err.message}`);
      durationResult = { duration: null, source: 'extraction failed', version: null };
    }

    // --- Write info file (atomic) ---
    const [origStat, gzStat] = await Promise.all([
      statAsync(originalPath),
      statAsync(gzPath),
    ]);

    const infoData = {
      duration:        durationResult.duration,
      cast_version:    durationResult.version,
      compressed_at:   new Date().toISOString(),
      original_size:   origStat.size,
      compressed_size: gzStat.size,
    };

    try {
      await writeInfoFileAtomic(infoPath, infoData);
      console.log(`  Wrote info: ${path.basename(infoPath)}`);
    } catch (err) {
      console.error(`  ⚠️  Failed to write info file for ${filename}: ${err.message}`);
      continue;
    }

    // --- Only now delete the original ---
    try {
      await fs.promises.unlink(originalPath);
      console.log(`  Deleted original: ${filename}`);
    } catch (err) {
      console.warn(`  Could not delete original ${filename}: ${err.message}`);
    }
  }

  console.log('Maintenance complete.');
}

if (require.main === module) {
  maintainCastFiles().catch(err => {
    console.error('Maintenance failed:', err);
    process.exit(1);
  });
}

module.exports = { maintainCastFiles };
