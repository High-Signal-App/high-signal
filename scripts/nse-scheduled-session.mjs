import { pathToFileURL } from 'node:url';

const scheduledDays = new Map([
  ['30 13 * * *', [0, 1, 2, 3, 4, 5, 6]],
  ['30 21 * * 0,6', [0, 6]],
  ['30 21 * * 1-5', [1, 2, 3, 4, 5]],
]);

// A runner can start after midnight UTC. Use the latest matching scheduled
// tick at creation of the original run so a later retry selects the same file.
export function nseScheduledSession(expression, createdAt) {
  const days = scheduledDays.get(expression);
  const created = new Date(createdAt);
  if (!days || !Number.isFinite(created.getTime()))
    throw new Error('Invalid NSE schedule or run creation time');
  const [minute, hour] = expression.split(' ').map(Number);
  const tick = new Date(created);
  tick.setUTCHours(hour, minute, 0, 0);
  if (tick > created) tick.setUTCDate(tick.getUTCDate() - 1);
  while (!days.includes(tick.getUTCDay())) tick.setUTCDate(tick.getUTCDate() - 1);
  return tick.toISOString().slice(0, 10);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(nseScheduledSession(process.argv[2], process.argv[3]));
}
