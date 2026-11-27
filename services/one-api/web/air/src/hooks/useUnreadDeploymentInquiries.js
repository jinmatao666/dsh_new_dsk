import { useEffect, useState } from 'react';
import { API, isAdmin } from '../helpers';

export default function useUnreadDeploymentInquiries(refreshKey) {
  const [unreadInquiries, setUnreadInquiries] = useState(0);
  useEffect(() => {
    if (!isAdmin()) return;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const response = await API.get('/api/feedback/list', {
          params: { page: 1, per_page: 1, feedback_type: 'deployment_inquiry', read: false },
        });
        if (current === request && response?.data?.success) setUnreadInquiries(response.data.data.total);
      } catch {
        // Keep the last confirmed count when the request fails.
      }
    };
    void refresh();
    window.addEventListener('deployment-inquiry-read-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      ++request;
      window.removeEventListener('deployment-inquiry-read-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshKey]);
  return unreadInquiries;
}
