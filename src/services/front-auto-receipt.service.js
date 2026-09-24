const { supabase } = require('../config/supabase');
const { stockArgs, rpc } = require('./front-stock-guard.service');
async function listAutoReceipts(branchId, { terminalId, assemblyVersion }) {
  let query = supabase
    .from('front_receipt_jobs')
    .select(
      'order_id,receipt_id,terminal_id,created_at,fiscal_due,assembly_status,kaspi_orders!inner(order_number,status,refund_status)',
    )
    .eq('branch_id', branchId)
    .neq('status', 'completed')
    .eq('kaspi_orders.status', 'paid')
    .or('refund_status.is.null,refund_status.in.(partial,failed)', {
      referencedTable: 'kaspi_orders',
    })
    .or(`terminal_id.is.null,terminal_id.eq.${terminalId}`)
    .order('updated_at', { ascending: true })
    .limit(20);
  if (assemblyVersion !== 1) query = query.eq('fiscal_due', true);
  const { data, error } = await query;
  if (error) throw error;
  return {
    jobs: (data || [])
      .filter(
        (row) =>
          row.kaspi_orders.status === 'paid' &&
          [null, 'partial', 'failed'].includes(row.kaspi_orders.refund_status ?? null),
      )
      .map((row) => ({
        orderId: row.order_id,
        receiptId: row.receipt_id,
        fiscalDue: row.fiscal_due,
        assemblyStatus: row.assembly_status,
        number: Number(row.kaspi_orders.order_number),
      })),
  };
}
async function autoReceiptAction(branchId, payload) {
  const stock = payload.items ? await stockArgs(branchId, payload) : {};
  return rpc('front_receipt_job_action', {
    p_branch: branchId,
    p_terminal: payload.terminalId,
    p_order: payload.orderId,
    p_action: payload.action,
    p_receipt: payload.receiptId || null,
    p_items: stock.p_items || null,
    p_total: payload.total ?? null,
    p_error: payload.error || null,
  });
}
module.exports = { listAutoReceipts, autoReceiptAction };
