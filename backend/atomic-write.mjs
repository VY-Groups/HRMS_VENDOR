/**
 * Atomic File Operations
 *
 * Prevents race conditions when writing JSON files.
 * Uses write-to-temp-then-rename pattern.
 *
 * Problem (Risk 2 from audit):
 *  - Two operators writing simultaneously = corrupted JSON
 *  - Write A starts, Write B starts before A finishes = data loss
 *
 * Solution:
 *  - Write to temp file first
 *  - Rename temp file to target (atomic on most filesystems)
 *  - Only one write succeeds, other gets EEXIST or overwrites cleanly
 */

import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

// ── Atomic Write ─────────────────────────────────────────────────────────

/**
 * Write data atomically to a file.
 * 1. Write to temp file
 * 2. Rename temp file to target (atomic operation)
 *
 * @param {string} targetPath - Final file path
 * @param {string|Buffer} data - Data to write
 * @returns {Promise<void>}
 */
export async function atomicWrite(targetPath, data) {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });

  // Create temp file in same directory (ensures same filesystem for atomic rename)
  const tempName = `.tmp-${randomBytes(8).toString('hex')}`;
  const tempPath = join(dir, tempName);

  try {
    // Write to temp file first
    await writeFile(tempPath, data, 'utf8');

    // Atomic rename to target
    // On Linux/macOS: This is atomic (same filesystem)
    // On Windows: This may not be fully atomic but is safer than direct write
    await rename(tempPath, targetPath);
  } catch (err) {
    // Clean up temp file on failure
    try { await unlink(tempPath); } catch {}
    throw err;
  }
}

/**
 * Write JSON data atomically.
 * @param {string} targetPath - Final file path
 * @param {any} jsonData - Data to serialize as JSON
 * @param {string} indent - Indentation (default: 2 spaces)
 */
export async function atomicWriteJson(targetPath, jsonData, indent = 2) {
  const data = JSON.stringify(jsonData, null, indent);
  return atomicWrite(targetPath, data);
}

// ── File Lock (Simple In-Memory) ─────────────────────────────────────────

const locks = new Map();

/**
 * Acquire a lock for a file path.
 * Prevents concurrent writes to the same file.
 *
 * @param {string} filePath - Path to lock
 * @param {number} timeoutMs - Max wait time (default: 5000ms)
 * @returns {Promise<Function>} Release function
 */
export async function acquireLock(filePath, timeoutMs = 5000) {
  const startTime = Date.now();

  while (true) {
    if (!locks.has(filePath) || locks.get(filePath) === false) {
      locks.set(filePath, true);
      return () => locks.set(filePath, false); // Release function
    }

    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Lock timeout for ${filePath}`);
    }

    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * Execute a function with a file lock.
 * Automatically acquires and releases the lock.
 *
 * @param {string} filePath - Path to lock
 * @param {Function} fn - Function to execute
 * @returns {Promise<any>} Result of fn
 */
export async function withLock(filePath, fn) {
  const release = await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    release();
  }
}

// ── JSON Store with Atomic Writes ────────────────────────────────────────

/**
 * Safe JSON file operations with atomic writes and locking.
 */
export class AtomicJsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  /**
   * Read JSON file safely.
   */
  async read() {
    const { readFile } = await import('fs/promises');
    try {
      const data = await readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw err;
    }
  }

  /**
   * Write JSON file atomically with locking.
   */
  async write(data) {
    return withLock(this.filePath, async () => {
      await atomicWriteJson(this.filePath, data);
    });
  }

  /**
   * Update JSON file atomically with locking.
   * Reads current state, applies updater function, writes atomically.
   */
  async update(updater) {
    return withLock(this.filePath, async () => {
      const current = await this._readUnsafe();
      const updated = updater(current);
      await atomicWriteJson(this.filePath, updated);
      return updated;
    });
  }

  /**
   * Internal read without locking (for use within locked sections).
   */
  async _readUnsafe() {
    const { readFile } = await import('fs/promises');
    try {
      const data = await readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }
}
