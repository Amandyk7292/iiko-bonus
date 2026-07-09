const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../src/server.js');
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/require\(['"]\.\/services\/otpStore['"]\)/g, "require('./services/otpStore.service')");
fs.writeFileSync(file, content);

const dir = path.join(__dirname, '../src/services');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
for (const f of files) {
  const fp = path.join(dir, f);
  let content = fs.readFileSync(fp, 'utf8');
  content = content.replace(/require\(['"]\.\/otpStore['"]\)/g, "require('./otpStore.service')");
  content = content.replace(/require\(['"]\.\/iiko-api['"]\)/g, "require('./iiko.service')");
  content = content.replace(/require\(['"]\.\/index['"]\)/g, "require('../utils/tier.util')"); // getTierInfo was in index
  fs.writeFileSync(fp, content);
}
