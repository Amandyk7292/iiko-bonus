const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
test('shared badge persists once and editing it changes both product projections', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(fs.readFileSync('supabase/migrations/20260925060000_product_badges.sql', 'utf8'));
  const id = '11111111-1111-4111-8111-111111111111';
  await db.query(
    "insert into product_badges(id,label,background,foreground) values($1,'Хит','#782b0e','#ffffff')",
    [id],
  );
  await db.query(
    "insert into product_badge_assignments(product_id,badge_ids) values('one',array[$1::uuid]),('two',array[$1::uuid])",
    [id],
  );
  await db.query("update product_badges set label='Острое',background='#ff0000' where id=$1", [id]);
  const result = await db.query(
    'select b.label,b.background from product_badge_assignments a join product_badges b on b.id=any(a.badge_ids)',
  );
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.label === 'Острое' && row.background === '#ff0000'));
  await assert.rejects(
    db.query("update product_badges set background='url(javascript:bad)' where id=$1", [id]),
  );
  await assert.rejects(
    db.query(
      'update product_badge_assignments set badge_ids=array[$1::uuid,$1::uuid,$1::uuid,$1::uuid]',
      [id],
    ),
  );
});
