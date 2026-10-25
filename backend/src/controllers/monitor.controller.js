export function createMonitorController({ monitorService }) {
  return {
    async create(req, res) {
      const result = await monitorService.processBatch(req.body, {
        source: 'http',
        requestId: req.id,
        log: req.log,
      });
      res.json(result);
    },
  };
}
