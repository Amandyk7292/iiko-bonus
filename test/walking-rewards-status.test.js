const test = require('node:test');
const assert = require('node:assert/strict');
const configPath = require.resolve('../src/config/supabase');
let policy;
let progress;
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    supabase: {
      from(table) {
        assert.ok(['walking_reward_policy', 'walking_daily_progress'].includes(table));
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          async single() {
            return { data: policy, error: null };
          },
          async order() {
            return { data: progress, error: null };
          },
        };
      },
    },
  },
};
const walking = require('../src/services/walking-rewards.service');

test('status advertises 100 while preserving the actual amounts of earlier daily rewards', async () => {
  policy = { enabled: true, starts_on: walking.walkingPeriod(6).date };
  progress = [0, 100, 1000].map((rewardAmount, offset) => {
    const date = walking.walkingPeriod(offset).date;
    return {
      walking_date: date,
      steps: rewardAmount ? 10000 : 9999,
      reward_amount: rewardAmount,
      credited_at: rewardAmount ? `${date}T12:00:00+05:00` : null,
      measurement_end_at: `${date}T12:00:00+05:00`,
    };
  });
  const status = await walking.walkingStatus('customer');
  assert.equal(status.rewardAmount, 100);
  assert.equal(status.targetSteps, 10000);
  assert.deepEqual(
    status.days.map(({ rewardAmount, credited }) => ({ rewardAmount, credited })),
    [
      { rewardAmount: 0, credited: false },
      { rewardAmount: 100, credited: true },
      { rewardAmount: 1000, credited: true },
    ],
  );
});
