const fs = require('fs');
const forge = require('node-forge');

const pem = fs.readFileSync('wallet_cert.pem', 'utf8');
const cert = forge.pki.certificateFromPem(pem);

console.log('=== Certificate Subject ===');
cert.subject.attributes.forEach(attr => {
  console.log(`  ${attr.shortName || attr.name} (OID: ${attr.type}): ${attr.value}`);
});

console.log('\n=== Certificate Extensions ===');
cert.extensions.forEach(ext => {
  if (ext.name) console.log(`  ${ext.name}: ${JSON.stringify(ext.value || ext.id)}`);
});
