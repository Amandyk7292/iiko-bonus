// Read-only provider queries: checking never captures a payment or retries a refund.
async function checkBankOrder(order, { forte, widget }) {
  if (order.payment_method !== 'forte_card') {
    return { payment_status: 'unsupported', refund_status: 'unsupported', issue: 'manual' };
  }
  try {
    const isWidget = order.provider_payment_system === 'forte_widget';
    const provider = isWidget ? widget : forte;
    const { normalized } = await provider.queryOrder(order);
    const payment = isWidget
      ? widget.mapWidgetStatus(normalized)
      : forte.mapForteStatus(normalized.status);
    let refund = 'none';
    const needsRefund =
      order.status === 'refunded' ||
      Number(order.partially_refunded_amount) > 0 ||
      Boolean(order.refund_status && order.refund_status !== 'none');
    if (needsRefund) {
      refund = 'manual';
      if (!isWidget && payment === 'refunded') refund = 'confirmed';
      else if (isWidget && order.refund_reference) {
        refund = (await widget.reconcileRefund(order)).status;
        // A full-refund lookup cannot verify separate partial refunds.
        if (Number(order.partially_refunded_amount) > 0) refund = 'manual';
      }
    }
    const localPaid = ['paid', 'refunded'].includes(order.status);
    let issue = 'ok';
    if (localPaid && !['paid', 'refunded'].includes(payment)) issue = 'payment_unconfirmed';
    else if (!localPaid && payment === 'paid') issue = 'local_unpaid';
    else if (
      (payment === 'refunded' || (refund === 'confirmed' && isWidget)) &&
      order.status !== 'refunded'
    )
      issue = 'local_refund_missing';
    else if (needsRefund && refund !== 'confirmed') issue = 'refund_unconfirmed';
    return {
      payment_status: payment,
      refund_status: refund,
      issue,
      provider_status: String(normalized.status || '').slice(0, 60),
    };
  } catch {
    // Provider errors may contain credentials or card data. Do not persist them.
    return { payment_status: 'unknown', refund_status: 'unknown', issue: 'unavailable' };
  }
}
module.exports = { checkBankOrder };
