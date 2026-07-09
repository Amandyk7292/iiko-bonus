const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../src/services');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
for (const file of files) {
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf8');
  content = content.replace(/require\(['"]\.\/supabase['"]\)/g, "require('../config/supabase')");
  content = content.replace(/require\(['"]\.\/push-notifications['"]\)/g, "require('./push.service')");
  content = content.replace(/require\(['"]\.\/telegram['"]\)/g, "require('./telegram.service')");
  content = content.replace(/require\(['"]\.\/customers['"]\)/g, "require('./customer.service')");
  content = content.replace(/require\(['"]\.\/settings['"]\)/g, "require('./settings.service')");
  fs.writeFileSync(fp, content);
}
console.log('Imports fixed in services.');
