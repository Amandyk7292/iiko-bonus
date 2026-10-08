const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const sharp = require('sharp');
const { PGlite } = require('@electric-sql/pglite');
const photos = require('../src/services/pickup-photo-gift.service');
const { checkoutPaymentBodySchema } = require('../src/contracts/customer-api.contract');
const { pickupPhotoPrintQuerySchema } = require('../src/contracts/pickup-photo-gift.contract');

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,deleted_at timestamptz);
    create table bulka_locations(id uuid primary key,active boolean default true);
    create table pos_devices(terminal_id uuid primary key,branch_id uuid,active boolean default true,
      last_health_at timestamptz default now(),connected_to_main boolean default true,
      printer_status text default 'ready',health_payload jsonb default '{"photoPrinterReady":true}',plugin_version text default '1.14.0');
    create table kaspi_orders(id uuid primary key default gen_random_uuid(),customer_id uuid,client_request_id uuid,
      branch_id uuid,order_number bigint default 123456,status text default 'pending',fulfillment_type text default 'pickup',
      kitchen_status text default 'new',fulfillment_status text default 'new',refund_status text,order_kind text default 'product',preorder_fulfillment_type text,
      scheduled_at timestamptz default now(),created_at timestamptz default now());`);
  await db.exec(
    fs.readFileSync('supabase/migrations/20261006153000_pickup_photo_gifts.sql', 'utf8'),
  );
  await db.exec(
    fs.readFileSync(
      'supabase/migrations/20261006235400_pickup_photo_before_handover_guard.sql',
      'utf8',
    ),
  );
  await db.exec(
    fs.readFileSync('supabase/migrations/20261008152000_operations_queue_visibility.sql', 'utf8'),
  );
  const customer = crypto.randomUUID(),
    other = crypto.randomUUID(),
    branch = crypto.randomUUID(),
    terminal = crypto.randomUUID();
  await db.query('insert into customers(id) values($1),($2)', [customer, other]);
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query('insert into pos_devices(terminal_id,branch_id) values($1,$2)', [
    terminal,
    branch,
  ]);
  const call = async (name, args) =>
    (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args))
      .rows[0].r;
  const upload = async (owner = customer) =>
    (await call('create_pickup_photo_upload', [owner, 'YQ==', 'a'.repeat(64), 1, 1, 1])).photoId;
  const reserve = (checkout, photo, owner = customer) =>
    call('reserve_pickup_photo_checkout', [owner, checkout, photo, branch]);
  const action = (order, act, device = terminal) =>
    call('pickup_photo_print_action', [branch, device, order, act, null]);
  const order = async (
    checkout,
    photo,
    { status = 'pending', type = 'pickup', kitchen = 'new', preorderType = null } = {},
  ) => {
    const id = crypto.randomUUID();
    await db.query(
      'insert into kaspi_orders(id,customer_id,client_request_id,branch_id,pickup_photo_id,status,fulfillment_type,kitchen_status,preorder_fulfillment_type) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, customer, checkout, branch, photo, status, type, kitchen, preorderType],
    );
    return id;
  };
  return { db, customer, other, branch, terminal, call, upload, reserve, action, order };
}

test('claimed photo remains visible beyond20 waiting jobs and respects terminal/order state', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    ids = [];
  for (let n = 0; n < 21; n++) {
    const checkout = crypto.randomUUID();
    await f.reserve(checkout, photo);
    ids.push(await f.order(checkout, photo, { status: 'paid', kitchen: 'ready' }));
  }
  const poll = () => f.call('list_pickup_photo_print_jobs', [f.branch, f.terminal]);
  const initial = await poll();
  assert.equal(initial.jobs.length, 20);
  const claimed = initial.jobs[0].orderId;
  assert.equal((await f.action(claimed, 'claim')).status, 'print');
  const current = await poll();
  assert.equal(current.jobs.length, 20);
  assert.equal(current.jobs.find((job) => job.orderId === claimed).status, 'printing');
  await f.db.query(
    "update pickup_photo_print_jobs set status='uncertain',terminal_id=$1 where order_id<>$2",
    [f.terminal, claimed],
  );
  for (let n = 0; n < 21; n++) {
    const checkout = crypto.randomUUID();
    await f.reserve(checkout, photo);
    await f.order(checkout, photo, { status: 'paid', kitchen: 'ready' });
  }
  const uncertainBacklog = await poll();
  assert.equal(uncertainBacklog.jobs.length, 20);
  assert.equal(uncertainBacklog.jobs[0].orderId, claimed);
  assert.equal(uncertainBacklog.jobs[0].status, 'printing');
  assert.equal(uncertainBacklog.jobs.filter((job) => job.status === 'pending').length, 19);
  const otherTerminal = crypto.randomUUID();
  await f.db.query('insert into pos_devices(terminal_id,branch_id) values($1,$2)', [
    otherTerminal,
    f.branch,
  ]);
  assert.equal(
    (await f.call('list_pickup_photo_print_jobs', [f.branch, otherTerminal])).jobs.some(
      (job) => job.orderId === claimed,
    ),
    false,
  );
  await f.db.query("update kaspi_orders set fulfillment_status='cancelled' where id=$1", [claimed]);
  assert.equal(
    (await poll()).jobs.some((job) => job.orderId === claimed),
    false,
  );
});

test('photo normalization strips orientation/GPS, bounds size and rejects spoofed files', async () => {
  const original = await sharp({
    create: { width: 32, height: 16, channels: 3, background: '#996644' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const image = await photos.normalizePhoto(original, 'image/jpeg');
  const meta = await sharp(image.buffer).metadata();
  assert.equal(meta.width, 16);
  assert.equal(meta.height, 32);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  assert.ok(image.bytes <= 512000);
  await assert.rejects(photos.normalizePhoto(original, 'image/png'), {
    code: 'PICKUP_PHOTO_FORMAT',
  });
  await assert.rejects(photos.normalizePhoto(Buffer.from('<svg/>'), 'image/png'), {
    code: 'PICKUP_PHOTO_FORMAT',
  });
  await assert.rejects(
    photos.normalizePhoto(Buffer.alloc(photos.MAX_UPLOAD_BYTES + 1), 'image/jpeg'),
    { code: 'PICKUP_PHOTO_TOO_LARGE' },
  );
});

test('thermal strip contains only black/white pixels at supported width with bounded PNG output', async () => {
  const input = await sharp({
    create: { width: 64, height: 80, channels: 3, background: '#8c8c8c' },
  })
    .jpeg()
    .toBuffer();
  for (const width of [384, 576]) {
    const strip = await photos.renderStrip(input, 123456, width);
    const { data, info } = await sharp(strip)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width);
    assert.ok(info.height <= 1200);
    assert.ok(strip.length <= 512000);
    assert.deepEqual(new Set(data), new Set([0, 255]));
    assert.ok(data.subarray(0, width * 180).includes(0), 'brand/number header has visible ink');
  }
  await assert.rejects(photos.renderStrip(input, '<script>'), {
    code: 'PICKUP_PHOTO_PRINT_FORMAT',
  });
  assert.equal(
    pickupPhotoPrintQuerySchema.safeParse({ terminalId: crypto.randomUUID(), widthDots: '384' })
      .success,
    true,
  );
  assert.equal(
    pickupPhotoPrintQuerySchema.safeParse({ terminalId: crypto.randomUUID(), widthDots: '2000' })
      .success,
    false,
  );
});

test('private photos cannot be read/deleted by another customer and storage errors do not leak image data', async () => {
  const id = crypto.randomUUID();
  let filters = [];
  const db = {
    from: () => ({
      select() {
        return this;
      },
      eq(k, v) {
        filters.push([k, v]);
        return this;
      },
      maybeSingle: async () => ({ data: null }),
    }),
  };
  await assert.rejects(photos.customerPhoto('owner', id, { db }), {
    code: 'PICKUP_PHOTO_NOT_FOUND',
  });
  assert.deepEqual(filters, [
    ['id', id],
    ['customer_id', 'owner'],
  ]);
  await assert.rejects(
    photos.deleteCustomerPhoto('foreign', id, {
      rpc: async () => ({ data: { error: 'photo_unavailable' } }),
    }),
    { code: 'PICKUP_PHOTO_EXPIRED' },
  );
  await assert.rejects(
    photos.uploadPhoto(
      'owner',
      {
        buffer: await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
          .jpeg()
          .toBuffer(),
        mimetype: 'image/jpeg',
      },
      {
        rpc: async () => ({ error: { message: 'sensitive-image-base64', details: 'private GPS' } }),
      },
    ),
    (error) =>
      error.code === 'PICKUP_PHOTO_STORAGE_UNAVAILABLE' &&
      !JSON.stringify(error).includes('sensitive-image'),
  );
});

test('checkout contract accepts only an opaque photo UUID and delivery cannot attach it', async () => {
  const body = {
    items: [{ id: 'bun', quantity: 1 }],
    checkoutId: crypto.randomUUID(),
    pickupPhotoId: crypto.randomUUID(),
  };
  assert.equal(checkoutPaymentBodySchema.safeParse(body).success, true);
  assert.equal(
    checkoutPaymentBodySchema.safeParse({ ...body, pickupPhotoId: 'https://example.com/photo.jpg' })
      .success,
    false,
  );
  assert.equal(
    checkoutPaymentBodySchema.safeParse({ ...body, photoUrl: 'https://example.com/photo.jpg' })
      .success,
    false,
  );
  await assert.rejects(
    photos.reserveCheckoutPhoto('owner', body.checkoutId, body, {
      effectiveFulfillmentType: 'delivery',
    }),
    { code: 'PICKUP_PHOTO_PICKUP_ONLY' },
  );
  assert.throws(
    () =>
      photos.assertExistingPhoto(
        { pickup_photo_id: body.pickupPhotoId },
        { pickupPhotoId: crypto.randomUUID() },
      ),
    { code: 'PICKUP_PHOTO_REQUEST_CHANGED' },
  );
  assert.throws(() => photos.assertExistingPhoto({ pickup_photo_id: body.pickupPhotoId }, {}), {
    code: 'PICKUP_PHOTO_REQUEST_CHANGED',
  });
  photos.assertExistingPhoto({}, {});
});

test('SQL upload quotas, owner isolation, private grants and immutable retry bindings survive retries', async (t) => {
  const f = await fixture(t),
    id = await f.upload(),
    checkout = crypto.randomUUID();
  assert.equal((await f.reserve(checkout, id, f.other)).error, 'photo_unavailable');
  assert.equal((await f.reserve(checkout, id)).photoId, id);
  assert.equal((await f.reserve(checkout, id)).photoId, id);
  assert.equal((await f.reserve(checkout, null)).error, 'request_changed');
  const empty = crypto.randomUUID();
  await f.reserve(empty, null);
  const changedBranch = crypto.randomUUID();
  await f.db.query('insert into bulka_locations(id) values($1)', [changedBranch]);
  assert.equal(
    (await f.call('reserve_pickup_photo_checkout', [f.customer, empty, null, changedBranch]))
      .photoId,
    null,
    'legacy no-photo preflight may switch branches',
  );
  assert.equal(
    (await f.call('reserve_pickup_photo_checkout', [f.customer, checkout, id, changedBranch]))
      .error,
    'request_changed',
    'attached photo remains branch bound',
  );
  assert.equal((await f.reserve(empty, id)).error, 'request_changed');
  assert.equal(
    (await f.call('discard_pickup_photo_upload', [f.other, id])).error,
    'photo_unavailable',
  );
  assert.equal(
    (await f.call('discard_pickup_photo_upload', [f.customer, id])).error,
    'request_changed',
  );
  for (let i = 0; i < 5; i++) await f.upload();
  assert.equal(
    (await f.call('create_pickup_photo_upload', [f.customer, 'YQ==', 'a'.repeat(64), 1, 1, 1]))
      .error,
    'rate_limited',
  );
  for (let batch = 0; batch < 2; batch++) {
    await f.db.query(
      "update pickup_photo_uploads set created_at=now()-interval '2 hours' where customer_id=$1",
      [f.customer],
    );
    for (let i = 0; i < 6; i++) await f.upload();
  }
  await f.db.query(
    "update pickup_photo_uploads set created_at=now()-interval '2 hours' where customer_id=$1",
    [f.customer],
  );
  await f.upload();
  await f.upload();
  assert.equal(
    (await f.call('create_pickup_photo_upload', [f.customer, 'YQ==', 'a'.repeat(64), 1, 1, 1]))
      .error,
    'rate_limited',
    '20 uploads per rolling day is an independent database limit',
  );
  await assert.rejects(
    f.db.exec('set role anon; select image_base64 from pickup_photo_uploads'),
    /permission denied/,
  );
  await f.db.exec('reset role');
  await assert.rejects(
    f.db.exec(`set role authenticated; select pickup_photo_printer_ready('${f.branch}')`),
    /permission denied/,
  );
  await f.db.exec('reset role');
});

test('photo orders cannot print unpaid, delivered, foreign, unaccepted, or on a second terminal', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    checkout = crypto.randomUUID();
  await f.reserve(checkout, photo);
  const id = await f.order(checkout, photo);
  assert.equal((await f.db.query('select count(*) n from pickup_photo_print_jobs')).rows[0].n, 0);
  assert.equal((await f.action(id, 'claim')).error, 'job_unavailable');
  await assert.rejects(
    f.order(checkout, photo, { status: 'paid', type: 'delivery' }),
    /Фото недоступно/,
  );
  await assert.rejects(
    f.order(checkout, photo, { status: 'paid', type: 'preorder', preorderType: 'delivery' }),
    /Фото недоступно/,
  );
  await f.db.query("update kaspi_orders set status='paid' where id=$1", [id]);
  assert.equal((await f.action(id, 'claim')).error, 'order_unavailable');
  await f.db.query("update kaspi_orders set kitchen_status='preparing' where id=$1", [id]);
  assert.equal(
    (await f.call('list_pickup_photo_print_jobs', [f.branch, f.terminal])).jobs.length,
    1,
  );
  assert.equal((await f.action(id, 'claim')).status, 'print');
  const second = crypto.randomUUID();
  await f.db.query('insert into pos_devices(terminal_id,branch_id) values($1,$2)', [
    second,
    f.branch,
  ]);
  assert.equal((await f.action(id, 'claim', second)).error, 'terminal_conflict');
  assert.equal(
    (await f.action(id, 'claim')).status,
    'uncertain',
    'lost claim response does not cause a second print',
  );
  assert.equal((await f.action(id, 'uncertain')).status, 'uncertain');
  assert.equal((await f.action(id, 'claim')).status, 'uncertain');
  assert.equal((await f.action(id, 'complete')).status, 'printed');
  assert.equal((await f.action(id, 'complete')).status, 'printed');
  assert.equal(
    (await f.call('list_pickup_photo_print_jobs', [f.branch, f.terminal])).jobs.length,
    0,
  );
  await assert.rejects(
    f.db.query('update kaspi_orders set pickup_photo_id=null where id=$1', [id]),
    /Фото заказа уже закреплено/,
  );
  await assert.rejects(
    f.db.query('update kaspi_orders set branch_id=$1 where id=$2', [crypto.randomUUID(), id]),
    /Фото заказа уже закреплено/,
  );
  await assert.rejects(
    f.db.query("update kaspi_orders set fulfillment_type='delivery' where id=$1", [id]),
    /Фото заказа уже закреплено/,
  );
});

test('printer capability requires a fresh supported terminal; expired images erase bytes but preserve printed audit', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    checkout = crypto.randomUUID();
  assert.equal(await f.call('pickup_photo_printer_ready', [f.branch, null]), true);
  await f.db.query("update pos_devices set printer_status='unavailable' where terminal_id=$1", [
    f.terminal,
  ]);
  assert.equal(
    await f.call('pickup_photo_printer_ready', [f.branch, null]),
    true,
    'dedicated receipt printer readiness does not require a Bill/Document printer',
  );
  await f.db.query("update pos_devices set plugin_version='1.13.2' where terminal_id=$1", [
    f.terminal,
  ]);
  assert.equal((await f.reserve(checkout, photo)).error, 'printer_unavailable');
  await f.db.query(
    "update pos_devices set plugin_version='1.14.0',last_health_at=now()-interval '3 minutes' where terminal_id=$1",
    [f.terminal],
  );
  assert.equal(await f.call('pickup_photo_printer_ready', [f.branch, null]), false);
  await f.db.query('update pos_devices set last_health_at=now() where terminal_id=$1', [
    f.terminal,
  ]);
  await f.reserve(checkout, photo);
  const id = await f.order(checkout, photo, { status: 'paid', kitchen: 'preparing' });
  assert.equal((await f.action(id, 'claim')).status, 'print');
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).image,
    'YQ==',
  );
  await f.db.query(
    "update pickup_photo_uploads set expires_at=now()-interval '1 second' where id=$1",
    [photo],
  );
  assert.equal((await f.call('cleanup_pickup_photos', [])).deleted, 1);
  const erased = (
    await f.db.query('select image_base64,deleted_at from pickup_photo_uploads where id=$1', [
      photo,
    ])
  ).rows[0];
  assert.equal(erased.image_base64, null);
  assert.ok(erased.deleted_at);
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).error,
    'photo_unavailable',
  );
  assert.equal(
    (await f.action(id, 'complete')).status,
    'printed',
    'a durable successful print acknowledgement survives image expiry',
  );
  assert.equal((await f.action(id, 'claim')).status, 'printed');
  const privateDraft = await f.upload();
  await f.db.query('update customers set deleted_at=now() where id=$1', [f.customer]);
  assert.equal((await f.call('cleanup_pickup_photos', [])).deleted, 1);
  assert.equal(
    (await f.db.query('select image_base64 from pickup_photo_uploads where id=$1', [privateDraft]))
      .rows[0].image_base64,
    null,
    'deleted accounts erase photo bytes',
  );
});

test('definite pre-print release can retry; refunds remove only never-started jobs', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    checkout = crypto.randomUUID();
  await f.reserve(checkout, photo);
  const id = await f.order(checkout, photo, { status: 'paid', kitchen: 'preparing' });
  assert.equal((await f.action(id, 'claim')).status, 'print');
  assert.equal((await f.action(id, 'release')).status, 'pending');
  assert.equal((await f.action(id, 'claim')).status, 'print');
  assert.equal((await f.action(id, 'uncertain')).status, 'uncertain');
  assert.equal(
    (await f.action(id, 'release')).error,
    'invalid_action',
    'uncertain output cannot automatically be released/reprinted',
  );
  await f.db.query("update kaspi_orders set status='refunded' where id=$1", [id]);
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).error,
    'job_unavailable',
  );
  assert.equal(
    (await f.action(id, 'complete')).status,
    'printed',
    'already printed acknowledgement is not replayed',
  );
});

test('a pending photo cannot start printing after pickup handover', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    checkout = crypto.randomUUID();
  await f.reserve(checkout, photo);
  const id = await f.order(checkout, photo, { status: 'paid', kitchen: 'preparing' });
  assert.equal(
    (await f.call('list_pickup_photo_print_jobs', [f.branch, f.terminal])).jobs.length,
    1,
  );
  await f.db.query(
    "update kaspi_orders set kitchen_status='handed_over',fulfillment_status='completed' where id=$1",
    [id],
  );
  assert.deepEqual((await f.call('list_pickup_photo_print_jobs', [f.branch, f.terminal])).jobs, []);
  assert.equal((await f.action(id, 'claim')).error, 'order_unavailable');
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).error,
    'job_unavailable',
  );
  const job = (
    await f.db.query(
      'select status,terminal_id,claimed_at from pickup_photo_print_jobs where order_id=$1',
      [id],
    )
  ).rows[0];
  assert.deepEqual(job, { status: 'pending', terminal_id: null, claimed_at: null });
});

test('handover between photo claim and image retrieval denies printing but preserves a durable acknowledgement', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    checkout = crypto.randomUUID();
  await f.reserve(checkout, photo);
  const id = await f.order(checkout, photo, { status: 'paid', kitchen: 'preparing' });
  assert.equal((await f.action(id, 'claim')).status, 'print');
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).image,
    'YQ==',
  );
  await f.db.query("update kaspi_orders set kitchen_status='ready' where id=$1", [id]);
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).image,
    'YQ==',
  );
  await f.db.query(
    "update kaspi_orders set kitchen_status='handed_over',fulfillment_status='completed' where id=$1",
    [id],
  );
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).error,
    'job_unavailable',
    'a claim does not authorize a late image download after handover',
  );
  assert.equal((await f.action(id, 'claim')).status, 'uncertain');
  assert.equal(
    (await f.action(id, 'complete')).status,
    'printed',
    'a durable acknowledgement of an earlier physical print remains valid',
  );
  assert.equal((await f.action(id, 'complete')).status, 'printed');
  assert.equal((await f.action(id, 'claim')).status, 'printed');
  assert.equal(
    (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).error,
    'job_unavailable',
  );
  assert.deepEqual((await f.call('list_pickup_photo_print_jobs', [f.branch, f.terminal])).jobs, []);
});

test('claimed photo image access requires an accepted kitchen state and stays private', async (t) => {
  const f = await fixture(t),
    photo = await f.upload(),
    checkout = crypto.randomUUID();
  await f.reserve(checkout, photo);
  const id = await f.order(checkout, photo, { status: 'paid', kitchen: 'preparing' });
  assert.equal((await f.action(id, 'claim')).status, 'print');
  for (const kitchen of ['new', null, 'handed_over']) {
    await f.db.query('update kaspi_orders set kitchen_status=$1 where id=$2', [kitchen, id]);
    assert.equal(
      (await f.call('pickup_photo_print_image', [f.branch, f.terminal, id])).error,
      'job_unavailable',
    );
  }
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(
      f.db.exec(`set role ${role}; select pickup_photo_print_image(null,null,null)`),
      /permission denied/,
    );
    await f.db.exec('reset role');
  }
});
