export default function toast(message: string, opts?: { duration?: number; type?: 'info' | 'error' | 'success' }) {
  const duration = opts?.duration ?? 4000;
  const type = opts?.type ?? 'info';

  try {
    const rootId = 'duplidetect-toast-root';
    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement('div');
      root.id = rootId;
      root.style.position = 'fixed';
      root.style.right = '16px';
      root.style.bottom = '16px';
      root.style.zIndex = '9999';
      document.body.appendChild(root);
    }

    const el = document.createElement('div');
    el.textContent = message;
    el.style.marginTop = '8px';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '10px';
    el.style.boxShadow = '0 6px 18px rgba(2,6,23,0.2)';
    el.style.color = '#fff';
    el.style.fontSize = '13px';
    el.style.maxWidth = '320px';
    el.style.wordBreak = 'break-word';
    el.style.opacity = '0';
    el.style.transition = 'opacity 220ms, transform 220ms';
    el.style.transform = 'translateY(6px)';

    if (type === 'error') el.style.background = '#ef4444';
    else if (type === 'success') el.style.background = '#10b981';
    else el.style.background = 'rgba(17,24,39,0.9)';

    root.appendChild(el);

    // fade in
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

    const timeout = setTimeout(() => {
      // fade out
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => {
        try { root?.removeChild(el); } catch {};
      }, 300);
    }, duration);

    // allow manual dismiss on click
    el.addEventListener('click', () => {
      clearTimeout(timeout);
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => {
        try { root?.removeChild(el); } catch {};
      }, 220);
    });
  } catch (e) {
    // Fallback: alert
    try { console.error('Toast error', e); } catch {}
  }
}
