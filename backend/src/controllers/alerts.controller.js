import * as alertService from '../services/alerts/alert.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { data, total, counts_by_severity } = await alertService.listAlerts(query);
  res.json({ data, meta: { total, page: query.page, limit: query.limit, counts_by_severity } });
}

export async function show(req, res) {
  res.json({ data: await alertService.getAlert(req.validated.params.id) });
}

export async function update(req, res) {
  res.json({ data: await alertService.resolveAlert(req.validated.params.id) });
}
