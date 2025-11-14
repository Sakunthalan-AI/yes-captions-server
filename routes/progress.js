import { getProgress } from "../lib/progressStore.js";

export function progressRoute(req, res) {
  const exportId = req.query.exportId;

  if (!exportId) {
    return res.status(400).json({ error: "Missing exportId" });
  }

  const progress = getProgress(exportId);
  return res.json({ progress });
}



