// Applies a stored colour-scheme override before first paint (kept external to satisfy the CSP).
try { document.querySelector('meta[name="color-scheme"]').content = localStorage.getItem('color-scheme') || 'light dark'; } catch (e) {}
