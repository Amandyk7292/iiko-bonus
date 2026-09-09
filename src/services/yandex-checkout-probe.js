const { deliveryDestination, deliveryCourierComment } = require('../utils/delivery-address.util');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { assertCargoPrice } = require('./yandex-cargo-price');
const { unavailableError } = require('./delivery-availability.service');

const NOTICE = 'Проверка доставки Bulka. Автоматическая отмена. Груз не передавать.';
const coordinate = (value, limit) =>
  value != null &&
  value !== '' &&
  Number.isFinite(Number(value)) &&
  Math.abs(Number(value)) <= limit;

function createProbeTransport({ config, request, cargoItems, normalizeCity, cargoOptions }) {
  return {
    prepare({ checkout, pricing, customerPhone }) {
      // A durable cancellation worker is required before any physical call.
      if (!config.opsAlertReceiver.workersEnabled || !config.opsAlertReceiver.deliverySyncEnabled)
        throw unavailableError();
      const branch = checkout.deliveryOrigin || {};
      const address = checkout.deliveryAddress || {};
      const destination = deliveryDestination(address);
      const phone = normalizeKazakhstanPhone(customerPhone);
      if (
        !phone ||
        !config.senderPhone ||
        !destination.fullname ||
        !branch.address ||
        !normalizeCity(branch.city) ||
        normalizeCity(branch.city) !== normalizeCity(destination.city) ||
        !coordinate(branch.latitude, 90) ||
        !coordinate(branch.longitude, 180) ||
        !coordinate(address.latitude, 90) ||
        !coordinate(address.longitude, 180)
      ) {
        throw unavailableError();
      }
      return {
        items: cargoItems({ cart_items: pricing.canonicalItems }, config),
        route_points: [
          {
            point_id: 1,
            visit_order: 1,
            type: 'source',
            skip_confirmation: true,
            contact: { name: config.senderName, phone: config.senderPhone },
            address: {
              fullname: [branch.city, branch.address].join(', '),
              coordinates: [Number(branch.longitude), Number(branch.latitude)],
              country: config.country,
              city: branch.city,
              comment: NOTICE,
            },
          },
          {
            point_id: 2,
            visit_order: 2,
            type: 'destination',
            skip_confirmation: true,
            contact: { name: 'Клиент Bulka', phone },
            address: {
              fullname: destination.fullname,
              shortname: destination.shortname,
              coordinates: [Number(address.longitude), Number(address.latitude)],
              country: config.country,
              city: destination.city,
              ...(destination.house && { building: destination.house }),
              ...(destination.entrance && { porch: destination.entrance }),
              ...(destination.floor && { sfloor: destination.floor }),
              ...(destination.apartment && { sflat: destination.apartment }),
              comment: `${NOTICE} ${deliveryCourierComment(destination)}`.slice(0, 700),
            },
          },
        ],
        client_requirements: {
          taxi_class: config.taxiClass,
          pro_courier: false,
          assign_robot: false,
          cargo_options: cargoOptions(config),
        },
        skip_client_notify: true,
        skip_emergency_notify: true,
        skip_door_to_door: false,
        optional_return: false,
        comment: NOTICE,
        referral_source: 'bulka',
      };
    },
    create(probe) {
      return request('/claims/create', {
        query: { request_id: probe.id },
        body: {
          ...probe.request_payload,
          route_points: probe.request_payload.route_points.map((point) => ({
            ...point,
            external_order_id: `probe:${probe.id}`,
          })),
        },
      });
    },
    info(id) {
      return request('/claims/info', { query: { claim_id: id } });
    },
    accept(id, version) {
      return request('/claims/accept', { query: { claim_id: id }, body: { version } });
    },
    cancel(id, version, state = 'free') {
      return request('/claims/cancel', {
        query: { claim_id: id },
        body: { version, cancel_state: state },
      });
    },
    cancelInfo(id) {
      return request('/claims/cancel-info', { query: { claim_id: id } });
    },
    validatePrice(info) {
      return assertCargoPrice(info, config.cargoMaxPriceKzt);
    },
  };
}

module.exports = { createProbeTransport };
