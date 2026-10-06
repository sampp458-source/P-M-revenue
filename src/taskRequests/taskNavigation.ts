export function taskRequestPath(id?: string) {
 const params = new URLSearchParams({ scope: 'inbox', filter: 'active' });
 if (id) params.set('task', id);
 return `/operations/requests?${params}`;
}
