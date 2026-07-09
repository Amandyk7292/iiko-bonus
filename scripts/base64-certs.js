const fs = require('fs');

const cert = fs.readFileSync('wallet_cert.pem').toString('base64');
const key = fs.readFileSync('wallet_private_key.pem').toString('base64');
const wwdr = fs.readFileSync('wwdr.pem').toString('base64');

let out = `--- Render Environment Variables ---\n\n`;
out += `WALLET_CERT\n${cert}\n\n`;
out += `WALLET_KEY\n${key}\n\n`;
out += `WALLET_WWDR\n${wwdr}\n\n`;

fs.writeFileSync('render_env.txt', out);
console.log('Saved to render_env.txt');
