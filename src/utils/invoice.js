import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatTHB, getBase64FromUrl } from "./format";

export async function generateInvoicePDF(order, customer) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();

  // Logo
  try {
    const logoData = await getBase64FromUrl(`/logo.png?cb=${Date.now()}`);
    doc.addImage(logoData, "PNG", pageWidth - 50, 10, 40, 25);
  } catch {}

  doc.setFontSize(20);
  doc.text("INVOICE", 14, 20);

  doc.setFontSize(11);
  doc.text("Selera Malaysia Bangkok", 14, 30);
  doc.text("Phone: +66 9 8284 1569", 14, 36);

  let y = 50;
  doc.setFontSize(12); doc.text("Bill To:", 14, y); y += 6;
  doc.setFontSize(11);
  if (customer?.name)  { doc.text(customer.name, 14, y); y += 6; }
  if (customer?.phone) { doc.text("Phone: " + customer.phone, 14, y); y += 6; }
  if (customer?.address) { doc.text("Address: " + customer.address, 14, y); y += 6; }

  y = 50;
  doc.text(`Invoice #: ${order.orderCode}`, pageWidth/2, y); y += 6;
  doc.text(`Date: ${order.date}`, pageWidth/2, y);

  const rows = (order.items || []).map(it => [
    it.productName || "",
    String(it.qty),
    String(it.price),
    String((Number(it.qty) * Number(it.price)).toFixed(2))
  ]);
  autoTable(doc, {
    startY: 90,
    head: [["Description", "Qty", "Unit Price", "Amount"]],
    body: rows,
    styles: { fontSize: 11 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
    theme: "grid",
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(12);
  doc.text(`Subtotal: ${formatTHB(order.subtotal)}`, 14, finalY);
  doc.text(`Delivery Fee: ${formatTHB(order.deliveryFee)}`, 14, finalY + 6);
  doc.setFontSize(14);
  doc.text(`TOTAL: ${formatTHB(order.total)}`, 14, finalY + 16);

  const payY = finalY + 30;
  doc.setFontSize(12);
  doc.text("Payment:", 14, payY);
  doc.setFontSize(11);
  doc.text("Krungsri / Bank Ayudhaya : 511 1345 714", 14, payY + 6);
  doc.text("PromptPay: 098 284 1569", 14, payY + 12);
  doc.text("Thank you for your order!", 14, payY + 24);

  doc.save(`invoice_${order.orderCode}.pdf`);
}
