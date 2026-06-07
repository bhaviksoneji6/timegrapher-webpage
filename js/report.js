export async function generateAndShare(results, traceDataUrl) {
  const canvas = document.createElement('canvas');
  const W = 800, H = 480;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  // Header bar
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, 56);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Timegrapher', 24, 36);

  // Date
  const dateStr = new Date().toLocaleString();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 24, 36);

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 56);
  ctx.lineTo(W, 56);
  ctx.stroke();

  // Metrics row
  const metrics = [
    { label: 'Rate', value: formatRate(results.rateSPerDay), unit: 's/day', color: rateColor(results.rateSPerDay) },
    { label: 'Beat Error', value: results.beatErrorMs.toFixed(1), unit: 'ms', color: beatColor(results.beatErrorMs) },
    { label: 'Beat Rate', value: results.bph.toLocaleString(), unit: 'BPH', color: '#ffffff' },
  ];

  const colW = W / 3;
  metrics.forEach((m, i) => {
    const cx = colW * i + colW / 2;
    ctx.textAlign = 'center';

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(m.label, cx, 82);

    ctx.fillStyle = m.color;
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(m.value, cx, 120);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(m.unit, cx, 138);
  });

  // Column dividers
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(colW, 64); ctx.lineTo(colW, 148); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(colW * 2, 64); ctx.lineTo(colW * 2, 148); ctx.stroke();

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath(); ctx.moveTo(0, 152); ctx.lineTo(W, 152); ctx.stroke();

  // Trace image
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 152, W, H - 152 - 32);
      resolve();
    };
    img.src = traceDataUrl;
  });

  // Footer
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, H - 32, W, 32);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Measured with Timegrapher Web App', W / 2, H - 12);

  // Share or download
  canvas.toBlob(async (blob) => {
    const filename = `timegrapher-${Date.now()}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Timegrapher Result' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled
      }
    }

    // Fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}

function formatRate(r) {
  const abs = Math.abs(r);
  const sign = r >= 0 ? '+' : '-';
  return `${sign}${abs.toFixed(1)}`;
}

function rateColor(r) {
  const abs = Math.abs(r);
  if (abs <= 5) return '#4caf50';
  if (abs <= 15) return '#ff9f4a';
  return '#f44336';
}

function beatColor(ms) {
  if (ms <= 1.0) return '#4caf50';
  if (ms <= 2.0) return '#ff9f4a';
  return '#f44336';
}
