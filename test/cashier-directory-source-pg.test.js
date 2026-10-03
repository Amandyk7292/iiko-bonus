const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
test('source directory exposes only active cashier public fields while employee RLS remains private', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.points(id bigint primary key, name text, city text);
      create table public.bulka_users(id bigint primary key, display_name text, first_name text,
        last_name text, position text, point_id bigint, role text, is_deleted boolean, deleted_at timestamptz,
        phone text, salary numeric);
      alter table public.bulka_users enable row level security;
      grant select on public.bulka_users to anon;
      insert into public.points values(1,'19а ЖК Жасыл дала','Актау'),(2,'Кабанбай 46','Астана');
      insert into public.bulka_users values
        (1,'Айгүл','Айгүл','Сейіт','Кассир',1,'cashier',false,null,'private',100000),
        (2,'Қайрат Асан Ұлы','Қайрат','Асан','Продавец-кассир',2,'worker',null,null,'private',100000),
        (3,'Архив 1',null,null,'Кассир',1,'cashier',true,null,'private',100000),
        (4,'Архив 2',null,null,'Кассир',1,'cashier',false,now(),'private',100000),
        (5,'Пекарь',null,null,'Пекарь',1,'worker',false,null,'private',100000);
    `);
    await db.exec(await fs.readFile(path.join(__dirname,'../docs/integrations/cashier-directory-source.sql'),'utf8'));
    await db.exec('set role anon');
    assert.deepEqual((await db.query('select * from public.bulka_users')).rows,[]);
    const rows = (await db.query('select * from public.bulka_cashier_signup_directory()')).rows;
    assert.equal(rows.length,2);
    assert.equal(rows.find(x=>x.id==='1').name,'Айгүл Сейіт');
    assert.equal(rows.find(x=>x.id==='2').name,'Қайрат Асан Ұлы');
    assert.deepEqual(Object.keys(rows[0]).sort(),['branch_name','city','id','name','point_id']);
    assert.deepEqual(rows.map(x=>x.city).sort(),['Актау','Астана']);
    await db.exec('reset role; update public.bulka_users set is_deleted=true where id=1; set role anon');
    assert.equal((await db.query('select * from public.bulka_cashier_signup_directory()')).rows.length,1);
    await assert.rejects(db.exec('update public.bulka_users set salary=0 where id=2'));
  } finally { await db.close(); }
});
