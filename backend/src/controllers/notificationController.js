const asyncHandler = require("../utils/asyncHandler");
const inbox = require("../services/inboxService");

const truthy = (v) => v === "1" || v === "true";

/** Every call works on the signed-in person's own inbox; nobody reads another's. */
const list = asyncHandler(async (req, res) => {
  res.json(
    await inbox.list(req.user.id, {
      unread: truthy(req.query.unread),
      category: req.query.category,
      before: req.query.before,
      limit: req.query.limit,
    })
  );
});

const summary = asyncHandler(async (req, res) => {
  res.json(await inbox.summary(req.user.id));
});

const markRead = asyncHandler(async (req, res) => {
  res.json(await inbox.markRead(req.user.id, req.body.all === true ? "all" : req.body.ids));
});

const markUnread = asyncHandler(async (req, res) => {
  res.json(await inbox.markUnread(req.user.id, req.params.id));
});

const remove = asyncHandler(async (req, res) => {
  res.json(await inbox.remove(req.user.id, req.params.id));
});

module.exports = { list, summary, markRead, markUnread, remove };
