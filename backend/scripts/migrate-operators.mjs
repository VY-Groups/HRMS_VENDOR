import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
const operatorsFile = path.join(dataDir, 'operators.json');

function migrate() {
  if (!fs.existsSync(operatorsFile)) {
    console.log('No operators.json found. Nothing to migrate.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(operatorsFile, 'utf8'));
  let migratedCount = 0;

  if (Array.isArray(data.operators)) {
    data.operators = data.operators.map(op => {
      let changed = false;
      
      // Ensure Platform_Admin role string
      if (op.role === 'platform_admin') {
        op.role = 'Platform_Admin';
        changed = true;
      }
      
      if (op.is_active === undefined) {
        op.is_active = true;
        changed = true;
      }
      
      if (op.auth_source === undefined) {
        op.auth_source = 'local';
        changed = true;
      }

      if (changed) migratedCount++;
      return op;
    });
  }

  if (migratedCount > 0) {
    fs.writeFileSync(operatorsFile, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Migrated ${migratedCount} operator(s) successfully.`);
  } else {
    console.log('Operators already migrated. No changes made.');
  }
}

migrate();
