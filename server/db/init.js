#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('[db-init] Reading schema...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    console.log('[db-init] Creating tables...');
    await client.query(schema);
    console.log('[db-init] ✓ Database schema initialized successfully');
  } catch (err) {
    console.error('[db-init] Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

initializeDatabase();
