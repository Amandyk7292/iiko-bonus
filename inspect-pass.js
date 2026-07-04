const fs = require('fs');
const AdmZip = require('adm-zip');

try {
  const zip = new AdmZip('test_pass.pkpass');
  const entries = zip.getEntries();
  
  console.log('=== Files in .pkpass ===');
  entries.forEach(e => {
    console.log(`  ${e.entryName} (${e.header.size} bytes)`);
  });
  
  // Read pass.json from inside
  const passEntry = zip.getEntry('pass.json');
  if (passEntry) {
    const passJson = JSON.parse(passEntry.getData().toString('utf8'));
    console.log('\n=== pass.json contents ===');
    console.log(JSON.stringify(passJson, null, 2));
  }
} catch (e) {
  console.error('Error:', e.message);
  // Try reading as text
  const content = fs.readFileSync('test_pass.pkpass', 'utf8').substring(0, 500);
  console.log('Raw content:', content);
}
