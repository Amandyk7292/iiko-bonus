const test = require('node:test');
const assert = require('node:assert/strict');

const { findDangerousOperations } = require('../scripts/check-migration-safety');

test('migration safety detects destructive function, constraint, and nullability changes', () => {
  assert.deepEqual(findDangerousOperations('drop function public.rebuild_orders();'), [
    'DROP FUNCTION/PROCEDURE',
  ]);
  assert.deepEqual(
    findDangerousOperations('alter table public.orders drop constraint orders_status_check;'),
    ['DROP CONSTRAINT'],
  );
  assert.deepEqual(
    findDangerousOperations('alter table public.orders alter column customer_id set not null;'),
    ['SET NOT NULL'],
  );
});

test('migration safety requires a non-empty reviewed exception reason', () => {
  const unsafeSql = 'drop function public.rebuild_orders();';
  assert.notDeepEqual(
    findDangerousOperations(`-- migration-safety: allow-destructive reason=\n${unsafeSql}`),
    [],
  );
  assert.deepEqual(
    findDangerousOperations(
      `-- migration-safety: allow-destructive reason=OPS-42-reviewed\n${unsafeSql}`,
    ),
    [],
  );
});

test('migration safety permits expand-only changes', () => {
  assert.deepEqual(
    findDangerousOperations('alter table public.orders add column if not exists note text;'),
    [],
  );
});
