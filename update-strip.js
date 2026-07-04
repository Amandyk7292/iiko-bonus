const { Jimp } = require('jimp');
const path = require('path');

const passModelDir = path.join(__dirname, 'pass.model');
const stripSrc = 'C:\\Users\\Asus Rog\\.gemini\\antigravity-ide\\brain\\0a5fe602-9bc6-434e-9885-8c835534045b\\strip_dark_1783071986650.png';

async function updateStrip() {
  const strip = await Jimp.read(stripSrc);
  await strip.resize({ w: 375 }).write(path.join(passModelDir, 'strip.png'));
  const strip2x = await Jimp.read(stripSrc);
  await strip2x.resize({ w: 750 }).write(path.join(passModelDir, 'strip@2x.png'));
  console.log('Dark strip images updated!');
}

updateStrip();
