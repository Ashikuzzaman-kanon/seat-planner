const { PERMISSION_CATALOGUE } = require("../constants/permissions");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { FEATURE_KEYS, SWITCH_STATES } = require("../constants/features");

/**
 * The API contract, served at `GET /api/v1/openapi.json`.
 *
 * Written as a module rather than a static file so the parts that already exist
 * as catalogues in code — permission keys, audit actions — stay in step
 * automatically instead of drifting out of date in a hand-maintained document.
 *
 * Its purpose is client generation: the web app and any future mobile client
 * derive their types from this rather than hand-writing them.
 */

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const json = (schema) => ({ content: { "application/json": { schema } } });

const response = (description, schema) => ({
  description,
  ...(schema ? json(schema) : {}),
});

const errors = {
  400: response("Validation failed", ref("Error")),
  401: response("Missing, invalid or expired credentials", ref("Error")),
  403: response(
    "Authenticated, but lacking the required permission — or the feature is switched off for the caller " +
      "(code FEATURE_UNAVAILABLE)",
    ref("Error")
  ),
  404: response("Not found", ref("Error")),
  409: response("Conflicts with existing data", ref("Error")),
};

/** Declares which permission an endpoint requires, for readers of the document. */
const secured = (...permissions) => ({
  security: [{ bearerAuth: [] }],
  "x-required-permissions": permissions,
});

const pathParam = (name, description, type = "integer") => ({
  name,
  in: "path",
  required: true,
  schema: { type },
  description,
});

const queryParam = (name, description, type = "string") => ({
  name,
  in: "query",
  required: false,
  schema: { type },
  description,
});

