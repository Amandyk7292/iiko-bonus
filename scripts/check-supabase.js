require('dotenv').config();
const { supabase } = require('../src/config/supabase');

async function main() {
  const missing = [];
  if (!process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes('xxxxxxxx')) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === 'ey...') missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length) {
    console.error(`Missing real values in .env: ${missing.join(', ')}`);
    process.exit(1);
  }

  const checks = [];

  const { data: settings, error: settingsReadError } = await supabase
    .from('settings')
    .select('key,value')
    .limit(3);
  if (settingsReadError) throw new Error(`settings read failed: ${settingsReadError.message}`);
  checks.push(`settings read ok (${settings.length})`);

  const { data: customers, error: customersReadError } = await supabase
    .from('customers')
    .select('id')
    .limit(1);
  if (customersReadError) throw new Error(`customers read failed: ${customersReadError.message}`);
  checks.push(`customers read ok (${customers.length})`);

  const { data: tiers, error: tiersReadError } = await supabase
    .from('loyalty_tiers')
    .select('id')
    .limit(1);
  if (tiersReadError) {
    throw new Error(
      `loyalty_tiers read failed (apply npm run db:migrate first): ${tiersReadError.message}`,
    );
  }
  checks.push(`loyalty tiers read ok (${tiers.length})`);

  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) throw new Error(`storage bucket check failed: ${bucketError.message}`);
  checks.push(`storage ok (${(buckets || []).some(b => b.name === 'stories') ? 'stories bucket exists' : 'stories bucket missing'})`);

  console.log('Supabase OK');
  for (const check of checks) console.log(`- ${check}`);
}

main().catch((err) => {
  console.error('Supabase check failed');
  console.error(err.message);
  process.exit(1);
});
