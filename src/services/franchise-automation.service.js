const { supabase } = require('../config/supabase');
const { checkBankOrder } = require('./franchise-bank-check.service');
const { finalJobCost, TERMINAL } = require('./delivery-budget-cost');
let running = false;
let deliveryOffset = 0;
async function reconcileFranchise({ db = supabase, forte, widget } = {}) {
  if (running) return 0;
  running = true;
  try {
    // Only confirmed final invoices are copied. A courier offer is never a cost.
    const { data: jobs, error: jobsError } = await db
      .from('delivery_jobs')
      .select('*')
      .is('budget_final_cost', null)
      .in('provider_status', [...TERMINAL])
      .order('id')
      .range(deliveryOffset, deliveryOffset + 49);
    if (jobsError) throw jobsError;
    deliveryOffset = (jobs || []).length < 50 ? 0 : deliveryOffset + 50;
    for (const job of jobs || []) {
      const cost = finalJobCost(job);
      if (cost !== null) {
        const { error } = await db
          .from('delivery_jobs')
          .update({ budget_final_cost: cost })
          .eq('id', job.id)
          .eq('updated_at', job.updated_at)
          .is('budget_final_cost', null);
        if (error) throw error;
      }
    }
    const { data: queue, error } = await db.rpc('franchise_bank_queue');
    if (error) throw error;
    for (const item of queue || []) {
      const { data: order, error: readError } = await db
        .from('kaspi_orders')
        .select('*')
        .eq('id', item.order_id)
        .maybeSingle();
      if (readError) throw readError;
      if (!order) continue;
      const result = await checkBankOrder(order, {
        forte: forte || require('./forte.service'),
        widget: widget || require('./forte-widget.service'),
      });
      const { error: saveError } = await db.from('franchise_bank_checks').upsert({
        order_id: order.id,
        signature: item.signature,
        checked_at: new Date().toISOString(),
        checked_by: 'automatic',
        ...result,
      });
      if (saveError) throw saveError;
      // Stop a failed provider burst. The saved attempt retries after backoff.
      if (result.issue === 'unavailable') break;
    }
    return (queue || []).length;
  } finally {
    running = false;
  }
}
module.exports = { reconcileFranchise };
