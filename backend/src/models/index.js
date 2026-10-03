const sequelize = require("../config/database");
const User = require("./User");
const Role = require("./Role");
const Permission = require("./Permission");
const RolePermission = require("./RolePermission");
const UserRole = require("./UserRole");
const RefreshToken = require("./RefreshToken");
const Setting = require("./Setting");
const TrainName = require("./TrainName");
const CoachType = require("./CoachType");
const CoachClass = require("./CoachClass");
const SeatPlan = require("./SeatPlan");
const Station = require("./Station");
const RouteStop = require("./RouteStop");
const FareRule = require("./FareRule");
const FareTableEntry = require("./FareTableEntry");
const SeatAttribute = require("./SeatAttribute");
const TrainCoach = require("./TrainCoach");
const TrainSchedule = require("./TrainSchedule");
const Trip = require("./Trip");
const TripCoach = require("./TripCoach");
const TripSeat = require("./TripSeat");
const SeatSegmentBooking = require("./SeatSegmentBooking");
const TrainQuotaRule = require("./TrainQuotaRule");
const TripSeatQuota = require("./TripSeatQuota");
const Wallet = require("./Wallet");
const WalletTransaction = require("./WalletTransaction");
const SeatHold = require("./SeatHold");
const Booking = require("./Booking");
const Ticket = require("./Ticket");
const Payment = require("./Payment");
const Refund = require("./Refund");
const RefundSegment = require("./RefundSegment");
const ApprovalRequest = require("./ApprovalRequest");
const WaitlistEntry = require("./WaitlistEntry");
const TicketScan = require("./TicketScan");
const TicketReport = require("./TicketReport");
const AccountHold = require("./AccountHold");
const Job = require("./Job");
const DemoRecord = require("./DemoRecord");
const Notification = require("./Notification");
const demoCapture = require("../utils/demoCapture");

const models = {
  User,
  Role,
  Permission,
  RolePermission,
  UserRole,
  RefreshToken,
  Setting,
  TrainName,
  CoachType,
  CoachClass,
  SeatPlan,
  Station,
  RouteStop,
  FareRule,
  FareTableEntry,
  SeatAttribute,
  TrainCoach,
  TrainSchedule,
  Trip,
  TripCoach,
  TripSeat,
  SeatSegmentBooking,
  TrainQuotaRule,
  TripSeatQuota,
  Wallet,
  WalletTransaction,
  SeatHold,
  Booking,
  Ticket,
  Payment,
  Refund,
  RefundSegment,
  ApprovalRequest,
  WaitlistEntry,
  TicketScan,
  TicketReport,
  AccountHold,
  Job,
  DemoRecord,
  Notification,
};

// Wire up associations for any model that declares them.
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

// Notes every row the demo data creates, so it can be removed again exactly.
demoCapture.install(sequelize, DemoRecord);

module.exports = { sequelize, ...models };
