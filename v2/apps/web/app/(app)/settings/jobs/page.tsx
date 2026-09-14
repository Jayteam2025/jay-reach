import { getTranslations } from 'next-intl/server';
import { QUEUES } from '@jay-reach/core';
import { AppTopBar } from '../../chrome';

export default async function JobsPage() {
  const t = await getTranslations();

  return (
    <div className="rs-shell">
      <AppTopBar active="jobs" />
      <main className="rs-main">
        <h1>{t('jobs.title')}</h1>
        <div className="rs-card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th className="rs-eyebrow" style={{ textAlign: 'left', padding: '10px 14px' }}>{t('jobs.queue')}</th>
                <th className="rs-eyebrow" style={{ textAlign: 'left', padding: '10px 14px' }}>{t('jobs.description')}</th>
                <th className="rs-eyebrow" style={{ textAlign: 'left', padding: '10px 14px' }}>{t('jobs.retries')}</th>
              </tr>
            </thead>
            <tbody>
              {QUEUES.map((queue) => (
                <tr key={queue.name} style={{ borderTop: '1px solid var(--slate2)' }}>
                  <td className="mono" style={{ padding: '9px 14px', color: 'var(--lime2)', fontSize: 13 }}>
                    {queue.name}
                  </td>
                  <td style={{ padding: '9px 14px', fontSize: 14 }}>{t(queue.descriptionKey)}</td>
                  <td className="mono" style={{ padding: '9px 14px' }}>{queue.retry.retryLimit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
