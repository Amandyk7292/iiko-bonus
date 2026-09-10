#!/usr/bin/env node
// Run on the application server. Read-only unless --enable AND --counts-confirmed are supplied.
require('dotenv').config({ quiet: true });
const { supabase } = require('../src/config/supabase');

async function main() {
  const argv = process.argv.slice(2);
  const value = (name) => argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const branch = value('--branch');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(branch || '')) throw new Error('Укажите --branch=UUID филиала');
  if (argv.includes('--enable')) {
    const terminals = (value('--terminals') || '').split(',');
    if (
      !argv.includes('--counts-confirmed') ||
      !terminals.every((id) => uuid.test(id)) ||
      new Set(terminals).size !== terminals.length
    )
      throw new Error(
        'Нужны --terminals=UUID,UUID и --counts-confirmed после проверки каждой кассы и витрины',
      );
    const { error } = await supabase.rpc('enable_front_stock_guard', {
      p_branch: branch,
      p_terminals: terminals,
      p_counts_confirmed: true,
    });
    if (error) throw new Error(error.message);
  }
  const results = await Promise.all([
    supabase
      .from('front_stock_policies')
      .select('enabled,paused,terminal_ids,recount_id')
      .eq('branch_id', branch)
      .maybeSingle(),
    supabase
      .from('front_stock_terminals')
      .select('terminal_id,last_seen_at,connected,protocol')
      .eq('branch_id', branch),
    supabase
      .from('front_stock_sales')
      .select('receipt_id,terminal_id,online_order_id,status,created_at')
      .eq('branch_id', branch)
      .eq('status', 'reserved')
      .order('created_at')
      .limit(100),
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  process.stdout.write(
    JSON.stringify(
      {
        branch,
        policy: results[0].data,
        terminals: results[1].data,
        pendingReceipts: results[2].data,
      },
      null,
      2,
    ) + '\n',
  );
}
main().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
