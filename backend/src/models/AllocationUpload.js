const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A seat-allocation file applied: routes, census or counts — who uploaded it,
 * when, what it changed, and for a census when the railway was scanned. The
 * page shows these, newest first, so anyone can see how current the data is.
 */
const UPLOAD_KINDS = Object.freeze({ STOPS: "stops", CENSUS: "census", COUNTS: "counts" });

class AllocationUpload extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      kind: this.kind,
      fileName: this.fileName,
      summary: this.summary,
      scannedFrom: this.scannedFrom,
      scannedTo: this.scannedTo,
      uploadedBy: this.uploadedBy ? { id: this.uploadedBy.id, fullName: this.uploadedBy.fullName } : null,
      uploadedAt: this.createdAt,
    };
  }
}

AllocationUpload.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.STRING(20), allowNull: false },
    fileName: { type: DataTypes.STRING(200), allowNull: true },
    /** The numbers the preview showed: added, changed, set… (not the lines left out). */
    summary: { type: DataTypes.JSON, allowNull: false },
    /** A census: the earliest and latest time the railway was scanned in it. */
    scannedFrom: { type: DataTypes.DATE, allowNull: true },
    scannedTo: { type: DataTypes.DATE, allowNull: true },
    uploadedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, modelName: "AllocationUpload", tableName: "allocation_uploads", indexes: [{ fields: ["kind", "id"] }] }
);

AllocationUpload.associate = ({ User }) => {
  AllocationUpload.belongsTo(User, { foreignKey: "uploadedById", as: "uploadedBy" });
};

module.exports = AllocationUpload;
module.exports.UPLOAD_KINDS = UPLOAD_KINDS;
