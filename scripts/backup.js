import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../server/db.js';

const dbPath=process.env.DB_PATH||'./data/rangers.sqlite';
const backupDir=path.resolve('./backups');
fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=path.join(backupDir,`rangers-${stamp}.sqlite`);
const db=openDatabase(dbPath);
try {
 await db.backup(destination);
 fs.chmodSync(destination,0o600);
 const check=new (await import('better-sqlite3')).default(destination,{readonly:true,fileMustExist:true});
 check.pragma('foreign_keys=ON');
 const result=check.prepare('PRAGMA integrity_check').get();
 check.close();
 if(result.integrity_check!=='ok') throw new Error('Validation intégrité de la sauvegarde échouée.');
 console.log(`Sauvegarde validée: ${destination}`);
 console.log('Téléchargez cette sauvegarde hors de l’instance Katabump et conservez-la en lieu sûr.');
} finally { db.close(); }
