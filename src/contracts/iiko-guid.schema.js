const { z } = require('../middlewares/validation.middleware');

// iikoFront exposes .NET Guid identifiers, including non-RFC versions/variants.
// Validate the canonical 128-bit representation without imposing UUID bits.
// Keep Bulka-generated IDs on their existing UUID schemas.
const iikoGuidSchema = z.guid().length(36).toLowerCase();

module.exports = { iikoGuidSchema };
