"use strict";

/**
 * One seat plan per coach, numbered with the railway's coach letter.
 *
 * Until now several coaches of a train could share one plan — KA and KHA both
 * on "AC_CABIN-48" — and a plan's coach number was a label for its layout. Now
 * a plan is a coach: train EKOTA EXPRESS (705), coach KA.
 *
 * For every coach in a train's line-up (train_coaches):
 *
 *   - the first coach of the plan's own train takes the plan over, and the
 *     plan's coach number becomes that coach's letter;
 *   - every other coach gets a copy of the plan, under its own letter, and the
 *     line-up points at the copy. A copy keeps the plan's status and who
 *     approved it: the layout is the one that was approved.
 *
 * A coach whose train already has another plan with that letter is left
 * alone, rather than guessing which layout is right. Departures already
 * generated are not touched — they hold their own seats.
 *
 * What was done is written to `seat_plan_splits`, so down can put it back:
 * letters return to the old labels, line-ups point at the shared plans again,
 * and copies go — except a copy a departure has been built from since, which
 * is kept.
 */

const LOG = "seat_plan_splits";

module.exports = {
  async up(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    const select = (sql, replacements) => db.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });

    await queryInterface.createTable(LOG, {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_coach_id: { type: Sequelize.INTEGER, allowNull: false },
      plan_id: { type: Sequelize.INTEGER, allowNull: false },
      source_plan_id: { type: Sequelize.INTEGER, allowNull: false },
      previous_coach_no: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    // Everything a copy carries over, found rather than listed.
    const copied = (await select("SHOW COLUMNS FROM seat_plans"))
      .map((c) => c.Field)
      .filter((f) => !["id", "coach_no", "train_name_id", "revision_of_id", "created_at", "updated_at"].includes(f))
      .map((f) => `\`${f}\``);

    const coaches = await select(
      `SELECT tc.id, tc.train_id AS trainId, tc.coach_code AS coachCode, tc.seat_plan_id AS planId,
              sp.train_name_id AS planTrainId, sp.coach_no AS planCoachNo
       FROM train_coaches tc JOIN seat_plans sp ON sp.id = tc.seat_plan_id
       ORDER BY tc.seat_plan_id, tc.train_id, tc.position, tc.id`
    );
    const letterTaken = async (trainId, letter, exceptId) =>
      (
        await select(
          `SELECT id FROM seat_plans WHERE train_name_id = :trainId AND coach_no = :letter AND revision_of_id IS NULL AND id <> :exceptId LIMIT 1`,
          { trainId, letter, exceptId }
        )
      ).length > 0;

    const claimed = new Set();
    for (const coach of coaches) {
      const letter = coach.coachCode;
      // Already one plan per coach: nothing to do.
      if (coach.planTrainId === coach.trainId && coach.planCoachNo === letter) {
        claimed.add(coach.planId);
        continue;
      }
      if (await letterTaken(coach.trainId, letter, coach.planId)) continue;

      if (!claimed.has(coach.planId) && coach.planTrainId === coach.trainId) {
        claimed.add(coach.planId);
        await db.query("UPDATE seat_plans SET coach_no = :letter WHERE id = :id", { replacements: { letter, id: coach.planId } });
        await db.query(
          `INSERT INTO ${LOG} (train_coach_id, plan_id, source_plan_id, previous_coach_no, created_at)
           VALUES (:coachId, :planId, :planId, :previous, UTC_TIMESTAMP())`,
          { replacements: { coachId: coach.id, planId: coach.planId, previous: coach.planCoachNo } }
        );
        continue;
      }

      const [copyId] = await db.query(
        `INSERT INTO seat_plans (coach_no, train_name_id, ${copied.join(", ")}, created_at, updated_at)
         SELECT :letter, :trainId, ${copied.join(", ")}, UTC_TIMESTAMP(), UTC_TIMESTAMP() FROM seat_plans WHERE id = :source`,
        { replacements: { letter, trainId: coach.trainId, source: coach.planId }, type: Sequelize.QueryTypes.INSERT }
      );
      await db.query("UPDATE train_coaches SET seat_plan_id = :copyId WHERE id = :id", { replacements: { copyId, id: coach.id } });
      await db.query(
        `INSERT INTO ${LOG} (train_coach_id, plan_id, source_plan_id, previous_coach_no, created_at)
         VALUES (:coachId, :copyId, :source, NULL, UTC_TIMESTAMP())`,
        { replacements: { coachId: coach.id, copyId, source: coach.planId } }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    const select = (sql, replacements) => db.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
    const done = await select(`SELECT * FROM ${LOG} ORDER BY id DESC`);

    for (const row of done) {
      if (row.plan_id === row.source_plan_id) {
        await db.query("UPDATE seat_plans SET coach_no = :previous WHERE id = :id", {
          replacements: { previous: row.previous_coach_no, id: row.plan_id },
        });
        continue;
      }
      const [source] = await select("SELECT id FROM seat_plans WHERE id = :id", { id: row.source_plan_id });
      if (!source) continue;
      await db.query("UPDATE train_coaches SET seat_plan_id = :source WHERE id = :coachId AND seat_plan_id = :copyId", {
        replacements: { source: row.source_plan_id, coachId: row.train_coach_id, copyId: row.plan_id },
      });
      const [{ n }] = await select(
        `SELECT (SELECT COUNT(*) FROM trip_coaches WHERE seat_plan_id = :id) + (SELECT COUNT(*) FROM train_coaches WHERE seat_plan_id = :id) AS n`,
        { id: row.plan_id }
      );
      if (!Number(n)) await db.query("DELETE FROM seat_plans WHERE id = :id", { replacements: { id: row.plan_id } });
    }
    await queryInterface.dropTable(LOG);
  },
};
