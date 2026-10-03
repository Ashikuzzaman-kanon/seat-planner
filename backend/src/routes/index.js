const express = require("express");
const router = express.Router();

const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const roleRoutes = require("./roleRoutes");
const settingRoutes = require("./settingRoutes");
const auditRoutes = require("./auditRoutes");
const referenceRoutes = require("./referenceRoutes");
const seatPlanRoutes = require("./seatPlanRoutes");
const network = require("./networkRoutes");
const departures = require("./departureRoutes");
const inventory = require("./inventoryRoutes");
const booking = require("./bookingRoutes");
const search = require("./searchRoutes");
const postSale = require("./postSaleRoutes");
const waitlist = require("./waitlistRoutes");
const verification = require("./verificationRoutes");
const abuse = require("./abuseRoutes");
const jobRoutes = require("./jobRoutes");
const demoRoutes = require("./demoRoutes");
const railwayRoutes = require("./railwayRoutes");
const { PERMISSION_CATALOGUE } = require("../constants/permissions");
const openapi = require("../docs/openapi");

router.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// The permission catalogue is public metadata: it describes what capabilities
// exist, not who holds them. Roles are no longer a fixed list, so there is
// nothing static to expose alongside it.
router.get("/meta/permissions", (_req, res) => res.json({ permissions: PERMISSION_CATALOGUE }));

// Machine-readable contract, so web and mobile clients generate their types
// instead of hand-writing them.
router.get("/openapi.json", (_req, res) => res.json(openapi));

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/settings", settingRoutes);
router.use("/audit", auditRoutes);
router.use("/reference", referenceRoutes);
router.use("/plans", seatPlanRoutes);

// The network model: what the railway physically is.
router.use("/stations", network.stations);
router.use("/trains", network.trains);
// Composition and schedule hang off a train too; mounted second so the network
// router's own /trains routes match first.
router.use("/trains", departures.trainPlanning);
router.use("/fares", network.fares);
router.use("/seat-attributes", network.seatAttributes);

// Departures generated from a train's composition and schedule.
router.use("/trips", departures.trips);
// Segment-level seat inventory also hangs off a departure.
router.use("/trips", inventory.tripInventory);
router.use("/quota", inventory.quota);

// Shopping: finding a train and seeing what is free, with only the permission
// to buy. Deliberately separate from /trips, which is the operational view.
router.use("/search", search);

// Buying: stored credit, checkout holds, and the bookings they become.
router.use("/wallet", booking.wallet);
router.use("/holds", booking.holds);
router.use("/bookings", booking.bookings);

// Queueing for a stretch that is sold out. Sits with buying rather than after
// the sale, because that is what it is: an attempt to buy that is waiting for
// stock.
router.use("/waitlist", waitlist);

/*
 * On the train: checking a ticket, admitting a passenger, and reconciling a
 * service afterwards.
 *
 * Under its own prefix rather than flat. Flat would put `/trips/:id/manifest`
 * behind the inventory router already mounted at `/trips` and rely on it
 * falling through — which works until someone adds a matching route there and
 * silently captures it.
 */
router.use("/verify", verification);

/*
 * Reporting a ticket, reviewing what was reported, and holding an account.
 *
 * Separate from /verify because the permissions are deliberately different: a
 * checker raises signals, a reviewer decides whether they count, and only a
 * third role can stop anybody buying.
 */
router.use("/abuse", abuse);

// Work carried on after the request that started it — a cancelled departure's
// refunds and the messages telling its passengers (Phase 8B).
router.use("/jobs", jobRoutes);

// Demonstration data the super admin can populate and delete again.
router.use("/demo-data", demoRoutes);
router.use("/railway-data", railwayRoutes);

// After the sale: returning a ticket, moving it to another passenger, and the
// queue of decisions a person has to make about both.
router.use("/refunds", postSale.refunds);
router.use("/tickets", postSale.tickets);
router.use("/approvals", postSale.approvals);

module.exports = router;
