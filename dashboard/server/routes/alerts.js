import { HttpError, audit } from '../util.js';
import { alertStore, EVENT_LABELS, validateWebhook, sendDiscord } from '../notify.js';

const hint = (u) => (u ? `${new URL(u).hostname}/…${u.slice(-6)}` : '');

export default async function (app) {
  app.get('/api/alerts', async () => {
    const s = await alertStore.read();
    return { urlSet: !!s.discordUrl, urlHint: hint(s.discordUrl), events: s.events, labels: EVENT_LABELS };
  });

  app.put('/api/alerts', async (req) => {
    const { url, clear, events } = req.body || {};
    try {
      await alertStore.mutate((d) => {
        if (clear) d.discordUrl = '';
        else if (url) d.discordUrl = validateWebhook(url);
        if (events && typeof events === 'object') for (const k of Object.keys(d.events)) if (k in events) d.events[k] = !!events[k];
      });
    } catch (e) { throw new HttpError(400, e.message); }
    await audit(req, 'alerts.update');
    return { ok: true };
  });

  app.post('/api/alerts/test', async (req) => {
    const s = await alertStore.read();
    if (!s.discordUrl) throw new HttpError(400, 'Add a webhook address first');
    try { await sendDiscord(s.discordUrl, { title: '✅ Test message', description: `Sent by ${req.user.username} from the dashboard.`, color: 'green' }); }
    catch (e) { throw new HttpError(502, e.message); }
    return { ok: true };
  });
}
