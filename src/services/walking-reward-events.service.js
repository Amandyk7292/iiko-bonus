const realtime = require('./realtime.service');

function publishWalkingRewardEvents(customerId, result, publish = realtime.publish) {
  const credited = (Array.isArray(result?.days) ? result.days : [result]).filter(
    (day) => day?.credited === true,
  );
  if (!credited.length) return;
  for (const day of credited) {
    try {
      publish(
        'transaction.created',
        {
          customerId,
          type: 'deposit',
          amount: day.creditedAmount,
          source: 'walking',
          date: day.date,
        },
        { customerId, includeAdmins: true, roles: ['owner', 'admin'] },
      );
    } catch {
      // The durable reward, inbox notice and push have already committed.
      console.error('Walking reward history refresh could not be published.');
    }
  }
  try {
    publish('notification.created', {}, { customerId });
  } catch {
    console.error('Walking reward inbox refresh could not be published.');
  }
}

module.exports = { publishWalkingRewardEvents };
