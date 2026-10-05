const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const moduleUrl = pathToFileURL(path.resolve(__dirname, '../public/cashier-qr/directory.mjs'));
const row = (id, name, city, branchName = 'Булка') => ({
  id, name, city, branchName, inviteToken: 'a'.repeat(64),
});

test('point filters use stable IDs within the selected city, even when point names match', async () => {
  const { cashierPoints, filterCashiers } = await import(moduleUrl.href);
  const items = [
    { ...row('1', 'Первый', 'Актау'), pointId: '10' },
    { ...row('2', 'Второй', 'Актау'), pointId: '11' },
    { ...row('3', 'Третий', 'Астана'), pointId: '20' },
    row('4', 'Без привязки', 'Актау'),
  ];
  assert.deepEqual(cashierPoints(items, ''), []);
  assert.deepEqual(cashierPoints(items, 'Актау').map((point) => point.id), ['10', '11']);
  assert.deepEqual(cashierPoints(items, 'Актау').map((point) => point.name), ['Булка · № 10', 'Булка · № 11']);
  assert.deepEqual(cashierPoints(items, 'Астана'), [{ id: '20', name: 'Булка' }]);
  assert.deepEqual(filterCashiers(items, 'Актау', '', '11').map((person) => person.id), ['2']);
  assert.deepEqual(filterCashiers(items, 'Астана', '', '11'), []);
  assert.equal(filterCashiers(items, 'Актау', '').length, 3);
});
test('cashier list rejects unsafe QR and archived rows, then filters city and name', async () => {
  const { readDirectory, filterCashiers, qrImageUrl } = await import(moduleUrl.href);
  const items = readDirectory({success:true,items:[
    row('2','Қайрат Асан','Астана','Кабанбай 46'),
    row('1','Айгүл Сейіт','Актау','19а ЖК Жасыл дала'),
    {...row('3','Архив','Актау'),isArchived:true},
    {...row('4','Ошибка','Астана'),inviteToken:'../../bad'},
    row('1','Повтор','Астана'),
  ]});
  assert.equal(items.length,2);
  assert.deepEqual(filterCashiers(items,'Актау','АЙГҮЛ 19А').map(x=>x.id),['1']);
  assert.deepEqual(filterCashiers(items,'Астана','қайрат').map(x=>x.id),['2']);
  assert.deepEqual(filterCashiers(items,'Актау','Қайрат'),[]);
  assert.throws(()=>readDirectory({success:false,items:[]}));
  assert.throws(()=>qrImageUrl('../invalid'));
  assert.equal(qrImageUrl('a'.repeat(64)),`/api/public/cashier-invites/${'a'.repeat(64)}/qr`);
});
