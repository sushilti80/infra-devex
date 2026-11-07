/**
 * Ship from Repo API (docs/architecture/ship-from-repo-spec.md §4.1 endpoints 1–9), mounted at /api/ship.
 * Thin controllers: auth → validators → service → `{ success, data | error, correlationId }` envelope.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const shipService = require('../services/shipService');
const shipStatus = require('../services/shipStatusService');
const v = require('../utils/shipValidators');
const { ShipError } = require('../utils/shipErrors');

router.use(requireAuth);

const ok = (res, status, data, correlationId) => res.status(status).json({ success: true, data, correlationId });

function sendError(req, res, error, correlationId) {
  let err = error;
  if (!(err instanceof ShipError)) {
    logger.error(`[${correlationId}] ship route error: ${error && error.message}`, { requestId: req.correlationId });
    err = new ShipError(500, 'UNKNOWN', 'Unexpected error.');
  }
  if (err.retryAfterSec) res.set('Retry-After', String(err.retryAfterSec));
  const body = { code: err.code, message: err.message };
  if (err.details !== undefined) body.details = err.details;
  if (err.hint) body.hint = err.hint;
  return res.status(err.status).json({ success: false, error: body, correlationId });
}

/** `idOf(req)` yields the envelope correlationId (the ship ID for per-ship routes, else the request ID). */
const handle = (fn, idOf = (req) => req.correlationId) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendError(req, res, error, idOf(req));
  }
};
const shipIdOf = (req) => req.params.correlationId;

// 1
router.get('/config', handle(async (req, res) => ok(res, 200, await shipService.getConfig(req.user), req.correlationId)));

// 2
router.get('/repos', v.reposQuery, v.handleValidation, handle(async (req, res) => {
  ok(res, 200, await shipService.listRepos(req.user, { q: req.query.q, limit: req.query.limit }), req.correlationId);
}));

// 3
router.get('/repos/:org/:repo/branches', v.branchesParams, v.handleValidation, handle(async (req, res) => {
  ok(res, 200, await shipService.listBranches(req.user, req.params.org, req.params.repo, { q: req.query.q, page: req.query.page }), req.correlationId);
}));

// 4
router.get('/apps/:env/:app', v.appStateParams, v.handleValidation, handle(async (req, res) => {
  ok(res, 200, await shipService.getAppAdvisory(req.user, req.params.env, req.params.app, req.query.repo), req.correlationId);
}));

// 5 — only whitelisted body keys are read; actor / oid / GitHub login always come from the verified token / identity provider
router.post('/', v.startShipValidators, v.handleValidation, handle(async (req, res) => {
  const input = v.pickStartBody(req.body);
  const provided = { port: req.body.port !== undefined, healthPath: req.body.healthPath !== undefined };
  const started = await shipService.start(req.user, input, { provided, requestId: req.correlationId });
  ok(res, 202, started, started.correlationId);
}));

// 6
router.get('/status/:correlationId', v.shipIdParam, v.handleValidation, handle(async (req, res) => {
  ok(res, 200, await shipStatus.getStatus(req.params.correlationId, req.user, { requestId: req.correlationId }), req.params.correlationId);
}, shipIdOf));

// 7
router.get('/logs/:correlationId', v.shipIdParam, v.logsQuery, v.handleValidation, handle(async (req, res) => {
  const cid = req.params.correlationId;
  const download = req.query.download === '1';
  const result = await shipStatus.getLogs(cid, req.user, { stage: req.query.stage, offset: Number(req.query.offset || 0), download, requestId: req.correlationId });
  if (download && result.available) {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="ship-${cid}-${req.query.stage}.log"`);
    return res.status(200).send(result.text);
  }
  const { download: _omit, ...data } = result;
  return ok(res, 200, data, cid);
}, shipIdOf));

// 8
router.post('/:correlationId/cancel', v.shipIdParam, v.handleValidation, handle(async (req, res) => {
  ok(res, 200, await shipService.cancel(req.user, req.params.correlationId, { requestId: req.correlationId }), req.params.correlationId);
}, shipIdOf));

// 9
router.post('/:correlationId/retry-config-pr', v.shipIdParam, v.handleValidation, handle(async (req, res) => {
  ok(res, 202, await shipService.retryConfigPr(req.user, req.params.correlationId, { requestId: req.correlationId }), req.params.correlationId);
}, shipIdOf));

module.exports = router;
