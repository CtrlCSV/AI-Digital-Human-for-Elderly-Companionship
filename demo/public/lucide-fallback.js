(function () {
  if (window.lucide && typeof window.lucide.createIcons === 'function') return;

  const common = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'bell': '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>',
    'bell-plus': '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M12 5v6"/><path d="M9 8h6"/>',
    'bell-ring': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>',
    'book-open': '<path d="M12 7v14"/><path d="M3 18a2 2 0 0 1 2-2h7V5H5a2 2 0 0 0-2 2z"/><path d="M21 18a2 2 0 0 0-2-2h-7V5h7a2 2 0 0 1 2 2z"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'circle-help': '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.8 1c-.7 1.2-2.1 1.5-2.6 2.7"/><path d="M12 17h.01"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'cloud': '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 12.5 4.5 4.5 0 0 1 17.5 19z"/>',
    'cloud-fog': '<path d="M17.5 17H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 10.5 4.5 4.5 0 0 1 17.5 17z"/><path d="M5 21h14"/><path d="M7 19h10"/>',
    'cloud-lightning': '<path d="M17.5 17H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 10.5 4.5 4.5 0 0 1 17.5 17z"/><path d="m13 14-2 5h4l-2 4"/>',
    'cloud-rain': '<path d="M17.5 16H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 9.5 4.5 4.5 0 0 1 17.5 16z"/><path d="M8 19v2"/><path d="M12 19v2"/><path d="M16 19v2"/>',
    'cloud-snow': '<path d="M17.5 16H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 9.5 4.5 4.5 0 0 1 17.5 16z"/><path d="M8 20h.01"/><path d="M12 20h.01"/><path d="M16 20h.01"/>',
    'cloud-sun': '<path d="M12 2v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m17.7 6.3 1.4-1.4"/><path d="M16 13a4 4 0 0 0-7.7-1.5"/><path d="M17.5 21H8a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 20 15.5 3.5 3.5 0 0 1 17.5 21z"/>',
    'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'footprints': '<path d="M4 16c1-3 2.5-5 4-5 1.7 0 2.4 1.8 1.5 3.5C8.4 16.6 6.8 18 5.3 18 4.3 18 3.7 17.2 4 16z"/><path d="M14.5 9.5C13.6 7.8 14.3 6 16 6c1.5 0 3 2 4 5 .3 1.2-.3 2-1.3 2-1.5 0-3.1-1.4-4.2-3.5z"/><path d="M7 4h.01"/><path d="M10 5h.01"/><path d="M17 18h.01"/><path d="M14 19h.01"/>',
    'glass-water': '<path d="M15.2 22H8.8a2 2 0 0 1-2-1.8L5 2h14l-1.8 18.2a2 2 0 0 1-2 1.8z"/><path d="M6 12h12"/><path d="M7 7h10"/>',
    'heart-handshake': '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.6z"/><path d="m8 13 2-2 2 2 4-4"/><path d="m14 15 2-2"/>',
    'heart-pulse': '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.6z"/><path d="M3 12h4l2-4 4 8 2-4h6"/>',
    'history': '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/>',
    'image-plus': '<path d="M16 5h6"/><path d="M19 2v6"/><rect x="3" y="5" width="14" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-3.5-3.5L9 20"/>',
    'languages': '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    'map-pin': '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    'message-circle': '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-4.2-1.1L3 21l1.3-4A8.5 8.5 0 1 1 21 11.5z"/>',
    'messages-square': '<path d="M14 9a2 2 0 0 1 2 2v7l-3-3H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8z"/><path d="M18 9h1a2 2 0 0 1 2 2v7l-3-3h-2"/>',
    'mic': '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'newspaper': '<path d="M4 22h14a2 2 0 0 0 2-2V4H6a2 2 0 0 0-2 2z"/><path d="M4 8h16"/><path d="M8 12h8"/><path d="M8 16h5"/>',
    'panel-right-open': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>',
    'pencil': '<path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5z"/><path d="m15 5 4 4"/>',
    'phone-off': '<path d="M10.7 13.3a15.1 15.1 0 0 0 4 4l2.2-2.2a2 2 0 0 1 2-.5 12.8 12.8 0 0 0 3 .5 2 2 0 0 1 2 2v3.4a2 2 0 0 1-2 2A19.9 19.9 0 0 1 2 4a2 2 0 0 1 2-2h3.5a2 2 0 0 1 2 2 12.8 12.8 0 0 0 .5 3 2 2 0 0 1-.5 2z"/><path d="m2 2 20 20"/>',
    'pill': '<path d="M10.5 20.5 20.5 10.5a4.2 4.2 0 0 0-6-6l-10 10a4.2 4.2 0 0 0 6 6z"/><path d="m8.5 12.5 3 3"/>',
    'plus': '<path d="M12 5v14"/><path d="M5 12h14"/>',
    'plus-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    'send': '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    'settings': '<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.9 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.7 1z"/>',
    'smile': '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
    'sparkles': '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    'trash-2': '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    'video': '<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    'video-off': '<path d="M10.7 6H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1"/><path d="M23 7l-7 5 7 5z"/><path d="m2 2 20 20"/>',
    'volume-2': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    'volume-off': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
    'wind': '<path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M3 12h18"/><path d="M3 16h10a3 3 0 1 1-3 3"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  function sizeFrom(style, prop, fallback) {
    const match = String(style || '').match(new RegExp(prop + '\\s*:\\s*(\\d+)px', 'i'));
    return match ? match[1] : fallback;
  }

  function createIcons() {
    document.querySelectorAll('[data-lucide]').forEach((node) => {
      const name = node.getAttribute('data-lucide');
      const body = icons[name] || icons.circle-help;
      const width = node.getAttribute('width') || sizeFrom(node.getAttribute('style'), 'width', '24');
      const height = node.getAttribute('height') || sizeFrom(node.getAttribute('style'), 'height', width);
      const style = node.getAttribute('style') || '';
      const cls = node.getAttribute('class') || '';
      const id = node.getAttribute('id') ? ` id="${node.getAttribute('id')}"` : '';
      const svg = `<svg${id} xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 24" ${common} class="${cls}" style="${style}" aria-hidden="true">${body}</svg>`;
      node.outerHTML = svg;
    });
  }

  window.lucide = { createIcons };
})();
