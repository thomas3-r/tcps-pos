// Invoice maths. All item prices are GST-inclusive (5%).
export const GST_RATE = 0.05;

export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// lines: [{price, qty}], discount: {type: 'none'|'percent'|'amount'|'csr', value}
export function computeTotals(lines, discount = { type: 'none', value: 0 }) {
  const gross = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  let discountAmount = 0;
  const v = Number(discount.value) || 0;
  if (discount.type === 'percent') discountAmount = gross * Math.min(Math.max(v, 0), 100) / 100;
  else if (discount.type === 'amount') discountAmount = Math.min(Math.max(v, 0), gross);
  else if (discount.type === 'csr') discountAmount = gross;
  discountAmount = r2(discountAmount);
  const net = r2(gross - discountAmount);            // amount payable, GST included
  const taxable = r2(net / (1 + GST_RATE));          // value before GST
  const gst = r2(net - taxable);
  const cgst = r2(gst / 2);
  const sgst = r2(gst - cgst);
  return { gross, discountAmount, net, taxable, gst, cgst, sgst };
}
