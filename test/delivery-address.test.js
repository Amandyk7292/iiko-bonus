const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deliveryDestination,
  deliveryCourierComment,
} = require('../src/utils/delivery-address.util');

test('a separately entered house completes the street address without treating the district as a house', () => {
  const destination = deliveryDestination({
    city: 'Актау',
    address: '17-й микрорайон',
    house: '17',
  });
  assert.equal(destination.fullname, 'Актау, 17-й микрорайон, дом 17');
  assert.equal(destination.address, '17-й микрорайон');
});

test('precomposed addresses do not repeat their city or house', () => {
  for (const address of [
    'Актау, 17-й микрорайон, дом 34',
    'Актау, 17-й микрорайон, 34',
    'Актау, 17-й микрорайон д. 34',
    'Актау, 17-й микрорайон дом 34',
  ]) {
    assert.equal(deliveryDestination({ city: 'Актау', address, house: '34' }).fullname, address);
  }
});

test('house matching escapes punctuation and keeps buildings distinct', () => {
  for (const house of ['34/1', '34А', '34.1', '34(1)']) {
    const address = `17-й микрорайон, ${house}`;
    assert.equal(
      deliveryDestination({ city: 'Актау', address, house }).fullname,
      `Актау, ${address}`,
    );
  }
  assert.equal(
    deliveryDestination({ city: 'Актау', address: '17-й микрорайон, 134', house: '34' }).fullname,
    'Актау, 17-й микрорайон, 134, дом 34',
  );
});

test('legacy address aliases retain their delivery details and a ground floor', () => {
  const destination = deliveryDestination({
    locality: 'Актау',
    fullAddress: '17-й микрорайон',
    building: '34',
    porch: '2',
    sfloor: 0,
    flat: '18',
    courierComment: 'Позвонить заранее',
  });
  assert.equal(destination.fullname, 'Актау, 17-й микрорайон, дом 34');
  assert.equal(destination.floor, '0');
  assert.equal(
    deliveryCourierComment(destination),
    'Дом 34. Подъезд 2. Этаж 0. Квартира 18. Позвонить заранее',
  );
});

test('visible courier comments retain all arrival instructions before lengthy optional notes', () => {
  const destination = deliveryDestination({
    label: 'ЖК Пример',
    city: 'Актау',
    address: '17-й микрорайон',
    house: '34',
    entrance: '2',
    floor: '4',
    apartment: '18',
    comment: 'А'.repeat(600),
  });
  const comment = deliveryCourierComment(destination, 'Б'.repeat(600));
  assert.ok(comment.startsWith('ЖК Пример. Дом 34. Подъезд 2. Этаж 4. Квартира 18. '));
  assert.equal(comment.length, 500);
});

test('missing optional address fields do not add empty labels', () => {
  const destination = deliveryDestination({ address: '17-й микрорайон, 34' }, 'Актау');
  assert.equal(destination.fullname, 'Актау, 17-й микрорайон, 34');
  assert.equal(deliveryCourierComment(destination, 'Позвонить'), 'Позвонить');
});
