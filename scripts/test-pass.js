const { PKPass } = require('passkit-generator');
const fs = require('fs');

async function test() {
  try {
    const pass = new PKPass(
      {
        'pass.json': fs.readFileSync('./pass.model/pass.json'),
        'icon.png': fs.readFileSync('./pass.model/icon.png'),
        'logo.png': fs.readFileSync('./pass.model/logo.png')
      },
      {
        signerCert: fs.readFileSync('./wallet_cert.pem'),
        signerKey: fs.readFileSync('./wallet_private_key.pem'),
        wwdr: fs.readFileSync('./wwdr.pem')
      }
    );
    const buf = await pass.getAsBuffer();
    console.log("Buffer length:", buf.length);
  } catch (e) {
    console.error(e);
  }
}

test();
