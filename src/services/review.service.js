const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');

const reviewError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

async function submitReview(customerId, orderId, payload = {}) {
  const rating = Number(payload.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw reviewError('Оценка должна быть от 1 до 5');
  }
  const { data: order, error: orderError } = await supabase
    .from('kaspi_orders')
    .select('id,order_number,branch_id,cart_items,fulfillment_status,delivery_status,status')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw reviewError('Заказ не найден', 404);
  if (
    order.status !== 'paid' ||
    (!['completed'].includes(order.fulfillment_status) && order.delivery_status !== 'delivered')
  ) {
    throw reviewError('Оценить можно только завершённый заказ', 409);
  }
  const orderProducts = new Map(
    (Array.isArray(order.cart_items) ? order.cart_items : []).map((item) => [
      String(item.id || item.productId),
      String(item.name || 'Товар'),
    ]),
  );
  const reviewItems = [];
  let hasComplaint = false;
  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    const productId = String(item.productId || '').trim();
    if (!orderProducts.has(productId)) throw reviewError('Товар не входит в этот заказ');
    const itemRating = item.rating == null ? null : Number(item.rating);
    if (itemRating != null && (!Number.isInteger(itemRating) || itemRating < 1 || itemRating > 5)) {
      throw reviewError('Оценка товара должна быть от 1 до 5');
    }
    const complaint =
      String(item.complaintReason || '')
        .trim()
        .slice(0, 300) || null;
    if (complaint) hasComplaint = true;
    reviewItems.push({
      product_id: productId,
      product_name: orderProducts.get(productId),
      rating: itemRating,
      complaint_reason: complaint,
      comment:
        String(item.comment || '')
          .trim()
          .slice(0, 1000) || null,
    });
  }
  const { data: review, error } = await supabase
    .from('order_reviews')
    .upsert(
      {
        order_id: order.id,
        customer_id: customerId,
        rating,
        comment:
          String(payload.comment || '')
            .trim()
            .slice(0, 2000) || null,
        status: hasComplaint || rating <= 2 ? 'requires_attention' : 'published',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'order_id,customer_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  await supabase.from('order_review_items').delete().eq('review_id', review.id);
  if (reviewItems.length) {
    const { error: itemError } = await supabase
      .from('order_review_items')
      .insert(reviewItems.map((item) => ({ ...item, review_id: review.id })));
    if (itemError) throw itemError;
  }
  realtime.publish(
    'review.updated',
    {
      reviewId: review.id,
      orderId: order.id,
      requiresAttention: hasComplaint || rating <= 2,
    },
    { adminOnly: true, branchId: order.branch_id },
  );
  return { ...review, items: reviewItems };
}

async function listCustomerReviews(customerId) {
  const { data, error } = await supabase
    .from('order_reviews')
    .select('*,order_review_items(*)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function listAdminReviews({
  status = '',
  search = '',
  page = 1,
  pageSize = 30,
  branchIds = [],
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(10, Number(pageSize) || 50));
  const scopedBranchIds = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  const orderRelation = scopedBranchIds.length
    ? 'kaspi_orders!inner(order_number,branch_name,branch_id)'
    : 'kaspi_orders(order_number,branch_name,branch_id)';
  let query = supabase
    .from('order_reviews')
    .select(`*,customers(name,phone),${orderRelation},order_review_items(*)`, {
      count: 'exact',
    });
  if (status) query = query.eq('status', status);
  if (scopedBranchIds.length) query = query.in('kaspi_orders.branch_id', scopedBranchIds);
  const needle = String(search || '')
    .trim()
    .replace(/[%_,()]/g, ' ')
    .slice(0, 100);
  if (needle) {
    let orderLookup = supabase.from('kaspi_orders').select('id').limit(100);
    if (scopedBranchIds.length) orderLookup = orderLookup.in('branch_id', scopedBranchIds);
    orderLookup = /^\d+$/.test(needle)
      ? orderLookup.eq('order_number', needle)
      : orderLookup.ilike('branch_name', `%${needle}%`);
    const [customerResult, orderResult, itemResult] = await Promise.all([
      supabase
        .from('customers')
        .select('id')
        .or(`name.ilike.%${needle}%,phone.ilike.%${needle}%`)
        .limit(100),
      orderLookup,
      supabase
        .from('order_review_items')
        .select('review_id')
        .or(
          `product_name.ilike.%${needle}%,comment.ilike.%${needle}%,complaint_reason.ilike.%${needle}%`,
        )
        .limit(100),
    ]);
    if (customerResult.error) throw customerResult.error;
    if (orderResult.error) throw orderResult.error;
    if (itemResult.error) throw itemResult.error;
    const customerIds = (customerResult.data || []).map((item) => item.id);
    const orderIds = (orderResult.data || []).map((item) => item.id);
    const reviewIds = [...new Set((itemResult.data || []).map((item) => item.review_id))];
    query = query.or(
      [
        `comment.ilike.%${needle}%`,
        ...(customerIds.length ? [`customer_id.in.(${customerIds.join(',')})`] : []),
        ...(orderIds.length ? [`order_id.in.(${orderIds.join(',')})`] : []),
        ...(reviewIds.length ? [`id.in.(${reviewIds.join(',')})`] : []),
      ].join(','),
    );
  }
  const from = (safePage - 1) * safeSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + safeSize - 1);
  if (error) throw error;
  return { reviews: data || [], total: count || 0, page: safePage, pageSize: safeSize };
}

async function updateReviewStatus(reviewId, status) {
  if (!['published', 'hidden', 'requires_attention', 'resolved'].includes(status)) {
    throw reviewError('Некорректный статус отзыва');
  }
  const { data, error } = await supabase
    .from('order_reviews')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('*,kaspi_orders(branch_id)')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw reviewError('Отзыв не найден', 404);
  realtime.publish(
    'review.updated',
    { reviewId, status },
    { adminOnly: true, branchId: data.kaspi_orders?.branch_id || null },
  );
  return data;
}

module.exports = { listAdminReviews, listCustomerReviews, submitReview, updateReviewStatus };
