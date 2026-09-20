const path = require('node:path');
const sharp = require('sharp');

let artwork;
function getWalletArtwork() {
  if (!artwork) {
    const directory = path.join(__dirname, '../assets/pass.model');
    artwork = (async () => {
      const buffers = {};
      for (const scale of [1, 2, 3]) {
        const suffix = scale === 1 ? '' : `@${scale}x`;
        // PassKit controls layout; supply native-resolution artwork for each scale.
        buffers[`logo${suffix}.png`] = await sharp(path.join(directory, 'brand-logo.png'))
          .trim().resize({width: 160 * scale, height: 50 * scale, fit: 'inside'})
          .png().toBuffer();
        buffers[`strip${suffix}.png`] = await sharp(path.join(directory, 'ornament.png'))
          .resize(375 * scale, 144 * scale, {fit: 'cover', position: 'centre'})
          .png().toBuffer();
      }
      return buffers;
    })().catch((error) => { artwork = null; throw error; });
  }
  return artwork;
}
module.exports = { getWalletArtwork };
