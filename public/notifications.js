self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin || target.pathname !== '/') return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const match = windows.find(client => client.url === target.href);
    if (match) return match.focus();
    return self.clients.openWindow(target.href);
  })());
});
