const text = (value, maximum) =>
  String(value == null ? '' : value)
    .trim()
    .slice(0, maximum);

function includesHouse(address, house) {
  const escaped = house.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A district/street number alone is not a house number. Older clients
  // included the house after a comma or an explicit "дом"/"д." prefix.
  return new RegExp(
    `(?:^|[,;]\\s*)(?:дом\\s*|д\\.\\s*)?${escaped}(?=\\s*[,;]|$)|` +
      `(?:^|\\s)(?:дом\\s+|д\\.\\s*)${escaped}(?=\\s*[,;]|$)`,
    'iu',
  ).test(address);
}

function deliveryDestination(raw = {}, fallbackCity = '') {
  const address = text(raw.address || raw.fullname || raw.fullAddress || raw.label, 300);
  const city = text(raw.city || raw.town || raw.locality || fallbackCity, 100);
  const house = text(raw.house || raw.building, 30);
  const streetAndHouse =
    address && house && !includesHouse(address, house) ? `${address}, дом ${house}` : address;
  const hasCity =
    city && streetAndHouse.toLocaleLowerCase('ru-RU').includes(city.toLocaleLowerCase('ru-RU'));
  const fullname = hasCity ? streetAndHouse : [city, streetAndHouse].filter(Boolean).join(', ');
  const cityPrefix = `${city}, `;
  return {
    ...raw,
    city,
    house,
    fullname,
    shortname: fullname.toLocaleLowerCase('ru-RU').startsWith(cityPrefix.toLocaleLowerCase('ru-RU'))
      ? fullname.slice(cityPrefix.length)
      : streetAndHouse,
    entrance: text(raw.entrance || raw.porch || raw.porchnumber, 30),
    floor: text(raw.floor ?? raw.sfloor, 20),
    apartment: text(raw.apartment || raw.flat || raw.sflat, 30),
  };
}

function deliveryCourierComment(destination, orderComment = '') {
  // Keep arrival instructions ahead of optional notes so limits cannot hide
  // the entrance, floor or flat in clients that show only the comment.
  return [
    text(destination.label, 120),
    destination.house ? `Дом ${destination.house}` : '',
    destination.entrance ? `Подъезд ${destination.entrance}` : '',
    destination.floor ? `Этаж ${destination.floor}` : '',
    destination.apartment ? `Квартира ${destination.apartment}` : '',
    text(destination.comment || destination.courierComment, 500),
    text(orderComment, 500),
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 500);
}

module.exports = { deliveryDestination, deliveryCourierComment };
