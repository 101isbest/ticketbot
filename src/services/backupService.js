const fs = require('fs');
const path = require('path');
const { DATA_DIR, DB_PATH } = require('../database/database');
const { getDb } = require('../database/database');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * Create a backup of the database
 */
function createBackup(guildId, userId) {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${guildId}-${timestamp}.db`;
    const filePath = path.join(BACKUP_DIR, fileName);

    try {
        // Validate db integrity first
        const db = getDb();
        const integrity = db.pragma('integrity_check');
        if (!integrity || (integrity[0] && integrity[0].integrity_check !== 'ok')) {
            return { success: false, error: 'Veritabanı bütünlük kontrolü başarısız oldu. Yedekleme iptal edildi.' };
        }

        // Use SQLite backup API
        db.backup(filePath);

        const stats = fs.statSync(filePath);

        return {
            success: true,
            fileName,
            filePath,
            size: stats.size,
            timestamp: new Date().toISOString(),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * List available backups for a guild
 */
function listBackups(guildId) {
    if (!fs.existsSync(BACKUP_DIR)) return [];

    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith(`backup-${guildId}-`) && f.endsWith('.db'))
        .sort()
        .reverse();

    return files.map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        const match = f.match(/backup-\d+-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        return {
            fileName: f,
            size: stats.size,
            created: match ? match[1].replace(/-/g, (m, i) => i > 9 ? ':' : '-') : stats.mtime.toISOString(),
        };
    });
}

/**
 * Restore a backup
 */
function restoreBackup(fileName) {
    const backupPath = path.join(BACKUP_DIR, fileName);
    if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Yedek dosyası bulunamadı.' };
    }

    try {
        // Validate backup file
        const Database = require('better-sqlite3');
        const testDb = new Database(backupPath, { readonly: true });
        const integrity = testDb.pragma('integrity_check');
        testDb.close();

        if (!integrity || (integrity[0] && integrity[0].integrity_check !== 'ok')) {
            return { success: false, error: 'Yedek dosyası bozuk. Geri yükleme iptal edildi.' };
        }

        // Create safety backup of current db
        const safetyName = `safety-${Date.now()}.db`;
        const safetyPath = path.join(BACKUP_DIR, safetyName);
        fs.copyFileSync(DB_PATH, safetyPath);

        // Close current connection and restore
        const { close } = require('../database/database');
        close();

        fs.copyFileSync(backupPath, DB_PATH);

        return { success: true, safetyBackup: safetyName };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Delete a backup file
 */
function deleteBackup(fileName) {
    const backupPath = path.join(BACKUP_DIR, fileName);
    if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        return true;
    }
    return false;
}

module.exports = { createBackup, listBackups, restoreBackup, deleteBackup };