const body = (schema, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

const obj = (properties, required = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

const str = (description) => ({ type: "string", ...(description ? { description } : {}) });
const int = (description) => ({ type: "integer", ...(description ? { description } : {}) });
const bool = (description) => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items) => ({ type: "array", items });

module.exports = {
  openapi: "3.0.3",

  info: {
    title: "Railway Ticket Management API",
    version: "1.0.0",
    description: [
      "Access control is permission-based, not role-based. Roles are created at",
      "runtime and composed from the fixed permission catalogue below; a caller's",
      "effective permissions are the union of every role they hold.",
      "",
      "Access tokens are short-lived and carry identity only — permissions are",
      "re-resolved on every request, so revoking a role takes effect almost",
      "immediately. Clients exchange a refresh token for a new pair when the",
      "access token expires; the presented refresh token is rotated out.",
      "",
      "Feature switches: the super admin can turn any tab of the app off, for everyone or for chosen",
      "users and roles (the super admin included). The API then refuses the calls only that tab makes,",
      "with 403 and code FEATURE_UNAVAILABLE; a call another tab still needs keeps working. A session",
      "and /auth/me list the caller's switched-off features in unavailableFeatures. Settings has no",
      "switch, and the outside APIs (the subscription check and seat plans) are never switched.",
    ].join("\n"),
  },

  servers: [
    { url: "/api/v1", description: "Versioned API" },
    { url: "/api", description: "Unversioned alias (deprecated)" },
  ],

  tags: [
    { name: "Auth", description: "Registration, sessions and account recovery" },
    { name: "Roles", description: "Runtime-created roles and the permission catalogue" },
    { name: "Users", description: "User directory and role assignment" },
    { name: "Settings", description: "Runtime-configurable values" },
    { name: "Features", description: "Switching tabs of the app off, for everyone or for chosen users and roles" },
    {
      name: "Public seat allocation",
      description:
        "Seat Allocation for everyone, without signing in (/seat-allocation): read-only, rate-limited, with a bot " +
        "check and a number of free searches a day. Switched on in Settings.",
    },
    {
      name: "Seat allocation",
      description:
        "Which station pairs the railway actually sets seats aside for, per train and class — the railway's own " +
        "data, uploaded from a census of its booking site and kept apart from the site's trains and bookings",
    },
    { name: "Audit", description: "Record of privileged actions" },
    { name: "Network", description: "Stations, trains, routes, fares and seat attributes" },
    { name: "Departures", description: "Composition, schedules, and the trips generated from them" },
    { name: "Inventory", description: "Segment-level seat availability, quota and blocks" },
    { name: "Shopping", description: "Finding a train and seeing what is free, with only the permission to buy" },
    { name: "Booking", description: "Wallet, seat holds, and turning a hold into tickets" },
    { name: "On the train", description: "Checking tickets, admitting passengers, and reconciling a service afterwards" },
    { name: "Waitlist", description: "Queueing for a stretch that is sold out, and the offers that queue converts into" },
    { name: "After the sale", description: "Returning a ticket, moving it to another passenger, and the decisions a person has to make" },
    { name: "Background jobs", description: "Work done after the request that asked for it — mass refunds and the messages about them" },
    { name: "Demo data", description: "Filling the system with demonstration data, and removing exactly that again" },
    { name: "Seat plans", description: "Coach seat layouts, their approval, and changing one that is already approved" },
    { name: "Railway data", description: "Loading Bangladesh Railway's timetable and the seat plans transcribed for it" },
    { name: "Notifications", description: "Each person's in-app inbox: what happened, and what is waiting on them" },
    {
      name: "Subscriptions",
      description: "What can be subscribed to, each person's subscription, and checking for one from outside the app",
    },
    { name: "Meta", description: "Service metadata" },
  ],

  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      appToken: {
        type: "http",
        scheme: "bearer",
        description:
          "A subscriber's app's sign-in token, from an earlier POST /subscriptions/check with the password: " +
          "`spa_…`. In place of the email and password, on the check and on seat plans.",
      },
    },

    schemas: {
      Error: obj({
        message: str("Human-readable explanation"),
        code: str("Set on some refusals: FEATURE_UNAVAILABLE when the feature is switched off for the caller"),
        details: {
          description:
            "Validation: the fields at fault. FEATURE_UNAVAILABLE: { features, note } — the features the call " +
            "serves, and the message the super admin left",
        },
        errors: arr(obj({ field: str(), message: str() })),
      }),

      AllocationClass: obj({
        code: str("The railway's class code, such as S_CHAIR"),
        seats: { ...int("Seats set aside. null while the count is not known — not the same as 0"), nullable: true },
        seatsUpdatedAt: {
          type: "string",
          format: "date-time",
          nullable: true,
          description: "When the count was last set or cleared (by the counts sheet or by hand) — not when a census kept the class",
        },
      }),

      AllocationUpload: obj({
        id: int(),
        kind: { type: "string", enum: ["stops", "census", "counts"] },
        fileName: { ...str(), nullable: true },
        summary: { type: "object", description: "What it did: added, changed, set, cleared, left out…" },
        scannedFrom: { type: "string", format: "date-time", nullable: true, description: "A census: the earliest scan in it" },
        scannedTo: { type: "string", format: "date-time", nullable: true, description: "A census: the latest scan in it" },
        uploadedBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
        uploadedAt: { type: "string", format: "date-time" },
      }),

      AllocationPair: obj({
        train: obj({ number: int(), name: str() }),
        from: str("Station, named as the railway names it"),
        to: str(),
        status: { type: "string", enum: ["allocated", "not_allocated", "not_checked"] },
        checkedAt: { type: "string", format: "date-time", nullable: true },
        source: { type: "string", enum: ["census", "manual"], nullable: true },
        onRoute: { ...bool("Both stations on the train's uploaded route, in that order; null with no route"), nullable: true },
        classes: arr(ref("AllocationClass")),
      }),

      AllocationSummary: obj({
        trains: int(),
        pairs: int(),
        stations: int(),
        allocated: int(),
        notAllocated: int(),
        notChecked: int(),
        checkedFrom: { type: "string", format: "date-time", nullable: true, description: "The oldest railway check among the pairs matched" },
        checkedTo: { type: "string", format: "date-time", nullable: true, description: "The newest" },
        countsFrom: { type: "string", format: "date-time", nullable: true, description: "When the oldest seat count shown was set" },
        countsTo: { type: "string", format: "date-time", nullable: true, description: "When the newest was set" },
        classes: arr(obj({ code: str(), pairs: int(), counted: int("Pairs with a count known"), seats: int("Their total") })),
      }),

      UnavailableFeature: obj({
        key: { ...str("Feature key"), enum: FEATURE_KEYS },
        message: { ...str("The message left for the people it is off for"), nullable: true },
      }),

      FeatureSwitch: obj({
        key: { ...str(), enum: FEATURE_KEYS },
        label: str("The tab's name"),
        group: str("The menu group"),
        path: str("The tab's address in the web app"),
        state: {
          type: "string",
          enum: Object.values(SWITCH_STATES),
          description: "off_some: off for the users and roles listed",
        },
        message: { ...str(), nullable: true },
        users: arr(obj({ id: int(), fullName: str(), email: str() })),
        roles: arr(obj({ id: int(), name: str() })),
        updatedBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      }),

      Permission: obj({
        key: { ...str("Catalogue key"), enum: PERMISSION_CATALOGUE.map((p) => p.key) },
        group: str("UI grouping"),
        label: str(),
        description: str(),
        grantable: bool("Whether the calling user may grant this permission"),
      }),

      Role: obj({
        id: int(),
        name: str(),
        description: str(),
        isSystem: bool("System roles cannot be edited or deleted"),
        isDefault: bool("Granted automatically to new registrations"),
        permissions: arr(str("Permission key")),
      }),

      User: obj({
        id: int(),
        fullName: str(),
        email: { type: "string", format: "email" },
        isVerified: bool(),
        restrictedAt: { type: "string", format: "date-time", nullable: true, description: "Set while the account is restricted" },
        lastSignInAt: { type: "string", format: "date-time", nullable: true, description: "Its last password sign-in or email verification" },
        roles: arr(obj({ id: int(), name: str() })),
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      }),

      AccountRestriction: obj({
        id: int(),
        userId: int(),
        reason: str("Why it was restricted. Staff only; the account itself is never told it"),
        restrictedAt: { type: "string", format: "date-time" },
        restrictedBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
        liftedAt: { type: "string", format: "date-time", nullable: true },
        liftedBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
        liftNote: { ...str(), nullable: true },
        inForce: bool("Not yet lifted"),
      }),

      Profile: obj({
        id: int(),
        fullName: str(),
        roles: arr(str("Role name")),
        isSelf: bool(),
        limited: bool("True when only the name and roles are sent: the caller is neither the account nor holds user:view"),
        email: { type: "string", format: "email", description: "From here down, only when not limited" },
        dateOfBirth: { type: "string", format: "date", nullable: true },
        nidLast4: { ...str("The last four characters of the national ID; the rest is never sent"), nullable: true },
        memberSince: { type: "string", format: "date-time" },
        lastSignInAt: { type: "string", format: "date-time", nullable: true },
        isVerified: bool(),
        restriction: { ...ref("AccountRestriction"), nullable: true },
        signInPausedUntil: { type: "string", format: "date-time", nullable: true },
        buyingHold: { ...obj({ since: { type: "string", format: "date-time" }, detail: str() }), nullable: true },
        restrictions: { ...arr(ref("AccountRestriction")), description: "Every restriction, newest first. Only to user:view holders" },
        can: obj({
          restrict: bool("The caller may restrict this account now"),
          lift: bool("The caller may lift its restriction now"),
          editRoles: bool(),
        }),
      }),

      BulkOutcome: obj({
        results: arr(obj({ userId: int(), done: bool(), error: str("Why this one was left alone") })),
        done: int("How many were changed"),
      }),

      Session: obj({
        accessToken: str("Short-lived JWT carrying identity only"),
        refreshToken: str("Opaque token, rotated on every use"),
        user: ref("User"),
        roles: arr(obj({ id: int(), name: str() })),
        permissions: arr(str("Effective permission keys")),
        unavailableFeatures: arr(ref("UnavailableFeature")),
        publicFeatures: arr(str("Features open to the public, and so to everyone signed in: seat-allocation")),
      }),

      Setting: obj({
        key: str(),
        group: str(),
        label: str(),
        description: str(),
        type: { type: "string", enum: ["integer", "decimal", "boolean", "string"] },
        default: {},
        value: {},
        min: int(),
        max: int(),
        isDefault: bool("True when no override is stored"),
      }),

      AuditEvent: obj({
        action: { ...str(), enum: Object.values(AUDIT_ACTIONS) },
        at: { type: "string", format: "date-time" },
        actor: obj({ id: int(), email: str(), roles: arr(str()) }),
        entity: obj({ type: str(), id: str(), label: str() }),
        before: {},
        after: {},
        outcome: { type: "string", enum: ["success", "failure"] },
        message: str(),
        context: obj({
          requestId: str(),
          ipAddress: str(),
          userAgent: str(),
          method: str(),
          path: str(),
        }),
      }),

      Pagination: obj({ page: int(), limit: int(), total: int(), pages: int() }),

      Station: obj({
        id: int(),
        code: str("Short operating code, uppercased on write"),
        name: str(),
        district: str(),
        isActive: bool("Retired stations stay referenced by existing routes"),
      }),

      RouteStop: obj({
        id: int(),
        sequence: int("1-based position along the route"),
        stationId: int(),
        station: ref("Station"),
        arrivalTime: str("HH:MM — null at the origin"),
        departureTime: str("HH:MM — null at the terminus"),
        dayOffset: int("Days after the origin's departure date; 1 on an overnight leg"),
        distanceKm: { type: "number", description: "Cumulative kilometres from the origin" },
        haltMinutes: int(),
      }),

      Train: obj({
        id: int(),
        name: str(),
        code: str("Display code, e.g. 755/756"),
        upCode: str(),
        downCode: str(),
        notes: str(),
        isActive: bool(),
        stops: arr(ref("RouteStop")),
        segments: arr(
          obj({ index: int(), fromStationId: int(), toStationId: int() })
        ),
        journeyMinutes: int("Origin departure to terminus arrival, day offsets included"),
      }),

      FareRule: obj({
        id: int(),
        name: str(),
        kind: { type: "string", enum: ["table", "distance"] },
        priority: int("Lower runs first; the first rule that yields an amount wins"),
        trainId: int("Null applies the rule to every train"),
        coachClassId: int(),
        ratePerKm: { type: "number", description: "distance rules only" },
        minFare: { type: "number", description: "distance rules only" },
        isActive: bool(),
        entries: arr(ref("FareTableEntry")),
      }),

      FareTableEntry: obj({
        id: int(),
        fromStationId: int(),
        toStationId: int(),
        amount: { type: "number" },
      }),

      Fare: obj({
        amount: { type: "number" },
        distanceKm: { type: "number" },
        basis: { type: "string", enum: ["table", "distance"] },
        rule: obj({ id: int(), name: str(), kind: str(), priority: int() }),
        explanation: str("Why this price — so a fare can be justified, not just asserted"),
      }),

      TrainCoach: obj({
        id: int(),
        position: int("Order along the rake"),
        coachCode: str("Operating letter, e.g. KA"),
        seatPlanId: int(),
        seatCount: int(),
        planApproved: bool("Only approved layouts are put into service"),
        isActive: bool(),
      }),

      TrainSchedule: obj({
        id: int(),
        runsOn: arr(int("0 = Sunday, matching Date#getDay")),
        effectiveFrom: str("YYYY-MM-DD"),
        effectiveTo: str("YYYY-MM-DD"),
        isActive: bool(),
      }),

      Trip: obj({
        id: int(),
        trainId: int(),
        train: obj({ id: int(), name: str(), code: str() }),
        departureDate: str("Date the train leaves its origin, Asia/Dhaka"),
        status: { type: "string", enum: ["scheduled", "cancelled", "departed", "completed"] },
        cancellationReason: str(),
        generatedAt: { type: "string", format: "date-time" },
        coachCount: int(),
        seatCount: int(),
        seatsByClass: { type: "object", additionalProperties: int() },
        segmentCount: int("Sellable legs — one fewer than the number of stops"),
        convenientReturnEnabled: bool("Whether this departure offers a convenient return"),
        demandReturnEnabled: bool("Whether it offers a demand-based one"),
      }),

      TripSeat: obj({
        id: int(),
        tripCoachId: int(),
        coachClassId: int(),
        seatNumber: str(),
        rowIndex: int("Position in the plan, so a seat map redraws from rows alone"),
        cellIndex: int(),
        isWindow: bool(),
        windowType: { type: "string", enum: ["full", "half"] },
        chargingPort: bool(),
        fan: bool(),
        note: str(),
        attributes: { type: "object", description: "Catalogue-keyed features" },
        coachCode: str("The coach's printed code, e.g. KA (list endpoints only)"),
        coachPosition: int("Where the coach is coupled, front first (list endpoints only)"),
        coachClass: str("Class name (list endpoints only)"),
      }),

      GenerationReport: obj({
        horizonDays: int(),
        from: str(),
        to: str(),
        created: int(),
        existing: int("Departures that already existed — generation is idempotent"),
        seatsCreated: int(),
        trains: arr(
          obj({
            train: str(),
            created: int(),
            existing: int(),
            seats: int(),
            notes: arr(str("Why a coach was skipped, e.g. plan is pending")),
          })
        ),
      }),

      Availability: obj({
        tripId: int(),
        departureDate: str(),
        fromStationId: int(),
        toStationId: int(),
        segments: arr(int("Zero-based segment indices this journey occupies")),
        totalSeats: int(),
        availableCount: int(),
        available: arr(ref("TripSeat")),
        withheld: obj({
          occupied: int(),
          blocked: int(),
          reserved_for_other_pair: int("Held by quota for a different station pair"),
          does_not_match_filters: int(),
        }),
        availableByClass: { type: "object", additionalProperties: int() },
      }),

      AvailabilityPair: obj({
        fromStationId: int(),
        toStationId: int(),
        fromStation: ref("Station"),
        toStation: ref("Station"),
        segments: arr(int()),
        available: int(),
        total: int(),
      }),

      QuotaRule: obj({
        id: int(),
        trainId: int(),
        coachClassId: int(),
        fromStationId: int(),
        toStationId: int(),
        quantity: int("How many seats of that class to hold for the pair"),
        releaseHoursBefore: int("Unsold held seats return to open sale this long before departure"),
        priority: int("Lower runs first, claiming seats before later rules see them"),
        effectiveFrom: str(),
        effectiveTo: str(),
        isActive: bool(),
      }),

      SeatAttribute: obj({
        id: int(),
        key: str("Slug stored on each seat, e.g. charging_port"),
        label: str(),
        description: str(),
        valueType: { type: "string", enum: ["boolean", "enum"] },
        options: arr(obj({ value: str(), label: str() })),
        icon: str(),
        isFilterable: bool("Whether passengers may filter on it during auto-select"),
        isActive: bool(),
        sortOrder: int(),
      }),

      /* ---------------- Booking ---------------- *
       * Every amount is an integer count of poisha, the minor unit. Money is
       * never a float here: a fare split three ways has to add back up exactly,
       * and 0.1 + 0.2 does not. The `*Formatted` fields carry the display form
       * so clients never have to do the arithmetic themselves.
       */

      Wallet: obj({
        id: int(),
        userId: int(),
        balanceMinor: int("Stored credit in poisha"),
        balance: { type: "number", description: "The same balance in taka" },
        balanceFormatted: str("Ready to display, e.g. 1,250.00"),
        status: { type: "string", enum: ["active", "frozen"] },
      }),

      WalletTransaction: obj({
        id: int(),
        direction: { type: "string", enum: ["credit", "debit"] },
        amountMinor: int(),
        balanceAfterMinor: int("The balance this entry produced, so the ledger can be replayed"),
        reason: { type: "string", enum: ["topup", "purchase", "refund", "adjustment", "withdrawal"] },
        referenceType: str("What the entry points at, e.g. gateway or booking"),
        referenceId: str(),
        description: str(),
        createdAt: str(),
      }),

      SeatHold: obj({
        id: int(),
        reference: str("Opaque handle the client carries through checkout"),
        tripId: int(),
        userId: int(),
        fromStationId: int(),
        toStationId: int(),
        seatIds: arr(int()),
        status: { type: "string", enum: ["active", "converted", "expired", "released"] },
        expiresAt: str(),
        secondsRemaining: int("Counts down to zero, then the seats return to sale"),
        isLive: bool("Whether it can still be paid for"),
        createdAt: str(),
      }),

      TicketReport: obj({
        reference: str(),
        ticketNumber: str(),
        tripId: int(),
        kind: {
          type: "string",
          enum: ["identity_mismatch", "duplicate_in_use", "forgery", "beyond_journey", "other"],
        },
        status: {
          type: "string",
          description:
            "`open` counts for nothing. `upheld` is what turns an accusation into a signal. " +
            "`dismissed` withdraws it entirely rather than discounting it — a report a human " +
            "rejected is not weak evidence.",
          enum: ["open", "upheld", "dismissed"],
        },
        detail: str("The checker's own words. Required, because a report nobody can review is noise"),
        reportedUserId: int("Whose account held the ticket, copied so a transfer cannot move the history"),
        reviewedById: int(),
        reviewedAt: str(),
        reviewNote: str(),
        reportedAt: str(),
      }),

      AbuseScore: obj({
        userId: int(),
        windowDays: int("Signals age out; a score with no window never forgives anything"),
        total: int(),
        threshold: int(),
        parts: arr(
          obj({
            signal: str(),
            count: str(),
            weight: int(),
            points: int(),
            note: str("Why this counted what it did — a score nobody can argue with cannot be appealed"),
          })
        ),
      }),

      Job: obj({
        id: int(),
        type: str("What kind of work, e.g. refund.trip_cancellation"),
        label: str("Said to an operator: what this job is doing"),
        status: { type: "string", enum: ["queued", "running", "succeeded", "failed"] },
        priority: int("Higher runs first — refunds outrank the messages about them"),
        attempts: int(),
        maxAttempts: int("After this many failed attempts it stops and waits for a person"),
        runAfter: str("Not claimed before this — how a retry waits out its backoff"),
        startedAt: str(),
        finishedAt: str(),
        lastError: str(),
        progress: obj({ total: int(), done: int(), step: str("Demo jobs: the stage it is on") }),
        result: obj({}),
        payload: obj({}),
        createdById: int("Who queued it; they may read it without job:view"),
        createdAt: str(),
        updatedAt: str(),
      }),

      DemoBlocker: obj({
        kind: { type: "string", enum: ["outside_tickets_on_demo_departures", "demo_tickets_on_other_departures"] },
        tickets: int("Valid tickets in the way"),
        bookings: arr(obj({ reference: str(), email: str(), tickets: int() })),
        message: str("What is in the way, and what to do about it"),
      }),

      DemoStatus: obj({
        populated: bool("Whether any demo data exists"),
        counts: obj({
          accounts: int(),
          roles: int(),
          seatPlans: int(),
          stations: int(),
          trains: int(),
          fareRules: int(),
          departures: int("Every departure of a demo train, including ones generated after populating"),
          bookings: int("On demo departures, or by demo accounts — what a delete would remove"),
          tickets: int(),
        }),
        accounts: arr(
          obj({
            role: str(),
            name: str(),
            email: str(),
            password: str("The fixed demo password. Null for an account that existed before the demo — it kept its own"),
            state: { type: "string", enum: ["demo", "existing", "missing"] },
          })
        ),
        blockers: arr(ref("DemoBlocker")),
        job: { ...ref("Job"), nullable: true, description: "A populate or delete still running" },
        lastJob: { ...ref("Job"), nullable: true, description: "The last one that finished, with its result" },
      }),

      Notification: obj({
        id: int(),
        type: str("What happened, e.g. booking.confirmed, refund.paid, plan.submitted, job.failed"),
        category: { type: "string", enum: ["booking", "refund", "waitlist", "account", "approval", "plan", "subscription", "system"] },
        tone: { type: "string", enum: ["info", "success", "warning", "danger", "neutral"] },
        title: str(),
        body: { ...str("One or two sentences, written when it happened"), nullable: true },
        link: { ...str("A path in the app where the current state lives"), nullable: true },
        read: bool(),
        readAt: { type: "string", format: "date-time", nullable: true },
        createdAt: { type: "string", format: "date-time" },
      }),

      Subscription: obj({
        id: int(),
        code: str("How callers name it. Set when it is created and never changed, even if it is renamed"),
        name: str(),
        description: { ...str(), nullable: true },
        isOpen: bool("Whether it takes new requests. Closing leaves running subscriptions alone"),
        includesSeatPlans: bool("Whether its subscribers' apps may fetch seat plans (POST /subscriptions/seat-plans)"),
        appUrl: {
          ...str("Where its app is got from — an https address. In the list, sent only to staff and to whoever is subscribed now"),
          nullable: true,
        },
        createdAt: { type: "string", format: "date-time" },
      }),

      SeatPlan: obj({
        id: int(),
        coachNo: { ...str("The railway's coach letter — KA, KHA, GA… A train has one plan per coach"), nullable: true },
        status: { type: "string", enum: ["draft", "pending", "approved", "rejected"] },
        rejectionReason: { ...str(), nullable: true },
        trainNameId: { ...int(), nullable: true },
        coachTypeId: { ...int(), nullable: true },
        coachClassId: { ...int("A class named with the railway's code: S_CHAIR, SNIGDHA, AC_B…"), nullable: true },
        trainName: { ...obj({ id: int(), name: str() }), nullable: true },
        coachType: { ...obj({ id: int(), name: str() }), nullable: true },
        coachClass: { ...obj({ id: int(), name: str() }), nullable: true },
        layout: { type: "object", description: "The seat grid. Left out of lists" },
        approvedAt: { type: "string", format: "date-time", nullable: true },
        revisionOfId: { ...int("Set on an editable copy of an approved plan: the plan it changes"), nullable: true },
        revision: {
          ...obj({ id: int(), status: str(), rejectionReason: { ...str(), nullable: true } }),
          nullable: true,
          description: "On an approved plan: its editable copy, while one is open",
        },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      }),

      UserSubscription: obj({
        id: int(),
        subscriptionId: int(),
        userId: int(),
        status: {
          type: "string",
          enum: ["pending", "active", "declined", "cancelled", "expired"],
          description: "An active one whose time is up reads as expired at once, before the hourly sweep marks it",
        },
        valid: bool("Active and not yet run out, right now"),
        requestedAt: { type: "string", format: "date-time" },
        decidedAt: { type: "string", format: "date-time", nullable: true },
        decisionNote: { ...str(), nullable: true },
        startsAt: { type: "string", format: "date-time", nullable: true },
        expiresAt: { ...str("The first instant it is no longer valid"), format: "date-time", nullable: true },
        lastDay: { ...str("The last calendar day it is valid, in Dhaka (YYYY-MM-DD)"), nullable: true },
        endedAt: { type: "string", format: "date-time", nullable: true },
        endReason: { ...str(), nullable: true },
        devices: arr(
          obj({
            platformId: int(),
            value: str("What a caller sends as `platform`"),
            name: str(),
            isActive: bool(),
            limit: int("How many devices of this platform it allows; 0 for none"),
          })
        ),
      }),

      DeviceCounts: {
        type: "object",
        description:
          "How many devices of each platform, keyed by the platform's value. 0 to 10 each, at least one in " +
          "total; a platform left out is 0.",
        additionalProperties: { type: "integer", minimum: 0, maximum: 10 },
        example: { windows: 2, android: 1 },
      },

      SubscriptionPlatform: obj({
        id: int(),
        value: str("What a caller sends as `platform`. Set when it is created and never changed"),
        name: str("What it is called on screen"),
        isActive: bool("Switched off, nobody can ask for devices on it and no check from it is valid"),
      }),

      AppNotice: obj({
        id: int(),
        subscriptionId: int(),
        platformId: int(),
        kind: { type: "string", enum: ["released", "retiring"] },
        version: str(),
        message: str(),
        emailed: bool(),
        recipients: int("How many it went to"),
        sentAt: { type: "string", format: "date-time" },
        sentBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
      }),

      BlockedVersion: obj({
        id: int(),
        version: str("Clean: v1.04 is stored as 1.4"),
        note: { ...str(), nullable: true },
        createdAt: { type: "string", format: "date-time" },
        createdBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
      }),

      UserDevice: obj({
        id: int(),
        userId: int(),
        platformId: int(),
        platform: obj({ id: int(), value: str(), name: str() }),
        deviceId: str("As the device sent it"),
        note: { ...str("Staff's own words about it. Only staff are sent it"), nullable: true },
        isBlocked: bool("Blocked, it is never valid and holds no place"),
        firstSeenAt: { type: "string", format: "date-time" },
        lastSeenAt: { type: "string", format: "date-time" },
        checks: int("How many times it has checked in"),
        appVersion: { ...str("The app version it last checked in with"), nullable: true },
      }),

      DeviceUsage: obj({
        platformId: int(),
        value: str(),
        name: str(),
        isActive: bool(),
        used: int("Devices holding a place"),
        allowed: int("The most any running subscription allows — what a new device is measured against"),
      }),

      DeviceRefusal: obj({
        id: int(),
        userId: int(),
        platform: { ...str("As sent, cut to fit"), nullable: true },
        deviceId: { ...str("As sent, cut to fit"), nullable: true },
        reason: {
          type: "string",
          enum: ["no_device", "bad_device", "unknown_platform", "platform_off", "blocked", "limit_reached", "beyond_limit"],
          description: "Why the check was answered `valid: false`. Never returned to the caller of the check",
        },
        attempts: int("How many times this device was turned away for this reason"),
        firstAt: { type: "string", format: "date-time" },
        lastAt: { type: "string", format: "date-time" },
      }),

      NotificationSummary: obj({
        unreadCount: int(),
        latestId: int("The newest notification's id — when it moves, something arrived"),
      }),

      RailwayStatus: obj({
        snapshot: obj({
          source: str("Where the timetable was published"),
          fetchedAt: str("When the committed snapshot was taken"),
          trains: int(),
          stations: int(),
          plans: int("Plans a load makes: one per coach of every line-up, plus the drafts"),
          coachPlans: int("Coaches the line-ups put on trains, each with a plan of its own"),
          layouts: int("Transcribed layouts the plans are built from"),
          draftPlans: int("Layouts whose source names no train, saved as drafts"),
          readyTrains: int("Trains a seat-plan source names, made ready for departures"),
        }),
        loaded: obj({
          trains: int("Snapshot trains present"),
          withRoutes: int(),
          stations: int(),
          approvedPlans: int(),
          draftPlans: int(),
        }),
        generation: obj({
          automatic: bool("Whether the hourly job generates departures by itself"),
          horizonDays: int(),
        }),
        demoPopulated: bool("Loading is refused while demo data exists"),
        blocker: { ...str("Why loading is refused right now"), nullable: true },
        ready: arr(
          obj({
            id: int(),
            name: str(),
            code: str(),
            coaches: arr(str()),
            seats: int(),
            seatsByClass: { type: "object", additionalProperties: { type: "integer" } },
            runsOn: arr(int("0 = Sunday")),
            from: str(),
            to: str(),
            departs: str("HH:MM at the origin"),
            arrives: str("HH:MM at the terminus"),
            arrivesDayOffset: int(),
          })
        ),
        job: { ...ref("Job"), nullable: true, description: "A load still running" },
        lastJob: { ...ref("Job"), nullable: true, description: "The last load that finished, with its report" },
        sync: obj({
          pending: { ...ref("RailwayTimetable"), nullable: true, description: "A check waiting to be applied" },
          lastApplied: { ...ref("RailwayTimetable"), nullable: true, description: "The timetable the server works from now" },
          job: { ...ref("Job"), nullable: true, description: "A check or apply still running" },
          lastJob: { ...ref("Job"), nullable: true, description: "The last check or apply that finished" },
        }),
      }),

      RailwayTimetable: obj({
        id: int(),
        status: { type: "string", enum: ["checked", "applied"] },
        requestedFor: { type: "string", format: "date", description: "The day the railway was asked for" },
        fetchedAt: { type: "string", format: "date-time" },
        unpublished: arr(int("Train numbers the railway said it has no timetable for")),
        failed: arr(obj({ number: int(), error: str() })),
        diff: obj({
          counts: obj({
            published: int(),
            newStations: int(),
            newTrains: int(),
            renamed: int(),
            times: int(),
            stations: int(),
            days: int(),
            unpublished: int(),
            failed: int(),
            unchanged: int(),
          }),
          upToDate: bool("Nothing to apply"),
          newStations: arr(str()),
          newTrains: arr(obj({ number: int(), name: str(), stops: int(), from: str(), to: str(), runsOn: arr(int()) })),
          renamed: arr(obj({ trainId: int(), number: int(), from: str(), to: str() })),
          times: arr(obj({ trainId: int(), number: int(), name: str(), stops: arr(obj({ station: str(), from: obj({}), to: obj({}) })) })),
          stations: arr(
            obj({
              trainId: int(),
              number: int(),
              name: str(),
              added: arr(str()),
              removed: arr(str()),
              reordered: bool(),
              newRoute: bool(),
              upcoming: int("Departures still to run"),
              willApply: bool("False while departures are still to run: the route is left and named"),
            })
          ),
          days: arr(
            obj({
              trainId: int(),
              number: int(),
              name: str(),
              from: arr(int()),
              to: arr(int()),
              willApply: bool("False when its running days were set by hand"),
              stranded: arr(str("Departures already generated on a day it will no longer run")),
            })
          ),
          unpublished: arr(obj({ trainId: int(), number: int(), name: str() })),
          failed: arr(int()),
        }),
        report: { type: "object", nullable: true, description: "What applying did, skipped and why — once applied" },
        checkedBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
        appliedBy: { ...obj({ id: int(), fullName: str() }), nullable: true },
        appliedAt: { type: "string", format: "date-time", nullable: true },
      }),

      AccountHold: obj({
        id: int(),
        userId: int(),
        reason: { type: "string", enum: ["abuse_score", "review_decision", "manual"] },
        detail: str("Read by the account holder, so a sentence rather than a code"),
        automatic: bool("Placed by the scorer rather than a person — deserves more scrutiny, not less"),
        scoreAtHold: int(),
        placedById: int("Null when the scorer placed it; nobody is credited for arithmetic"),
        placedAt: str(),
        releasedById: int(),
        releasedAt: str(),
        releaseNote: str(),
        active: bool(),
      }),

      ScanVerdict: {
        type: "string",
        description:
          "What the checker was shown. `accepted` admitted the passenger and marked the ticket used; " +
          "`checked` looked and changed nothing. The rest are refusals, each with its own reason " +
          "because a passenger whose ticket was refunded, one holding a copy of somebody else's and " +
          "one on the wrong train all need a different sentence said to them.",
        enum: [
          "accepted",
          "checked",
          "already_used",
          "not_valid",
          "wrong_service",
          "forged",
          "unreadable",
          "unknown",
        ],
      },

      ScanResult: obj({
        verdict: ref("ScanVerdict"),
        refused: bool("Whether to stop this passenger boarding"),
        message: str("Said to the passenger, as written. Not a code to be reworded on the device"),
        signatureOk: bool("True only when a signed code was read — a typed number proves nothing"),
        typedOnly: bool("The number was keyed in rather than scanned"),
        firstScan: obj({
          scannedAt: str(),
          station: str(),
          checkedBy: str(),
        }),
        ticket: obj({
          ticketNumber: str(),
          bookingReference: str(),
          status: str(),
          passengerName: str(),
          nidLastFour: str("Last four digits only — enough to match a card, useless in a photograph"),
          coachCode: str(),
          seatNumber: str(),
          train: str(),
          from: str(),
          to: str(),
          travellingOn: str(),
        }),
        scan: obj({
          id: int(),
          verdict: ref("ScanVerdict"),
          scannedAt: str(),
          syncedAt: str(),
          offline: bool(),
        }),
      }),

      WaitlistEntry: obj({
        reference: str("What the passenger quotes, and what the confirm call carries"),
        tripId: int(),
        fromStationId: int(),
        toStationId: int(),
        seatCount: int(),
        coachClassId: int("Null means any class, which converts sooner"),
        status: {
          type: "string",
          enum: ["waiting", "offered", "confirmed", "declined", "lapsed", "withdrawn", "closed"],
        },
        position: int("Place in the queue. Derived from join order, never stored; null unless waiting"),
        offerExpiresAt: str("When an open offer lapses and the seat goes back on sale"),
        offerSecondsRemaining: int(),
        offersMade: int("Offers this entry has been made; too many unanswered and it leaves the queue"),
        bookingId: int("Set once the offer is taken"),
        train: obj({ id: int(), name: str() }),
        departureDate: str(),
        fromStation: str(),
        toStation: str(),
        coachClass: str(),
        offer: obj({
          holdReference: str(),
          seats: arr(obj({ id: int(), seatNumber: str(), coachCode: str() })),
        }),
        joinedAt: str(),
      }),

      QuoteLine: obj({
        tripSeatId: int(),
        seatNumber: str(),
        coachCode: str(),
        coachClassId: int(),
        fareMinor: int(),
        fareFormatted: str(),
        basis: { type: "string", enum: ["table", "distance"] },
        explanation: str("How this fare was arrived at, in words"),
      }),

      Quote: obj({
        holdReference: str(),
        tripId: int(),
        departureDate: str(),
        fromStationId: int(),
        toStationId: int(),
        secondsRemaining: int(),
        lines: arr(ref("QuoteLine")),
        totalMinor: int("The exact integer sum of the lines"),
        totalFormatted: str(),
        payment: obj({
          walletBalanceMinor: int(),
          walletBalance: str(),
          options: arr(
            obj({
              method: { type: "string", enum: ["wallet", "split", "gateway"] },
              label: str(),
              available: bool("Whether this method can cover the fare right now"),
              detail: str("Why it can or cannot"),
            })
          ),
        }),
      }),

      Passenger: obj(
        {
          name: str(),
          nid: str("National ID, 10 to 17 digits"),
          dob: str("Date of birth, YYYY-MM-DD"),
          tripSeatId: int("Pin this passenger to one held seat; otherwise they are paired in order"),
        },
        ["name", "nid", "dob"]
      ),

      Ticket: obj({
        id: int(),
        ticketNumber: str("What a ticket checker reads"),
        tripSeatId: int(),
        seatNumber: str(),
        coachCode: str(),
        coachClassId: int(),
        passengerName: str(),
        passengerNid: str(),
        passengerDob: str(),
        fareMinor: int(),
        fareFormatted: str(),
        status: { type: "string", enum: ["valid", "used", "cancelled", "transferred"] },
      }),

      Payment: obj({
        id: int(),
        provider: { type: "string", enum: ["wallet", "gateway"] },
        amountMinor: int(),
        status: { type: "string", enum: ["captured", "refunded", "failed"] },
        reference: str("The provider's own handle on the payment"),
        createdAt: str(),
      }),

      DepartureFare: obj({
        coachClassId: int(),
        coachClass: str(),
        availableCount: int("Seats of this class free for the journey asked about"),
        fareMinor: int(),
        fareFormatted: str(),
        basis: { type: "string", enum: ["table", "distance"] },
      }),

      Departure: obj({
        tripId: int(),
        trainId: int(),
        train: obj({ id: int(), name: str(), code: str() }),
        departureDate: str(),
        from: obj({
          stationId: int(),
          name: str(),
          code: str(),
          time: str("Local departure time at the origin"),
          sequence: int(),
        }),
        to: obj({
          stationId: int(),
          name: str(),
          code: str(),
          time: str("Local arrival time at the destination"),
          dayOffset: int("1 when the train arrives the following calendar day"),
          sequence: int(),
        }),
        stopsBetween: int(),
        availableCount: int("Seats sellable over this exact stretch"),
        totalSeats: int(),
        fares: arr(ref("DepartureFare")),
        cheapestMinor: int(),
        cheapestFormatted: str(),
      }),

      SellableSeat: obj({
        id: int("Trip seat id, the handle a hold is taken on"),
        tripCoachId: int(),
        coachCode: str("What the coach is called on the platform, e.g. KA"),
        coachPosition: int("Where the coach sits in the rake"),
        coachClassId: int(),
        seatNumber: str(),
        rowIndex: int("Row in the coach layout"),
        cellIndex: int("Position across the row, counting aisles — consecutive values are adjacent seats"),
        attributes: obj({}),
      }),

      SeatRequest: obj(
        {
          tripId: int("Which departure"),
          fromStationId: int(),
          toStationId: int(),
          count: int("How many seats, up to the per-booking maximum"),
          coachClassId: int("Narrow to one class"),
          criteria: obj({}, []),
          together: bool("Seat the party near one another"),
          strict: bool(
            "Refuse rather than offer something lesser. Without it, unmet preferences are " +
              "relaxed and reported in the response; with it, they are a reason to decline."
          ),
        },
        ["tripId", "fromStationId", "toStationId", "count"]
      ),

      SeatSuggestion: obj({
        tripId: int(),
        departureDate: str(),
        fromStationId: int(),
        toStationId: int(),
        seats: arr(ref("SellableSeat")),
        seatIds: arr(int()),
        togetherness: {
          type: "string",
          enum: ["side_by_side", "same_row", "nearby", "same_coach", "scattered"],
          description: "How close together the chosen seats turned out to be",
        },
        togetherLabel: str("The same thing in words, for showing a passenger"),
        relaxed: arr(str("Preferences that had to be given up to fill the request")),
        message: str(),
        freeForJourney: int(),
      }),

      RefundOption: obj({
        type: { type: "string", enum: ["convenient", "demand"] },
        label: str(),
        describe: str("What this policy does, in a sentence"),
        ok: bool("False when this policy cannot be used right now"),
        reason: {
          type: "string",
          enum: [
            "departed",
            "not_refundable",
            "already_refunded",
            "standing_held",
            "sale_closed",
            "disabled",
          ],
          description:
            "Why not, when ok is false. `disabled` means this departure does not offer the " +
            "policy at all — the option is still listed rather than silently dropped, so the " +
            "passenger is told it exists and is unavailable here.",
        },
        message: str("The same thing in words, for showing a passenger"),
        immediate: bool("Whether money moves now or waits on a resale"),
        hoursRemaining: { type: "number" },
        percent: int("The deduction or charge that applies"),
        deductionMinor: int("What is kept"),
        refundMinor: int("Convenient returns — exactly fare minus deduction"),
        segmentCount: int("Demand returns only"),
        maximumMinor: int("Demand returns only — the most this could ever pay, if every segment resells"),
        lines: arr(obj({ shareMinor: int(), deductionMinor: int(), refundMinor: int() })),
      }),

      RefundQuote: obj({
        ticketId: int(),
        ticketNumber: str(),
        seatNumber: str(),
        coachCode: str(),
        passengerName: str(),
        fareMinor: int(),
        fareFormatted: str(),
        departureInstant: str("When the passenger's own leg leaves — every deadline is measured from this"),
        hoursRemaining: { type: "number" },
        segmentCount: int(),
        options: arr(ref("RefundOption")),
      }),

      RefundSegment: obj({
        id: int(),
        tripSeatId: int(),
        segmentIndex: int(),
        shareMinor: int("This segment's share of the fare"),
        refundMinor: int("What it pays if it resells"),
        isResold: bool(),
        resoldAt: str(),
        resoldTicketId: int("The ticket that bought this space back"),
        settledAt: str(),
      }),

      Refund: obj({
        id: int(),
        reference: str(),
        ticketId: int(),
        bookingId: int(),
        userId: int(),
        type: {
          type: "string",
          enum: ["convenient", "demand", "disruption"],
          description:
            "disruption is issued by the railway when it cancels a service, never asked for " +
            "by a passenger: the whole fare comes back with nothing deducted",
        },
        status: {
          type: "string",
          enum: ["settled", "awaiting_resale", "partially_settled", "closed"],
          description:
            "closed means the train left with segments unsold, so nothing further will be paid",
        },
        isOpen: bool(),
        fareMinor: int(),
        deductionPercent: int(),
        refundedMinor: int("Credited so far"),
        refundedFormatted: str(),
        maximumMinor: int("The most this refund can ever pay, fixed when it was created"),
        maximumFormatted: str(),
        segments: arr(ref("RefundSegment")),
        requestedAt: str(),
        closedAt: str(),
        note: str(),
      }),

      ApprovalRequest: obj({
        id: int(),
        reference: str(),
        type: {
          type: "string",
          enum: ["ticket_transfer", "wallet_withdrawal", "abuse_review"],
        },
        status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] },
        isOpen: bool(),
        subjectType: str("What the request is about, e.g. ticket or wallet"),
        subjectId: str(),
        subjectLabel: str("Kept so a decided request still reads sensibly later"),
        summary: str("One line a reviewer can act on without opening it"),
        requestedById: int(),
        requestedBy: obj({ id: int(), email: str(), fullName: str() }),
        reason: str("Why the requester asked"),
        payload: obj({}),
        decidedById: int(),
        decidedBy: obj({ id: int(), email: str(), fullName: str() }),
        decidedAt: str(),
        decisionNote: str(),
        createdAt: str(),
      }),

      Booking: obj({
        id: int(),
        reference: str("The PNR a passenger quotes, six unambiguous characters"),
        userId: int(),
        tripId: int(),
        trip: obj({ id: int(), departureDate: str(), status: str() }),
        fromStationId: int(),
        toStationId: int(),
        fromStation: ref("Station"),
        toStation: ref("Station"),
        status: { type: "string", enum: ["confirmed", "cancelled", "refunded"] },
        totalMinor: int(),
        total: { type: "number" },
        totalFormatted: str(),
        ticketCount: int(),
        tickets: arr(ref("Ticket")),
        payments: arr(ref("Payment")),
        createdAt: str(),
      }),
    },
  },

  paths: {
    "/health": {
      get: {
        tags: ["Meta"],
        summary: "Liveness check",
        responses: { 200: response("Service is up", obj({ status: str(), time: str() })) },
      },
    },

    "/meta/permissions": {
      get: {
        tags: ["Meta"],
        summary: "The permission catalogue",
        description:
          "Public metadata describing what capabilities exist. Roles are no longer a fixed list, so there is nothing static to expose alongside it.",
        responses: {
          200: response("Catalogue", obj({ permissions: arr(ref("Permission")) })),
        },
      },
    },

    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register an account and email a verification code",
        description: "The new account receives whichever role is flagged as the default.",
        requestBody: body(
          obj(
            {
              fullName: str(),
              email: { type: "string", format: "email" },
              password: { type: "string", minLength: 8 },
            },
            ["fullName", "email", "password"]
          )
        ),
        responses: {
          201: response("Registered", obj({ message: str(), user: ref("User") })),
          400: errors[400],
          409: errors[409],
        },
      },
    },

    "/auth/verify-email": {
      post: {
        tags: ["Auth"],
        summary: "Verify an email with its code and open a session",
        requestBody: body(
          obj({ email: str(), code: { type: "string", minLength: 6, maxLength: 6 } }, [
            "email",
            "code",
          ])
        ),
        responses: { 200: response("Verified", ref("Session")), 400: errors[400] },
      },
    },

    "/auth/resend-verification": {
      post: {
        tags: ["Auth"],
        summary: "Re-issue a verification code",
        description: "Always succeeds, to avoid revealing whether an account exists.",
        requestBody: body(obj({ email: str() }, ["email"])),
        responses: { 200: response("Accepted", obj({ message: str() })) },
      },
    },

    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Exchange credentials for a session",
        requestBody: body(obj({ email: str(), password: str() }, ["email", "password"])),
        responses: {
          200: response("Signed in", ref("Session")),
          401: errors[401],
          403: response("Email not yet verified", ref("Error")),
          429: response(
            "Sign-in is paused for this account after too many wrong passwords in a row. Retry-After says for how long",
            ref("Error")
          ),
        },
      },
    },

    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Exchange a refresh token for a new session",
        description:
          "The presented token is revoked and replaced, so a stolen token is usable at most once.",
        requestBody: body(obj({ refreshToken: str() }, ["refreshToken"])),
        responses: { 200: response("Refreshed", ref("Session")), 401: errors[401] },
      },
    },

    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke one session",
        requestBody: body(obj({ refreshToken: str() }, ["refreshToken"])),
        responses: { 200: response("Logged out", obj({ message: str() })) },
      },
    },

    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Email a password-reset code",
        requestBody: body(obj({ email: str() }, ["email"])),
        responses: { 200: response("Accepted", obj({ message: str() })) },
      },
    },

    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Complete a password reset",
        description: "Revokes every existing session for the account.",
        requestBody: body(
          obj({ email: str(), code: str(), newPassword: { type: "string", minLength: 8 } }, [
            "email",
            "code",
            "newPassword",
          ])
        ),
        responses: { 200: response("Reset", obj({ message: str() })), 400: errors[400] },
      },
    },

    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "The current user with freshly resolved access",
        ...secured(),
        responses: {
          200: response(
            "Current user",
            obj({
              user: ref("User"),
              roles: arr(obj({ id: int(), name: str() })),
              permissions: arr(str()),
              unavailableFeatures: arr(ref("UnavailableFeature")),
              publicFeatures: arr(str()),
            })
          ),
          401: errors[401],
        },
      },
    },

    "/roles": {
      get: {
        tags: ["Roles"],
        summary: "List roles with their permissions",
        ...secured("role:view"),
        responses: { 200: response("Roles", obj({ roles: arr(ref("Role")) })), 403: errors[403] },
      },
      post: {
        tags: ["Roles"],
        summary: "Create a role",
        description:
          "Bounded by the escalation guard: a caller may only grant permissions they already hold themselves.",
        ...secured("role:create"),
        requestBody: body(
          obj({ name: str(), description: str(), permissions: arr(str()) }, ["name"])
        ),
        responses: {
          201: response("Created", obj({ message: str(), role: ref("Role") })),
          400: errors[400],
          403: response("Attempted to grant a permission the caller lacks", ref("Error")),
          409: errors[409],
        },
      },
    },

    "/roles/permissions": {
      get: {
        tags: ["Roles"],
        summary: "The catalogue, annotated with what this caller may grant",
        description:
          "Lets the role editor disable un-grantable permissions rather than failing on save.",
        ...secured("role:view"),
        responses: {
          200: response("Catalogue", obj({ permissions: arr(ref("Permission")) })),
          403: errors[403],
        },
      },
    },

    "/roles/{id}": {
      get: {
        tags: ["Roles"],
        summary: "Fetch one role",
        ...secured("role:view"),
        parameters: [pathParam("id", "Role id")],
        responses: { 200: response("Role", obj({ role: ref("Role") })), 404: errors[404] },
      },
      patch: {
        tags: ["Roles"],
        summary: "Update a role",
        description:
          "The escalation guard applies to what the role already holds as well as to what is being added. System roles cannot be modified.",
        ...secured("role:update"),
        parameters: [pathParam("id", "Role id")],
        requestBody: body(obj({ name: str(), description: str(), permissions: arr(str()) }), false),
        responses: {
          200: response("Updated", obj({ message: str(), role: ref("Role") })),
          403: errors[403],
          404: errors[404],
          409: errors[409],
        },
      },
      delete: {
        tags: ["Roles"],
        summary: "Delete a role",
        description: "System roles and the default registration role cannot be deleted.",
        ...secured("role:delete"),
        parameters: [pathParam("id", "Role id")],
        responses: {
          200: response("Deleted", obj({ message: str() })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/users": {
      get: {
        tags: ["Users"],
        summary: "Paginated user directory",
        ...secured("user:view"),
        parameters: [
          queryParam("page", "1-based page number", "integer"),
          queryParam("limit", "Page size, max 100", "integer"),
          queryParam("search", "Matches name or email"),
          queryParam("roleId", "Only users holding this role", "integer"),
          { ...queryParam("status", "restricted, or active for every account that is not"), schema: { type: "string", enum: ["restricted", "active"] } },
        ],
        responses: {
          200: response(
            "Users",
            obj({ users: arr(ref("User")), pagination: ref("Pagination") })
          ),
          403: errors[403],
        },
      },
    },

    "/users/restrict": {
      post: {
        tags: ["Users"],
        summary: "Restrict several accounts at once",
        description:
          "Each is restricted as if one at a time, under the same guards; one refused does not stop the rest. " +
          "The answer says which were done and why the others were not.",
        ...secured("user:restrict"),
        requestBody: body(obj({ userIds: arr(int()), reason: str() }, ["userIds", "reason"])),
        responses: { 200: response("What happened to each", ref("BulkOutcome")), 400: errors[400], 403: errors[403] },
      },
    },

    "/users/lift-restriction": {
      post: {
        tags: ["Users"],
        summary: "Lift the restriction on several accounts at once",
        ...secured("user:restrict"),
        requestBody: body(obj({ userIds: arr(int()), note: str("Optional") }, ["userIds"])),
        responses: { 200: response("What happened to each", ref("BulkOutcome")), 400: errors[400], 403: errors[403] },
      },
    },

    "/users/{id}/profile": {
      get: {
        tags: ["Users"],
        summary: "Someone's profile — what the caller may see of it",
        description:
          "Anyone signed in gets the name and roles. The account itself, and whoever holds user:view, gets the " +
          "rest: email, date of birth, the national ID's last four, when they joined and last signed in, and " +
          "whether anything stops them. Only user:view holders get the restriction history.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id", "User id")],
        responses: { 200: response("The profile", obj({ profile: ref("Profile") })), 401: errors[401], 404: errors[404] },
      },
    },

    "/users/{id}/restrict": {
      post: {
        tags: ["Users"],
        summary: "Restrict an account until someone lifts it",
        description: [
          "It is signed out everywhere at once and cannot sign in, refresh a session, verify its email or pass",
          "the subscription check until the restriction is lifted. Guards: nobody restricts their own account,",
          "a super admin's account cannot be restricted, and an account holding a permission the caller lacks",
          "(beyond what every new account gets) can only be restricted by someone who holds it too.",
        ].join(" "),
        ...secured("user:restrict"),
        parameters: [pathParam("id", "User id")],
        requestBody: body(obj({ reason: str("Up to 500 characters") }, ["reason"])),
        responses: {
          201: response("Restricted", obj({ restriction: ref("AccountRestriction") })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
          409: response("Already restricted", ref("Error")),
        },
      },
    },

    "/users/{id}/lift-restriction": {
      post: {
        tags: ["Users"],
        summary: "Lift an account's restriction",
        description: "Under the same guards as restricting. It can sign in again straight away.",
        ...secured("user:restrict"),
        parameters: [pathParam("id", "User id")],
        requestBody: body(obj({ note: str("Optional, up to 500 characters") }), false),
        responses: {
          200: response("Lifted", obj({ lifted: bool() })),
          403: errors[403],
          404: errors[404],
          409: response("Not restricted", ref("Error")),
        },
      },
    },

    "/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Fetch one user",
        ...secured("user:view"),
        parameters: [pathParam("id", "User id")],
        responses: { 200: response("User", obj({ user: ref("User") })), 404: errors[404] },
      },
    },

    "/users/{id}/roles": {
      put: {
        tags: ["Users"],
        summary: "Replace the roles a user holds",
        description: [
          "Guards: nobody may change their own roles; the escalation guard applies to",
          "every role added *and* removed; and the last super admin cannot be demoted.",
        ].join(" "),
        ...secured("user:manage_roles"),
        parameters: [pathParam("id", "User id")],
        requestBody: body(obj({ roleIds: arr(int()) }, ["roleIds"])),
        responses: {
          200: response("Updated", obj({ message: str(), user: ref("User") })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/settings": {
      get: {
        tags: ["Settings"],
        summary: "The settings catalogue with current values",
        ...secured("setting:view"),
        responses: {
          200: response("Settings", obj({ settings: arr(ref("Setting")) })),
          403: errors[403],
        },
      },
    },

    "/settings/{key}": {
      put: {
        tags: ["Settings"],
        summary: "Change one setting",
        description: "Validated against the declared type and bounds, and audited.",
        ...secured("setting:manage"),
        parameters: [pathParam("key", "Setting key", "string")],
        requestBody: body(obj({ value: {} }, ["value"])),
        responses: {
          200: response("Updated", obj({ message: str(), setting: ref("Setting") })),
          400: errors[400],
          403: errors[403],
        },
      },
    },

    "/features": {
      get: {
        tags: ["Features"],
        summary: "Every feature with its switch, and the roles one can be switched off for",
        description: "Super admin only. A feature with no switch stored is on.",
        security: [{ bearerAuth: [] }],
        "x-required-permissions": [],
        "x-super-admin-only": true,
        responses: {
          200: response(
            "Features",
            obj({ features: arr(ref("FeatureSwitch")), roles: arr(obj({ id: int(), name: str() })) })
          ),
          403: errors[403],
        },
      },
    },

    "/features/people": {
      get: {
        tags: ["Features"],
        summary: "People to switch a feature off for, by name or email (at most 20)",
        security: [{ bearerAuth: [] }],
        "x-required-permissions": [],
        "x-super-admin-only": true,
        parameters: [queryParam("search", "Part of a name or email")],
        responses: {
          200: response("People", obj({ people: arr(obj({ id: int(), fullName: str(), email: str() })) })),
          403: errors[403],
        },
      },
    },

    "/features/{key}": {
      put: {
        tags: ["Features"],
        summary: "Switch a feature on, off for everyone, or off for chosen users and roles",
        description: [
          "Super admin only, and it applies to the super admin too. off_some needs at least one user or role.",
          "The message is shown to the people it is off for, and cleared when it is switched on. Audited.",
        ].join("\n"),
        security: [{ bearerAuth: [] }],
        "x-required-permissions": [],
        "x-super-admin-only": true,
        parameters: [pathParam("key", `One of: ${FEATURE_KEYS.join(", ")}`, "string")],
        requestBody: body(
          obj(
            {
              state: { type: "string", enum: Object.values(SWITCH_STATES) },
              message: { ...str("At most 300 characters"), nullable: true },
              userIds: arr(int()),
              roleIds: arr(int()),
            },
            ["state"]
          )
        ),
        responses: {
          200: response("Switched", obj({ message: str(), feature: ref("FeatureSwitch") })),
          400: errors[400],
          403: errors[403],
          404: response("No feature by that name (Settings has none)", ref("Error")),
        },
      },
    },

    "/allocation/meta": {
      get: {
        tags: ["Seat allocation"],
        summary: "What there is to filter by, and how much data there is",
        ...secured("allocation:view"),
        responses: {
          200: response(
            "Trains, stations and classes, with totals",
            obj({
              trains: arr(obj({ number: int(), name: str(), hasStops: bool() })),
              stations: arr(str()),
              classes: arr(str()),
              totals: obj({
                trains: int(),
                trainsWithStops: int(),
                pairs: int(),
                allocated: int(),
                notAllocated: int(),
                classes: int(),
                counted: int(),
              }),
              updatedAt: { type: "string", format: "date-time", nullable: true },
              latest: obj({
                stops: {
                  type: "object",
                  nullable: true,
                  description: "The routes: { at, by, fileName, summary } — by and fileName null for data applied before uploads were recorded",
                },
                census: {
                  type: "object",
                  nullable: true,
                  description: "The census: as stops, plus scannedFrom and scannedTo, when the railway was checked",
                },
                counts: { type: "object", nullable: true, description: "The last count set: { at, by }, by the counts sheet or by hand" },
              }),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/public/allocation/status": {
      get: {
        tags: ["Public seat allocation"],
        summary: "Whether the public page is open, and the bot check's site key",
        security: [],
        responses: { 200: response("Status", obj({ enabled: bool(), botCheck: { ...obj({ siteKey: str() }), nullable: true } })) },
      },
    },

    "/public/allocation/meta": {
      get: {
        tags: ["Public seat allocation"],
        summary: "The filters, and how current the data is — no sign-in",
        description: [
          "Headers: x-sp-visitor (a random id the browser keeps), x-sp-referrer (the page the visitor came from).",
          "Reached through the web app's server, which adds the visitor's address and, with PUBLIC_EDGE_SECRET set,",
          "a secret; without the secret such requests are refused (REFUSED). Recorded in public_visits and the audit log.",
        ].join("\n"),
        security: [],
        responses: {
          200: response(
            "Filters and freshness",
            obj({
              trains: arr(obj({ number: int(), name: str() })),
              stations: arr(str()),
              classes: arr(str()),
              totals: obj({ trains: int(), pairs: int(), allocated: int() }),
              lastUpdated: { type: "string", format: "date-time", nullable: true },
              railwayChecked: { ...obj({ from: str(), to: str() }), nullable: true },
              enabled: bool(),
              botCheck: { ...obj({ siteKey: str() }), nullable: true },
              signedIn: bool(),
            })
          ),
          403: response("REFUSED: not through the web app", ref("Error")),
          404: response("PUBLIC_OFF: not open to the public", ref("Error")),
          429: response("RATE_LIMITED, with Retry-After", ref("Error")),
        },
      },
    },

    "/public/allocation": {
      get: {
        tags: ["Public seat allocation"],
        summary: "A search — the same answer as GET /allocation, without where pairs came from",
        description: [
          "Needs x-sp-visitor, and x-sp-pass (from POST /public/allocation/pass) when the bot check is on.",
          "Without a sign-in, a visitor has the free searches of the day set in Settings (different from, to, train,",
          "class; paging and the opening view do not count), per browser and per address; then SIGN_IN_REQUIRED.",
          "Signed in (Authorization: Bearer), searches are unlimited.",
        ].join("\n"),
        security: [],
        parameters: [
          queryParam("from", "Boarding station"),
          queryParam("to", "Destination"),
          queryParam("train", "Train number", "integer"),
          queryParam("class", "Class code"),
          queryParam("show", "allocated (default) or all"),
          queryParam("page", "From 1", "integer"),
          queryParam("pageSize", "1 to 1000", "integer"),
        ],
        responses: {
          200: response(
            "Pairs",
            obj({ items: arr(ref("AllocationPair")), total: int(), page: int(), pageSize: int(), summary: ref("AllocationSummary") })
          ),
          400: response("No visitor id, or a bad filter", ref("Error")),
          403: response("SIGN_IN_REQUIRED (details.freeSearches), BOT_CHECK (details.siteKey) or REFUSED", ref("Error")),
          404: response("PUBLIC_OFF", ref("Error")),
          429: response("RATE_LIMITED, with Retry-After", ref("Error")),
        },
      },
    },

    "/public/allocation/pass": {
      post: {
        tags: ["Public seat allocation"],
        summary: "Trade a Cloudflare Turnstile token for a pass lasting an hour",
        security: [],
        requestBody: body(obj({ token: str("Turnstile's answer") }, ["token"])),
        responses: {
          200: response(
            "The pass (null when no bot check is set up)",
            obj({ required: bool(), pass: { ...str(), nullable: true }, expiresAt: { type: "string", format: "date-time", nullable: true } })
          ),
          403: response("BOT_CHECK: the token did not pass", ref("Error")),
        },
      },
    },

    "/allocation/public-visits": {
      get: {
        tags: ["Seat allocation"],
        summary: "How the public page is used: totals, most searched journeys, where from, the latest visits",
        ...secured("allocation:requests"),
        responses: { 200: response("Visits", { type: "object" }), 403: errors[403] },
      },
    },

    "/allocation/requests": {
      get: {
        tags: ["Seat allocation"],
        summary: "Who looks at the seat allocation, and for what: requests grouped and counted",
        description: [
          "The requests from the public page (channel public) and the searches made in the app (channel app),",
          "within a span of Dhaka days, grouped by one or two fields and counted: requests, people (signed in),",
          "visitors (browsers), and the searches that found nothing. Searches only, unless all=1. With the",
          "totals, the counts over time (by hour over a day or two, by day up to three months, by week beyond),",
          "the latest 50 requests that match, and — for days whose requests are gone — the daily totals kept.",
          "",
          "Fields: channel, signedIn, person, role, visitor, ip, journey, station, from, to, train, class, show, search, outcome, found, kind, country, city, device, browser, os, language, site, hour, weekday, day, week, month.",
        ].join("\n"),
        ...secured("allocation:requests"),
        parameters: [
          queryParam("by", "One or two fields, comma-separated (channel by default), such as train,outcome"),
          queryParam("w", "A filter, field:value — repeat it for more; field: alone means none (not signed in…)"),
          queryParam("since", "First day, YYYY-MM-DD (30 days back by default)"),
          queryParam("until", "Last day, YYYY-MM-DD (today by default)"),
          queryParam("all", "1 to count every request — page opens and bot checks too — not only searches"),
        ],
        responses: {
          200: response(
            "The analysis",
            obj({
              totals: obj({ requests: int(), people: int(), visitors: int(), nothing: int(), public: int(), app: int() }),
              groups: arr(
                obj({
                  values: arr(str("A field's value, as a filter takes it; null for none")),
                  labels: arr(str("The same, for people to read")),
                  requests: int(),
                  people: int(),
                  visitors: int(),
                  nothing: int("Searches shown that found nothing"),
                  lastAt: { type: "string", format: "date-time" },
                })
              ),
              truncated: bool("More than 500 groups: the rest left out"),
              series: obj({ size: str("hour, day or week"), points: arr({ type: "object" }) }),
              latest: arr({ type: "object" }),
              dimensions: arr(obj({ key: str(), group: str(), label: str() })),
            })
          ),
          400: errors[400],
          403: errors[403],
        },
      },
    },

    "/allocation/requests.csv": {
      get: {
        tags: ["Seat allocation"],
        summary: "The same groups as a spreadsheet",
        ...secured("allocation:requests"),
        parameters: [
          queryParam("by", "As for /allocation/requests"),
          queryParam("w", "As for /allocation/requests"),
          queryParam("since", "As for /allocation/requests"),
          queryParam("until", "As for /allocation/requests"),
          queryParam("all", "As for /allocation/requests"),
        ],
        responses: {
          200: { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } },
          400: errors[400],
          403: errors[403],
        },
      },
    },

    "/allocation/requests/today": {
      get: {
        tags: ["Seat allocation"],
        summary: "Today's searches, on the public page and in the app",
        ...secured("allocation:requests"),
        responses: { 200: response("Today", obj({ searches: int(), people: int(), visitors: int() })), 403: errors[403] },
      },
    },

    "/allocation/uploads": {
      get: {
        tags: ["Seat allocation"],
        summary: "Every file applied, newest first",
        ...secured("allocation:view"),
        parameters: [queryParam("limit", "1 to 100; 20 by default", "integer")],
        responses: {
          200: response("Uploads", obj({ uploads: arr(ref("AllocationUpload")) })),
          403: errors[403],
        },
      },
    },

    "/allocation": {
      get: {
        tags: ["Seat allocation"],
        summary: "The pairs that match: any of from, to, train and class",
        description: [
          "Each filter left out means all. From and to together: the trains with seats on that journey; from",
          "alone: everywhere a train with seats goes from there; a train alone: its pairs in route order, with",
          "its route. Only allocated pairs unless show=all, which adds pairs found not allocated and — from the",
          "uploaded routes — the pairs nobody has checked. The summary covers every match, not just the page.",
          "Each search is recorded as a request (channel app; see /allocation/requests).",
        ].join("\n"),
        ...secured("allocation:view"),
        parameters: [
          queryParam("from", "Boarding station"),
          queryParam("to", "Destination"),
          queryParam("train", "Train number", "integer"),
          queryParam("class", "Class code"),
          queryParam("show", "allocated (default) or all"),
          queryParam("page", "From 1", "integer"),
          queryParam("pageSize", "1 to 1000; 50 by default", "integer"),
        ],
        responses: {
          200: response(
            "Pairs",
            obj({
              items: arr(ref("AllocationPair")),
              total: int(),
              page: int(),
              pageSize: int(),
              summary: ref("AllocationSummary"),
              route: { ...arr(str()), nullable: true, description: "With train: its stations in order, if uploaded" },
            })
          ),
          403: errors[403],
        },
      },
    },

    "/allocation/counts.csv": {
      get: {
        tags: ["Seat allocation"],
        summary: "The counts sheet: one line per allocated class, for the same filters",
        description: "Columns train, train_name, from, to, class, seats — seats blank where the count is not known. Fill it in and upload it back.",
        ...secured("allocation:view"),
        parameters: [queryParam("from", "Boarding station"), queryParam("to", "Destination"), queryParam("train", "Train number", "integer"), queryParam("class", "Class code")],
        responses: {
          200: { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } },
          403: errors[403],
        },
      },
    },

    "/allocation/import/{kind}": {
      post: {
        tags: ["Seat allocation"],
        summary: "Upload a file: read it, and with ?apply=1 apply it",
        description: [
          "The file is the request body, sent as text/plain (it may be several megabytes). kind:",
          "- stops: train-stoppages.json, each train's stations in order. Trains not in the file are left alone.",
          "- census: the census CSV (From, To, Result, Trains with seats (classes), Trains on the route, Scanned at).",
          "  Pairs in the file replace what is stored for them; the rest are left alone. A class still allocated keeps",
          "  its count; one no longer allocated goes. Failed scans, and Allocated without the trains named, are left out.",
          "- counts: the counts sheet. Only classes already allocated take a count; blank means not known.",
          "Without apply nothing changes: the preview says what applying would do, and what is left out and why.",
        ].join("\n"),
        ...secured("allocation:manage"),
        parameters: [
          pathParam("kind", "stops, census or counts", "string"),
          queryParam("apply", "1 to apply; otherwise only read"),
          queryParam("name", "The file's name, kept in the upload history"),
        ],
        requestBody: { required: true, content: { "text/plain": { schema: { type: "string" } } } },
        responses: {
          200: response(
            "Read, or applied",
            obj({ message: str(), applied: bool(), preview: { type: "object", description: "What the file holds and does" } })
          ),
          400: errors[400],
          403: errors[403],
        },
      },
    },

    "/allocation/pairs": {
      put: {
        tags: ["Seat allocation"],
        summary: "Set one train's pair by hand: allocated with its classes and counts, or not allocated",
        ...secured("allocation:manage"),
        requestBody: body(
          obj(
            {
              train: int(),
              from: str(),
              to: str(),
              status: { type: "string", enum: ["allocated", "not_allocated"] },
              classes: arr(ref("AllocationClass")),
            },
            ["train", "from", "to", "status"]
          )
        ),
        responses: {
          200: response("Saved", obj({ message: str(), pair: ref("AllocationPair") })),
          400: response("Not on the train's route in that order, or a class or count that is not one", ref("Error")),
          403: errors[403],
          404: errors[404],
        },
      },
      delete: {
        tags: ["Seat allocation"],
        summary: "Forget a pair: back to not checked",
        ...secured("allocation:manage"),
        parameters: [
          { name: "train", in: "query", required: true, schema: { type: "integer" } },
          { name: "from", in: "query", required: true, schema: { type: "string" } },
          { name: "to", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { 200: response("Forgotten", obj({ message: str() })), 403: errors[403], 404: errors[404] },
      },
    },

    "/stations": {
      get: {
        tags: ["Network"],
        summary: "List stations",
        ...secured("network:view"),
        parameters: [
          queryParam("search", "Matches name, code or district"),
          queryParam("includeInactive", "Include retired stations", "boolean"),
        ],
        responses: {
          200: response("Stations", obj({ stations: arr(ref("Station")) })),
          403: errors[403],
        },
      },
      post: {
        tags: ["Network"],
        summary: "Create a station",
        ...secured("station:manage"),
        requestBody: body(obj({ code: str(), name: str(), district: str() }, ["code", "name"])),
        responses: {
          201: response("Created", obj({ message: str(), station: ref("Station") })),
          409: errors[409],
        },
      },
    },

    "/stations/{id}": {
      get: {
        tags: ["Network"],
        summary: "Fetch one station",
        ...secured("network:view"),
        parameters: [pathParam("id", "Station id")],
        responses: { 200: response("Station", obj({ station: ref("Station") })), 404: errors[404] },
      },
      patch: {
        tags: ["Network"],
        summary: "Update a station",
        ...secured("station:manage"),
        parameters: [pathParam("id", "Station id")],
        requestBody: body(obj({ code: str(), name: str(), district: str(), isActive: bool() }), false),
        responses: {
          200: response("Updated", obj({ message: str(), station: ref("Station") })),
          404: errors[404],
          409: errors[409],
        },
      },
      delete: {
        tags: ["Network"],
        summary: "Delete a station",
        description:
          "Refused once a route stop or fare entry references it — retire it with `isActive: false` instead.",
        ...secured("station:manage"),
        parameters: [pathParam("id", "Station id")],
        responses: {
          200: response("Deleted", obj({ message: str() })),
          404: errors[404],
          409: response("Still referenced", ref("Error")),
        },
      },
    },

    "/trains": {
      get: {
        tags: ["Network"],
        summary: "List trains with route summaries",
        ...secured("network:view"),
        parameters: [
          queryParam("search", "Matches name or code"),
          queryParam("includeInactive", "Include inactive trains", "boolean"),
        ],
        responses: {
          200: response("Trains", obj({ trains: arr(ref("Train")) })),
          403: errors[403],
        },
      },
      post: {
        tags: ["Network"],
        summary: "Create a train",
        ...secured("train:manage"),
        requestBody: body(
          obj({ name: str(), code: str(), upCode: str(), downCode: str(), notes: str() }, ["name"])
        ),
        responses: {
          201: response("Created", obj({ message: str(), train: ref("Train") })),
          409: errors[409],
        },
      },
    },

    "/trains/{id}": {
      get: {
        tags: ["Network"],
        summary: "Fetch a train with its full route and segments",
        ...secured("network:view"),
        parameters: [pathParam("id", "Train id")],
        responses: { 200: response("Train", obj({ train: ref("Train") })), 404: errors[404] },
      },
      patch: {
        tags: ["Network"],
        summary: "Update a train's identity",
        ...secured("train:manage"),
        parameters: [pathParam("id", "Train id")],
        requestBody: body(
          obj({ name: str(), code: str(), upCode: str(), downCode: str(), notes: str(), isActive: bool() }),
          false
        ),
        responses: { 200: response("Updated", obj({ message: str(), train: ref("Train") })), 404: errors[404] },
      },
      delete: {
        tags: ["Network"],
        summary: "Delete a train",
        description: "Refused while seat plans reference it.",
        ...secured("train:manage"),
        parameters: [pathParam("id", "Train id")],
        responses: { 200: response("Deleted", obj({ message: str() })), 409: errors[409] },
      },
    },

    "/trains/{id}/route": {
      put: {
        tags: ["Network"],
        summary: "Replace a train's route",
        description: [
          "The route is replaced as a whole, because a sequence is only coherent as a set.",
          "Rejected unless times move forward once day offsets are folded in, distances",
          "increase from zero at the origin, and no station repeats. Runs in a transaction,",
          "so a rejected route leaves the existing one intact.",
        ].join(" "),
        ...secured("route:manage"),
        parameters: [pathParam("id", "Train id")],
        requestBody: body(
          obj(
            {
              stops: arr(
                obj(
                  {
                    stationId: int(),
                    arrivalTime: str("HH:MM"),
                    departureTime: str("HH:MM"),
                    dayOffset: int("1 for a stop reached after midnight"),
                    distanceKm: { type: "number" },
                    haltMinutes: int(),
                  },
                  ["stationId"]
                )
              ),
            },
            ["stops"]
          )
        ),
        responses: {
          200: response("Route saved", obj({ message: str(), train: ref("Train") })),
          400: response("The route is not coherent — the message lists every problem", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/fares/rules": {
      get: {
        tags: ["Network"],
        summary: "List fare rules in priority order",
        ...secured("network:view"),
        parameters: [
          queryParam("trainId", "Rules for this train plus global ones", "integer"),
          queryParam("coachClassId", "Rules for this class", "integer"),
        ],
        responses: { 200: response("Rules", obj({ rules: arr(ref("FareRule")) })), 403: errors[403] },
      },
      post: {
        tags: ["Network"],
        summary: "Create a fare rule",
        ...secured("fare:manage"),
        requestBody: body(
          obj(
            {
              name: str(),
              kind: { type: "string", enum: ["table", "distance"] },
              coachClassId: int(),
              trainId: int("Omit for a rule covering every train"),
              priority: int(),
              ratePerKm: { type: "number" },
              minFare: { type: "number" },
            },
            ["name", "kind", "coachClassId"]
          )
        ),
        responses: {
          201: response("Created", obj({ message: str(), rule: ref("FareRule") })),
          400: errors[400],
        },
      },
    },

    "/fares/rules/{id}": {
      patch: {
        tags: ["Network"],
        summary: "Update a fare rule",
        ...secured("fare:manage"),
        parameters: [pathParam("id", "Fare rule id")],
        requestBody: body(obj({ name: str(), priority: int(), ratePerKm: {}, minFare: {}, isActive: bool() }), false),
        responses: { 200: response("Updated", obj({ message: str(), rule: ref("FareRule") })), 404: errors[404] },
      },
      delete: {
        tags: ["Network"],
        summary: "Delete a fare rule",
        ...secured("fare:manage"),
        parameters: [pathParam("id", "Fare rule id")],
        responses: { 200: response("Deleted", obj({ message: str() })), 404: errors[404] },
      },
    },

    "/fares/rules/{id}/table": {
      put: {
        tags: ["Network"],
        summary: "Replace the price table of a table rule",
        ...secured("fare:manage"),
        parameters: [pathParam("id", "Fare rule id")],
        requestBody: body(
          obj(
            {
              entries: arr(
                obj({ fromStationId: int(), toStationId: int(), amount: { type: "number" } }, [
                  "fromStationId",
                  "toStationId",
                  "amount",
                ])
              ),
            },
            ["entries"]
          )
        ),
        responses: {
          200: response("Saved", obj({ message: str(), rule: ref("FareRule") })),
          400: errors[400],
        },
      },
    },

    "/fares/quote": {
      get: {
        tags: ["Network"],
        summary: "Price one journey",
        description:
          "Walks the rule chain and returns the first amount produced, along with the rule that produced it.",
        ...secured("network:view"),
        parameters: [
          queryParam("trainId", "Train", "integer"),
          queryParam("coachClassId", "Coach class", "integer"),
          queryParam("fromStationId", "Origin", "integer"),
          queryParam("toStationId", "Destination", "integer"),
        ],
        responses: {
          200: response("Fare", obj({ fare: ref("Fare") })),
          400: response("Stations are not on the route, or no rule covers the pair", ref("Error")),
        },
      },
    },

    "/fares/matrix": {
      get: {
        tags: ["Network"],
        summary: "Price every forward station pair on a train",
        description: "Shows which pairs a table covers and which fall through to the fallback rule.",
        ...secured("network:view"),
        parameters: [
          queryParam("trainId", "Train", "integer"),
          queryParam("coachClassId", "Coach class", "integer"),
        ],
        responses: {
          200: response(
            "Matrix",
            obj({ stops: arr(ref("RouteStop")), pairs: arr(ref("Fare")) })
          ),
          400: errors[400],
        },
      },
    },

    "/trains/{id}/composition": {
      get: {
        tags: ["Departures"],
        summary: "A train's default coach line-up",
        ...secured("network:view"),
        parameters: [pathParam("id", "Train id")],
        responses: { 200: response("Composition", obj({ coaches: arr(ref("TrainCoach")) })), 404: errors[404] },
      },
      put: {
        tags: ["Departures"],
        summary: "Replace the default composition",
        description:
          "Wholesale, like the route: positions renumber when a coach is inserted, and the line-up only means anything in order. Each generated departure copies this, so changing it never alters departures already built.",
        ...secured("composition:manage"),
        parameters: [pathParam("id", "Train id")],
        requestBody: body(
          obj(
            { coaches: arr(obj({ coachCode: str(), seatPlanId: int() }, ["coachCode", "seatPlanId"])) },
            ["coaches"]
          )
        ),
        responses: {
          200: response("Saved", obj({ message: str(), coaches: arr(ref("TrainCoach")) })),
          400: errors[400],
        },
      },
    },

    "/trains/{id}/schedule": {
      get: {
        tags: ["Departures"],
        summary: "Which days a train runs",
        ...secured("network:view"),
        parameters: [pathParam("id", "Train id")],
        responses: { 200: response("Schedules", obj({ schedules: arr(ref("TrainSchedule")) })) },
      },
      put: {
        tags: ["Departures"],
        summary: "Replace a train's schedules",
        description:
          "A list with effective dates rather than one weekday set, so a timetable change is a new period instead of an edit that rewrites what the train used to do.",
        ...secured("schedule:manage"),
        parameters: [pathParam("id", "Train id")],
        requestBody: body(
          obj(
            {
              schedules: arr(
                obj({ runsOn: arr(int()), effectiveFrom: str(), effectiveTo: str(), isActive: bool() }, [
                  "runsOn",
                ])
              ),
            },
            ["schedules"]
          )
        ),
        responses: { 200: response("Saved", obj({ message: str(), schedules: arr(ref("TrainSchedule")) })), 400: errors[400] },
      },
    },

    "/trips": {
      get: {
        tags: ["Departures"],
        summary: "List departures",
        ...secured("trip:view"),
        parameters: [
          queryParam("trainId", "One train only", "integer"),
          queryParam("from", "From this date (defaults to today in Dhaka)"),
          queryParam("to", "Up to this date"),
          queryParam("status", "scheduled | cancelled | departed | completed"),
          queryParam("limit", "Max rows, capped at 500", "integer"),
        ],
        responses: { 200: response("Departures", obj({ trips: arr(ref("Trip")) })), 403: errors[403] },
      },
    },

    "/trips/generate": {
      post: {
        tags: ["Departures"],
        summary: "Extend the rolling horizon",
        description:
          "Idempotent: the unique constraint on (train, departure date) means a repeat run finds existing departures rather than duplicating them. Seats are materialised only from **approved** seat plans; skipped coaches are reported rather than silently dropped.",
        ...secured("trip:manage"),
        requestBody: body(
          obj({ days: int("Defaults to the trip.horizon_days setting"), trainId: int("One train only") }),
          false
        ),
        responses: {
          200: response("Report", obj({ message: str(), report: ref("GenerationReport") })),
          403: errors[403],
        },
      },
    },

    "/trips/jobs": {
      get: {
        tags: ["Departures"],
        summary: "Background job status",
        ...secured("trip:view"),
        responses: {
          200: response(
            "Jobs",
            obj({
              jobs: arr(
                obj({ name: str(), everyMinutes: int(), describe: str(), lastRun: {}, lastResult: {} })
              ),
            })
          ),
        },
      },
    },

    "/trips/{id}": {
      get: {
        tags: ["Departures"],
        summary: "One departure with its coaches and route",
        ...secured("trip:view"),
        parameters: [pathParam("id", "Trip id")],
        responses: { 200: response("Departure", obj({ trip: ref("Trip") })), 404: errors[404] },
      },
    },

    "/trips/{id}/seats": {
      get: {
        tags: ["Departures"],
        summary: "Every seat on a departure",
        description:
          "The flattened rows Phase 4 will sell against — one per physical seat, with its grid position and features.",
        ...secured("trip:view"),
        parameters: [pathParam("id", "Trip id"), queryParam("tripCoachId", "One coach only", "integer")],
        responses: { 200: response("Seats", obj({ seats: arr(ref("TripSeat")) })), 404: errors[404] },
      },
    },

    "/trips/{id}/rebuild": {
      post: {
        tags: ["Departures"],
        summary: "Rebuild a departure from the current composition",
        description:
          "Destroys and re-materialises coaches and seats. Safe only while nothing has been sold — Phase 5 adds the guard that refuses once tickets exist.",
        ...secured("trip:manage"),
        parameters: [pathParam("id", "Trip id")],
        responses: {
          200: response("Rebuilt", obj({ message: str(), trip: ref("Trip") })),
          400: response("The departure is cancelled", ref("Error")),
        },
      },
    },

    "/trips/{id}/cancel": {
      post: {
        tags: ["Departures"],
        summary: "Cancel a departure, refunding everyone aboard",
        description: [
          "Takes the departure off the board and queues a durable job that refunds every",
          "ticket on it in full — in the same transaction, so it is never cancelled without",
          "its refunds owed. The job survives a restart part-way through and resumes with",
          "the passengers not yet paid; each passenger's message is its own job, written",
          "with their refund. The request waits up to `jobs.inline_wait_seconds` for the",
          "refunds: **200** with what was refunded when they finish in that time, **202**",
          "with the job when they are still running.",
        ].join(" "),
        ...secured("trip:cancel"),
        parameters: [pathParam("id", "Trip id")],
        requestBody: body(obj({ reason: str() }), false),
        responses: {
          200: response(
            "Cancelled, and everyone refunded",
            obj({
              message: str(),
              trip: {
                allOf: [
                  ref("Trip"),
                  obj({
                    job: ref("Job"),
                    refunds: obj({
                      refunded: int(),
                      paidMinor: int(),
                      paidFormatted: str(),
                      refunds: arr(obj({ reference: str(), ticketNumber: str(), refundMinor: int(), userId: int() })),
                    }),
                  }),
                ],
              },
            })
          ),
          202: response(
            "Cancelled; refunds still being issued in the background",
            obj({ message: str(), trip: { allOf: [ref("Trip"), obj({ job: ref("Job"), refunds: { nullable: true } })] } })
          ),
          400: response("Already cancelled", ref("Error")),
        },
      },
    },

    "/trips/{id}/availability": {
      get: {
        tags: ["Inventory"],
        summary: "Which seats can be sold between two stations",
        description: [
          "A seat is sold per **segment**, not per departure. It is available for",
          "X→Y only when every segment in between is free — which is why selling",
          "the middle of a route leaves both ends on sale.",
          "Seats withheld are counted by reason rather than silently omitted.",
        ].join(" "),
        ...secured("inventory:view"),
        parameters: [
          pathParam("id", "Departure id"),
          queryParam("fromStationId", "Origin, must be on the route", "integer"),
          queryParam("toStationId", "Destination, must come after the origin", "integer"),
          queryParam("coachClassId", "Narrow to one class", "integer"),
          queryParam("filters", 'Seat features as JSON, e.g. {"window":true,"charging_port":true}'),
        ],
        responses: {
          200: response("Availability", ref("Availability")),
          400: response("Stations not on the route, or the journey runs backwards", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/trips/{id}/availability/matrix": {
      get: {
        tags: ["Inventory"],
        summary: "Every forward station pair, with seats free on each",
        description:
          "Computed in a single pass over the departure's occupancy rather than one query per pair. This is the view that makes segment inventory visible.",
        ...secured("inventory:view"),
        parameters: [pathParam("id", "Departure id"), queryParam("coachClassId", "Narrow to one class", "integer")],
        responses: {
          200: response(
            "Matrix",
            obj({
              tripId: int(),
              departureDate: str(),
              stops: arr(obj({ sequence: int(), stationId: int(), station: ref("Station") })),
              segmentCount: int(),
              totalSeats: int(),
              classes: arr(obj({ id: int(), name: str() })),
              pairs: arr(ref("AvailabilityPair")),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/trips/{id}/seats/{seatId}/timeline": {
      get: {
        tags: ["Inventory"],
        summary: "One seat's occupancy across the whole route",
        description: "Shows why a seat is free at one end of a route and sold in the middle.",
        ...secured("inventory:view"),
        parameters: [pathParam("id", "Departure id"), pathParam("seatId", "Trip seat id")],
        responses: {
          200: response(
            "Timeline",
            obj({
              seat: ref("TripSeat"),
              quota: {},
              segments: arr(
                obj({
                  index: int(),
                  fromStationId: int(),
                  toStationId: int(),
                  occupiedBy: { type: "string", enum: ["ticket", "hold", "block", null] },
                })
              ),
            })
          ),
          404: errors[404],
        },
      },
    },

    "/trips/{id}/seats/{seatId}/block": {
      post: {
        tags: ["Inventory"],
        summary: "Take a seat out of sale",
        description:
          "Modelled as an ordinary occupation, so it obeys the same unique constraint: a seat already sold cannot be blocked out from under a passenger. Defaults to the whole route.",
        ...secured("seat:block"),
        parameters: [pathParam("id", "Departure id"), pathParam("seatId", "Trip seat id")],
        requestBody: body(obj({ fromStationId: int(), toStationId: int(), reason: str() }), false),
        responses: {
          200: response("Blocked", obj({ message: str(), reserved: int() })),
          409: response("Already sold over part of that stretch", ref("Error")),
        },
      },
      delete: {
        tags: ["Inventory"],
        summary: "Return a blocked seat to sale",
        description: "Removes block rows only — a sold seat is never freed here.",
        ...secured("seat:block"),
        parameters: [pathParam("id", "Departure id"), pathParam("seatId", "Trip seat id")],
        responses: {
          200: response("Unblocked", obj({ message: str(), released: int() })),
          400: response("That seat is not blocked", ref("Error")),
        },
      },
    },

    "/trips/{id}/quota": {
      get: {
        tags: ["Inventory"],
        summary: "Seats held back on a departure, and for which pairs",
        ...secured("inventory:view"),
        parameters: [pathParam("id", "Departure id")],
        responses: { 200: response("Quota", obj({ quota: arr({}) })) },
      },
    },

    "/trips/{id}/quota/release": {
      post: {
        tags: ["Inventory"],
        summary: "Release a departure's held seats early",
        ...secured("quota:manage"),
        parameters: [pathParam("id", "Departure id")],
        responses: { 200: response("Released", obj({ message: str(), released: int() })) },
      },
    },

    "/quota/rules": {
      get: {
        tags: ["Inventory"],
        summary: "Standing seat-distribution rules",
        ...secured("inventory:view"),
        parameters: [queryParam("trainId", "One train only", "integer")],
        responses: { 200: response("Rules", obj({ rules: arr(ref("QuotaRule")) })) },
      },
      post: {
        tags: ["Inventory"],
        summary: "Hold seats back for a station pair",
        description:
          "A held seat sells **only as exactly that pair** until it releases. Exact matching would strand inventory on its own, which is why the release is part of the rule rather than optional.",
        ...secured("quota:manage"),
        requestBody: body(
          obj(
            {
              trainId: int(),
              coachClassId: int(),
              fromStationId: int(),
              toStationId: int(),
              quantity: int(),
              releaseHoursBefore: int(),
              priority: int(),
              effectiveFrom: str(),
              effectiveTo: str(),
            },
            ["trainId", "coachClassId", "fromStationId", "toStationId", "quantity"]
          )
        ),
        responses: {
          201: response("Created", obj({ message: str(), rule: ref("QuotaRule") })),
          400: response("The pair is not on the train's route, or runs backwards", ref("Error")),
        },
      },
    },

    "/quota/rules/{id}": {
      patch: {
        tags: ["Inventory"],
        summary: "Update a quota rule",
        ...secured("quota:manage"),
        parameters: [pathParam("id", "Rule id")],
        requestBody: body(obj({ quantity: int(), releaseHoursBefore: int(), isActive: bool() }), false),
        responses: { 200: response("Updated", obj({ message: str(), rule: ref("QuotaRule") })) },
      },
      delete: {
        tags: ["Inventory"],
        summary: "Delete a quota rule",
        description:
          "Frees the seats it was holding on upcoming departures. Leaving them held would produce a reservation with nothing left to explain it.",
        ...secured("quota:manage"),
        parameters: [pathParam("id", "Rule id")],
        responses: { 200: response("Deleted", obj({ message: str(), freed: int() })) },
      },
    },

    "/quota/trains/{id}/materialise": {
      post: {
        tags: ["Inventory"],
        summary: "Apply a train's rules across its upcoming departures",
        description:
          "Rules claim seats in priority order, each taking from what earlier rules left. Hand-placed holds are never overwritten.",
        ...secured("quota:manage"),
        parameters: [pathParam("id", "Train id")],
        requestBody: body(obj({ replace: bool("Rebuild rule-made reservations from scratch") }), false),
        responses: {
          200: response("Applied", obj({ message: str(), trips: int(), assigned: int(), notes: arr(str()) })),
        },
      },
    },

    "/seat-attributes": {
      get: {
        tags: ["Network"],
        summary: "The seat attribute catalogue",
        description:
          "Auto-select builds its filters from this, so a new attribute becomes filterable as soon as it exists.",
        ...secured("network:view"),
        parameters: [queryParam("includeInactive", "Include deactivated attributes", "boolean")],
        responses: {
          200: response("Attributes", obj({ attributes: arr(ref("SeatAttribute")) })),
          403: errors[403],
        },
      },
      post: {
        tags: ["Network"],
        summary: "Add a seat attribute",
        ...secured("seat_attribute:manage"),
        requestBody: body(
          obj(
            {
              key: str("Slugified on write"),
              label: str(),
              description: str(),
              valueType: { type: "string", enum: ["boolean", "enum"] },
              options: arr(obj({ value: str(), label: str() })),
              icon: str(),
              isFilterable: bool(),
              sortOrder: int(),
            },
            ["key", "label"]
          )
        ),
        responses: {
          201: response("Created", obj({ message: str(), attribute: ref("SeatAttribute") })),
          400: errors[400],
          409: errors[409],
        },
      },
    },

    "/seat-attributes/{id}": {
      patch: {
        tags: ["Network"],
        summary: "Update a seat attribute",
        ...secured("seat_attribute:manage"),
        parameters: [pathParam("id", "Attribute id")],
        requestBody: body(obj({ label: str(), description: str(), isActive: bool(), sortOrder: int() }), false),
        responses: { 200: response("Updated", obj({ message: str(), attribute: ref("SeatAttribute") })), 404: errors[404] },
      },
      delete: {
        tags: ["Network"],
        summary: "Delete a seat attribute",
        description:
          "Seats carry attribute keys inside layout JSON, which no foreign key protects — deactivating is the safer choice.",
        ...secured("seat_attribute:manage"),
        parameters: [pathParam("id", "Attribute id")],
        responses: { 200: response("Deleted", obj({ message: str() })), 404: errors[404] },
      },
    },

    "/audit": {
      get: {
        tags: ["Audit"],
        summary: "Read the audit log, newest first",
        description:
          "Backed by MongoDB. If the document store is unavailable the endpoint returns an empty page with `available: false` rather than failing.",
        ...secured("audit:view"),
        parameters: [
          queryParam("page", "1-based page number", "integer"),
          queryParam("limit", "Page size, max 100", "integer"),
          queryParam("action", "Filter by action key"),
          queryParam("actorId", "Filter by acting user id", "integer"),
          queryParam("entityType", "Filter by entity type, e.g. role"),
          queryParam("entityId", "Filter by entity id"),
        ],
        responses: {
          200: response(
            "Events",
            obj({
              events: arr(ref("AuditEvent")),
              pagination: ref("Pagination"),
              available: bool("False when the document store is unreachable"),
              actions: arr(str("Known action keys, for a filter dropdown")),
            })
          ),
          403: errors[403],
        },
      },
    },

    /* ---------------- Wallet ---------------- */

    "/wallet": {
      get: {
        tags: ["Booking"],
        summary: "The caller's own wallet",
        description:
          "Needs no permission: a wallet belongs to whoever is holding the token. " +
          "`balanceMinor` is a cache of the ledger, which GET /wallet/verify re-proves.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: response("Wallet", obj({ wallet: ref("Wallet") })),
          401: errors[401],
        },
      },
    },

    "/wallet/transactions": {
      get: {
        tags: ["Booking"],
        summary: "The caller's own ledger, newest first",
        description: "Append-only. Entries are never edited or deleted, only added.",
        security: [{ bearerAuth: [] }],
        parameters: [
          queryParam("page", "1-based page number", "integer"),
          queryParam("limit", "Page size, max 100", "integer"),
        ],
        responses: {
          200: response(
            "Entries",
            obj({ transactions: arr(ref("WalletTransaction")), pagination: ref("Pagination") })
          ),
          401: errors[401],
        },
      },
    },

    "/wallet/verify": {
      get: {
        tags: ["Booking"],
        summary: "Re-sum the ledger and compare it to the cached balance",
        description:
          "The cached balance exists so a purchase does not have to replay every " +
          "entry. This proves the two still agree — a self-audit an operator can " +
          "run at any time, and the assertion every money test ends on.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: response(
            "Comparison",
            obj({
              walletId: int(),
              entries: int(),
              ledgerMinor: int("Re-summed from every entry"),
              cachedMinor: int("What the wallet row says"),
              consistent: bool("False means the two have drifted and must be reconciled"),
            })
          ),
          401: errors[401],
        },
      },
    },

    "/wallet/topup": {
      post: {
        tags: ["Booking"],
        summary: "Add credit through the payment gateway",
        description:
          "The gateway is simulated in this build; the ledger is not. Refused below " +
          "the configured minimum or above the balance cap.",
        security: [{ bearerAuth: [] }],
        requestBody: body(
          obj(
            {
              amount: { type: "number", description: "In taka" },
              reference: str("Gateway handle"),
            },
            ["amount"]
          )
        ),
        responses: {
          200: response(
            "Credited",
            obj({ message: str(), wallet: ref("Wallet"), transaction: ref("WalletTransaction") })
          ),
          400: response("Below the minimum, or past the balance cap", ref("Error")),
          401: errors[401],
        },
      },
    },

    "/wallet/user/{userId}": {
      get: {
        tags: ["Booking"],
        summary: "Another user's wallet and ledger",
        ...secured("wallet:view_all"),
        parameters: [
          pathParam("userId", "Whose wallet"),
          queryParam("page", "1-based page number", "integer"),
        ],
        responses: {
          200: response(
            "Wallet and entries",
            obj({
              wallet: ref("Wallet"),
              transactions: arr(ref("WalletTransaction")),
              pagination: ref("Pagination"),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/wallet/user/{userId}/adjust": {
      post: {
        tags: ["Booking"],
        summary: "Move a balance by hand",
        description:
          "Creating credit from nothing, so it is deliberately the narrowest " +
          "permission in the catalogue and the reason is mandatory — an " +
          "adjustment without one is unauditable.",
        ...secured("wallet:adjust"),
        parameters: [pathParam("userId", "Whose wallet")],
        requestBody: body(
          obj(
            {
              amount: { type: "number", description: "In taka" },
              direction: { type: "string", enum: ["credit", "debit"] },
              description: str("Why — recorded on the entry and in the audit log"),
            },
            ["amount", "direction", "description"]
          )
        ),
        responses: {
          200: response(
            "Adjusted",
            obj({ message: str(), wallet: ref("Wallet"), transaction: ref("WalletTransaction") })
          ),
          400: response("Would overdraw the wallet, or the reason is missing", ref("Error")),
          403: errors[403],
        },
      },
    },

    /* ---------------- Coaches on a departure ---------------- */

    "/trips/{id}/coaches": {
      get: {
        tags: ["Departures"],
        summary: "The coaches on a departure, and what each is carrying",
        description:
          "Each coach reports its passengers, returned-ticket history, checkouts in progress and " +
          "blocks — and what may be done with it (`canRemove`, `canCancel`, `canReinstate`), " +
          "decided here so a screen shows the right buttons rather than guessing.",
        ...secured("trip:view"),
        parameters: [{ name: "id", in: "path", required: true, schema: int() }],
        responses: {
          200: response("The coaches, in coupling order", obj({ tripId: int(), status: str(), coaches: arr(obj({})) })),
          403: errors[403],
          404: errors[404],
        },
      },
      post: {
        tags: ["Departures"],
        summary: "Add a coach",
        description: [
          "Built through the same function generation uses, so a coach added on the",
          "day sells exactly like one built at generation. Only an approved plan can be",
          "put into service. Appended by default; given a position, the coaches from",
          "there onward move back one so the coupling order has no gaps. Anyone queueing",
          "for a full departure is offered the new seats first.",
        ].join(" "),
        ...secured("trip:manage"),
        parameters: [{ name: "id", in: "path", required: true, schema: int() }],
        requestBody: body(
          obj(
            {
              seatPlanId: int("An approved plan"),
              coachCode: str("Unique on this departure, e.g. KA"),
              position: int("Where in the train. Omit to append"),
            },
            ["seatPlanId", "coachCode"]
          )
        ),
        responses: {
          201: response("Added", obj({ message: str(), coach: obj({}), seats: int(), position: int() })),
          400: response("The plan is not approved, or cannot be built", ref("Error")),
          403: errors[403],
          409: response("That code is already on this departure", ref("Error")),
        },
      },
    },

    "/trips/{id}/coaches/{coachId}": {
      delete: {
        tags: ["Departures"],
        summary: "Remove a coach nobody has used",
        description: [
          "Deletes the coach and its seats outright — so it is refused for any coach a",
          "ticket of any status, or a checkout in progress, refers to. A coach carrying",
          "passengers is pointed at cancellation instead, which refunds them. There is no",
          "normal-path way to delete seats somebody bought.",
        ].join(" "),
        ...secured("trip:manage"),
        parameters: [
          { name: "id", in: "path", required: true, schema: int() },
          { name: "coachId", in: "path", required: true, schema: int() },
        ],
        responses: {
          200: response("Removed", obj({ message: str(), removed: str(), seats: int() })),
          403: errors[403],
          404: errors[404],
          409: response("Passengers, a checkout, or ticket history refer to it", ref("Error")),
        },
      },
    },

    "/trips/{id}/coaches/{coachId}/cancel": {
      post: {
        tags: ["Departures"],
        summary: "Take a coach out of service, refunding everyone on it",
        description: [
          "Refunds every passenger on the coach in full through the same disruption path",
          "a cancelled train uses — seated tickets on its seats and standing tickets on",
          "the coach — and emails each of them the reason. Checkouts in progress on it are",
          "released. The coach is marked cancelled, not deleted, so the record of what was",
          "sold and returned survives it.",
          "Needs `trip:cancel`, not `trip:manage`: this moves money for a carriage-load of",
          "people.",
          "The refunds run as a durable job, queued in the same transaction that marks the",
          "coach cancelled; **202** with the job, and `refunded: null`, if they are still",
          "running after `jobs.inline_wait_seconds`.",
        ].join(" "),
        ...secured("trip:cancel"),
        parameters: [
          { name: "id", in: "path", required: true, schema: int() },
          { name: "coachId", in: "path", required: true, schema: int() },
        ],
        requestBody: body(obj({ reason: str("Every passenger on the coach is told this") }, ["reason"])),
        responses: {
          200: response(
            "Cancelled",
            obj({
              message: str(),
              coach: obj({}),
              job: ref("Job"),
              refunded: int(),
              paidMinor: int(),
              paidFormatted: str(),
              checkoutsReleased: int(),
            })
          ),
          202: response(
            "Cancelled; its passengers are still being refunded in the background",
            obj({ message: str(), coach: obj({}), job: ref("Job"), refunded: { nullable: true }, checkoutsReleased: int() })
          ),
          400: response("No reason given, or the departure has gone", ref("Error")),
          403: errors[403],
          409: response("It is already cancelled", ref("Error")),
        },
      },
    },

    "/trips/{id}/coaches/{coachId}/reinstate": {
      post: {
        tags: ["Departures"],
        summary: "Put a cancelled coach back into service",
        description:
          "Its seats return to sale. Its passengers stay refunded — they have their money and may " +
          "have booked something else, and quietly re-issuing their tickets would seat people who " +
          "are not coming.",
        ...secured("trip:cancel"),
        parameters: [
          { name: "id", in: "path", required: true, schema: int() },
          { name: "coachId", in: "path", required: true, schema: int() },
        ],
        requestBody: body(obj({ reason: str() }), false),
        responses: {
          200: response("Back in service", obj({ message: str(), coach: obj({}), note: str() })),
          400: response("It is not cancelled", ref("Error")),
          403: errors[403],
          409: response("Its passengers are still being refunded — reinstate once the job finishes", ref("Error")),
        },
      },
    },

    /* ---------------- Reports and abuse ---------------- */

    "/abuse/reports": {
      post: {
        tags: ["After the sale"],
        summary: "Report a ticket",
        description: [
          "For what no machine check catches: the code verified, the ticket is",
          "valid, and the person holding it is not the person on it.",
          "Creates a record and does nothing else. A report is a signal, never a",
          "penalty — it scores nothing until a reviewer upholds it, and cannot",
          "hold anybody's account on its own.",
        ].join(" "),
        ...secured("ticket:report"),
        requestBody: body(
          obj(
            {
              ticketNumber: str(),
              kind: str("identity_mismatch, duplicate_in_use, forgery, beyond_journey or other"),
              detail: str("What happened, in at least a sentence"),
              stationId: int(),
            },
            ["ticketNumber", "kind", "detail"]
          )
        ),
        responses: {
          201: response("Recorded", obj({ message: str(), report: ref("TicketReport") })),
          400: response("Unknown kind, or a detail too thin to review", ref("Error")),
          403: errors[403],
          404: response("No ticket with that number", ref("Error")),
        },
      },
      get: {
        tags: ["After the sale"],
        summary: "The review queue",
        ...secured("abuse:review"),
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["open", "upheld", "dismissed", "all"] } },
          { name: "page", in: "query", schema: int() },
          { name: "limit", in: "query", schema: int() },
        ],
        responses: {
          200: response("Reports, oldest first", obj({ total: int(), page: int(), reports: arr(ref("TicketReport")) })),
          403: errors[403],
        },
      },
    },

    "/abuse/reports/{reference}/review": {
      post: {
        tags: ["After the sale"],
        summary: "Uphold or dismiss a report",
        description:
          "Upholding is the only thing that turns an accusation into a signal, and so the only " +
          "thing that can move a score or lead to a hold. Dismissing withdraws the report " +
          "entirely. A decided report cannot be decided again.",
        ...secured("abuse:review"),
        parameters: [{ name: "reference", in: "path", required: true, schema: str() }],
        requestBody: body(
          obj({ decision: str("uphold or dismiss"), note: str() }, ["decision"])
        ),
        responses: {
          200: response(
            "Decided",
            obj({ message: str(), report: ref("TicketReport"), account: obj({}) })
          ),
          403: errors[403],
          404: errors[404],
          409: response("It was already decided", ref("Error")),
        },
      },
    },

    "/jobs": {
      get: {
        tags: ["Background jobs"],
        summary: "Background jobs, newest first",
        description: [
          "Work carried on after the request that started it: a cancelled departure's",
          "refunds, and the message to each of its passengers. Shows how far each has got,",
          "how many attempts it took, and why a failed one failed.",
        ].join(" "),
        ...secured("job:view"),
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["queued", "running", "succeeded", "failed", "all"] } },
          { name: "type", in: "query", schema: str() },
          { name: "page", in: "query", schema: int() },
          { name: "limit", in: "query", schema: int() },
        ],
        responses: {
          200: response(
            "Jobs",
            obj({
              jobs: arr(ref("Job")),
              counts: obj({ queued: int(), running: int(), succeeded: int(), failed: int() }),
              types: arr(str()),
              pagination: obj({ page: int(), limit: int(), total: int(), pages: int() }),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/jobs/{id}": {
      get: {
        tags: ["Background jobs"],
        summary: "One job",
        description:
          "Readable with `job:view`, or by whoever queued it — so the operator who cancelled a " +
          "departure can watch its refunds finish. Anyone else gets 404.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id", "Job id")],
        responses: {
          200: response("The job", obj({ job: ref("Job") })),
          404: errors[404],
        },
      },
    },

    "/jobs/{id}/retry": {
      post: {
        tags: ["Background jobs"],
        summary: "Send a failed job round again",
        description:
          "Only a failed job. Attempts start again from zero. Safe for the jobs this system runs: " +
          "each is written so that running it twice does the work once.",
        ...secured("job:manage"),
        parameters: [pathParam("id", "Job id")],
        responses: {
          200: response("Queued again", obj({ message: str(), job: ref("Job") })),
          403: errors[403],
          404: errors[404],
          409: response("It is not failed", ref("Error")),
        },
      },
    },

    "/demo-data": {
      get: {
        tags: ["Demo data"],
        summary: "What demo data exists",
        description:
          "Counts of what the demo created, the demo accounts with their passwords, anything that would " +
          "stop a delete, and the populate or delete in progress.",
        ...secured("demo:manage"),
        responses: {
          200: response("Status", ref("DemoStatus")),
          403: errors[403],
        },
      },
    },

    "/demo-data/populate": {
      post: {
        tags: ["Demo data"],
        summary: "Fill the system with demonstration data",
        description: [
          "Queues a background job that creates demo accounts (passengers, planners, admins, checkers — never",
          "a super admin), the transcribed seat plans (approved), stations, two trains with routes, fares and",
          "departures, and sample bookings, returns, a transfer, a ticket check and a report.",
          "",
          "Anything that already exists under the same name is adopted and **not modified** — an existing",
          "account keeps its password, an existing train its route. The job's result lists what was adopted.",
          "Safe to run again: it fills in only what is missing.",
        ].join("\n"),
        ...secured("demo:manage"),
        responses: {
          202: response("Queued — follow it at /jobs/{id}", obj({ message: str(), job: ref("Job") })),
          403: errors[403],
          409: response("A demo delete is still running", ref("Error")),
        },
      },
    },

    "/demo-data/clear": {
      post: {
        tags: ["Demo data"],
        summary: "Remove everything the demo data created",
        description: [
          "Queues a background job that deletes, in one transaction, every row the demo created plus what",
          "happened on it since: departures generated for demo trains, bookings on demo departures, and",
          "anything demo accounts did. Nothing the demo only adopted is touched.",
          "",
          "Refused with 409, before anything is queued, while someone outside the demo holds a valid ticket",
          "on a demo departure or a demo account holds one on a real departure. `error.details.blockers`",
          "says which bookings.",
        ].join("\n"),
        ...secured("demo:manage"),
        responses: {
          202: response("Queued — follow it at /jobs/{id}", obj({ message: str(), job: ref("Job") })),
          400: response("There is no demo data", ref("Error")),
          403: errors[403],
          409: response("Valid tickets are in the way, or a populate is still running", ref("Error")),
        },
      },
    },

    "/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "Your notifications, newest first",
        description:
          "A page at a time: pass the previous page's `nextCursor` as `before`. `unread=1` narrows to unread, " +
          "`category` to one kind. Always your own inbox — nobody can read another's.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "unread", in: "query", schema: { type: "string", enum: ["1", "true"] } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "before", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        responses: {
          200: response(
            "A page",
            obj({
              notifications: arr(ref("Notification")),
              nextCursor: { type: "integer", nullable: true },
              unreadCount: int(),
              latestId: int(),
            })
          ),
          401: errors[401],
        },
      },
    },

    "/notifications/summary": {
      get: {
        tags: ["Notifications"],
        summary: "Unread count and newest id — what the bell polls",
        security: [{ bearerAuth: [] }],
        responses: { 200: response("Summary", ref("NotificationSummary")), 401: errors[401] },
      },
    },

    "/notifications/read": {
      post: {
        tags: ["Notifications"],
        summary: "Mark notifications read",
        description: "Send `{ ids: [...] }` for some, or `{ all: true }` for every unread one.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: obj({ ids: arr(int()), all: bool() }) } },
        },
        responses: { 200: response("New summary", ref("NotificationSummary")), 400: errors[400], 401: errors[401] },
      },
    },

    "/notifications/{id}/unread": {
      post: {
        tags: ["Notifications"],
        summary: "Mark one unread again",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: response("New summary", ref("NotificationSummary")), 404: errors[404] },
      },
    },

    "/notifications/{id}": {
      delete: {
        tags: ["Notifications"],
        summary: "Dismiss one",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: response("New summary", ref("NotificationSummary")), 404: errors[404] },
      },
    },

    "/subscriptions/check": {
      post: {
        tags: ["Subscriptions"],
        summary: "Which subscriptions an email and password hold on this device — for callers outside the app",
        description:
          "Needs no session and opens none, and answers from any origin. The password is checked exactly as " +
          "sign-in checks it, and shares its pause: after too many wrong passwords in a row the account answers " +
          "429 here and at sign-in until the pause is over. A wrong password and an unknown email are the same " +
          "401. `subscriptions` lists every subscription there is, each with whether this account's is valid " +
          "now on the device the call came from; no dates.\n\n" +
          "A subscription allows so many devices of each platform. The first time a device checks in and a " +
          "place is free it takes one, and keeps it; places are held in the order devices arrived. A device " +
          "with no place — the limit is reached, it is blocked, the platform is unknown or switched off, or " +
          "`deviceId` or `platform` is missing or malformed — is answered `valid: false` and nothing else: " +
          "still a 200, in the same shape, with no reason. Staff can read the reason on the account's devices.\n\n" +
          "Each subscription can set its own rules on the app's `version`, platform by platform: require one, set " +
          "the oldest it accepts, block single versions. Each subscription is answered on its own: when its rules " +
          "turn the version away and that is the only thing in the way — the account holds it and the device has a " +
          "place — its entry is `valid: false` with a `message` the app can show (\"A version is required\", or " +
          "\"This version is no longer supported. Please update.\"); the others are answered as usual. A version " +
          "that is not numbers and dots at all is a 400 for the whole call, before the password. A subscription " +
          "without rules ignores `version`; the device remembers the last one sent.\n\n" +
          "**Signing in.** Answered with the right password from a named device (`deviceId` and `platform` " +
          "well-formed), the answer also carries `token` and `tokenExpiresAt`. Send the token as " +
          "`Authorization: Bearer <token>` in place of the email and password, here and on seat plans, until it " +
          "expires (setting `subscription.app_token_hours`, a week by default). It is tied to the account and the " +
          "device it was issued for — a call with it uses that device whatever the body says — and `version` " +
          "is still sent each time. A new sign-in from the same device replaces it; a new password, a restriction, " +
          "or staff removing or blocking the device end it. A token that no longer works is a 401 \"Sign in " +
          "again\": sign in with the password once more.",
        security: [{}, { appToken: [] }],
        requestBody: body(
          obj(
            {
              email: str("Required unless the call carries the app's token"),
              password: str("Required unless the call carries the app's token"),
              deviceId: str(
                "The caller's own stable id for this installation: 4 to 128 letters, digits and . _ : -. Send the " +
                  "same one every time; a new id is a new device. Ignored with a token: the token's device is used"
              ),
              platform: str("A platform's value, such as windows or android"),
              version: str("The app's version, such as 1.4.2: one to four numbers joined by dots, optionally after a v"),
            }
          )
        ),
        responses: {
          200: response(
            "The account, and yes or no for each subscription",
            obj({
              user: obj({ name: str(), email: str() }),
              subscriptions: arr(
                obj({
                  code: str("The subscription's fixed code"),
                  valid: bool(),
                  message: str("Only when this subscription turns the app's version away, and nothing else stood in the way"),
                })
              ),
              token: str("Only when signed in with the password from a named device: the app's sign-in token"),
              tokenExpiresAt: { type: "string", format: "date-time", description: "When the token stops working" },
            })
          ),
          400: response("Missing email or password, or a version that is not numbers and dots", ref("Error")),
          401: response("Wrong password or unknown email (\"Invalid credentials\"), or a token that no longer works (\"Sign in again\")", ref("Error")),
          403: response("Email not yet verified, or the account is restricted", ref("Error")),
          429: response("Paused after too many wrong passwords; see Retry-After", ref("Error")),
        },
      },
    },

    "/subscriptions/seat-plans": {
      post: {
        tags: ["Subscriptions"],
        summary: "A train's seat plans, for an app signed in as a subscriber",
        description:
          "The same sign-in as the check — email, password, deviceId, platform, version, or the app's token from " +
          "the check as `Authorization: Bearer` with `version` — and answered only when " +
          "the account holds a subscription that includes seat plans and is valid on this device, under that " +
          "subscription's device limits and version rules. Asking takes a new device's place, as a check does. " +
          "Answers from any origin, compressed.\n\n" +
          "Name the train, or give its number; add `class` for one class, `coach` for one coach. Only approved " +
          "plans are sent, front to back as the train's line-up runs. A refused call says nothing about the device: " +
          "a 403, unless the app's version is the one thing in the way — then 400 \"A version is required\" or 426 " +
          "\"This version is no longer supported. Please update.\" Every call is in the audit log as " +
          "`subscription.seat_plans`.",
        requestBody: body(
          obj(
            {
              email: str(),
              password: str(),
              deviceId: str("As for the check"),
              platform: str("As for the check"),
              version: str("As for the check"),
              train: str("The train's name, such as EKOTA EXPRESS (705), or its number, 705"),
              class: str("Optional: a class code, such as S_CHAIR"),
              coach: str("Optional: a coach letter, such as KA"),
            },
            ["train"]
          )
        ),
        security: [{}, { appToken: [] }],
        responses: {
          200: response(
            "The plans",
            obj({
              train: obj({ name: str(), number: { ...str(), nullable: true } }),
              coaches: arr(
                obj({
                  coach: str("The coach letter"),
                  class: { ...str(), nullable: true },
                  type: { ...str(), nullable: true },
                  planId: int(),
                  updatedAt: { type: "string", format: "date-time", description: "When the plan last changed; cache by it" },
                  layout: { type: "object", description: "The seat grid, as stored" },
                })
              ),
            })
          ),
          400: response("Missing fields, a version that is not one, or one the subscription requires and none was sent", ref("Error")),
          401: response("Wrong password or unknown email, or a token that no longer works (\"Sign in again\")", ref("Error")),
          403: response("No subscription that includes seat plans is valid on this device, or the account is restricted", ref("Error")),
          404: response("No such train, or no plan matches", ref("Error")),
          426: response("This version of the app is no longer supported by the subscription", ref("Error")),
          429: response("Paused after too many wrong passwords; see Retry-After", ref("Error")),
        },
      },
    },

    "/plans": {
      get: {
        tags: ["Seat plans"],
        summary: "Seat plans you may see",
        description:
          "Holders of plan:create see every plan; everyone else only approved ones. An editable copy of an approved " +
          "plan is listed too, with `revisionOfId`; `templates=1` leaves copies out.",
        ...secured("plan:view"),
        parameters: [
          queryParam("status", "draft, pending, approved or rejected"),
          queryParam("search", "Part of a coach number"),
          queryParam("trainNameId", "One train's plans", "integer"),
          queryParam("mine", "1 for your own"),
          queryParam("templates", "1 for plans to start a new one from"),
        ],
        responses: { 200: response("Plans, without their layouts", obj({ plans: arr(ref("SeatPlan")) })) },
      },
      post: {
        tags: ["Seat plans"],
        summary: "Start a plan, as a draft",
        description: "Anything may be left out of a draft. A train has one plan per coach number: a second is a 409.",
        ...secured("plan:create"),
        requestBody: body(obj({
            coachNo: str("The railway's coach letter: KA, KHA, GA…"),
            trainNameId: { ...int(), nullable: true },
            coachTypeId: { ...int(), nullable: true },
            coachClassId: { ...int(), nullable: true },
            layout: { type: "object", description: "The seat grid: rows of cells" },
          })),
        responses: { 201: response("Created", obj({ plan: ref("SeatPlan") })), 400: errors[400], 409: errors[409] },
      },
    },

    "/plans/{id}": {
      get: {
        tags: ["Seat plans"],
        summary: "One plan, with its layout",
        ...secured("plan:view"),
        parameters: [pathParam("id", "Plan id")],
        responses: { 200: response("The plan", obj({ plan: ref("SeatPlan") })), 404: errors[404] },
      },
      put: {
        tags: ["Seat plans"],
        summary: "Change a plan that is not approved yet",
        description:
          "An approved plan is refused with 409: it is changed through an editable copy (POST /plans/{id}/revise), " +
          "so it keeps being used until the changes are approved.",
        ...secured("plan:update"),
        parameters: [pathParam("id", "Plan id")],
        requestBody: body(obj({
            coachNo: str("The railway's coach letter: KA, KHA, GA…"),
            trainNameId: { ...int(), nullable: true },
            coachTypeId: { ...int(), nullable: true },
            coachClassId: { ...int(), nullable: true },
            layout: { type: "object", description: "The seat grid: rows of cells" },
          })),
        responses: { 200: response("Saved", obj({ plan: ref("SeatPlan") })), 400: errors[400], 404: errors[404], 409: errors[409] },
      },
      delete: {
        tags: ["Seat plans"],
        summary: "Delete a plan — or throw a copy's changes away",
        description: "Deleting a plan deletes its open copy with it.",
        ...secured("plan:delete"),
        parameters: [pathParam("id", "Plan id")],
        responses: { 200: response("Deleted", obj({ message: str() })), 404: errors[404] },
      },
    },

    "/plans/{id}/revise": {
      post: {
        tags: ["Seat plans"],
        summary: "Open an editable copy of an approved plan",
        description:
          "Or the one already open (200). The plan keeps being used — new departures, coaches added on the day — " +
          "while the copy is drafted and reviewed. Approving the copy puts its content into the plan, under the " +
          "plan's own id, and removes the copy. Departures already generated keep their seats.",
        ...secured("plan:update"),
        parameters: [pathParam("id", "The approved plan's id")],
        responses: {
          201: response("Opened", obj({ message: str(), plan: ref("SeatPlan") })),
          200: response("Already open", obj({ message: str(), plan: ref("SeatPlan") })),
          400: response("The plan is not approved, or is itself a copy", ref("Error")),
          404: errors[404],
        },
      },
    },

    "/plans/{id}/submit": {
      post: {
        tags: ["Seat plans"],
        summary: "Send a draft or sent-back plan for approval",
        description: "Someone who may approve plans approves it as they submit it; a copy goes straight into its plan.",
        ...secured("plan:update"),
        parameters: [pathParam("id", "Plan id")],
        responses: { 200: response("Submitted, or approved", obj({ plan: ref("SeatPlan") })), 400: errors[400], 409: errors[409] },
      },
    },

    "/plans/{id}/approve": {
      post: {
        tags: ["Seat plans"],
        summary: "Approve a plan waiting for it",
        description: "An editable copy is folded into the plan it changes, and the answer is that plan.",
        ...secured("plan:approve"),
        parameters: [pathParam("id", "Plan id")],
        responses: { 200: response("Approved", obj({ plan: ref("SeatPlan") })), 400: errors[400], 409: errors[409] },
      },
    },

    "/plans/{id}/reject": {
      post: {
        tags: ["Seat plans"],
        summary: "Send a plan back, with a reason",
        ...secured("plan:approve"),
        parameters: [pathParam("id", "Plan id")],
        requestBody: body(obj({ reason: str() }, ["reason"])),
        responses: { 200: response("Sent back", obj({ plan: ref("SeatPlan") })), 400: errors[400] },
      },
    },

    "/subscriptions": {
      get: {
        tags: ["Subscriptions"],
        summary: "The subscriptions, each with your own standing",
        description:
          "Everyone signed in sees the open ones, and any closed one they have a history with. Whoever manages " +
          "or approves sees all of them, with how many people are waiting or subscribed.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: response(
            "The list",
            obj({
              subscriptions: arr({
                allOf: [
                  ref("Subscription"),
                  obj({
                    mine: { ...ref("UserSubscription"), nullable: true },
                    counts: obj({ pending: int(), active: int() }),
                  }),
                ],
              }),
            })
          ),
          401: errors[401],
        },
      },
      post: {
        tags: ["Subscriptions"],
        summary: "Create a subscription",
        ...secured("subscription:manage"),
        requestBody: body(
          obj(
            {
              name: str(),
              description: str(),
              code: str("Optional; made from the name when left out. Lowercase letters, digits and hyphens"),
              includesSeatPlans: bool("Optional, false by default"),
            },
            ["name"]
          )
        ),
        responses: {
          201: response("Created", obj({ subscription: ref("Subscription") })),
          400: errors[400],
          403: errors[403],
          409: errors[409],
        },
      },
    },

    "/subscriptions/mine": {
      get: {
        tags: ["Subscriptions"],
        summary: "Everything you have asked for, newest first",
        security: [{ bearerAuth: [] }],
        responses: {
          200: response("Your history", obj({ subscriptions: arr(ref("UserSubscription")) })),
          401: errors[401],
        },
      },
    },

    "/subscriptions/{id}": {
      patch: {
        tags: ["Subscriptions"],
        summary: "Rename, re-describe, close or reopen",
        description: "Closing declines whatever requests are still waiting. The code never changes.",
        ...secured("subscription:manage"),
        parameters: [pathParam("id", "Subscription id")],
        requestBody: body(obj({ name: str(), description: str(), isOpen: bool(), includesSeatPlans: bool() })),
        responses: {
          200: response("Updated", obj({ subscription: ref("Subscription") })),
          400: errors[400],
          404: errors[404],
          409: errors[409],
        },
      },
      delete: {
        tags: ["Subscriptions"],
        summary: "Delete one nobody has ever asked for",
        ...secured("subscription:manage"),
        parameters: [pathParam("id", "Subscription id")],
        responses: { 200: response("Deleted", obj({ deleted: bool() })), 404: errors[404], 409: errors[409] },
      },
    },

    "/subscriptions/{id}/requests": {
      post: {
        tags: ["Subscriptions"],
        summary: "Ask to be subscribed, saying on how many devices",
        description:
          "Refused while you already have a request waiting or a subscription running for it. Without " +
          "`devices` it asks for one of each platform.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id", "Subscription id")],
        requestBody: body(obj({ devices: ref("DeviceCounts") }), false),
        responses: {
          201: response("Waiting for a reviewer", obj({ subscription: ref("UserSubscription") })),
          400: errors[400],
          404: errors[404],
          409: errors[409],
        },
      },
    },

    "/subscriptions/members": {
      get: {
        tags: ["Subscriptions"],
        summary: "Requests and subscriptions across everyone",
        ...secured("subscription:approve"),
        parameters: [
          queryParam("status", "pending, active, declined, cancelled or expired"),
          queryParam("subscriptionId", "Only this subscription", "integer"),
          queryParam("search", "Part of a name or email"),
          queryParam("page", "Page number", "integer"),
          queryParam("limit", "Page size, up to 100", "integer"),
        ],
        responses: {
          200: response(
            "A page",
            obj({
              members: arr(ref("UserSubscription")),
              pagination: obj({ page: int(), limit: int(), total: int(), pages: int() }),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/subscriptions/members/pending-count": {
      get: {
        tags: ["Subscriptions"],
        summary: "How many requests are waiting",
        ...secured("subscription:approve"),
        responses: { 200: response("The count", obj({ pending: int() })), 403: errors[403] },
      },
    },

    "/subscriptions/members/{id}/approve": {
      post: {
        tags: ["Subscriptions"],
        summary: "Approve a request for a period",
        ...secured("subscription:approve"),
        parameters: [pathParam("id", "Request id")],
        requestBody: body(
          obj({
            days: int("Days from today in Dhaka"),
            lastDay: str("Or the last day it is valid, YYYY-MM-DD. It runs through the end of that day in Dhaka"),
            devices: { ...ref("DeviceCounts"), description: "Replaces the counts that were asked for. Left out, it is approved as asked" },
            note: str(),
          })
        ),
        responses: { 200: response("Now running", obj({ subscription: ref("UserSubscription") })), 400: errors[400], 404: errors[404], 409: errors[409] },
      },
    },

    "/subscriptions/members/{id}/decline": {
      post: {
        tags: ["Subscriptions"],
        summary: "Decline a request",
        ...secured("subscription:approve"),
        parameters: [pathParam("id", "Request id")],
        requestBody: body(obj({ note: str() }), false),
        responses: { 200: response("Declined", obj({ subscription: ref("UserSubscription") })), 404: errors[404], 409: errors[409] },
      },
    },

    "/subscriptions/members/{id}/cancel": {
      post: {
        tags: ["Subscriptions"],
        summary: "End a subscription now, or withdraw a waiting request",
        description: "Your own, always. Anyone's, with subscription:approve — without it, somebody else's is a 404.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id", "Request id")],
        requestBody: body(obj({ reason: str() }), false),
        responses: { 200: response("Cancelled", obj({ subscription: ref("UserSubscription") })), 404: errors[404], 409: errors[409] },
      },
    },

    "/subscriptions/members/{id}": {
      patch: {
        tags: ["Subscriptions"],
        summary: "Change when a running subscription ends, how many devices it allows, or both",
        description:
          "Lowering a count takes no device off the account: the ones that arrived first keep their places, " +
          "and the later ones are no longer valid for this subscription.",
        ...secured("subscription:approve"),
        parameters: [pathParam("id", "Request id")],
        requestBody: body(
          obj({
            days: int("Days from today in Dhaka"),
            lastDay: str("Or the last day it is valid, YYYY-MM-DD"),
            devices: ref("DeviceCounts"),
          })
        ),
        responses: { 200: response("Changed", obj({ subscription: ref("UserSubscription") })), 400: errors[400], 404: errors[404], 409: errors[409] },
      },
    },

    "/subscriptions/platforms": {
      get: {
        tags: ["Subscriptions"],
        summary: "The platforms a subscription can be used on",
        description: "Everyone signed in sees the ones switched on. Whoever manages or approves sees all of them.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: response(
            "The platforms, oldest first",
            obj({ platforms: arr(ref("SubscriptionPlatform")), maxDevices: int("The most of one platform that can be asked for") })
          ),
          401: errors[401],
        },
      },
      post: {
        tags: ["Subscriptions"],
        summary: "Create a platform",
        description:
          "Subscriptions already running allow no devices on a new platform until a reviewer raises their count.",
        ...secured("subscription:manage"),
        requestBody: body(
          obj(
            {
              value: str("Lowercase letters and digits, with single - _ or . between them, up to 40 characters"),
              name: str(),
            },
            ["value", "name"]
          )
        ),
        responses: {
          201: response("Created", obj({ platform: ref("SubscriptionPlatform") })),
          400: errors[400],
          403: errors[403],
          409: errors[409],
        },
      },
    },

    "/subscriptions/platforms/{id}": {
      patch: {
        tags: ["Subscriptions"],
        summary: "Rename a platform, or switch it on or off",
        description: "The value never changes.",
        ...secured("subscription:manage"),
        parameters: [pathParam("id", "Platform id")],
        requestBody: body(obj({ name: str(), isActive: bool() })),
        responses: {
          200: response("Updated", obj({ platform: ref("SubscriptionPlatform") })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
      delete: {
        tags: ["Subscriptions"],
        summary: "Delete a platform nothing uses",
        description: "Refused while any device is on it or any subscription allows devices on it — switch it off instead.",
        ...secured("subscription:manage"),
        parameters: [pathParam("id", "Platform id")],
        responses: { 200: response("Deleted", obj({ deleted: bool() })), 403: errors[403], 404: errors[404], 409: errors[409] },
      },
    },

    "/subscriptions/{id}/versions": {
      get: {
        tags: ["Subscriptions"],
        summary: "One subscription's version rules on every platform, and the versions its subscribers use",
        description:
          "A platform it has set nothing for has no rules: any version, or none. `inUse` is the version each device " +
          "of a current subscriber last checked in with, counted, newest first; null for devices that never said.",
        ...secured("subscription:versions"),
        parameters: [pathParam("id", "Subscription id")],
        responses: {
          200: response(
            "The rules",
            obj({
              subscription: obj({ id: int(), code: str(), name: str(), appUrl: { ...str(), nullable: true } }),
              notices: arr(ref("AppNotice")),
              platforms: arr({
                allOf: [
                  ref("SubscriptionPlatform"),
                  obj({
                    blocked: arr(ref("BlockedVersion")),
                    reach: int("How many current subscribers have a device on this platform — whom a notice would reach"),
                    noticeTemplates: obj({
                      released: str("The words a release notice starts from, with {version} to fill in"),
                      retiring: str("The words a retirement notice starts from"),
                    }),
                    versionRequired: bool("A check must send `version` to be valid for this subscription"),
                    minVersion: { ...str("The oldest app version this subscription accepts"), nullable: true },
                    inUse: arr(obj({ version: { ...str(), nullable: true }, devices: int(), lastSeenAt: { type: "string", format: "date-time" } })),
                  }),
                ],
              }),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/subscriptions/{id}/versions/{platformId}": {
      patch: {
        tags: ["Subscriptions"],
        summary: "Require a version for a subscription on a platform, or set its minimum there",
        description: "Either or both. An empty or null `minVersion` removes the minimum. A change to what it already is (2 for 2.0) is a 400.",
        ...secured("subscription:versions"),
        parameters: [pathParam("id", "Subscription id"), pathParam("platformId", "Platform id")],
        requestBody: body(obj({ versionRequired: bool(), minVersion: { ...str(), nullable: true } })),
        responses: {
          200: response("Updated", obj({ policy: obj({ versionRequired: bool(), minVersion: { ...str(), nullable: true } }) })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/subscriptions/{id}/app-link": {
      patch: {
        tags: ["Subscriptions"],
        summary: "Set where a subscription's app is got from",
        description:
          "A full https:// address; empty or null removes it. Subscribers whose subscription is running get a button " +
          "that goes there. Setting it to what it already is, is a 400.",
        ...secured("subscription:versions"),
        parameters: [pathParam("id", "Subscription id")],
        requestBody: body(obj({ appUrl: { ...str(), nullable: true } })),
        responses: {
          200: response("Saved", obj({ appUrl: { ...str(), nullable: true } })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/subscriptions/{id}/versions/{platformId}/notices": {
      post: {
        tags: ["Subscriptions"],
        summary: "Tell a platform's subscribers about a version of the app",
        description:
          "To everyone currently subscribed with a device on that platform: in the app at once, and by email too " +
          "when `email` is true — each email a queued job of its own, retried if the mail server refuses. " +
          "`released`: a new version is out. `retiring`: an old one is going away. Nobody to tell is a 400.",
        ...secured("subscription:versions"),
        parameters: [pathParam("id", "Subscription id"), pathParam("platformId", "Platform id")],
        requestBody: body(
          obj(
            {
              kind: { type: "string", enum: ["released", "retiring"] },
              version: str("Such as 2.0.1"),
              message: str("What subscribers read, up to 1000 characters"),
              email: bool("Email them too. False by default"),
            },
            ["kind", "version", "message"]
          )
        ),
        responses: {
          201: response("Sent", obj({ notice: ref("AppNotice") })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/subscriptions/{id}/versions/{platformId}/blocked": {
      post: {
        tags: ["Subscriptions"],
        summary: "Block one version of a platform's app for a subscription",
        description: "That subscription turns it away whatever its minimum; other subscriptions are not affected.",
        ...secured("subscription:versions"),
        parameters: [pathParam("id", "Subscription id"), pathParam("platformId", "Platform id")],
        requestBody: body(obj({ version: str(), note: str("Optional, up to 200 characters") }, ["version"])),
        responses: {
          201: response("Blocked", obj({ blocked: ref("BlockedVersion") })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
          409: response("Already blocked", ref("Error")),
        },
      },
    },

    "/subscriptions/{id}/versions/{platformId}/blocked/{blockedId}": {
      delete: {
        tags: ["Subscriptions"],
        summary: "Unblock a version for a subscription",
        ...secured("subscription:versions"),
        parameters: [pathParam("id", "Subscription id"), pathParam("platformId", "Platform id"), pathParam("blockedId", "The blocked version's id")],
        responses: { 200: response("Unblocked", obj({ unblocked: bool() })), 403: errors[403], 404: errors[404] },
      },
    },

    "/subscriptions/devices/mine": {
      get: {
        tags: ["Subscriptions"],
        summary: "Your devices, and how many places are used",
        description: "To look at, not to change. Without staff's notes, and without the checks that were turned away.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: response("Your devices", obj({ devices: arr(ref("UserDevice")), usage: arr(ref("DeviceUsage")) })),
          401: errors[401],
        },
      },
    },

    "/subscriptions/users/{userId}/devices": {
      get: {
        tags: ["Subscriptions"],
        summary: "An account's devices, and the checks that were turned away",
        description: "`refusals` holds the newest 100, each with why — which the caller of the check was never told.",
        ...secured("subscription:approve"),
        parameters: [pathParam("userId", "Account id")],
        responses: {
          200: response(
            "The account and its devices",
            obj({
              user: obj({ id: int(), fullName: str(), email: str() }),
              devices: arr(ref("UserDevice")),
              usage: arr(ref("DeviceUsage")),
              refusals: arr(ref("DeviceRefusal")),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/subscriptions/devices/{id}": {
      patch: {
        tags: ["Subscriptions"],
        summary: "Note what a device is, or block or unblock it",
        description:
          "A blocked device is never valid and holds no place, so the next one moves up. Unblocked, it has its " +
          "place in the order back.",
        ...secured("subscription:approve"),
        parameters: [pathParam("id", "Device id")],
        requestBody: body(obj({ note: str("Up to 200 characters; empty clears it"), isBlocked: bool() })),
        responses: {
          200: response("Updated", obj({ device: ref("UserDevice") })),
          400: errors[400],
          403: errors[403],
          404: errors[404],
        },
      },
      delete: {
        tags: ["Subscriptions"],
        summary: "Remove a device from an account",
        description:
          "Its place is free at once — and the same device may take one again the next time it checks in, if " +
          "there is room. To keep a device out, block it.",
        ...secured("subscription:approve"),
        parameters: [pathParam("id", "Device id")],
        responses: { 200: response("Removed", obj({ deleted: bool() })), 403: errors[403], 404: errors[404] },
      },
    },

    "/railway-data": {
      get: {
        tags: ["Railway data"],
        summary: "What of the real railway is loaded",
        description:
          "The current timetable (the newest applied from the railway, else the one committed with the code), " +
          "how much of it is loaded, the trains ready for departures with their line-ups and seats, whether " +
          "departures are generated automatically, the load in progress, and the sync with the railway.",
        ...secured("railway:manage"),
        responses: {
          200: response("Status", ref("RailwayStatus")),
          403: errors[403],
        },
      },
    },

    "/railway-data/load": {
      post: {
        tags: ["Railway data"],
        summary: "Load the timetable and seat plans",
        description: [
          "Queues a background job that adds whatever is missing of: every station and train in the snapshot",
          "with its route, running days and estimated distances; an approved seat plan for every coach of every",
          "train with a line-up, numbered with the coach's letter, and a draft for each source that names no",
          "train; and coaches, running days and per-kilometre fares for those trains. It never generates departures.",
          "",
          "Anything already there is used as it is. A route is replaced only where the timetable differs, and",
          "never on a train with departures. Refused with 409 while demo data exists.",
        ].join("\n"),
        ...secured("railway:manage"),
        responses: {
          202: response("Queued — follow it at /jobs/{id}", obj({ message: str(), job: ref("Job") })),
          403: errors[403],
          409: response("Demo data has to be deleted first", ref("Error")),
        },
      },
    },

    "/railway-data/check": {
      post: {
        tags: ["Railway data"],
        summary: "Check the server against what the railway publishes now",
        description: [
          "Queues a background job that asks the railway for every train on its list, for the timetable two days",
          "ahead, and compares it with the server: new trains and stations, renamed trains, moved times, changed",
          "stations, changed running days, trains no longer published, and trains it could not fetch. Nothing",
          "changes; the result waits under `sync.pending` for someone to apply it, and replaces a check never applied.",
          "",
          "If the railway does not answer for more than half the trains, the job fails and nothing is kept.",
          "One railway job at a time: 409 while a load, check or apply runs.",
        ].join("\n"),
        ...secured("railway:manage"),
        responses: {
          202: response("Queued — follow it at /jobs/{id}", obj({ message: str(), job: ref("Job") })),
          403: errors[403],
          409: response("Another railway job is running", ref("Error")),
        },
      },
    },

    "/railway-data/sync/{id}/apply": {
      post: {
        tags: ["Railway data"],
        summary: "Apply a check",
        description: [
          "Queues a background job that compares the check again as things are now, then: adds new stations and",
          "trains with their routes; renames renamed trains; takes moved times on the same stations, even on trains",
          "with departures, keeping the distances saved; replaces changed stations only on trains with no departures",
          "still to run (the others are named); and updates running days where they are the single undated schedule",
          "loading gives, listing departures already generated on a day no longer run. Coaches, seat plans and fares",
          "are not touched and nothing is deleted. The applied timetable becomes the one Load works from.",
        ].join("\n"),
        ...secured("railway:manage"),
        parameters: [pathParam("id", "The check's id (sync.pending.id)")],
        responses: {
          202: response("Queued — follow it at /jobs/{id}", obj({ message: str(), job: ref("Job") })),
          403: errors[403],
          409: response("Replaced or already applied, another railway job is running, or demo data is present", ref("Error")),
        },
      },
    },

    "/abuse/accounts/held": {
      get: {
        tags: ["After the sale"],
        summary: "Accounts currently held",
        ...secured("abuse:review"),
        parameters: [{ name: "page", in: "query", schema: int() }],
        responses: {
          200: response("Open holds", obj({ total: int(), page: int(), holds: arr(ref("AccountHold")) })),
          403: errors[403],
        },
      },
    },

    "/abuse/accounts/{userId}/standing": {
      get: {
        tags: ["After the sale"],
        summary: "What the signals against an account add up to",
        description: [
          "The score with its arithmetic laid out, whether the account is held,",
          "every hold it has ever had, and the reports against it.",
          "Under `abuse:review` rather than `account:hold`, because a reviewer has",
          "to see the working in order to decide — and seeing it is not the same",
          "as being able to act on it.",
        ].join(" "),
        ...secured("abuse:review"),
        parameters: [{ name: "userId", in: "path", required: true, schema: int() }],
        responses: {
          200: response(
            "Standing",
            obj({
              score: ref("AbuseScore"),
              held: bool(),
              hold: ref("AccountHold"),
              holds: arr(ref("AccountHold")),
              reports: arr(ref("TicketReport")),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/abuse/accounts/{userId}/hold": {
      post: {
        tags: ["After the sale"],
        summary: "Stop an account buying",
        description: [
          "Stops new bookings and nothing else. Existing tickets stay valid, remain",
          "readable and downloadable, and can still be travelled on — voiding them",
          "would be a second penalty nobody decided on.",
          "The detail is read by the account holder, so it has to be a sentence.",
        ].join(" "),
        ...secured("account:hold"),
        parameters: [{ name: "userId", in: "path", required: true, schema: int() }],
        requestBody: body(
          obj({ detail: str("Why, in words the account holder will read"), reason: str() }, ["detail"])
        ),
        responses: {
          201: response("Held", obj({ message: str(), hold: ref("AccountHold") })),
          200: response("It was already held", obj({ message: str(), hold: ref("AccountHold") })),
          400: response("No usable reason given", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/abuse/accounts/{userId}/release": {
      post: {
        tags: ["After the sale"],
        summary: "Lift a hold",
        description:
          "Always available to whoever may hold. That symmetry is what makes a hold safe to " +
          "place at all. A note is required for the same reason one is required to place it: an " +
          "unexplained release is as unaccountable as an unexplained hold.",
        ...secured("account:hold"),
        parameters: [{ name: "userId", in: "path", required: true, schema: int() }],
        requestBody: body(obj({ note: str("Why it is being lifted") }, ["note"])),
        responses: {
          200: response("Lifted", obj({ message: str(), hold: ref("AccountHold") })),
          400: response("Not held, or no reason given", ref("Error")),
          403: errors[403],
        },
      },
    },

    /* ---------------- On the train ---------------- */

    "/verify/check": {
      post: {
        tags: ["On the train"],
        summary: "Read a ticket without changing it",
        description: [
          "Looks and marks nothing. Separate from scanning because a checker often",
          "wants to look — a passenger asking whether they are on the right train",
          "should not have their ticket burned to find out.",
          "A refusal is still a 200: the request worked, the reader worked, and the",
          "answer is no. Returning 4xx would make a scanner treat a refused ticket",
          "like a dropped connection, at the moment it must not.",
        ].join(" "),
        ...secured("ticket:verify"),
        requestBody: body(
          obj(
            {
              token: str("The scanned code. A bare token or a verification URL containing one"),
              ticketNumber: str("Typed off a printed page when the QR will not read"),
              tripId: int("Which service the checker is on, so a ticket for another is caught"),
              stationId: int("Where the check happened"),
              note: str(),
            },
            []
          )
        ),
        responses: {
          200: response("What the checker was shown", ref("ScanResult")),
          400: response("Neither a code nor a number was given", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/verify/scan": {
      post: {
        tags: ["On the train"],
        summary: "Admit a passenger, marking the ticket used",
        description: [
          "The irreversible half. Marking happens under a row lock and re-reads the",
          "status inside it, so two checkers scanning the same ticket at the same",
          "moment produce one admission and one \"already scanned\" — never two",
          "admissions.",
          "Every attempt is recorded, refusals included, and including codes that",
          "name no ticket at all: a ticket presented twice is how a shared",
          "screenshot surfaces, and a bad signature is somebody trying it on.",
        ].join(" "),
        ...secured("ticket:scan"),
        requestBody: body(
          obj(
            {
              token: str(),
              ticketNumber: str(),
              tripId: int(),
              stationId: int(),
              clientReference: str("The device's own id for this scan, so a retry cannot double-record"),
              note: str(),
            },
            []
          )
        ),
        responses: {
          200: response("What the checker was shown", ref("ScanResult")),
          400: response("Neither a code nor a number was given", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/verify/scans/sync": {
      post: {
        tags: ["On the train"],
        summary: "Upload scans recorded while out of signal",
        description: [
          "Each scan is judged now, against current state, which is the honest thing",
          "to do: a checker who admitted somebody offline on a ticket refunded two",
          "hours earlier made a reasonable decision with what they had, and the",
          "record should show the discrepancy rather than hide it.",
          "Idempotent through `clientReference`, so a batch re-sent after a dropped",
          "connection records nothing twice and is not counted as fresh admissions.",
        ].join(" "),
        ...secured("ticket:scan"),
        requestBody: body(
          obj(
            {
              scans: arr(
                obj(
                  {
                    scannedAt: str("When the scan happened — not when it was uploaded"),
                    clientReference: str("The device's own id for the scan"),
                    token: str(),
                    ticketNumber: str(),
                    tripId: int(),
                    stationId: int(),
                    mark: bool("False to record a look rather than an admission. Defaults to true"),
                    note: str(),
                  },
                  ["scannedAt", "clientReference"]
                )
              ),
            },
            ["scans"]
          )
        ),
        responses: {
          200: response(
            "What the batch did",
            obj({
              received: int(),
              accepted: int(),
              refused: int(),
              duplicates: int("Already recorded, and excluded from the counts above"),
              results: arr(obj({ clientReference: str(), verdict: ref("ScanVerdict"), refused: bool() })),
            })
          ),
          400: response("Malformed batch", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/verify/trips/{tripId}/manifest": {
      get: {
        tags: ["On the train"],
        summary: "Everything needed to check this service with no network",
        description: [
          "The signature on a ticket already proves the railway issued it, with no",
          "database. What a token cannot carry is anything mutable — refunded,",
          "cancelled, already scanned — so this supplies that half, downloaded",
          "before departure.",
          "A stale manifest is the failure mode of the whole mechanism: a ticket",
          "returned after it was generated still looks valid offline. The response",
          "says so in `advice`.",
          "NIDs are truncated, because a manifest is a file on a device that leaves",
          "the building.",
        ].join(" "),
        ...secured("ticket:verify"),
        parameters: [{ name: "tripId", in: "path", required: true, schema: int() }],
        responses: {
          200: response(
            "The service and everyone booked on it",
            obj({
              tripId: int(),
              train: str(),
              departureDate: str(),
              tripStatus: str(),
              generatedAt: str(),
              advice: str(),
              count: int(),
              tickets: arr(
                obj({
                  ticketNumber: str(),
                  status: str(),
                  passengerName: str(),
                  nidLastFour: str(),
                  coachCode: str(),
                  seatNumber: str(),
                  alreadyScannedAt: str("Set when the ticket has been admitted already"),
                })
              ),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/verify/trips/{tripId}/scans": {
      get: {
        tags: ["On the train"],
        summary: "How a service went",
        description:
          "Sold, admitted, and the difference — which is what a no-show count is made of, though " +
          "it is not one until the train has gone. Refused attempts are listed alongside the " +
          "admitted ones, because they are the evidence.",
        ...secured("ticket:verify"),
        parameters: [
          { name: "tripId", in: "path", required: true, schema: int() },
          { name: "page", in: "query", schema: int() },
          { name: "limit", in: "query", schema: int() },
        ],
        responses: {
          200: response(
            "The scan log for one departure",
            obj({
              tripId: int(),
              train: str(),
              sold: int(),
              admitted: int(),
              unscanned: int(),
              total: int(),
              scans: arr(obj({ verdict: ref("ScanVerdict"), refused: bool(), checkedBy: str(), station: str() })),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/verify/tickets/{ticketNumber}/scans": {
      get: {
        tags: ["On the train"],
        summary: "One ticket's scan history",
        description: "For settling a dispute about whether somebody was admitted, and when.",
        ...secured("ticket:verify"),
        parameters: [{ name: "ticketNumber", in: "path", required: true, schema: str() }],
        responses: {
          200: response(
            "Every attempt against this ticket, oldest first",
            obj({
              ticket: obj({ ticketNumber: str(), passengerName: str(), status: str() }),
              scans: arr(obj({ verdict: ref("ScanVerdict"), scannedAt: str(), checkedBy: str() })),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    /* ---------------- Waitlist ---------------- */

    "/waitlist": {
      get: {
        tags: ["Waitlist"],
        summary: "The caller's queue places",
        description: [
          "Open entries first, then a short tail of closed ones. Each carries the",
          "train, both stations and — while waiting — the caller's place in line.",
        ].join(" "),
        ...secured("waitlist:join"),
        responses: {
          200: response("Queue places", obj({ entries: arr(ref("WaitlistEntry")) })),
          403: errors[403],
        },
      },
      post: {
        tags: ["Waitlist"],
        summary: "Join the queue for a sold-out stretch",
        description: [
          "Refused when seats are actually free, because the queue is only served",
          "when a seat *frees* — an entry behind an open seat would wait forever",
          "for an offer that never comes.",
          "Passenger details are required here rather than at confirmation. That is",
          "what makes taking an offer one click: a seat offered to the queue is out",
          "of sale for everyone else until it is answered, so the time-critical",
          "moment is the worst possible one at which to ask for paperwork.",
        ].join(" "),
        ...secured("waitlist:join"),
        requestBody: body(
          obj(
            {
              tripId: int("Which departure"),
              fromStationId: int(),
              toStationId: int(),
              count: int("Seats wanted. Defaults to 1"),
              coachClassId: int("Optional. Narrows what counts as a match, and converts slower"),
              passengers: arr(
                obj({ name: str(), nid: str("10 to 17 digits"), dob: str("YYYY-MM-DD") })
              ),
            },
            ["tripId", "fromStationId", "toStationId", "passengers"]
          )
        ),
        responses: {
          201: response("In the queue", obj({ message: str(), entry: ref("WaitlistEntry") })),
          400: response(
            "Seats are still available, the departure is cancelled, waitlists are switched off, or the passenger list does not match the seat count",
            ref("Error")
          ),
          403: errors[403],
          404: response("No such departure", ref("Error")),
        },
      },
    },

    "/waitlist/trip/{tripId}": {
      get: {
        tags: ["Waitlist"],
        summary: "The queue on one departure",
        description: [
          "For watching how a queue converts. Read-only by design: the queue is",
          "served in join order by the sweep, and no endpoint can reorder it.",
          "Passengers are named; their identity documents are not returned.",
        ].join(" "),
        ...secured("waitlist:view_all"),
        parameters: [{ name: "tripId", in: "path", required: true, schema: int() }],
        responses: {
          200: response(
            "The queue, in join order",
            obj({
              tripId: int(),
              entries: arr(ref("WaitlistEntry")),
              waiting: int(),
              seatsWanted: int("Seats the still-waiting entries add up to"),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/waitlist/{reference}": {
      get: {
        tags: ["Waitlist"],
        summary: "One queue place",
        ...secured("waitlist:join"),
        parameters: [{ name: "reference", in: "path", required: true, schema: str() }],
        responses: {
          200: response("The entry", obj({ entry: ref("WaitlistEntry") })),
          403: response("It belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
      delete: {
        tags: ["Waitlist"],
        summary: "Leave the queue",
        description:
          "Releases an open offer along with the place, so the seat goes straight back to whoever is next rather than waiting out the offer window for nobody.",
        ...secured("waitlist:join"),
        parameters: [{ name: "reference", in: "path", required: true, schema: str() }],
        responses: {
          200: response(
            "Left",
            obj({ message: str(), reference: str(), status: str(), releasedOffer: bool() })
          ),
          403: response("It belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
    },

    "/waitlist/{reference}/offer/quote": {
      get: {
        tags: ["Waitlist"],
        summary: "What the offered seat costs",
        description:
          "The same quote the payment step uses, priced against the hold standing in this passenger's name. Reserves nothing further.",
        ...secured("waitlist:join"),
        parameters: [{ name: "reference", in: "path", required: true, schema: str() }],
        responses: {
          200: response("Priced", ref("Quote")),
          400: response("No open offer, or it has expired", ref("Error")),
          403: response("It belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
    },

    "/waitlist/{reference}/offer/confirm": {
      post: {
        tags: ["Waitlist"],
        summary: "Take the offered seat",
        description: [
          "Takes no body at all — who is travelling was captured when the passenger",
          "joined the queue.",
          "Wallet only, and deliberately: a card flow is several screens and a",
          "redirect, which is precisely the friction this feature exists to remove.",
          "A short balance is refused with the shortfall named, and the offer stays",
          "theirs until it expires.",
        ].join(" "),
        ...secured("waitlist:join"),
        parameters: [{ name: "reference", in: "path", required: true, schema: str() }],
        responses: {
          201: response("Bought", obj({ message: str(), booking: ref("Booking") })),
          400: response("No open offer, it expired, or the wallet is short", ref("Error")),
          403: response("It belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
    },

    "/waitlist/{reference}/offer/decline": {
      post: {
        tags: ["Waitlist"],
        summary: "Turn the offered seat down",
        description:
          "The seat is passed to the next person waiting immediately, rather than sitting out the offer window. `passedOn` says whether it found one.",
        ...secured("waitlist:join"),
        parameters: [{ name: "reference", in: "path", required: true, schema: str() }],
        responses: {
          200: response(
            "Declined",
            obj({
              message: str(),
              reference: str(),
              status: str(),
              passedOn: bool("Whether the seat reached someone else in the queue"),
            })
          ),
          400: response("There is no open offer", ref("Error")),
          403: response("It belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
    },

    /* ---------------- Holds ---------------- */

    "/holds": {
      get: {
        tags: ["Booking"],
        summary: "The caller's open checkouts",
        ...secured("booking:create"),
        responses: {
          200: response("Live holds", obj({ holds: arr(ref("SeatHold")) })),
          403: errors[403],
        },
      },
      post: {
        tags: ["Booking"],
        summary: "Hold seats while the passenger pays",
        description: [
          "The seats leave availability immediately, through the same path a sale",
          "uses — so from the moment checkout starts there is no window in which",
          "two people both believe they have the seat. The cost is abandoned",
          "checkouts sitting on inventory, which the hold.expire job undoes.",
        ].join(" "),
        ...secured("booking:create"),
        requestBody: body(
          obj(
            {
              tripId: int("Which departure"),
              seatIds: arr(int("Trip seat ids, at most the configured maximum")),
              fromStationId: int(),
              toStationId: int(),
            },
            ["tripId", "seatIds", "fromStationId", "toStationId"]
          )
        ),
        responses: {
          201: response("Held", obj({ message: str(), hold: ref("SeatHold") })),
          400: response("Too many seats, a cancelled departure, or a seat not on it", ref("Error")),
          403: errors[403],
          409: response("One of those seats was taken a moment ago", ref("Error")),
        },
      },
    },

    "/holds/preview": {
      post: {
        tags: ["Booking"],
        summary: "Which seats would I be given?",
        description: [
          "Reserves nothing. It exists so a passenger can see that no free seat has",
          "a charging port while they can still change their mind, rather than",
          "finding out after committing.",
          "Availability is read without their criteria applied, which is what lets",
          "the answer distinguish \"the train is full\" from \"the train has room,",
          "but not the kind you asked for\" — a filtered query cannot tell those",
          "apart.",
        ].join(" "),
        ...secured("booking:create"),
        requestBody: body(ref("SeatRequest")),
        responses: {
          200: response("A proposal", ref("SeatSuggestion")),
          400: response("More seats than may be bought together", ref("Error")),
          403: errors[403],
          409: response(
            "Nothing matches. The error details carry a per-criterion count of what is free, " +
              "and name any preference no seat can satisfy.",
            ref("Error")
          ),
        },
      },
    },

    "/holds/auto": {
      post: {
        tags: ["Booking"],
        summary: "Choose seats and hold them in one step",
        description: [
          "Selecting and holding as two calls would leave a window in which the",
          "seats just proposed are taken by someone else. So this does both, and",
          "re-chooses internally if it loses that race — a passenger sees a",
          "successful hold rather than an error they can do nothing about.",
        ].join(" "),
        ...secured("booking:create"),
        requestBody: body(ref("SeatRequest")),
        responses: {
          201: response(
            "Held",
            obj({
              message: str(),
              hold: ref("SeatHold"),
              seats: arr(ref("SellableSeat")),
              togetherness: str(),
              togetherLabel: str(),
              relaxed: arr(str()),
              attempts: int("How many times it had to re-choose before the hold stuck"),
            })
          ),
          400: response("More seats than may be bought together", ref("Error")),
          403: errors[403],
          409: response("Nothing matches, or seats are going faster than they can be held", ref("Error")),
        },
      },
    },

    "/holds/{reference}": {
      get: {
        tags: ["Booking"],
        summary: "One checkout, with its seats",
        ...secured("booking:create"),
        parameters: [pathParam("reference", "Hold reference", "string")],
        responses: {
          200: response("Hold", obj({ hold: ref("SeatHold") })),
          403: response("The checkout belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
      delete: {
        tags: ["Booking"],
        summary: "Give the seats back before paying",
        description: "Idempotent — releasing an already-released hold is not an error.",
        ...secured("booking:create"),
        parameters: [pathParam("reference", "Hold reference", "string")],
        responses: {
          200: response(
            "Released",
            obj({
              message: str(),
              reference: str(),
              status: str(),
              released: int("Seat-segments freed"),
            })
          ),
          403: response("The checkout belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
    },

    /* ---------------- Bookings ---------------- */

    "/bookings": {
      get: {
        tags: ["Booking"],
        summary: "Bookings, the caller's own unless they may see everyone's",
        ...secured("booking:create"),
        parameters: [
          queryParam("page", "1-based page number", "integer"),
          queryParam("all", "Set to 1 to list everyone's; needs booking:view_all"),
        ],
        responses: {
          200: response(
            "Bookings",
            obj({ bookings: arr(ref("Booking")), pagination: ref("Pagination") })
          ),
          403: errors[403],
        },
      },
      post: {
        tags: ["Booking"],
        summary: "Turn a hold into tickets",
        description: [
          "The transactional centrepiece: seats, tickets and money all move together",
          "or none of them do. The held seat rows are **converted** to ticket rows",
          "rather than re-inserted, so there is never an instant where the seat is",
          "free between the hold ending and the ticket existing. A decline, an",
          "overdrawn wallet or a lapsed hold rolls the whole thing back and leaves",
          "the passenger exactly where they started.",
        ].join(" "),
        ...secured("booking:create"),
        requestBody: body(
          obj(
            {
              holdReference: str("Which checkout"),
              passengers: arr(ref("Passenger")),
              method: {
                type: "string",
                enum: ["wallet", "gateway", "split"],
                description: "split spends the wallet first and puts the rest on the gateway",
              },
              gatewayToken: str("Simulated gateway handle; the token fail forces a decline"),
            },
            ["holdReference", "passengers"]
          )
        ),
        responses: {
          201: response("Confirmed", obj({ message: str(), booking: ref("Booking") })),
          400: response(
            "Declined, wallet short, hold expired mid-payment, or passenger details rejected",
            ref("Error")
          ),
          403: errors[403],
          404: response("No such checkout", ref("Error")),
        },
      },
    },

    "/bookings/quote": {
      post: {
        tags: ["Booking"],
        summary: "Price a hold before anyone commits to it",
        description:
          "Every seat on one hold travels the same stretch, but fares differ by " +
          "class, so each is priced on its own and the total is an exact integer sum.",
        ...secured("booking:create"),
        requestBody: body(obj({ holdReference: str() }, ["holdReference"])),
        responses: {
          200: response("Quote", ref("Quote")),
          400: response("The checkout has expired", ref("Error")),
          403: response("The checkout belongs to someone else", ref("Error")),
          404: errors[404],
        },
      },
    },

    "/bookings/reference/{reference}": {
      get: {
        tags: ["Booking"],
        summary: "Look a booking up by its PNR",
        ...secured("booking:create"),
        parameters: [pathParam("reference", "Booking reference", "string")],
        responses: {
          200: response("Booking", obj({ booking: ref("Booking") })),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/bookings/{id}": {
      get: {
        tags: ["Booking"],
        summary: "One booking with its tickets and payments",
        description:
          "Someone else's booking answers 404 rather than 403: whether a booking " +
          "exists is itself information.",
        ...secured("booking:create"),
        parameters: [pathParam("id", "Booking id")],
        responses: {
          200: response("Booking", obj({ booking: ref("Booking") })),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/bookings/{id}/pdf": {
      get: {
        tags: ["Booking"],
        summary: "The tickets as a printable PDF",
        description:
          "One page per ticket, each carrying its own signed QR. Generated on " +
          "demand rather than stored: it is derivable from the booking, so a saved " +
          "file would only be something to keep in step, back up and clean up.",
        ...secured("booking:create"),
        parameters: [pathParam("id", "Booking id")],
        responses: {
          200: {
            description: "The tickets",
            content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
          },
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/bookings/{id}/tickets/{ticketNumber}/qr": {
      get: {
        tags: ["Booking"],
        summary: "One ticket's QR code as a data URI",
        description:
          "For showing a ticket on screen without making the passenger open an " +
          "attachment. The same signed payload the PDF carries.",
        ...secured("booking:create"),
        parameters: [
          pathParam("id", "Booking id"),
          pathParam("ticketNumber", "Ticket number as printed", "string"),
        ],
        responses: {
          200: response(
            "QR image",
            obj({ ticketNumber: str(), seatNumber: str(), dataUrl: str("data:image/png;base64,…") })
          ),
          403: errors[403],
          404: response("No such ticket on this booking", ref("Error")),
        },
      },
    },

    /* ---------------- Shopping ---------------- */

    "/search/stations": {
      get: {
        tags: ["Shopping"],
        summary: "Stations a passenger can travel between",
        description:
          "Active stations only, in name order. Reachable with the permission to " +
          "buy, unlike /stations, which is the administrative catalogue.",
        ...secured("booking:create"),
        responses: {
          200: response(
            "Stations",
            obj({ stations: arr(obj({ id: int(), code: str(), name: str(), district: str() })) })
          ),
          403: errors[403],
        },
      },
    },

    "/search/dates": {
      get: {
        tags: ["Shopping"],
        summary: "The dates currently open for booking",
        description: "As far ahead as departures have been generated, starting today in Dhaka.",
        ...secured("booking:create"),
        parameters: [queryParam("days", "How many days to list, up to 60", "integer")],
        responses: {
          200: response("Dates", obj({ dates: arr(str("YYYY-MM-DD")) })),
          403: errors[403],
        },
      },
    },

    "/search/departures": {
      get: {
        tags: ["Shopping"],
        summary: "Trains that will carry you from A to B on a given day",
        description: [
          "Only trains whose route contains both stations, in the direction of",
          "travel, with seats actually sellable over that stretch. Each result",
          "carries a price per class and how many seats remain, so a passenger can",
          "choose without opening anything.",
          "Deliberately separate from /trips: that is the operational departure",
          "board, and answering this through it would mean giving every passenger",
          "`trip:view`.",
        ].join(" "),
        ...secured("booking:create"),
        parameters: [
          queryParam("fromStationId", "Origin station", "integer"),
          queryParam("toStationId", "Destination station", "integer"),
          queryParam("date", "YYYY-MM-DD; defaults to today in Dhaka"),
          queryParam("coachClassId", "Narrow to one class", "integer"),
        ],
        responses: {
          200: response(
            "Departures, earliest first",
            obj({
              date: str(),
              fromStationId: int(),
              toStationId: int(),
              departures: arr(ref("Departure")),
            })
          ),
          400: response("Same station both ends, a past date, or a malformed one", ref("Error")),
          403: errors[403],
        },
      },
    },

    "/search/departures/{id}/route": {
      get: {
        tags: ["Shopping"],
        summary: "Where a departure calls, and when",
        description: "The timetable a passenger reads — no generation metadata, no seat rows.",
        ...secured("booking:create"),
        parameters: [pathParam("id", "Departure id")],
        responses: {
          200: response(
            "Route",
            obj({
              tripId: int(),
              departureDate: str(),
              status: str(),
              train: obj({ id: int(), name: str(), code: str() }),
              stops: arr(
                obj({
                  sequence: int(),
                  stationId: int(),
                  station: obj({ id: int(), code: str(), name: str() }),
                  arrivalTime: str(),
                  departureTime: str(),
                  dayOffset: int(),
                  distanceKm: str(),
                })
              ),
            })
          ),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    /* ---------------- After the sale ---------------- */

    "/tickets/{ticketId}/refund-quote": {
      get: {
        tags: ["After the sale"],
        summary: "What each return policy would pay for this ticket, right now",
        description: [
          "Both policies are quoted together because the choice between them is the",
          "decision a passenger is actually making. Far from departure a convenient",
          "return pays most of the fare with certainty; close to it, it pays nothing",
          "while a demand-based return might still pay most of the fare if the seat",
          "finds another buyer. Showing one at a time hides that.",
        ].join(" "),
        ...secured("refund:request"),
        parameters: [pathParam("ticketId", "Ticket id")],
        responses: {
          200: response("Both policies priced", ref("RefundQuote")),
          400: response("The ticket has been used, or is not returnable", ref("Error")),
          404: errors[404],
          409: response("That ticket has already been returned", ref("Error")),
        },
      },
    },

    "/tickets/{ticketId}/refund": {
      post: {
        tags: ["After the sale"],
        summary: "Return the ticket",
        description: [
          "The seat goes back on sale immediately under either policy — a passenger",
          "who has decided not to travel should not be occupying a seat while the",
          "railway works out what to pay them, and for a demand return the seat",
          "being on sale is the entire mechanism.",
          "Money always lands in the wallet: three segments reselling separately",
          "would otherwise mean three gateway refunds with three sets of fees.",
        ].join(" "),
        ...secured("refund:request"),
        parameters: [pathParam("ticketId", "Ticket id")],
        requestBody: body(
          obj(
            {
              type: {
                type: "string",
                enum: ["convenient", "demand"],
                description: "disruption is not accepted here — it is issued, not requested",
              },
            },
            ["type"]
          )
        ),
        responses: {
          201: response("Returned", obj({ message: str(), refund: ref("Refund") })),
          400: response("That policy cannot be used for this ticket right now", ref("Error")),
          404: errors[404],
          409: response("Already returned", ref("Error")),
        },
      },
    },

    "/tickets/{ticketId}/transfer": {
      post: {
        tags: ["After the sale"],
        summary: "Ask to move a ticket to another passenger",
        description: [
          "Raises an approval rather than acting. Automate this and a ticket becomes",
          "a bearer instrument — buy cheap seats early, transfer them to whoever pays",
          "most later. The approval is the friction that keeps a ticket attached to a",
          "person. Nothing changes on the ticket until someone with the transfer",
          "permission agrees.",
        ].join(" "),
        ...secured("refund:request"),
        parameters: [pathParam("ticketId", "Ticket id")],
        requestBody: body(
          obj(
            {
              toNid: str("The new passenger's National ID, 10 to 17 digits"),
              toName: str("The new passenger's full name"),
              reason: str("Why — shown to whoever decides it"),
            },
            ["toNid", "toName"]
          )
        ),
        responses: {
          201: response("Requested", obj({ message: str(), request: ref("ApprovalRequest") })),
          400: response("Invalid National ID, or the ticket cannot be transferred", ref("Error")),
          404: errors[404],
          409: response("A transfer for that ticket is already waiting", ref("Error")),
        },
      },
    },

    "/refunds": {
      get: {
        tags: ["After the sale"],
        summary: "Returns, the caller's own unless they may see everyone's",
        ...secured("refund:request"),
        parameters: [
          queryParam("page", "1-based page number", "integer"),
          queryParam("all", "Set to 1 to list everyone's; needs refund:view_all"),
        ],
        responses: {
          200: response("Refunds", obj({ refunds: arr(ref("Refund")), pagination: ref("Pagination") })),
          403: errors[403],
        },
      },
    },

    "/refunds/{reference}": {
      get: {
        tags: ["After the sale"],
        summary: "One return and how much of it has been paid",
        ...secured("refund:request"),
        parameters: [pathParam("reference", "Refund reference", "string")],
        responses: {
          200: response("Refund", obj({ refund: ref("Refund") })),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/wallet/withdraw": {
      post: {
        tags: ["After the sale"],
        summary: "Ask to take credit out of the wallet",
        description: [
          "The only way money leaves the system — everything else moves credit around",
          "inside it. That makes this the one place where someone cycling purchases",
          "and refunds has to be looked at by a person, so it raises an approval and",
          "pays out nothing until one is granted.",
          "The balance is checked now and again at approval: a passenger can spend in",
          "between, and paying out on a balance since spent would overdraw the wallet.",
        ].join(" "),
        security: [{ bearerAuth: [] }],
        requestBody: body(
          obj(
            {
              amount: { type: "number", description: "In taka" },
              destination: str("An account or mobile number"),
              reason: str(),
            },
            ["amount", "destination"]
          )
        ),
        responses: {
          201: response("Requested", obj({ message: str(), request: ref("ApprovalRequest") })),
          400: response("More than the balance, or no destination given", ref("Error")),
          409: response("A withdrawal is already waiting for a decision", ref("Error")),
        },
      },
    },

    "/approvals/mine": {
      get: {
        tags: ["After the sale"],
        summary: "The caller's own requests, whatever kind",
        description: "Needs no permission beyond being signed in — these are your own.",
        security: [{ bearerAuth: [] }],
        parameters: [queryParam("page", "1-based page number", "integer")],
        responses: {
          200: response(
            "Requests",
            obj({ requests: arr(ref("ApprovalRequest")), pagination: ref("Pagination") })
          ),
          401: errors[401],
        },
      },
    },

    "/approvals/queues": {
      get: {
        tags: ["After the sale"],
        summary: "The queues, how many are waiting, and which the caller may act on",
        description:
          "`canDecide` is per caller, so a supervisor can watch a queue read-only " +
          "rather than having it hidden from them.",
        ...secured("approval:view"),
        responses: {
          200: response(
            "Queues",
            obj({
              queues: arr(
                obj({
                  type: str(),
                  label: str(),
                  description: str(),
                  permission: str("What deciding this kind requires"),
                  pending: int(),
                  canDecide: bool(),
                })
              ),
            })
          ),
          403: errors[403],
        },
      },
    },

    "/approvals": {
      get: {
        tags: ["After the sale"],
        summary: "The queue, oldest open request first",
        ...secured("approval:view"),
        parameters: [
          queryParam("type", "ticket_transfer, wallet_withdrawal or abuse_review"),
          queryParam("status", "pending, approved, rejected or cancelled"),
          queryParam("page", "1-based page number", "integer"),
        ],
        responses: {
          200: response(
            "Requests",
            obj({ requests: arr(ref("ApprovalRequest")), pagination: ref("Pagination") })
          ),
          403: errors[403],
        },
      },
    },

    "/approvals/{reference}": {
      get: {
        tags: ["After the sale"],
        summary: "One request, with everything the decision needs",
        ...secured("approval:view"),
        parameters: [pathParam("reference", "Request reference", "string")],
        responses: {
          200: response("Request", obj({ request: ref("ApprovalRequest") })),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/approvals/{reference}/decide": {
      post: {
        tags: ["After the sale"],
        summary: "Approve or reject, once",
        description: [
          "The row is locked and re-checked inside the transaction that carries out",
          "the decision, so two reviewers clicking at the same moment cannot both act",
          "on it — and if the consequence fails, an approved withdrawal the wallet can",
          "no longer cover, the request stays pending rather than being recorded as",
          "approved with nothing having happened.",
          "Which permission is required depends on the queue the request is in, so it",
          "is checked once the type is known rather than on the route.",
        ].join(" "),
        ...secured("approval:view"),
        parameters: [pathParam("reference", "Request reference", "string")],
        requestBody: body(
          obj(
            {
              decision: { type: "string", enum: ["approve", "reject"] },
              note: str("Why — recorded against the decision"),
            },
            ["decision"]
          )
        ),
        responses: {
          200: response("Decided", obj({ message: str(), request: ref("ApprovalRequest") })),
          403: response("You may see this queue but not decide it", ref("Error")),
          404: errors[404],
          409: response("Already decided", ref("Error")),
        },
      },
    },

    "/approvals/{reference}/cancel": {
      post: {
        tags: ["After the sale"],
        summary: "Withdraw your own request before anyone acts on it",
        description: "Only while it is still open — a decided request is a record, not a draft.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("reference", "Request reference", "string")],
        responses: {
          200: response("Withdrawn", obj({ message: str(), request: ref("ApprovalRequest") })),
          403: response("That request belongs to someone else", ref("Error")),
          404: errors[404],
          409: response("It has already been decided", ref("Error")),
        },
      },
    },

    "/trips/{id}/refund-options": {
      patch: {
        tags: ["Departures"],
        summary: "Choose which return policies this departure offers",
        description: [
          "Both are on unless someone turns one off. Global settings decide how much each",
          "policy deducts; this decides whether it is on the menu here at all — a train",
          "that always sells out gains nothing from a demand-based return, and one being",
          "wound down may want to stop accepting returns without stopping sales.",
          "Held under its own permission rather than trip:manage: deciding a train does",
          "not run is an operational call, while deciding how its tickets may be returned",
          "is a commercial one, and they are not always the same person.",
        ].join(" "),
        ...secured("refund:configure"),
        parameters: [pathParam("id", "Departure id")],
        requestBody: body(
          obj({
            convenient: bool("Offer the convenient return here; omit to leave unchanged"),
            demand: bool("Offer the demand-based return here; omit to leave unchanged"),
          })
        ),
        responses: {
          200: response("Updated", obj({ message: str(), trip: ref("Trip") })),
          403: errors[403],
          404: errors[404],
        },
      },
    },

    "/trips/{id}/reinstate": {
      post: {
        tags: ["Departures"],
        summary: "Put a cancelled departure back into service",
        description: [
          "Cancelling used to be a one-way door: rebuild refuses a cancelled trip, so",
          "an operator who cancelled the wrong train had destroyed that departure with",
          "no way back short of editing the database. Railways cancel for fog and",
          "reinstate when it lifts.",
          "The seats were never deleted — cancelling only marks the coaches cancelled —",
          "so tickets sold before the cancellation become valid again exactly as they",
          "were.",
        ].join(" "),
        ...secured("trip:cancel"),
        parameters: [pathParam("id", "Departure id")],
        requestBody: body(obj({ reason: str("Why it is running again") }), false),
        responses: {
          200: response(
            "Running again",
            obj({
              message: str(),
              trip: ref("Trip"),
              refundedOnCancellation: int(
                "How many tickets were refunded when it was cancelled. That money stayed with " +
                  "the passengers, so a reinstated departure comes back open for sale rather " +
                  "than carrying its old bookings."
              ),
            })
          ),
          400: response("That departure is not cancelled", ref("Error")),
          403: errors[403],
          404: errors[404],
          409: response(
            "Refunds from the cancellation are still being issued — the message names the job and how far it has got",
            ref("Error")
          ),
        },
      },
    },

    "/search/departures/{id}/seats": {
      get: {
        tags: ["Shopping"],
        summary: "The seats free for one journey, for choosing by hand",
        description:
          "The same availability engine the inventory screen uses, reached with the " +
          "permission to buy. A passenger is told what is free, not why anything " +
          "else is withheld.",
        ...secured("booking:create"),
        parameters: [
          pathParam("id", "Departure id"),
          queryParam("fromStationId", "Origin", "integer"),
          queryParam("toStationId", "Destination", "integer"),
          queryParam("coachClassId", "Narrow to one class", "integer"),
          queryParam("filters", 'Seat features as JSON, e.g. {"window":true}'),
        ],
        responses: {
          200: response(
            "Free seats",
            obj({
              tripId: int(),
              departureDate: str(),
              fromStationId: int(),
              toStationId: int(),
              totalSeats: int(),
              availableCount: int(),
              availableByClass: obj({}),
              available: arr(ref("SellableSeat")),
            })
          ),
          400: response("Stations not on the route, or the journey runs backwards", ref("Error")),
          403: errors[403],
        },
      },
    },
  },
};
