const { mongoose } = require("../../config/mongo");

/**
 * An immutable record of a privileged action.
 *
 * This lives in MongoDB rather than MySQL on purpose: audit entries are
 * append-only, never joined, and every action type carries a different shape of
 * detail. A document store absorbs that without a migration each time a new
 * kind of event is added — which is exactly what happens as features land.
 */
const auditEventSchema = new mongoose.Schema(
  {
    // Dotted action key, e.g. "role.create", "user.roles.update".
    action: { type: String, required: true, index: true },

    actor: {
      id: { type: Number, default: null },
      email: { type: String, default: null },
      roles: { type: [String], default: [] },
    },

    // What was acted upon. `label` is a human-readable snapshot, kept so the
    // log stays readable after the row itself is deleted.
    entity: {
      type: { type: String, default: null },
      id: { type: String, default: null },
      label: { type: String, default: null },
    },

    // Free-form per-action detail — the reason a document store earns its place.
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    outcome: { type: String, enum: ["success", "failure"], default: "success" },
    message: { type: String, default: null },

    context: {
      requestId: { type: String, default: null },
      ipAddress: { type: String, default: null },
      userAgent: { type: String, default: null },
      method: { type: String, default: null },
      path: { type: String, default: null },
    },
  },
  {
    timestamps: { createdAt: "at", updatedAt: false },
    collection: "audit_events",
  }
);

// Newest-first listing, plus the two filters the admin screen offers.
auditEventSchema.index({ at: -1 });
auditEventSchema.index({ "actor.id": 1, at: -1 });
auditEventSchema.index({ "entity.type": 1, "entity.id": 1, at: -1 });

module.exports = mongoose.models.AuditEvent || mongoose.model("AuditEvent", auditEventSchema);
