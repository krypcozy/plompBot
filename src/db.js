const fs = require('fs');
const path = require('path');

/**
 * Minimal JSON file "database". Loads the whole file into memory on start,
 * writes are synchronous + atomic (write to .tmp, then rename) so a crash
 * mid-write never corrupts the real file.
 */
class JsonDB {
  constructor(filePath, defaultData = {}) {
    this.filePath = filePath;
    this.data = defaultData;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = raw.trim() ? JSON.parse(raw) : this.data;
      } else {
        this._ensureDir();
        this.save();
      }
    } catch (err) {
      console.error(`[db] Failed to load ${this.filePath}:`, err.message);
      console.error('[db] Starting from an empty dataset for this file. Check the file for corruption.');
    }
  }

  _ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  save() {
    this._ensureDir();
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}

module.exports = JsonDB;
