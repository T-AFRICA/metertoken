import { formatToken, groupMeter, type Vend } from './types';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const RED_TOP = '#d4161f';
const RED_BOTTOM = '#9e0e15';
const INK = '#111827';
const MUTED = '#667085';
const FAINT = '#98a2b3';
const LINE = '#eceef2';

/** Draws a token receipt as a PNG and saves it, so a customer can keep it on their phone. */
export async function downloadTokenReceipt(vend: Vend, customerName: string) {
  const tokens = vend.tokens ?? [];
  const mock = vend.adapterMode === 'mock';
  const W = 720;
  const H = 1114 + (tokens.length - 1) * 52 + (mock ? 0 : -52);
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  const css = getComputedStyle(document.documentElement);
  const sans = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const display = css.getPropertyValue('--font-display').trim() || sans;
  const mono = css.getPropertyValue('--font-mono').trim() || 'monospace';
  const font = (weight: number, size: number, family = sans) => (g.font = `${weight} ${size}px ${family}`);
  const text = (s: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  const box = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  const redBand = (y: number, h: number) => {
    const band = g.createLinearGradient(0, y, 0, y + h);
    band.addColorStop(0, RED_TOP);
    band.addColorStop(1, RED_BOTTOM);
    g.fillStyle = band;
    g.fillRect(0, y, W, h);
    // Faint rings from the corner, like the sun in the logo.
    g.save();
    g.beginPath();
    g.rect(0, y, W, h);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (let r = 60; r < 520; r += 56) {
      g.beginPath();
      g.arc(W, y, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  };

  g.fillStyle = '#f4f5f7';
  g.fillRect(0, 0, W, H);

  // ---- Header ----
  redBand(0, 210);
  try {
    const logo = await loadImage('/tronic-logo-white.png');
    g.drawImage(logo, 48, 50, 200, 200 * (logo.height / logo.width));
  } catch {
    g.fillStyle = '#fff';
    font(800, 40, display);
    text('TRONIC', 48, 92);
  }
  g.fillStyle = 'rgba(255,255,255,0.75)';
  font(600, 13);
  text('PREPAID ELECTRICITY', W - 48, 66, 'right');
  g.fillStyle = '#fff';
  font(800, 30, display);
  text('Token receipt', W - 48, 102, 'right');
  // "Issued" pill
  font(600, 13);
  const pill = 'TOKEN ISSUED';
  const pw = g.measureText(pill).width + 34;
  g.fillStyle = 'rgba(255,255,255,0.16)';
  box(W - 48 - pw, 122, pw, 28, 14);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(W - 48 - pw + 14, 136, 4, 0, Math.PI * 2);
  g.fill();
  text(pill, W - 48 - 10, 141, 'right');

  // ---- White sheet ----
  const sheetY = 170;
  const sheetH = H - sheetY - 150;
  g.save();
  g.shadowColor = 'rgba(17,24,39,0.14)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 12;
  g.fillStyle = '#fff';
  box(32, sheetY, W - 64, sheetH, 24);
  g.fill();
  g.restore();

  // Token ticket
  let y = sheetY + 32;
  const ticketH = 146 + (tokens.length - 1) * 52;
  const ticket = g.createLinearGradient(56, y, W - 56, y + ticketH);
  ticket.addColorStop(0, '#1f2533');
  ticket.addColorStop(1, '#0d1018');
  g.fillStyle = ticket;
  box(56, y, W - 112, ticketH, 18);
  g.fill();
  const glow = g.createRadialGradient(W - 56, y, 0, W - 56, y, 260);
  glow.addColorStop(0, 'rgba(239,28,38,0.35)');
  glow.addColorStop(1, 'rgba(239,28,38,0)');
  g.fillStyle = glow;
  box(56, y, W - 112, ticketH, 18);
  g.fill();

  g.fillStyle = 'rgba(255,255,255,0.6)';
  font(500, 14);
  text('Enter this token on your meter', 84, y + 38);
  g.fillStyle = '#fff';
  font(700, 14);
  text(`${vend.units} kWh`, W - 84, y + 38, 'right');
  font(600, 30, mono);
  let ty = y + 88;
  for (const t of tokens) {
    text(formatToken(t), 84, ty);
    ty += 52;
  }
  g.fillStyle = 'rgba(255,255,255,0.45)';
  font(400, 13);
  text(`Meter ${groupMeter(vend.meterNo)}`, 84, y + ticketH - 20);
  y += ticketH + 22;

  if (mock) {
    g.fillStyle = '#fff4e5';
    box(56, y, W - 112, 40, 12);
    g.fill();
    g.fillStyle = '#b54708';
    font(600, 14);
    text('TEST TOKEN — practice only, it will not load on a real meter', W / 2, y + 25, 'center');
    y += 52;
  }

  // Perforation: a dashed tear line with notches at the sheet edges.
  y += 14;
  g.strokeStyle = '#d0d5dd';
  g.setLineDash([7, 7]);
  g.beginPath();
  g.moveTo(64, y);
  g.lineTo(W - 64, y);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#f4f5f7';
  for (const x of [32, W - 32]) {
    g.beginPath();
    g.arc(x, y, 14, 0, Math.PI * 2);
    g.fill();
  }
  y += 36;

  // Details
  const amount = `${vend.currency} ${Number(vend.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows: [string, string][] = [
    ['Tenant', customerName],
    ['Meter number', groupMeter(vend.meterNo)],
    ['Units', `${vend.units} kWh`],
    ['Date', new Date(vend.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Reference', vend.reference.slice(0, 8).toUpperCase()],
  ];
  for (const [i, [k, v]] of rows.entries()) {
    g.fillStyle = MUTED;
    font(400, 16);
    text(k, 64, y + 20);
    g.fillStyle = INK;
    font(600, 16);
    text(v, W - 64, y + 20, 'right');
    if (i < rows.length - 1) {
      g.fillStyle = LINE;
      g.fillRect(64, y + 38, W - 128, 1);
    }
    y += 48;
  }

  // Amount, set apart
  y += 8;
  g.fillStyle = '#fdecec';
  box(56, y, W - 112, 64, 14);
  g.fill();
  g.fillStyle = '#c4121b';
  font(600, 14);
  text('AMOUNT', 80, y + 38);
  g.fillStyle = INK;
  font(800, 26, display);
  text(amount, W - 80, y + 42, 'right');
  y += 88;

  // How to load
  g.fillStyle = FAINT;
  font(600, 12);
  text('HOW TO LOAD', 64, y);
  y += 26;
  const steps = ['Type the 20 digits on your meter keypad', 'Press Enter (or #)', 'Check the credit on the meter screen'];
  for (const [i, s] of steps.entries()) {
    g.fillStyle = '#fdecec';
    g.beginPath();
    g.arc(76, y - 5, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c4121b';
    font(700, 12);
    text(String(i + 1), 76, y - 1, 'center');
    g.fillStyle = INK;
    font(400, 15);
    text(s, 100, y);
    y += 32;
  }

  // ---- Red footer ----
  redBand(H - 120, 120);
  g.fillStyle = '#fff';
  font(700, 18, display);
  text('Thank you for choosing Tronic', W / 2, H - 66, 'center');
  g.fillStyle = 'rgba(255,255,255,0.75)';
  font(400, 13);
  text('Keep this receipt until the token is loaded  ·  Tronic Token Desk', W / 2, H - 40, 'center');

  const d = new Date(vend.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `tronic-token-${vend.meterNo}-${stamp}.png`;
  a.click();
}
