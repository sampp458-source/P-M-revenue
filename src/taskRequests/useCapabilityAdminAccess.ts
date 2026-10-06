import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchCurrentOperationRole } from '../pages/operationsScheduleRepository';

// Administration uses the existing self-membership contract, independently of Task runtime.
export function useCapabilityAdminAccess() {
  const { profile } = useAuth();
  const identity = profile?.isActive && profile.accountStatus === 'active' ? profile.id : undefined;
  const [loaded, setLoaded] = useState<{ identity: string; owner: boolean }>();
  useEffect(() => {
    if (!identity) return;
    let live = true;
    let generation = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const request = ++generation;
      void fetchCurrentOperationRole(identity).then(role => {
        if (live && request === generation) setLoaded({ identity, owner: role === 'owner' });
      }).catch(() => {
        if (live && request === generation) setLoaded({ identity, owner: false });
      });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [identity]);
  return {
    owner: !!identity && loaded?.identity === identity && loaded.owner,
    loading: !!identity && loaded?.identity !== identity,
  };
}
