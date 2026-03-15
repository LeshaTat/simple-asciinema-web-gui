'use strict';

require('dotenv').config();
const path = require('path');

const CASTS_DIR = process.env.CASTS_DIR
  ? path.resolve(process.env.CASTS_DIR)
  : path.join(__dirname, '..', 'public', 'casts');

const ZIP_DIR = path.join(CASTS_DIR, 'zip');

module.exports = { CASTS_DIR, ZIP_DIR };
