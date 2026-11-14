"use strict";

/**
 * Coach classes take Bangladesh Railway's own codes.
 *
 * The six classes the seat plans used are renamed in place, so every plan,
 * fare, departure and ticket that points at one keeps pointing at it:
 *
 *   Shovon Chair → S_CHAIR    Shovon → SHOVAN     AC Chair → AC_CHAIR
 *   Snigdha → SNIGDHA         AC Cabin → AC_B     Non-AC Cabin → F_BERTH
 *
 * A code that already exists as a class of its own takes the old class's
 * place instead: everything pointing at the old one is moved to it, and the
 * old one goes. The rest of the railway's ten codes are added, so each can be
 * chosen for a plan. Fare rules named after a class ("Shovon Chair — per
 * kilometre") are renamed with it.
 *
 * Down renames them back, and removes an added class nothing uses. A merge is
 * not undone: the two were one class from then on.
 */

const RENAMED = [
  ["Shovon Chair", "S_CHAIR"],
  ["Shovon", "SHOVAN"],
  ["AC Chair", "AC_CHAIR"],
  ["Snigdha", "SNIGDHA"],
  ["AC Cabin", "AC_B"],
  ["Non-AC Cabin", "F_BERTH"],
];

/** The railway's classes, in the order its booking site lists them. */
const CODES = ["AC_B", "AC_S", "SNIGDHA", "F_BERTH", "F_SEAT", "F_CHAIR", "S_CHAIR", "SHOVAN", "SHULOV", "AC_CHAIR"];

const PER_KM = " — per kilometre";

module.exports = {
  async up(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    const select = (sql, replacements) => db.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
    const classNamed = async (name) => (await select("SELECT id FROM coach_classes WHERE name = :name", { name }))[0] || null;
    // Every column that points at a class, found rather than listed, so a
    // table added later is not missed.
    const pointers = await select(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_NAME = 'coach_classes' AND TABLE_SCHEMA = DATABASE()`
    );

    for (const [from, to] of RENAMED) {
      const old = await classNamed(from);
      if (!old) continue;
      // Names compare without case here, so "Snigdha" finds itself as
      // "SNIGDHA": that is a rename, not a second class.
      const taken = await classNamed(to);
      if (taken && taken.id !== old.id) {
        for (const { tableName, columnName } of pointers) {
          await db.query(`UPDATE \`${tableName}\` SET \`${columnName}\` = :to WHERE \`${columnName}\` = :from`, {
            replacements: { to: taken.id, from: old.id },
          });
        }
        await db.query("DELETE FROM coach_classes WHERE id = :id", { replacements: { id: old.id } });
      } else {
        await db.query("UPDATE coach_classes SET name = :to, updated_at = UTC_TIMESTAMP() WHERE id = :id", {
          replacements: { to, id: old.id },
        });
      }
      await db.query("UPDATE fare_rules SET name = :to, updated_at = UTC_TIMESTAMP() WHERE name = :from", {
        replacements: { to: `${to}${PER_KM}`, from: `${from}${PER_KM}` },
      });
    }

    for (const code of CODES) {
      if (await classNamed(code)) continue;
      await db.query(
        "INSERT INTO coach_classes (name, standing_capacity, created_at, updated_at) VALUES (:code, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())",
        { replacements: { code } }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    const select = (sql, replacements) => db.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
    const classNamed = async (name) => (await select("SELECT id FROM coach_classes WHERE name = :name", { name }))[0] || null;
    const pointers = await select(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_NAME = 'coach_classes' AND TABLE_SCHEMA = DATABASE()`
    );

    for (const [from, to] of RENAMED) {
      const now = await classNamed(to);
      const other = await classNamed(from);
      if (!now || (other && other.id !== now.id)) continue;
      await db.query("UPDATE coach_classes SET name = :from, updated_at = UTC_TIMESTAMP() WHERE id = :id", {
        replacements: { from, id: now.id },
      });
      await db.query("UPDATE fare_rules SET name = :from, updated_at = UTC_TIMESTAMP() WHERE name = :to", {
        replacements: { from: `${from}${PER_KM}`, to: `${to}${PER_KM}` },
      });
    }

    const renamedTo = new Set(RENAMED.map(([, to]) => to));
    for (const code of CODES.filter((c) => !renamedTo.has(c))) {
      const added = await classNamed(code);
      if (!added) continue;
      let used = false;
      for (const { tableName, columnName } of pointers) {
        const [{ n }] = await select(`SELECT COUNT(*) AS n FROM \`${tableName}\` WHERE \`${columnName}\` = :id`, { id: added.id });
        if (Number(n)) used = true;
      }
      if (!used) await db.query("DELETE FROM coach_classes WHERE id = :id", { replacements: { id: added.id } });
    }
  },
};
