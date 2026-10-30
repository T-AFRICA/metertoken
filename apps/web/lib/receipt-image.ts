import { formatToken, type Vend } from './types';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Draws a token receipt as a PNG and saves it, so a customer can keep it on their phone. */
export async function downloadTokenReceipt(vend: Vend, customerName: string) {
  const W = 720;
  const H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  const sans = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const band = g.createLinearGradient(0, 0, 0, 150);
  band.addColorStop(0, '#d4161f');
  band.addColorStop(1, '#9e0e15');
  g.fillStyle = band;
  g.fillRect(0, 0, W, 150);
  try {
    const logo = await loadImage('/tronic-logo-white.png');
    g.drawImage(logo, 48, 46, 220, 220 * (logo.height / logo.width));
  } catch {
    g.fillStyle = '#fff';
    g.font = `800 40px ${sans}`;
    g.fillText('TRONIC', 48, 92);
  }
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = `500 18px ${sans}`;
  g.textAlign = 'right';
  g.fillText('Electricity token', W - 48, 86);
  g.textAlign = 'left';

  g.fillStyle = '#667085';
  g.font = `500 16px ${sans}`;
  g.fillText('Enter this token on your meter', 48, 210);
  g.fillStyle = '#111827';
  g.font = `600 34px ${mono}`;
  let y = 262;
  for (const t of vend.tokens ?? []) {
    g.fillText(formatToken(t), 48, y);
    y += 50;
  }

  if (vend.adapterMode === 'mock') {
    g.fillStyle = '#fdecec';
    g.fillRect(48, y - 14, W - 96, 44);
    g.fillStyle = '#c4121b';
    g.font = `600 15px ${sans}`;
    g.fillText('TEST TOKEN — practice only, it will not load on a real meter', 64, y + 14);
    y += 50;
  }

  y += 30;
  g.strokeStyle = '#e6e8ec';
  g.beginPath();
  g.moveTo(48, y);
  g.lineTo(W - 48, y);
  g.stroke();
  y += 44;

  const rows: [string, string][] = [
    ['Customer', customerName],
    ['Meter number', vend.meterNo],
    ['Units', `${vend.units} kWh`],
    ['Amount', `${vend.currency} ${Number(vend.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
    ['Date', new Date(vend.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Reference', vend.reference.slice(0, 8).toUpperCase()],
  ];
  for (const [k, v] of rows) {
    g.fillStyle = '#667085';
    g.font = `400 18px ${sans}`;
    g.fillText(k, 48, y);
    g.fillStyle = '#111827';
    g.font = `600 18px ${sans}`;
    g.textAlign = 'right';
    g.fillText(v, W - 48, y);
    g.textAlign = 'left';
    y += 44;
  }

  g.fillStyle = '#98a2b3';
  g.font = `400 14px ${sans}`;
  g.textAlign = 'center';
  g.fillText('Keep this receipt until the token is loaded. Tronic Token Desk', W / 2, H - 40);

  const d = new Date(vend.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `tronic-token-${vend.meterNo}-${stamp}.png`;
  a.click();
}
