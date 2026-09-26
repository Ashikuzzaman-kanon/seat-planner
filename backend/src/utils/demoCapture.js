const { AsyncLocalStorage } = require("async_hooks");

/**
 * Writing down every row the demo data creates, without the code that creates
 * them knowing.
 *
 * The demo is built by the same services a person uses — a booking goes
 * through `bookingService.create`, a departure through `generateHorizon` —
 * because demo data made by a side door is demo data that behaves differently
 * from the real thing. Those services know nothing of demos, so the record of
 * what was created is taken underneath them: a model hook that, while a
 * capture is running, notes each new row in `demo_records`.
 *
 * The note is written in the creating row's own transaction. A booking that
 * rolls back leaves no note behind; a note never points at a row that was
 * never committed.
 *
 * The capture rides in AsyncLocalStorage, so only work started inside
 * `capture()` is noted — a passenger buying a real ticket in the same second,
 * on another request, is not.
 */
const storage = new AsyncLocalStorage();

/**
 * Rows not worth a note of their own: there are thousands of them, and each
 * goes when its departure or ticket goes, by the database's own cascade.
 */
const SKIP = new Set(["DemoRecord", "TripSeat", "TripSeatQuota", "SeatSegmentBooking"]);

/** Run `fn` with every row it creates written down. */
function capture(fn) {
  return storage.run({ capturing: true }, fn);
}

/**
 * Run `fn` outside any capture.
 *
 * For the job worker: a job kicked off from inside a capture would otherwise
 * inherit it, and some unrelated job's rows would be taken for demo data.
 */
function outside(fn) {
  return storage.exit(fn);
}

const capturing = () => Boolean(storage.getStore()?.capturing);

let installed = false;

/** Register the hooks. Called once, from the model registry. */
function install(sequelize, DemoRecord) {
  if (installed) return;
  installed = true;

  const note = async (model, instances, options) => {
    if (!capturing() || SKIP.has(model.name)) return;
    // Every table this system has keys on an auto-increment `id`; a table that
    // did not could not be deleted by id, so it is not noted rather than noted wrongly.
    if (model.primaryKeyAttribute !== "id") return;
    // A bulk insert that skips or merges duplicates reports ids that need not
    // match its rows. Nothing in this system inserts that way; if something
    // ever does, it is left unnoted rather than noted against the wrong rows.
    if (options?.ignoreDuplicates || options?.updateOnDuplicate) return;

    const rows = instances
      .map((instance) => instance?.get?.("id"))
      .filter((id) => Number.isInteger(id))
      .map((recordId) => ({ model: model.name, recordId }));
    if (!rows.length) return;

    await DemoRecord.bulkCreate(rows, { transaction: options?.transaction });
  };

  sequelize.addHook("afterCreate", "demoCapture", (instance, options) =>
    note(instance.constructor, [instance], options)
  );
  sequelize.addHook("afterBulkCreate", "demoCapture", (instances, options) =>
    instances.length ? note(instances[0].constructor, instances, options) : undefined
  );
}

module.exports = { capture, outside, capturing, install };
